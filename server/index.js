const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const { execFileSync } = require('child_process');
// Restore the SQLite file before auth/storage modules open it.
require('./blob-sync').restoreSync();
const auth = require('./auth');
const store = require('./store');
const { sendResetEmail, mailConfig } = require('./mailer');
const { ownerId } = auth.initAuth();

const PORT = parseInt(process.env.PORT, 10) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const REPO_DIR = process.env.REPO_DIR
  ? path.resolve(process.env.REPO_DIR)
  : [
      path.join(ROOT, 'ai-job-search'),
      path.resolve(__dirname, '../../ai-job-search'),
      path.resolve(__dirname, '../../2026-11-17-22-21-42/ai-job-search'),
    ].find(candidate => fs.existsSync(candidate)) || path.join(ROOT, 'ai-job-search');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Per-user data file paths are resolved by server/auth.js using async-local context.
const DATA_FILES = auth.DATA_FILES;

// Initialize data files
function initDataFile(file, defaultData) {
  if (store.readFile(file) == null) {
    store.writeFile(file, defaultData);
  }
}

function initializeUserDataFiles(userId) {
  auth.runWithUser(userId, () => {
    initDataFile(DATA_FILES.profile, {
      identity: { name: '', location: '', phone: '', email: '', linkedin: '', github: '', status: '', cvLanguage: 'English' },
      languages: [],
      education: [],
      experience: [],
      skills: { primary: [], secondary: [], domain: [], software: [] },
      publications: [],
      awards: [],
      references: [],
      behavioral: { traits: [], strengths: [], growthAreas: [], thrivesIn: [] },
      careerGoals: { targetRoles: [], targetSectors: [], dealBreakers: [], whatExcites: [], whatDrains: [] },
      writingStyle: { tone: '', structure: '', dos: [], donts: [] },
      cvTemplates: [],
      coverLetterTemplates: [],
      starExamples: [],
      searchConfig: { roleTitles: [], keySkills: [], targetCompanies: [], locations: [], portals: [] }
    });
    initDataFile(DATA_FILES.tracker, []);
    initDataFile(DATA_FILES.seenJobs, { seen: {} });
    initDataFile(DATA_FILES.applications, []);
    initDataFile(DATA_FILES.searchQueries, { priorities: [], locationFilter: {}, languageFilter: {} });
    initDataFile(DATA_FILES.salaryData, { metadata: { index_baseline: 100, index_label: 'Index' }, companies: [] });
    initDataFile(DATA_FILES.reports, []);
    initDataFile(DATA_FILES.llmConfig, { providers: [], lastTested: null });
  });
}

initializeUserDataFiles(ownerId);

// Utility functions
function readJSON(file) {
  return store.readFile(file);
}

function writeJSON(file, data) {
  store.writeFile(file, data);
}

function currentUserId() {
  const ctx = auth.requestContext.getStore();
  return ctx && ctx.userId ? ctx.userId : 'owner';
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ============ LLM integration ============
// When a valid provider config is saved, AI-powered features use it directly.
// Every feature keeps a deterministic local fallback when no config exists or
// when the provider call fails.
function normalizeLLMConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const now = new Date().toISOString();
  let models = Array.isArray(c.models) ? c.models : [];

  // Migrate the old single-model shape into the multi-model shape.
  if (!models.length && c.provider && c.apiKey && c.model) {
    models = [{
      id: 'default',
      label: `${c.provider} / ${c.model}`,
      provider: c.provider,
      apiKey: c.apiKey,
      model: c.model,
      baseUrl: c.baseUrl || '',
      enabled: true,
      lastTested: c.lastTested || null,
      lastError: '',
    }];
  }

  models = models.filter(m => m && m.provider && m.apiKey && m.model).map((m, i) => ({
    id: String(m.id || `model_${i + 1}`),
    label: String(m.label || `${m.provider} / ${m.model}`),
    provider: String(m.provider),
    apiKey: String(m.apiKey),
    model: String(m.model),
    baseUrl: String(m.baseUrl || ''),
    enabled: m.enabled !== false,
    lastTested: m.lastTested || null,
    lastError: String(m.lastError || ''),
    lastSuccess: m.lastSuccess || null,
  }));

  const activeId = c.activeModelId === 'auto' || models.some(m => m.id === c.activeModelId)
    ? c.activeModelId
    : 'auto';

  return {
    version: 2,
    models,
    activeModelId: activeId,
    lastTested: c.lastTested || null,
    createdAt: c.createdAt || now,
    updatedAt: c.updatedAt || now,
  };
}

function readLLMConfig() {
  const raw = readJSON(DATA_FILES.llmConfig) || {};
  const normalized = normalizeLLMConfig(raw);
  if (!Array.isArray(raw.models)) writeJSON(DATA_FILES.llmConfig, normalized);
  return normalized;
}

function writeLLMConfig(config) {
  writeJSON(DATA_FILES.llmConfig, normalizeLLMConfig(config));
}

function getLLMConfig() {
  const config = readLLMConfig();
  return config.models.length ? config : null;
}

function llmConfigured() {
  const config = readLLMConfig();
  return config.models.some(m => m.enabled !== false);
}

function updateModelStatus(id, ok, error) {
  if (!id || id === 'default' && !readLLMConfig().models.some(m => m.id === id)) return;
  const config = readLLMConfig();
  const model = config.models.find(m => m.id === id);
  if (!model) return;
  const now = new Date().toISOString();
  model.lastTested = now;
  model.lastError = ok ? '' : String(error || '').slice(0, 300);
  if (ok) model.lastSuccess = now;
  config.lastTested = now;
  writeLLMConfig(config);
}

async function callSingleLLM(config, userPrompt, systemPrompt, options = {}) {
  const provider = String(config.provider || '').toLowerCase();
  const isAnthropic = provider.includes('anthropic') && !config.baseUrl;
  const baseUrl = (config.baseUrl || (isAnthropic ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1')).replace(/\/+$/, '');

  let endpoint, headers, payload;
  if (isAnthropic) {
    endpoint = baseUrl + '/messages';
    headers = {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    };
    payload = {
      model: config.model,
      max_tokens: options.maxTokens || 2500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    };
  } else {
    endpoint = baseUrl + '/chat/completions';
    headers = {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + config.apiKey,
    };
    payload = {
      model: config.model,
      temperature: typeof options.temperature === 'number' ? options.temperature : 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };
    if (options.maxTokens) payload.max_tokens = options.maxTokens;
  }

  const attempts = options.autoMode ? 1 : 3;
  const timeout = options.timeout || (options.autoMode ? 20000 : 60000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const backoff = attempt === 0 ? 1500 : 3000;
      let response, raw;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        raw = await response.text();
      } catch (e) {
        lastError = e;
        if (attempt < attempts - 1) { await new Promise(r => setTimeout(r, backoff)); continue; }
        throw e;
      }
      if (response.ok) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.content)) return data.content.map(part => part.text || '').join('');
        return data.choices?.[0]?.message?.content || '';
      }
      lastError = new Error(`LLM HTTP ${response.status}: ${raw.slice(0, 300)}`);
      if (attempt < attempts - 1 && (response.status === 429 || response.status >= 500)) {
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      throw lastError;
    }
    throw lastError || new Error('LLM request failed');
  } finally {
    clearTimeout(timer);
  }
}

async function callLLM(userPrompt, systemPrompt, options = {}) {
  const configFile = readLLMConfig();
  let candidates;

  if (options.config) {
    candidates = [options.config];
  } else {
    const models = configFile.models.filter(m => m.enabled !== false);
    if (!models.length) throw new Error('No enabled LLM model configured');
    const requestedId = options.modelId || configFile.activeModelId || 'auto';
    if (requestedId !== 'auto') {
      const selected = models.find(m => m.id === requestedId);
      if (!selected) throw new Error(`LLM model "${requestedId}" not found or disabled`);
      candidates = [selected];
    } else {
      // Work through the saved order; the first model that responds wins.
      candidates = models;
    }
  }

  let lastError;
  for (const candidate of candidates) {
    try {
      const reply = await callSingleLLM(candidate, userPrompt, systemPrompt, {
        ...options,
        autoMode: candidates.length > 1,
      });
      if (!String(reply || '').trim()) throw new Error('LLM returned an empty response');
      if (candidate.id) updateModelStatus(candidate.id, true);
      return reply;
    } catch (e) {
      lastError = e;
      if (candidate.id) updateModelStatus(candidate.id, false, e.message);
      console.error(`LLM model ${candidate.label || candidate.model} failed:`, e.message);
    }
  }
  throw lastError || new Error('All configured LLM models failed');
}

function parseLLMJson(text) {
  let source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) source = fenced[1].trim();
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start >= 0 && end > start) source = source.slice(start, end + 1);
  try {
    return JSON.parse(source);
  } catch (e) {
    if (process.env.DEBUG_LLM_JSON) console.error('LLM JSON parse failed. Raw source:\n' + source.slice(0, 4000));
    throw e;
  }
}

function compactProfileFacts(profile) {
  const p = profile || {};
  return JSON.stringify({
    identity: p.identity || {},
    skills: p.skills || {},
    languages: p.languages || [],
    experience: (p.experience || []).map(e => ({
      title: e.title, company: e.company, start: e.start, end: e.end,
      location: e.location, bullets: (e.bullets || []).slice(0, 12),
    })),
    education: p.education || [],
    behavioral: p.behavioral || {},
    careerGoals: p.careerGoals || {},
    starExamples: p.starExamples || [],
  });
}

const RESPONSE_LANGUAGES = {
  en: 'English',
  th: 'Thai',
  cn: 'Simplified Chinese',
};

function responseLanguage(language) {
  const key = String(language || '').toLowerCase();
  return RESPONSE_LANGUAGES[key] || 'English';
}

function languageDirective(language) {
  const name = responseLanguage(language);
  return `Write ALL user-facing text in ${name}. Keep JSON keys, field names and code identifiers in English. Keep proper nouns, company names, product names, technologies, personal names and the candidate's own profile data in their original form. Do not translate those. Do not mix languages in sentences or explanations.`;
}

function localizedTitle(language) {
  const key = String(language || '').toLowerCase();
  if (key === 'cn') return '关键成就';
  if (key === 'th') return 'ความสำเร็จหลัก';
  return 'Key Achievement';
}

async function aiTailoringReport(profile, company, role, posting, language) {
  const directive = languageDirective(language);
  const system = 'You are a careful HR manager and CV editor. Use ONLY facts present in the candidate profile. Never invent skills, years, metrics, seniority or employers. Return JSON only, with keys: matched (array of strings), missing (array of strings), coverage (integer 0-100), summary (string), highlights (array of strings), changes (array of strings). ' + directive;
  const prompt = `Candidate profile (JSON):\n${compactProfileFacts(profile)}\n\nTarget company: ${company}\nTarget role: ${role}\nJob posting:\n${posting}\n\nWrite a tailored, truthful profile statement for this role (2-4 sentences), choose 3-6 strongest REAL achievements from the profile as highlights, list matched competencies and missing requirements honestly, and describe the concrete edits you made. Return only JSON.\n\n${directive}`;
  let data;
  try {
    data = parseLLMJson(await callLLM(prompt, system, { maxTokens: 2500 }));
  } catch (e) {
    // Retry with a much shorter prompt if the provider rejects or truncates
    // the long profile payload before giving up and using local logic.
    const shortFacts = JSON.stringify({
      name: profile.identity?.name || '',
      location: profile.identity?.location || '',
      skills: profile.skills || {},
      roles: (profile.experience || []).map(x => `${x.title || ''} at ${x.company || ''}`).filter(Boolean),
    });
    const neutralPrompt = `Return JSON only. Candidate: ${shortFacts}. Role: ${role} at ${company}. Posting: ${posting}. Keys: matched (array), missing (array), coverage (0-100), summary (string), highlights (array), changes (array). Write a truthful tailored statement and select only real achievements. ${directive}`;
    data = parseLLMJson(await callLLM(neutralPrompt, 'Return JSON only. ' + directive, { maxTokens: 2000 }));
  }
  const list = value => Array.isArray(value) ? value.map(v => String(v).trim()).filter(Boolean) : [];
  return {
    company,
    role,
    matched: list(data.matched),
    missing: list(data.missing),
    coverage: Math.max(0, Math.min(100, Number(data.coverage) || 0)),
    summary: String(data.summary || '').trim(),
    highlights: list(data.highlights),
    changes: list(data.changes),
    requirements: list(data.requirements),
    source: 'ai',
  };
}

async function aiInterviewPrep(profile, company, role, posting, language) {
  const directive = languageDirective(language);
  const system = 'You are an experienced interview coach. Base everything strictly on the candidate profile and the job posting. Never invent metrics or experience. Return JSON only, with keys: starExamples (array of objects with title, situation, task, action, result), likelyQuestions (array of strings), talkingPoints (array of strings), questionsToAsk (array of strings). ' + directive;
  const prompt = `Candidate profile (JSON):\n${compactProfileFacts(profile)}\n\nInterviewing company: ${company}\nRole: ${role}\nJob posting:\n${posting || '(not provided)'}\n\nCreate a practical prep pack: 3-4 STAR examples from the candidate's REAL experience (leave action/result as focused prompts when facts are missing), 8-12 likely interview questions tailored to the role and posting, 4-6 talking points using the candidate's own evidence, and 5-8 thoughtful questions the candidate should ask. Return only JSON.\n\n${directive}`;
  let text;
  try {
    text = await callLLM(prompt, system, { maxTokens: 3500 });
  } catch (e) {
    if (!/contentFilter|1301|HTTP 400/i.test(e.message)) throw e;
    // Some providers flag long personal-history prompts. Retry with a shorter,
    // neutral summary of the same facts before giving up.
    const shortFacts = JSON.stringify({
      name: profile.identity?.name || '',
      location: profile.identity?.location || '',
      skills: profile.skills || {},
      roles: (profile.experience || []).map(x => `${x.title || ''} at ${x.company || ''}`).filter(Boolean),
      targetRoles: profile.careerGoals?.targetRoles || [],
    });
    const neutralPrompt = `Write neutral professional interview preparation content in JSON format. Candidate: ${shortFacts}. Role: ${role} at ${company}. Job posting: ${posting || 'not provided'}. Keys: starExamples (array of objects with title, situation, task, action, result), likelyQuestions (array), talkingPoints (array), questionsToAsk (array). Return only JSON. ${directive}`;
    text = await callLLM(neutralPrompt, 'You are a helpful assistant. Return JSON only. ' + directive, { maxTokens: 3000 });
  }
  const data = parseLLMJson(text);
  const list = value => Array.isArray(value) ? value.map(v => String(v).trim()).filter(Boolean) : [];
  const stars = Array.isArray(data.starExamples) ? data.starExamples.map(s => ({
    title: String(s.title || localizedTitle(language)),
    situation: String(s.situation || ''),
    task: String(s.task || ''),
    action: String(s.action || ''),
    result: String(s.result || ''),
  })) : [];
  return {
    company,
    role,
    starExamples: stars,
    likelyQuestions: list(data.likelyQuestions),
    talkingPoints: list(data.talkingPoints),
    questionsToAsk: list(data.questionsToAsk),
    source: 'ai',
  };
}

// ============ AI resume parsing ============
const RESUME_HEADER_NAMES = [
  'professional summary', 'summary', 'profile', 'objective', 'career objective', 'career summary',
  'experience', 'work experience', 'professional experience', 'employment history', 'work history',
  'education', 'academic background', 'qualifications', 'skills', 'technical skills',
  'core competencies', 'technologies', 'tech stack', 'languages', 'certifications', 'awards',
  'publications', 'references', 'interests', 'additional information', 'contact',
  // Chinese résumé headings (a trailing \\b would never match CJK characters)
  '个人简历', '求职简历', '简历', '个人信息', '个人资料', '基本资料', '联系方式',
  '教育背景', '教育经历', '学历', '学习经历', '工作经历', '工作经验', '工作履历',
  '职业经历', '从业经历', '工作职责', '职责业绩', '岗位职责', '工作内容', '工作描述',
  '主要职责', '项目经历', '项目经验', '专业技能', '技能', '技能清单', '技术技能',
  '核心能力', '语言能力', '语言', '语种', '证书', '奖项', '荣誉', '自我评价',
  '自我介绍', '求职意向', '个人简介', '摘要',
];
const RESUME_SECTION_HEADERS = new RegExp('^(?:' + RESUME_HEADER_NAMES.join('|') + ')\\s*[:：]?\\s*$', 'i');
const isResumeSectionHeader = value => RESUME_SECTION_HEADERS.test(String(value == null ? '' : value).trim());

const LANGUAGE_PATTERNS = {
  chinese: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g,
  thai: /[\u0E00-\u0E7F]/g,
  kana: /[\u3040-\u30FF]/g,
  latin: /[A-Za-z]/g,
};
const CJK_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

const CHINESE_RESUME_HINTS = /姓名|性别|出生|电话|邮箱|手机|地址|籍贯|民族|学历|毕业|专业|学位|学校|工作经历|工作经验|项目经验|项目经历|技能|自我评价|求职意向|个人简介|教育背景|教育经历|：|，|。|、|（|）/;

function cleanResumeText(value) {
  return String(value == null ? '' : value)
    .replace(/\uFEFF/g, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t\u3000]+/g, ' ')
    .replace(/(?<=[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF])[ \u3000]+(?=[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF])/g, (match) => match.length > 1 ? match : '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectResumeLanguage(text) {
  const source = String(text || '');
  const count = pattern => (source.match(new RegExp(pattern.source, 'g')) || []).length;
  const chinese = count(LANGUAGE_PATTERNS.chinese);
  const thai = count(LANGUAGE_PATTERNS.thai);
  const kana = count(LANGUAGE_PATTERNS.kana);
  const latin = count(LANGUAGE_PATTERNS.latin);
  const hints = CHINESE_RESUME_HINTS.test(source);
  const rawTotal = chinese + thai + kana + latin;
  if (rawTotal === 0) {
    return { code: 'unknown', label: 'Unknown', instruction: 'the original language', confidence: 0, counts: { chinese, thai, kana, latin }, method: 'script-detection' };
  }
  const total = rawTotal;

  let code = 'en';
  let label = 'English';
  let instruction = 'English';
  let confidence = 0.5;

  if (chinese >= 4 || (chinese >= 2 && hints) || chinese / total >= 0.08) {
    code = 'zh';
    label = 'Chinese';
    instruction = kana > chinese * 0.25 ? 'Japanese' : 'Simplified Chinese';
    if (kana > chinese * 0.25) { code = 'ja'; label = 'Japanese'; }
    confidence = Math.min(0.99, 0.65 + chinese / total);
  } else if (thai >= 8 || thai / total >= 0.12) {
    code = 'th';
    label = 'Thai';
    instruction = 'Thai';
    confidence = Math.min(0.99, 0.65 + thai / total);
  } else if (latin >= 20) {
    confidence = Math.min(0.99, 0.7 + latin / total * 0.25);
  }

  return { code, label, instruction, confidence, counts: { chinese, thai, kana, latin }, method: 'script-detection' };
}

function cleanField(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function cleanList(value) {
  if (Array.isArray(value)) return value.map(cleanField).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\n;•|]/).map(cleanField).filter(Boolean);
  return [];
}

function firstValid(values, rejectHeaders = false) {
  for (const value of values) {
    const text = cleanField(value);
    if (!text) continue;
    if (rejectHeaders && isResumeSectionHeader(text)) continue;
    return text;
  }
  return '';
}

function normalizeParsedProfile(raw, languageInfo = null) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = r.identity || r.personal || r.contact || {};
  const skills = r.skills || {};
  const skillList = value => Array.isArray(skills[value]) ? skills[value]
    : (skills[value] ? cleanList(skills[value]) : []);
  const primary = skillList('primary');
  const secondary = skillList('secondary');
  const domain = skillList('domain');
  const software = skillList('software').concat(skillList('technical'));

  const identity = {
    name: firstValid([id.name, id.fullName, r.name], true),
    location: firstValid([id.location, id.address, r.location]).replace(/^location:\s*/i, ''),
    email: firstValid([id.email, r.email]),
    phone: firstValid([id.phone, id.mobile, r.phone]),
    linkedin: firstValid([id.linkedin, r.linkedin]),
    github: firstValid([id.github, r.github]),
    status: cleanField(id.status),
    cvLanguage: languageInfo?.label || firstValid([id.cvLanguage, r.cvLanguage]) || 'English',
  };
  if (isResumeSectionHeader(identity.name)) identity.name = '';
  if (/\b(diploma|degree|bachelor|master|university|college|institute|certificate)\b/i.test(identity.location) || /大学|学院|学校|学历|学位/.test(identity.location)) identity.location = '';

  const education = (Array.isArray(r.education) ? r.education : []).map(e => ({
    degree: cleanField(e.degree || e.qualification),
    institution: cleanField(e.institution || e.school || e.university),
    start: cleanField(e.start),
    end: cleanField(e.end),
    topics: cleanField(e.topics || e.field || e.major),
  })).filter(e => e.degree || e.institution);

  const experience = (Array.isArray(r.experience) ? r.experience : []).map(e => ({
    title: cleanField(e.title || e.role || e.position),
    company: cleanField(e.company || e.employer || e.organization),
    start: cleanField(e.start || e.startDate),
    end: cleanField(e.end || e.endDate),
    location: cleanField(e.location),
    bullets: cleanList(e.bullets || e.responsibilities || e.achievements),
    employmentType: cleanField(e.employmentType),
  })).filter(e => e.title || e.company);

  const languages = (Array.isArray(r.languages) ? r.languages : []).map(l => ({
    language: cleanField(l.language || l.name),
    level: cleanField(l.level || l.proficiency),
  })).filter(l => l.language);

  const behavioral = r.behavioral || {};
  const goals = r.careerGoals || {};

  return {
    identity,
    languages,
    education,
    experience,
    skills: { primary, secondary, domain, software },
    publications: cleanList(r.publications),
    awards: cleanList(r.awards),
    references: cleanList(r.references),
    behavioral: {
      traits: cleanList(behavioral.traits),
      strengths: cleanList(behavioral.strengths),
      growthAreas: cleanList(behavioral.growthAreas),
      thrivesIn: cleanList(behavioral.thrivesIn),
    },
    careerGoals: {
      targetRoles: cleanList(goals.targetRoles),
      targetSectors: cleanList(goals.targetSectors),
      dealBreakers: [],
      whatExcites: [],
      whatDrains: [],
    },
    writingStyle: { tone: '', structure: '', dos: [], donts: [] },
    cvTemplates: [],
    coverLetterTemplates: [],
    starExamples: Array.isArray(r.starExamples) ? r.starExamples : [],
    searchConfig: {
      roleTitles: experience.map(e => e.title).filter(Boolean),
      keySkills: primary.slice(0, 12),
      targetCompanies: [],
      locations: identity.location ? [identity.location] : [],
      portals: [],
    },
  };
}

async function aiParseResumeText(text, languageInfo = null) {
  const lang = languageInfo || detectResumeLanguage(text);
  const languageRule = `- The resume is written in ${lang.instruction}. Keep ALL extracted names, employers, job titles, locations and bullet points in their original ${lang.instruction} text. Do NOT translate them into English. JSON keys stay in English.`;
  const system = `You are a precise resume parser. Extract ONLY information explicitly present in the resume text. Never invent names, employers, dates, numbers, skills or achievements. Never treat section headings such as "PROFESSIONAL SUMMARY", "EDUCATION", "教育背景" or "工作经历" as a person name or location. Return JSON only.`;
  const prompt = `Resume language: ${lang.instruction} (detected code: ${lang.code}).
Resume text:
${String(text).slice(0, 30000)}

Return a JSON object with exactly these keys:
{\n  "identity": {"name","email","phone","location","linkedin","github","cvLanguage"},\n  "languages": [{"language","level"}],\n  "education": [{"degree","institution","start","end","topics"}],\n  "experience": [{"title","company","start","end","location","bullets":["..."]}],\n  "skills": {"primary":[],"secondary":[],"domain":[],"software":[]},\n  "behavioral": {"traits":[],"strengths":[]},\n  "careerGoals": {"targetRoles":[],"targetSectors":[]}
}
Rules:
${languageRule}
- Each experience must keep its real title, company, dates and the original wording of its bullet points.
- Do not merge different jobs into one entry.
- Use empty strings/arrays when a field is not present.
- Put the candidate's actual city/country (e.g. Bangkok, 北京, 曼谷) in identity.location, never an education line.
- Set identity.cvLanguage to "${lang.label}".
Return only JSON.`;
  let data;
  try {
    data = parseLLMJson(await callLLM(prompt, system, { maxTokens: 6000 }));
  } catch (e) {
    if (!/contentFilter|1301|HTTP 400|Unexpected end/i.test(e.message)) throw e;
    const shortPrompt = `Resume language: ${lang.instruction}. Extract resume facts into JSON only. Resume:
${String(text).slice(0, 12000)}
Keys: identity{name,email,phone,location,linkedin,github}, languages[], education[{degree,institution,start,end}], experience[{title,company,start,end,location,bullets[]}], skills{primary[],secondary[],domain[],software[]}. Keep original ${lang.instruction} text. Do not translate. Do not use section headings as names. Return only JSON.`;
    data = parseLLMJson(await callLLM(shortPrompt, 'Return JSON only.', { maxTokens: 4000 }));
  }
  return normalizeParsedProfile(data, lang);
}

function sendFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end('Not found');
  }
}

// MIME types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.tex': 'text/plain; charset=utf-8',
  '.cls': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
};

// ============ API ROUTES ============

const api = {};

// --- Profile ---
api['GET /api/profile'] = (req, res) => {
  sendJSON(res, 200, readJSON(DATA_FILES.profile));
};

api['PUT /api/profile'] = (req, res, body) => {
  writeJSON(DATA_FILES.profile, body);
  sendJSON(res, 200, { ok: true });
};

// --- Profile photo (per user) ---
const PROFILE_PHOTO_EXTS = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
};

function profilePhotoMeta() {
  return store.getPhotoMeta(currentUserId());
}

function removeProfilePhotos() {
  store.deletePhoto(currentUserId());
}

api['GET /api/profile-photo'] = (req, res) => {
  const meta = profilePhotoMeta();
  if (!meta || !PROFILE_PHOTO_EXTS[meta.ext]) { sendJSON(res, 404, { error: 'No profile photo' }); return; }
  const photo = store.getPhoto(currentUserId());
  if (!photo) { sendJSON(res, 404, { error: 'No profile photo' }); return; }
  res.writeHead(200, {
    'Content-Type': meta.mime || PROFILE_PHOTO_EXTS[meta.ext],
    'Cache-Control': 'no-store',
  });
  res.end(photo);
};

api['POST /api/profile-photo'] = (req, res, body, params, query, rawBody) => {
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      sendJSON(res, 400, { error: 'Expected multipart/form-data' }); return;
    }
    const boundary = contentType.match(/boundary=(.+)/)?.[1]?.trim();
    if (!boundary || !rawBody) { sendJSON(res, 400, { error: 'No file uploaded' }); return; }
    const parts = parseMultipart(rawBody, boundary);
    const filePart = parts.find(p => p.filename && p.data);
    if (!filePart) { sendJSON(res, 400, { error: 'No file uploaded' }); return; }
    const ext = path.extname(filePart.filename).toLowerCase();
    if (!PROFILE_PHOTO_EXTS[ext]) {
      sendJSON(res, 400, { error: 'Use a PNG, JPG, GIF or WEBP image' }); return;
    }
    if (filePart.data.length > 5 * 1024 * 1024) {
      sendJSON(res, 400, { error: 'Image must be smaller than 5 MB' }); return;
    }
    store.savePhoto(currentUserId(), {
      ext,
      mime: PROFILE_PHOTO_EXTS[ext],
      originalName: path.basename(filePart.filename),
      uploadedAt: new Date().toISOString(),
    }, filePart.data);
    sendJSON(res, 200, { ok: true, photoUrl: '/api/profile-photo?v=' + Date.now() });
  } catch (e) {
    sendJSON(res, 500, { error: 'Photo upload failed: ' + e.message });
  }
};

api['DELETE /api/profile-photo'] = (req, res) => {
  removeProfilePhotos();
  sendJSON(res, 200, { ok: true });
};

// --- Formatted Document Previews ---
const docPreview = require('./doc-preview');
const cvTailoring = require('./cv-tailoring');

// Tailor the stored profile to a posting once and reuse it for all four document
// outputs so the LaTeX, HTML preview, and HR report always agree.
function tailoredFor(body) {
  const profile = readJSON(DATA_FILES.profile) || {};
  const result = cvTailoring.tailorResume(profile, body.company || '', body.role || '', body.posting || '');
  // Allow the reviewer to refine the HR-written summary / highlights before generating.
  if (body.summaryOverride && String(body.summaryOverride).trim()) {
    result.tailoredProfile.summary = String(body.summaryOverride).trim();
    result.report.summary = result.tailoredProfile.summary;
  }
  if (Array.isArray(body.highlightsOverride)) {
    const h = body.highlightsOverride.map(s => String(s).trim()).filter(Boolean);
    if (h.length) {
      result.tailoredProfile.highlights = h;
      result.report.highlights = h;
    }
  }
  return result;
}

// Preview the HR tailoring decisions before generating documents.
api['POST /api/tailor-resume'] = async (req, res, body) => {
  const profile = readJSON(DATA_FILES.profile) || {};
  if (llmConfigured()) {
    try {
      const report = await aiTailoringReport(profile, body.company || '', body.role || '', body.posting || '', body.language);
      return sendJSON(res, 200, { ok: true, report, source: 'ai' });
    } catch (e) {
      console.error('AI tailoring failed, using local logic:', e.message);
      const { report } = tailoredFor(body);
      report.aiError = e.message;
      return sendJSON(res, 200, { ok: true, report, source: 'local', warning: e.message });
    }
  }
  const { report } = tailoredFor(body);
  sendJSON(res, 200, { ok: true, report, source: 'local' });
};

api['POST /api/generate-cv-preview'] = (req, res, body) => {
  const { tailoredProfile } = tailoredFor(body);
  const html = docPreview.renderCV(tailoredProfile, body.company || '', body.role || '');
  sendJSON(res, 200, { ok: true, html });
};

// Print the same HTML preview to a real PDF via headless Chrome.
api['POST /api/generate-cv-pdf'] = (req, res, body) => {
  try {
    const { tailoredProfile } = tailoredFor(body || {});
    let html = docPreview.renderCV(tailoredProfile, (body && body.company) || '', (body && body.role) || '');
    const photoMeta = profilePhotoMeta();
    const photoBytes = photoMeta && PROFILE_PHOTO_EXTS[photoMeta.ext] ? store.getPhoto(currentUserId()) : null;
    if (photoBytes) {
      const dataUrl = `data:${photoMeta.mime || PROFILE_PHOTO_EXTS[photoMeta.ext]};base64,${photoBytes.toString('base64')}`;
      html = html.replace(/\/api\/profile-photo\?v=\d+/g, dataUrl);
    }
    // Use the platform temp directory so this works on read-only app filesystems too.
    const tmpDir = os.tmpdir();
    const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const htmlFile = path.join(tmpDir, `cv_pdf_${stamp}.html`);
    const pdfFile = path.join(tmpDir, `cv_pdf_${stamp}.pdf`);
    const chromeProfileDir = path.join(tmpDir, `chrome-cv-pdf-${stamp}`);
    fs.writeFileSync(htmlFile, html, 'utf-8');
    const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const args = [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
      `--user-data-dir=${chromeProfileDir}`,
      `--print-to-pdf=${pdfFile}`,
      url.pathToFileURL(htmlFile).href,
    ];
    execFileSync(chromePath, args, { timeout: 45000, stdio: 'pipe' });
    if (!fs.existsSync(pdfFile)) throw new Error('Chrome did not produce a PDF');
    const pdf = fs.readFileSync(pdfFile);
    const nameForFile = (body && body.company) || tailoredProfile.identity?.name || 'profile';
    const safeName = slugify(nameForFile).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'profile';
    const filename = `CV_${safeName}.pdf`;
    fs.unlinkSync(htmlFile);
    fs.unlinkSync(pdfFile);
    fs.rmSync(chromeProfileDir, { recursive: true, force: true });
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  } catch (e) {
    console.error('CV PDF generation failed:', e.message);
    sendJSON(res, 500, { error: 'Could not generate PDF: ' + e.message });
  }
};

api['POST /api/generate-cover-letter-preview'] = (req, res, body) => {
  const { tailoredProfile } = tailoredFor(body);
  const html = docPreview.renderCoverLetter(tailoredProfile, body.company || '', body.role || '');
  sendJSON(res, 200, { ok: true, html });
};

// --- Job Search (real data) ---
const jobSearch = require('./job-search');
const jobSites = require('./job-sites');
const profileMatch = require('./profile-match');

const CUSTOM_SITES_FILE = path.join(DATA_DIR, 'custom_job_sites.json');
initDataFile(CUSTOM_SITES_FILE, []);

// Every job-search route uses the profile location unless the caller overrides it.
function jobSearchLocation(body) {
  if (body && body.location) return String(body.location).trim();
  const profile = readJSON(DATA_FILES.profile);
  return (profile && profile.identity && profile.identity.location) || '';
}

function jobLocationMeta(location) {
  return { location, country: jobSites.detectCountry(location) };
}

function applyProfileMatch(jobs, result) {
  const matched = profileMatch.filterJobsByProfile(jobs, readJSON(DATA_FILES.profile));
  return {
    ...result,
    jobs: matched.jobs,
    profileMatched: matched.matchedCount,
    profileTotal: matched.total,
    profileCriteria: matched.criteria,
  };
}

// Get location-based job sites with filled search links
api['POST /api/jobs/sites'] = (req, res, body) => {
  try {
    const profile = readJSON(DATA_FILES.profile);
    const location = body.location || profile.identity?.location || '';
    const keywords = body.keywords || '';
    const custom = readJSON(CUSTOM_SITES_FILE) || [];
    const result = jobSites.getSitesForLocation(location, custom);
    const sites = result.sites.map(s => ({
      ...s,
      searchUrl: jobSites.fillTemplate(s.url, keywords, location),
    }));
    sendJSON(res, 200, { ok: true, country: result.country, location, sites });
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message });
  }
};

// Custom job sites CRUD
api['GET /api/jobs/custom-sites'] = (req, res) => {
  sendJSON(res, 200, readJSON(CUSTOM_SITES_FILE) || []);
};

api['POST /api/jobs/custom-sites'] = (req, res, body) => {
  try {
    const sites = readJSON(CUSTOM_SITES_FILE) || [];
    if (!body.name || !body.url) {
      sendJSON(res, 400, { ok: false, error: 'Name and URL are required' });
      return;
    }
    if (!/https?:\/\//i.test(body.url)) {
      sendJSON(res, 400, { ok: false, error: 'URL must start with http:// or https://' });
      return;
    }
    const site = { name: body.name.trim(), url: body.url.trim(), tier: body.tier || 1 };
    sites.push(site);
    writeJSON(CUSTOM_SITES_FILE, sites);
    sendJSON(res, 200, { ok: true, sites });
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message });
  }
};

api['DELETE /api/jobs/custom-sites/:id'] = (req, res, body, params) => {
  const sites = readJSON(CUSTOM_SITES_FILE) || [];
  const id = parseInt(params.id);
  if (id >= 0 && id < sites.length) {
    sites.splice(id, 1);
    writeJSON(CUSTOM_SITES_FILE, sites);
    sendJSON(res, 200, { ok: true, sites });
  } else {
    sendJSON(res, 404, { ok: false, error: 'Not found' });
  }
};

// Retrieve jobs from a URL with multi-strategy fallbacks
api['POST /api/jobs/retrieve'] = async (req, res, body) => {
  try {
    const url = body.url || '';
    if (!/^https?:\/\//i.test(url)) {
      sendJSON(res, 400, { ok: false, error: 'Please provide a valid URL' });
      return;
    }
    const location = jobSearchLocation(body);
    const result = await jobSites.retrieveJobs(url, body.keywords || '', location, { strictSite: body.strictSite === true });
    const matchedResult = applyProfileMatch(result.jobs || [], result);
    // Persist only jobs that match the profile
    if (result.ok && matchedResult.jobs.length) {
      const seenData = readJSON(DATA_FILES.seenJobs) || { seen: {} };
      let added = 0;
      matchedResult.jobs.forEach(j => {
        const key = `${(j.company || '').toLowerCase().replace(/\W+/g, '_')}_${(j.title || '').toLowerCase().replace(/\W+/g, '_')}`.replace(/^_|_$/g, '') || `job_${Date.now()}_${added}`;
        if (!seenData.seen[key]) {
          seenData.seen[key] = {
            title: j.title, company: j.company, location: j.location, url: j.url,
            source: j.source || 'url', fit: '', status: 'new',
            first_seen: new Date().toISOString().split('T')[0],
            description: (j.description || '').substring(0, 2000),
          };
          added++;
        }
      });
      writeJSON(DATA_FILES.seenJobs, seenData);
      matchedResult.addedToSeen = added;
    }
    sendJSON(res, 200, { ok: result.ok, ...matchedResult, ...jobLocationMeta(location) });
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message });
  }
};

api['POST /api/jobs/search'] = async (req, res, body) => {
  try {
    const keywords = body.keywords || '';
    const limit = Math.min(parseInt(body.limit) || 40, 100);
    const location = jobSearchLocation(body);
    const result = await jobSearch.searchByKeywords(keywords, limit, location);
    sendJSON(res, 200, { ok: true, ...applyProfileMatch(result.jobs, result), ...jobLocationMeta(location) });
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message });
  }
};

api['POST /api/jobs/parse-text'] = (req, res, body) => {
  try {
    const location = jobSearchLocation(body);
    const parsed = jobSearch.parsePastedJobs(body.text || '');
    const located = {
      ...parsed,
      jobs: jobSites.filterJobsByLocation(parsed.jobs, location, { allowUnknown: true }),
      totalParsed: (parsed.jobs || []).length,
      ...jobLocationMeta(location),
    };
    const result = applyProfileMatch(located.jobs, located);
    if (result.jobs && result.jobs.length) {
      const seenData = readJSON(DATA_FILES.seenJobs) || { seen: {} };
      let added = 0;
      result.jobs.forEach(j => {
        const key = `${(j.company || '').toLowerCase().replace(/\W+/g, '_')}_${(j.title || '').toLowerCase().replace(/\W+/g, '_')}`.replace(/^_|_$/g, '') || `job_${Date.now()}_${added}`;
        if (!seenData.seen[key]) {
          seenData.seen[key] = {
            title: j.title, company: j.company, location: j.location,
            url: j.url, source: 'pasted', fit: '', status: 'new',
            first_seen: new Date().toISOString().split('T')[0],
          };
          added++;
        }
      });
      writeJSON(DATA_FILES.seenJobs, seenData);
      sendJSON(res, 200, { ok: true, ...result, addedToSeen: added });
    } else {
      sendJSON(res, 200, { ok: false, ...result });
    }
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message });
  }
};

api['POST /api/jobs/fetch-url'] = async (req, res, body) => {
  try {
    const url = body.url || '';
    const location = jobSearchLocation(body);
    const fetched = await jobSearch.searchByUrl(url);
    const located = {
      ...fetched,
      jobs: jobSites.filterJobsByLocation(fetched.jobs || [], location, { allowUnknown: true }),
      ...jobLocationMeta(location),
    };
    const result = applyProfileMatch(located.jobs, located);
    if (result.error && !result.jobs.length) {
      sendJSON(res, 200, { ok: false, ...result });
    } else {
      // Persist discovered jobs into seen-jobs
      const seenData = readJSON(DATA_FILES.seenJobs) || { seen: {} };
      let added = 0;
      result.jobs.forEach(j => {
        const key = `${(j.company || '').toLowerCase().replace(/\W+/g, '_')}_${(j.title || '').toLowerCase().replace(/\W+/g, '_')}`.replace(/^_|_$/g, '') || `job_${Date.now()}_${added}`;
        if (!seenData.seen[key]) {
          seenData.seen[key] = {
            title: j.title, company: j.company, location: j.location,
            url: j.url, source: j.source || url, fit: j.fit || '',
            status: 'new', first_seen: new Date().toISOString().split('T')[0],
            description: (j.description || '').substring(0, 2000),
          };
          added++;
        }
      });
      writeJSON(DATA_FILES.seenJobs, seenData);
      sendJSON(res, 200, { ok: true, ...result, addedToSeen: added });
    }
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message });
  }
};

// --- Resume Analysis ---
api['POST /api/analyze-resume'] = async (req, res, body) => {
  try {
    const { text, fileName } = body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      sendJSON(res, 400, { error: 'No resume text provided' });
      return;
    }
    const cleanedText = cleanResumeText(text);
    const detectedLanguage = detectResumeLanguage(cleanedText);
    console.log('[resume-paste]', { chars: cleanedText.length, language: detectedLanguage.code, counts: detectedLanguage.counts });
    let analyzed = null;
    let source = 'local';
    let warning = '';
    if (llmConfigured()) {
      try {
        analyzed = await aiParseResumeText(cleanedText, detectedLanguage);
        source = 'ai';
      } catch (e) {
        warning = `AI parser unavailable (${e.message}); used local parser.`;
        console.error('AI resume parsing failed, using local logic:', e.message);
      }
    }
    if (!analyzed) analyzed = analyzeResumeText(cleanedText, detectedLanguage);
    sendJSON(res, 200, {
      ok: true,
      profile: analyzed,
      fileName: fileName || 'resume',
      charCount: cleanedText.length,
      detectedLanguage,
      source,
      warning,
    });
  } catch (e) {
    sendJSON(res, 500, { error: 'Resume analysis failed: ' + e.message });
  }
};

// --- Resume File Upload (multipart/form-data) ---
api['POST /api/upload-resume'] = async (req, res, body, params, query, rawBody) => {
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      sendJSON(res, 400, { error: 'Expected multipart/form-data' });
      return;
    }
    // Parse multipart form data from raw body
    const boundary = contentType.match(/boundary=(.+)/)?.[1]?.trim();
    if (!boundary || !rawBody) {
      sendJSON(res, 400, { error: 'No boundary or body found' });
      return;
    }
    const parts = parseMultipart(rawBody, boundary);
    let fileContent = null;
    let fileName = 'resume';
    let fileExt = '.txt';
    for (const part of parts) {
      if (part.filename) {
        fileName = part.filename;
        fileExt = path.extname(part.filename).toLowerCase();
        fileContent = part.data; // Buffer
      }
    }
    if (!fileContent) {
      sendJSON(res, 400, { error: 'No file uploaded' });
      return;
    }
    // Save to temp file for Python extraction
    const tmpDir = path.join(DATA_DIR, 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, `resume_${Date.now()}${fileExt}`);
    fs.writeFileSync(tmpFile, fileContent);

    // Use Python to extract text from PDF/DOCX; for TXT/HTML parse directly
    let extractedText = '';
    if (fileExt === '.pdf' || fileExt === '.docx' || fileExt === '.doc') {
      try {
        const { execSync } = require('child_process');
        const scriptPath = path.join(__dirname, 'extract_text.py');
        extractedText = execSync(`python3 "${scriptPath}" "${tmpFile}"`, {
          encoding: 'utf-8',
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024
        });
      } catch (e) {
        extractedText = fileContent.toString('utf-8');
      }
    } else {
      extractedText = fileContent.toString('utf-8');
    }
    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch (e) {}

    if (extractedText.startsWith('ERROR_NO_TEXT')) {
      sendJSON(res, 422, {
        error: 'No readable text was found in the file. If the CV is a scan or image, please paste its text into the box instead.',
        detail: extractedText,
      });
      return;
    }
    if (extractedText.startsWith('ERROR')) {
      sendJSON(res, 500, { error: 'Text extraction failed: ' + extractedText });
      return;
    }

    const cleanedText = cleanResumeText(extractedText);
    const detectedLanguage = detectResumeLanguage(cleanedText);
    console.log('[resume-upload]', fileName, { chars: cleanedText.length, language: detectedLanguage.code, counts: detectedLanguage.counts });
    let analyzed = null;
    let source = 'local';
    let warning = '';
    if (llmConfigured()) {
      try {
        analyzed = await aiParseResumeText(cleanedText, detectedLanguage);
        source = 'ai';
      } catch (e) {
        warning = `AI parser unavailable (${e.message}); used local parser.`;
        console.error('AI resume parsing failed, using local logic:', e.message);
      }
    }
    if (!analyzed) analyzed = analyzeResumeText(cleanedText, detectedLanguage);
    sendJSON(res, 200, {
      ok: true,
      profile: analyzed,
      fileName,
      charCount: cleanedText.length,
      detectedLanguage,
      source,
      warning,
    });
  } catch (e) {
    sendJSON(res, 500, { error: 'Upload processing failed: ' + e.message });
  }
};

// Normalize mixed-case legacy status labels into canonical values.
const STATUS_NORMALIZE = {
  'drafted': 'drafted', 'applied': 'applied', 'active': 'applied',
  'interview': 'interview', 'interviewing': 'interview',
  'offer': 'offer', 'offers': 'offer',
  'hired': 'hired', 'accepted': 'hired',
  'rejected': 'rejected', 'no_response': 'no_response', 'no response': 'no_response',
  'withdrawn': 'withdrawn',
};
function normalizeStatus(s) {
  if (!s) return '';
  const lower = String(s).toLowerCase().replace(/\s+/g, '_');
  return STATUS_NORMALIZE[lower] || lower;
}

// --- Tracker ---
api['GET /api/tracker'] = (req, res) => {
  const tracker = readJSON(DATA_FILES.tracker);
  // Normalize any legacy mixed-case statuses so the UI filter logic stays correct.
  const normalized = tracker.map(t => {
    if (t.status && STATUS_NORMALIZE[t.status.toLowerCase()] !== undefined) {
      return { ...t, status: STATUS_NORMALIZE[t.status.toLowerCase()] };
    }
    return t;
  });
  writeJSON(DATA_FILES.tracker, normalized);
  sendJSON(res, 200, normalized);
};

api['POST /api/tracker'] = (req, res, body) => {
  const tracker = readJSON(DATA_FILES.tracker);
  const existing = tracker.findIndex(t =>
    t.company.toLowerCase() === (body.company || '').toLowerCase() &&
    t.role.toLowerCase() === (body.role || '').toLowerCase()
  );
  // Merge sensible defaults so new entries surface all CRM/outcome fields.
  const merge = {
    contact_name: '', company_email: '', source_type: '',
    last_touched: '', next_followup: '',
    rejection_stage: '', rejection_reason: '',
    ...body,
    status: normalizeStatus(body.status),
    createdAt: body.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (existing >= 0 && !['rejected', 'no_response', 'offer_declined', 'withdrawn', 'hired'].includes(tracker[existing].status)) {
    tracker[existing] = { ...tracker[existing], ...merge };
  } else {
    tracker.push({ date: merge.date || new Date().toISOString().split('T')[0], ...merge });
  }
  writeJSON(DATA_FILES.tracker, tracker);
  sendJSON(res, 200, { ok: true, tracker });
};

api['PUT /api/tracker/:id'] = (req, res, body, params) => {
  const tracker = readJSON(DATA_FILES.tracker);
  const id = parseInt(params.id);
  if (id >= 0 && id < tracker.length) {
    tracker[id] = { ...tracker[id], ...body };
    writeJSON(DATA_FILES.tracker, tracker);
    sendJSON(res, 200, { ok: true, entry: tracker[id] });
  } else {
    sendJSON(res, 404, { error: 'Not found' });
  }
};

api['DELETE /api/tracker/:id'] = (req, res, body, params) => {
  const tracker = readJSON(DATA_FILES.tracker);
  const id = parseInt(params.id);
  if (id >= 0 && id < tracker.length) {
    tracker.splice(id, 1);
    writeJSON(DATA_FILES.tracker, tracker);
    sendJSON(res, 200, { ok: true });
  } else {
    sendJSON(res, 404, { error: 'Not found' });
  }
};

// --- Seen Jobs ---
api['GET /api/seen-jobs'] = (req, res) => {
  sendJSON(res, 200, readJSON(DATA_FILES.seenJobs));
};

// Discovered jobs filtered by profile location and profile relevance.
api['GET /api/jobs/discovered'] = (req, res) => {
  const data = readJSON(DATA_FILES.seenJobs) || { seen: {} };
  const all = Object.entries(data.seen || {}).map(([key, job]) => ({ key, ...job }));
  const location = jobSearchLocation({});
  const located = jobSites.filterJobsByLocation(all, location, { allowUnknown: true });
  const matched = profileMatch.filterJobsByProfile(located, readJSON(DATA_FILES.profile));
  sendJSON(res, 200, {
    all: located,
    matched: matched.jobs,
    profileMatched: matched.matchedCount,
    profileTotal: matched.total,
    location,
    ...jobLocationMeta(location),
    criteria: matched.criteria,
  });
};

api['POST /api/seen-jobs'] = (req, res, body) => {
  const seenJobs = readJSON(DATA_FILES.seenJobs);
  if (!seenJobs.seen) seenJobs.seen = {};
  const key = `${body.company}_${body.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  seenJobs.seen[key] = { ...body, first_seen: new Date().toISOString().split('T')[0] };
  writeJSON(DATA_FILES.seenJobs, seenJobs);
  sendJSON(res, 200, { ok: true, key });
};

// --- Applications ---
// Applications API — deprecated; now unified under Tracker.
// These endpoints redirect to Tracker so the old frontend code continues to work
// until we fully migrate over. The canonical store is DATA_FILES.tracker.
api['GET /api/applications'] = async (req, res) => {
  // Return empty to signal migration; real data lives in tracker
  sendJSON(res, 200, []);
};

api['POST /api/applications'] = (req, res, body) => {
  const tracker = readJSON(DATA_FILES.tracker);
  const existing = tracker.findIndex(t =>
    t.company.toLowerCase() === (body.company || '').toLowerCase() &&
    t.role.toLowerCase() === (body.role || '').toLowerCase()
  );
  const patch = {
    company: body.company,
    role: body.jobTitle || body.role || '',
    sector: body.sector || '',
    channel: body.channel || body.source || '',
    status: body.status || 'applied',
    fitRating: body.fitRating || '',
    notes: body.notes || '',
    date: body.date || new Date().toISOString().split('T')[0],
    createdAt: body.created || new Date().toISOString(),
  };
  if (existing >= 0) {
    tracker[existing] = { ...tracker[existing], ...patch };
  } else {
    tracker.push(patch);
  }
  writeJSON(DATA_FILES.tracker, tracker);
  sendJSON(res, 200, { ok: true, tracker });
};

api['PUT /api/applications/:id'] = (req, res, body, params) => {
  // No-op for migrated API; legacy callers may still send updates here.
  sendJSON(res, 200, { ok: true, note: 'applications endpoint deprecated; use tracker instead' });
};

api['DELETE /api/applications/:id'] = (req, res, body, params) => {
  // No-op for migrated API.
  sendJSON(res, 200, { ok: true });
};

// --- Search Queries ---
function newPriorityId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function normalizePriority(p) {
  return {
    id: String((p && p.id) || newPriorityId()),
    name: String((p && p.name) || '').trim(),
    terms: Array.isArray(p && p.terms) ? p.terms.filter(Boolean).map(String) : [],
    websearch: Array.isArray(p && p.websearch) ? p.websearch.filter(Boolean).map(String) : [],
  };
}

const LOCATION_CATEGORIES = ['areas', 'borderline', 'tooFar'];

function normalizeLocationFilter(filter) {
  const source = filter && typeof filter === 'object' ? filter : {};
  const out = {};
  for (const key of LOCATION_CATEGORIES) {
    out[key] = Array.isArray(source[key]) ? source[key].filter(Boolean).map(String) : [];
  }
  return out;
}

function readQueries() {
  const data = readJSON(DATA_FILES.searchQueries) || {};
  const priorities = Array.isArray(data.priorities)
    ? data.priorities.filter(p => p && typeof p === 'object' && !Array.isArray(p)).map(normalizePriority)
    : [];
  return { ...data, priorities, locationFilter: normalizeLocationFilter(data.locationFilter) };
}

function writeQueries(data) {
  writeJSON(DATA_FILES.searchQueries, {
    priorities: (data.priorities || []).map(normalizePriority),
    locationFilter: normalizeLocationFilter(data.locationFilter),
  });
}

api['GET /api/search-queries'] = (req, res) => {
  sendJSON(res, 200, readQueries());
};

api['PUT /api/search-queries'] = (req, res, body) => {
  writeQueries({
    priorities: Array.isArray(body.priorities) ? body.priorities : [],
    locationFilter: body.locationFilter,
  });
  sendJSON(res, 200, { ok: true, ...readQueries() });
};

api['POST /api/search-queries/priorities'] = (req, res, body) => {
  const data = readQueries();
  const priority = normalizePriority({ ...(body || {}), id: newPriorityId() });
  if (!priority.name) priority.name = `Priority ${data.priorities.length + 1}`;
  data.priorities.push(priority);
  writeQueries(data);
  sendJSON(res, 200, { ok: true, priority, priorities: data.priorities });
};

api['PUT /api/search-queries/priorities/:id'] = (req, res, body, params) => {
  const data = readQueries();
  const index = data.priorities.findIndex(p => p.id === params.id);
  if (index === -1) { sendJSON(res, 404, { error: 'Priority not found' }); return; }
  const updated = normalizePriority({ ...data.priorities[index], ...(body || {}), id: params.id });
  data.priorities[index] = updated;
  writeQueries(data);
  sendJSON(res, 200, { ok: true, priority: updated, priorities: data.priorities });
};

api['DELETE /api/search-queries/priorities/:id'] = (req, res, body, params) => {
  const data = readQueries();
  const next = data.priorities.filter(p => p.id !== params.id);
  if (next.length === data.priorities.length) { sendJSON(res, 404, { error: 'Priority not found' }); return; }
  data.priorities = next;
  writeQueries(data);
  sendJSON(res, 200, { ok: true, priorities: data.priorities });
};

api['POST /api/search-queries/priorities/:id/move'] = (req, res, body, params) => {
  const data = readQueries();
  const index = data.priorities.findIndex(p => p.id === params.id);
  if (index === -1) { sendJSON(res, 404, { error: 'Priority not found' }); return; }
  const target = body && body.direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= data.priorities.length) {
    sendJSON(res, 200, { ok: true, priorities: data.priorities });
    return;
  }
  [data.priorities[index], data.priorities[target]] = [data.priorities[target], data.priorities[index]];
  writeQueries(data);
  sendJSON(res, 200, { ok: true, priorities: data.priorities });
};

// --- Location filter items ---
function locationCategory(category) {
  if (category === 'acceptable' || category === 'acceptableAreas') return 'areas';
  return LOCATION_CATEGORIES.includes(category) ? category : null;
}

api['POST /api/search-queries/locations/:category'] = (req, res, body, params) => {
  const key = locationCategory(params.category);
  if (!key) { sendJSON(res, 400, { error: 'Unknown location category' }); return; }
  const value = String((body && body.value) || '').trim();
  if (!value) { sendJSON(res, 400, { error: 'Location value is required' }); return; }
  const data = readQueries();
  if (!data.locationFilter[key].some(v => v.toLowerCase() === value.toLowerCase())) {
    data.locationFilter[key].push(value);
  }
  writeQueries(data);
  sendJSON(res, 200, { ok: true, locationFilter: data.locationFilter });
};

api['PUT /api/search-queries/locations/:category/:index'] = (req, res, body, params) => {
  const key = locationCategory(params.category);
  const index = Number(params.index);
  if (!key || !Number.isInteger(index)) { sendJSON(res, 400, { error: 'Invalid location target' }); return; }
  const data = readQueries();
  if (index < 0 || index >= data.locationFilter[key].length) { sendJSON(res, 404, { error: 'Location not found' }); return; }
  const value = String((body && body.value) || '').trim();
  if (!value) { sendJSON(res, 400, { error: 'Location value is required' }); return; }
  data.locationFilter[key][index] = value;
  writeQueries(data);
  sendJSON(res, 200, { ok: true, locationFilter: data.locationFilter });
};

api['DELETE /api/search-queries/locations/:category/:index'] = (req, res, body, params) => {
  const key = locationCategory(params.category);
  const index = Number(params.index);
  if (!key || !Number.isInteger(index)) { sendJSON(res, 400, { error: 'Invalid location target' }); return; }
  const data = readQueries();
  if (index < 0 || index >= data.locationFilter[key].length) { sendJSON(res, 404, { error: 'Location not found' }); return; }
  data.locationFilter[key].splice(index, 1);
  writeQueries(data);
  sendJSON(res, 200, { ok: true, locationFilter: data.locationFilter });
};

api['POST /api/search-queries/locations/:category/:index/move'] = (req, res, body, params) => {
  const key = locationCategory(params.category);
  const index = Number(params.index);
  if (!key || !Number.isInteger(index)) { sendJSON(res, 400, { error: 'Invalid location target' }); return; }
  const data = readQueries();
  const list = data.locationFilter[key];
  if (index < 0 || index >= list.length) { sendJSON(res, 404, { error: 'Location not found' }); return; }
  const target = body && body.direction === 'up' ? index - 1 : index + 1;
  if (target >= 0 && target < list.length) {
    [list[index], list[target]] = [list[target], list[index]];
    writeQueries(data);
  }
  sendJSON(res, 200, { ok: true, locationFilter: data.locationFilter });
};

// --- Salary Lookup ---
// Port of the original salary_lookup.py: fuzzy matching, Nordic spelling
// variants, legal suffix stripping, city filtering and category rendering.
const salaryLookup = require('./salary-lookup');

function readSalaryData() {
  return salaryLookup.normalizeData(readJSON(DATA_FILES.salaryData));
}

function salaryView(entry) {
  return { ...entry, categories: salaryLookup.getCategories(entry) };
}

api['GET /api/salary'] = (req, res, body, params, query) => {
  const data = readSalaryData();
  const company = String(query.company || query.role || '').trim();
  const city = query.city ? String(query.city).trim() : null;

  if (!company) {
    return sendJSON(res, 400, { error: 'Enter a company name to look up.' });
  }

  const results = salaryLookup.searchCompany(data, company, city).map(salaryView);
  sendJSON(res, 200, {
    results,
    metadata: data.metadata,
    query: { company, city },
    warnings: data.warnings,
  });
};

api['GET /api/salary/all'] = (req, res) => {
  const data = readSalaryData();
  sendJSON(res, 200, {
    metadata: data.metadata,
    companies: data.companies.map(salaryView),
    errors: data.errors,
    warnings: data.warnings,
  });
};

api['PUT /api/salary'] = (req, res, body) => {
  const data = readSalaryData();
  let companies = data.companies;
  let metadata = data.metadata;

  if (Array.isArray(body.companies)) {
    // Full import / replace (used by the Import JSON button).
    const incoming = salaryLookup.normalizeData({
      metadata: body.metadata || metadata,
      companies: body.companies,
    });
    if (incoming.errors.length) {
      return sendJSON(res, 400, { error: incoming.errors[0] });
    }
    companies = incoming.companies;
    metadata = incoming.metadata;
  } else if (typeof body.company === 'string' && body.company.trim()) {
    // Add or update one company entry.
    const entry = { ...body };
    delete entry.matchScore;
    entry.company = entry.company.trim();
    const idx = companies.findIndex(c =>
      c.company.toLowerCase() === entry.company.toLowerCase()
      && (c.city || '') === (entry.city || ''));
    if (idx >= 0) companies[idx] = { ...companies[idx], ...entry };
    else companies.push(entry);
    if (body.metadata && typeof body.metadata === 'object') {
      metadata = { ...metadata, ...body.metadata };
    }
  } else {
    return sendJSON(res, 400, { error: 'Provide a company or a companies array.' });
  }

  writeJSON(DATA_FILES.salaryData, { metadata, companies });
  sendJSON(res, 200, { ok: true, total: companies.length });
};

api['DELETE /api/salary/:company'] = (req, res, body, params, query) => {
  const data = readSalaryData();
  let company = params.company;
  try { company = decodeURIComponent(company); } catch (e) { /* keep raw */ }
  const city = query.city ? String(query.city) : null;
  const before = data.companies.length;

  data.companies = data.companies.filter(c => {
    const sameCompany = c.company.toLowerCase() === String(company).toLowerCase();
    const sameCity = !city || (c.city || '').toLowerCase() === city.toLowerCase();
    return !(sameCompany && sameCity);
  });

  writeJSON(DATA_FILES.salaryData, { metadata: data.metadata, companies: data.companies });
  sendJSON(res, 200, { ok: true, removed: before - data.companies.length });
};

// --- Job Evaluation ---
api['POST /api/evaluate'] = (req, res, body) => {
  const profile = readJSON(DATA_FILES.profile);
  let posting = body.posting;
  // Support both string and object posting formats
  if (typeof posting === 'object' && posting !== null) {
    posting = [posting.title, posting.company, posting.location, posting.description].filter(Boolean).join(' ');
  }
  posting = posting || '';

  // Simulate the evaluation framework from 04-job-evaluation.md
  const evaluation = {
    technicalSkills: evaluateTechnicalSkills(profile, posting),
    experienceMatch: evaluateExperience(profile, posting),
    behavioralFit: evaluateBehavioral(profile, posting),
    location: evaluateLocation(profile, posting),
    careerAlignment: evaluateCareer(profile, posting),
    salary: evaluateSalary(profile, posting),
  };

  // Calculate overall score including salary as sixth dimension (weight 0.05).
  // Salary is down-weighted because many postings don't share ranges and
  // currency/location normalization is imperfect — but it still matters.
  const salaryScore = evaluation.salary?.score ?? 50;
  const techScore = evaluation.technicalSkills.score ?? 50;
  const expScore = evaluation.experienceMatch.score ?? 50;
  const behavScore = evaluation.behavioralFit.score ?? 50;
  const careerScore = evaluation.careerAlignment.score ?? 50;
  const overall = Math.round(
    techScore * 0.30 +
    expScore * 0.25 +
    behavScore * 0.15 +
    careerScore * 0.30 +
    salaryScore * 0.05
  );

  let verdict;
  if (overall >= 75) verdict = 'Strong Fit';
  else if (overall >= 60) verdict = 'Good Fit';
  else if (overall >= 45) verdict = 'Moderate Fit';
  else if (overall >= 30) verdict = 'Weak Fit';
  else verdict = 'Poor Fit';

  // Language gate
  const languageGate = checkLanguageGate(profile, posting);

  // Eligibility gate
  const eligibilityGate = checkEligibility(posting);

  // Build overall summary explanation
  const allReasons = [
    ...evaluation.technicalSkills.reasons.map(r => ({ dimension: 'Technical Skills', ...r })),
    ...evaluation.experienceMatch.reasons.map(r => ({ dimension: 'Experience', ...r })),
    ...evaluation.behavioralFit.reasons.map(r => ({ dimension: 'Behavioral Fit', ...r })),
    ...evaluation.location.reasons.map(r => ({ dimension: 'Location', ...r })),
    ...evaluation.careerAlignment.reasons.map(r => ({ dimension: 'Career Alignment', ...r })),
  ];
  if (evaluation.salary) {
    allReasons.push({
      dimension: 'Salary Fit',
      type: evaluation.salary.score >= 85 ? 'fit' : evaluation.salary.score >= 60 ? 'partial' : 'unfit',
      text: evaluation.salary.reason || '',
    });
  }
  const fitReasons = allReasons.filter(r => r.type === 'fit' || r.type === 'partial');
  const unfitReasons = allReasons.filter(r => r.type === 'unfit');
  const summary = `This role scores ${overall}/100 (${verdict}). ` +
    (fitReasons.length ? `Strongest points: ${fitReasons.slice(0, 2).map(r => r.text).join(' ')} ` : '') +
    (unfitReasons.length ? `Main concerns: ${unfitReasons.slice(0, 2).map(r => r.text).join(' ')} ` : '') +
    (languageGate.verdict === 'FAIL' ? 'IMPORTANT: A required language is missing from your profile. ' : '') +
    (eligibilityGate.verdict === 'FLAG' ? 'IMPORTANT: Eligibility requirements need verification. ' : '') +
    (evaluation.salary?.score && evaluation.salary.score < 60 ? 'Note: Salary expectations may not align with market benchmarks for this zone. ' : '');

  sendJSON(res, 200, {
    evaluation,
    overall,
    verdict,
    languageGate,
    eligibilityGate,
    strengths: extractStrengths(evaluation),
    gaps: extractGaps(evaluation),
    allReasons,
    fitReasons,
    unfitReasons,
    summary,
  });
};

/**
 * Evaluate salary fit by matching posting keywords against the local salary
 * benchmark data. Works without LLM calls — deterministic, privacy-preserving.
 *
 * Strategy:
 * - Extract role and country from the posting text.
 * - Look up any matching company in salary_data.json via fuzzy match; if no
 *   exact entry exists, fall back to the market-benchmark entry for that
 *   country (e.g. "Thailand Market Benchmark (PayScale 2026)").
 * - Find the most relevant category for the inferred role and compute an
 *   index relative to the dataset's baseline. A score of 100 is at baseline,
 *   below 80 signals under-market, above 120 signals well-above-market.
 *   Returns null when the postings/countries are outside the data scope.
 */
function evaluateSalary(profile, posting) {
  const salaryData = readJSON(DATA_FILES.salaryData);
  const companies = Array.isArray(salaryData?.companies) ? salaryData.companies : [];
  if (!companies.length) return null;

  const postingLower = String(posting || '').toLowerCase();
  const location = profile.identity?.location || '';
  // Infer currency / country zone from posting text + location.
  const zones = {
    THB: ['thai', 'thailand', 'bangkok', 'tha', 'usd/thb', '/thb$'],
    MYR: ['malay', 'kuala lumpur', 'myr', 'malaysia', '/myr$'],
    VND: ['vietnam', 'hcmc', 'ho chi', 'hanoi', 'vnd', '/vnd$'],
    CNY: ['china', 'cn', 'shanghai', 'beijing', 'cny', '/cny$'],
  };
  let zone = null;
  for (const [cur, tokens] of Object.entries(zones)) {
    if (tokens.some(tok => postingLower.includes(tok))) { zone = cur; break; }
  }
  if (!zone) return null; // outside benchmark coverage

  // Pick a representative category per zone for this role.
  const roleSlug = (postingLower.match(/\b(marketing|supply chain|business development|finance|software engineer|manager)\b/) || [])[1];
  const categoryHints = {
    'marketing manager': 'marketing_manager',
    'supply chain manager': 'supply_chain_manager',
    'business development manager': 'business_development_manager',
    'finance manager': 'finance_manager',
    'software engineer': 'software_engineer',
  };
  const hint = categoryHints[roleSlug] || '';

  // Prefer matching company by city zone; fallback to any entry with that zone key.
  const zoneLower = zone.toLowerCase();
  const candidates = companies.filter(c => c.city && c.city.toLowerCase().includes(zoneLower));
  const baseEntry = candidates.find(c =>
    Object.keys(c.categories || {}).some(k => hint && k.includes(hint.replace(' manager', '')))
  ) || companies.find(c =>
    Object.keys(c.categories || {}).some(k => k.endsWith(`_${zoneLower}_per_year`))
  );
  if (!baseEntry) return null;

  const catKeys = Object.keys(baseEntry.categories || {});
  const matchedKey = catKeys.find(k => hint && k.includes(hint.replace(' manager', '')))
    || catKeys.find(k => k.endsWith(`_${zone.toLowerCase()}_per_year`))
    || catKeys[0];
  const rawVal = baseEntry.categories?.[matchedKey];
  if (!rawVal) return null;
  const index = typeof rawVal === 'object' ? (rawVal.index ?? rawVal.value ?? 0) : (rawVal || 0);
  const baseline = Number(salaryData.metadata?.index_baseline || 100);
  if (!Number.isFinite(baseline) || baseline === 0) return null;
  const ratio = index / baseline;
  const score = Math.min(100, Math.max(0, Math.round(ratio * 100)));

  let reason = '';
  if (ratio >= 1.15) reason = `${localeCurrency(zone)} ${Math.round(index).toLocaleString()} is above market`;
  else if (ratio >= 0.9) reason = `${localeCurrency(zone)} ${Math.round(index).toLocaleString()} aligns with market`;
  else reason = `${localeCurrency(zone)} ${Math.round(index).toLocaleString()} is below market`;

  return { score, index, zone, hint, reason };
}

function localeCurrency(code) {
  if (!code) return 'currency';
  const symbols = { THB: 'THB', MYR: 'MYR', VND: 'VND', CNY: 'CNY' };
  return symbols[code] || code;
}

function evaluateTechnicalSkills(profile, posting) {
  const skillCategoryMap = {
    primary: [...(profile.skills?.primary || [])],
    secondary: [...(profile.skills?.secondary || [])],
    domain: [...(profile.skills?.domain || [])],
    software: [...(profile.skills?.software || [])],
  };
  const allSkills = Object.values(skillCategoryMap).flat()
    .map(s => s.toLowerCase ? s.toLowerCase() : String(s).toLowerCase());

  const postingText = (posting || '').toLowerCase();
  const skillKeywords = [...new Set(postingText.match(/\b(?:python|java|javascript|typescript|react|vue|angular|node|sql|nosql|mongodb|postgresql|mysql|redis|docker|kubernetes|aws|azure|gcp|ml|ai|tensorflow|pytorch|scikit-learn|pandas|numpy|spark|hadoop|kafka|git|jenkins|ci\/cd|linux|bash|go|rust|c\+\+|ruby|php|swift|kotlin|dart|flutter|graphql|rest|api|microservices|agile|scrum|devops|cloud|machine learning|deep learning|nlp|computer vision|data science|data analysis|tableau|power bi|excel|project management|leadership|communication|teamwork|problem solving|supply chain|logistics|negotiation|procurement|purchasing|inventory|quality assurance|quality control|customer relationship|crm|business development|sales|marketing|contract management|contract negotiation|import|export|customs|shipping|sourcing|vendor management|stakeholder management|budgeting|forecasting|reporting|erp|sap|operations management|strategic planning|cross-functional|cultural communication|cost control|food safety|iso|audit)\b/g) || [])];

  const matched = skillKeywords.filter(s => allSkills.some(p => p.includes(s) || s.includes(p)));
  const missing = skillKeywords.filter(s => !matched.includes(s));
  const total = skillKeywords.length;
  const score = total > 0 ? Math.round((matched.length / total) * 100) : 50;

  // Build detailed per-item evidence
  const matchedDetails = matched.map(s => {
    const category = Object.keys(skillCategoryMap).find(cat =>
      skillCategoryMap[cat].some(skill => String(skill).toLowerCase().includes(s) || s.includes(String(skill).toLowerCase())));
    const actual = category ? skillCategoryMap[category].find(skill => String(skill).toLowerCase().includes(s) || s.includes(String(skill).toLowerCase())) : s;
    return { skill: s, inProfile: actual || s, category: category || 'skills' };
  });

  const reasons = [];
  if (total === 0) {
    reasons.push({ type: 'neutral', text: 'No recognizable technical keywords found in the posting — score is neutral (50).' });
  } else {
    reasons.push({
      type: matched.length >= total * 0.7 ? 'fit' : matched.length >= total * 0.4 ? 'neutral' : 'unfit',
      text: `You match ${matched.length} of ${total} technical skills mentioned (${score}%).`,
    });
    if (matched.length) {
      reasons.push({ type: 'fit', text: 'Matched skills: ' + matched.map(s => s.toUpperCase()).join(', ') + '.' });
    }
    if (missing.length) {
      reasons.push({ type: 'unfit', text: 'Missing from your profile: ' + missing.map(s => s.toUpperCase()).join(', ') + '.' });
    }
    if (allSkills.length === 0) {
      reasons.push({ type: 'unfit', text: 'Your profile has no skills listed — add skills in Candidate Profile to improve this score.' });
    }
  }

  return {
    score,
    matched: matched.length,
    total,
    matchedSkills: matched,
    missingSkills: missing,
    matchedDetails,
    reasons,
    note: `${matched.length}/${total} required skills matched`,
  };
}

function evaluateExperience(profile, posting) {
  const yearsExp = (profile.experience || []).reduce((acc, exp) => {
    if (exp.start) {
      const start = new Date(exp.start);
      if (isNaN(start)) return acc;
      const endStr = (exp.end || '').toString().toLowerCase();
      const end = (endStr === 'present' || endStr === 'current' || endStr === 'now' || !exp.end) ? new Date() : new Date(exp.end);
      if (isNaN(end)) return acc;
      return acc + Math.max(0, (end - start) / (365.25 * 24 * 60 * 60 * 1000));
    }
    return acc;
  }, 0);

  const postingText = (posting || '').toLowerCase();
  const expMatch = postingText.match(/(\d+)\+?\s*(?:years|yrs)/);
  const requiredYears = expMatch ? parseInt(expMatch[1]) : 0;

  let score = 50;
  if (requiredYears === 0) score = 70;
  else if (yearsExp >= requiredYears) score = Math.min(100, 70 + Math.round((yearsExp - requiredYears) * 5));
  else score = Math.max(20, 70 - Math.round((requiredYears - yearsExp) * 15));

  // Detailed reasons
  const relevantTitles = (profile.experience || []).map(e => e.title).filter(Boolean);
  const reasons = [];
  if (requiredYears === 0) {
    reasons.push({ type: 'neutral', text: 'The posting does not state a specific years-of-experience requirement.' });
    reasons.push({ type: 'fit', text: `Your profile shows ${Math.round(yearsExp * 10) / 10} years of experience across ${(profile.experience || []).length} position(s).` });
  } else if (yearsExp >= requiredYears) {
    reasons.push({ type: 'fit', text: `You exceed the requirement: ${Math.round(yearsExp * 10) / 10} years vs ${requiredYears} required (${Math.round((yearsExp - requiredYears) * 10) / 10} extra years).` });
  } else {
    reasons.push({ type: 'unfit', text: `Experience gap: ${Math.round(yearsExp * 10) / 10} years vs ${requiredYears} required (short by ${Math.round((requiredYears - yearsExp) * 10) / 10} years).` });
  }
  if (relevantTitles.length) {
    reasons.push({ type: 'neutral', text: 'Your roles: ' + relevantTitles.slice(0, 5).join('; ') + '.' });
  } else {
    reasons.push({ type: 'unfit', text: 'No work experience is recorded in your profile.' });
  }

  return {
    score,
    yearsExp: Math.round(yearsExp * 10) / 10,
    requiredYears,
    reasons,
    note: `${Math.round(yearsExp * 10) / 10} years vs ${requiredYears} required`,
  };
}

function evaluateBehavioral(profile, posting) {
  const traits = profile.behavioral?.traits || [];
  const strengths = profile.behavioral?.strengths || [];
  const postingText = (posting || '').toLowerCase();
  const cultureKeywords = ['collaborative', 'independent', 'fast-paced', 'startup', 'enterprise', 'remote', 'hybrid', 'agile', 'innovative', 'structured'];
  const foundCulture = cultureKeywords.filter(k => postingText.includes(k));
  const score = 50 + Math.min(30, foundCulture.length * 10) + (traits.length > 0 ? 20 : 0);

  const reasons = [];
  if (traits.length) {
    reasons.push({ type: 'fit', text: `You have ${traits.length} behavioral trait(s) on file: ${traits.slice(0, 6).join(', ')}.` });
  } else {
    reasons.push({ type: 'unfit', text: 'No behavioral traits recorded in your profile — this dimension is uncertain.' });
  }
  if (foundCulture.length) {
    reasons.push({ type: 'fit', text: `Posting culture signals detected: ${foundCulture.join(', ')} — these can be referenced in your application.` });
  } else {
    reasons.push({ type: 'neutral', text: 'No explicit culture keywords found in the posting — research the company culture separately.' });
  }
  if (strengths.length) {
    reasons.push({ type: 'neutral', text: `Your listed strengths (${strengths.slice(0, 4).join(', ')}) can support your narrative if relevant.` });
  }

  return {
    score: Math.min(100, score),
    traitsOnFile: traits.length,
    cultureSignals: foundCulture,
    reasons,
    note: `${traits.length} behavioral traits on file, ${foundCulture.length} culture signals detected`,
  };
}

function evaluateLocation(profile, posting) {
  const postingText = (posting || '').toLowerCase();
  const userLocation = (profile.identity?.location || '').toLowerCase();
  const reasons = [];
  if (!userLocation) {
    reasons.push({ type: 'neutral', text: 'No location set in your profile — add it to enable location matching.' });
    return { pass: true, reasons, note: 'No location set in profile' };
  }
  if (postingText.includes('remote')) {
    reasons.push({ type: 'fit', text: 'Posting explicitly mentions remote work — location is not a blocker.' });
    reasons.push({ type: 'neutral', text: `Your location (${profile.identity.location}) should still be checked against any time-zone or on-site requirements.` });
    return { pass: true, reasons, note: 'Remote position' };
  }
  const locationParts = userLocation.split(',').map(s => s.trim()).filter(Boolean);
  const match = locationParts.some(loc => postingText.includes(loc));
  if (match) {
    const matched = locationParts.filter(loc => postingText.includes(loc));
    reasons.push({ type: 'fit', text: `Your location matches the posting: ${matched.join(', ')}.` });
  } else {
    reasons.push({ type: 'unfit', text: `Location mismatch: your location is "${profile.identity.location}" but the posting mentions a different location or does not specify one.` });
    reasons.push({ type: 'neutral', text: 'Verify whether relocation or visa sponsorship is available before applying.' });
  }
  return { pass: match, reasons, note: match ? 'Location matches' : 'Location may not match - verify' };
}

function evaluateCareer(profile, posting) {
  const goals = profile.careerGoals?.targetRoles || [];
  const sectors = profile.careerGoals?.targetSectors || [];
  const postingText = (posting || '').toLowerCase();
  const matchedGoals = [];
  goals.forEach(g => {
    const gLower = g.toLowerCase();
    if (postingText.includes(gLower) || gLower.split(' ').some(word => word.length > 3 && postingText.includes(word))) matchedGoals.push(g);
  });
  const matchedSectors = sectors.filter(s => postingText.includes(s.toLowerCase()));
  const matches = matchedGoals.length;
  const score = goals.length > 0 ? Math.min(100, 40 + Math.round((matches / goals.length) * 60)) : 50;

  const reasons = [];
  if (goals.length === 0) {
    reasons.push({ type: 'neutral', text: 'No target roles set in your career goals — add them for meaningful alignment scoring.' });
  } else {
    reasons.push({
      type: matches >= goals.length / 2 ? 'fit' : matches ? 'neutral' : 'unfit',
      text: `${matches} of ${goals.length} target roles align with this posting (${Math.round((matches / goals.length) * 100)}%).`,
    });
    if (matchedGoals.length) reasons.push({ type: 'fit', text: 'Aligned target roles: ' + matchedGoals.join(', ') + '.' });
    const unmatched = goals.filter(g => !matchedGoals.includes(g));
    if (unmatched.length) reasons.push({ type: 'unfit', text: 'Target roles not reflected in this posting: ' + unmatched.join(', ') + '.' });
  }
  if (matchedSectors.length) {
    reasons.push({ type: 'fit', text: 'Target sectors present in the posting: ' + matchedSectors.join(', ') + '.' });
  } else if (sectors.length) {
    reasons.push({ type: 'neutral', text: 'Your target sectors (' + sectors.join(', ') + ') are not explicitly mentioned — verify the industry fits.' });
  }

  return {
    score,
    matches,
    total: goals.length,
    matchedRoles: matchedGoals,
    matchedSectors,
    reasons,
    note: `${matches}/${goals.length} target roles aligned`,
  };
}

function checkLanguageGate(profile, posting) {
  const languages = profile.languages || [];
  const reasons = [];
  if (languages.length === 0) {
    reasons.push({ type: 'neutral', text: 'No languages declared in your profile.' });
    return { verdict: 'PASS', reasons, note: 'No languages declared - set up your profile first' };
  }

  const postingText = (posting || '').toLowerCase();
  const langMap = { 'english': 'english', 'danish': 'danish', 'spanish': 'spanish', 'german': 'german', 'french': 'french', 'chinese': 'chinese', 'mandarin': 'chinese', 'japanese': 'japanese', 'korean': 'korean', 'portuguese': 'portuguese', 'italian': 'italian', 'dutch': 'dutch', 'swedish': 'swedish', 'norwegian': 'norwegian', 'finnish': 'finnish', 'arabic': 'arabic', 'hindi': 'hindi', 'russian': 'russian' };

  for (const [lang, keyword] of Object.entries(langMap)) {
    if (postingText.includes(`fluent ${keyword}`) || postingText.includes(`${keyword} required`) || postingText.includes(`must speak ${keyword}`)) {
      const declared = languages.find(l => (l.language || '').toLowerCase().includes(lang) || (l.language || '').toLowerCase().includes(keyword));
      if (!declared) {
        reasons.push({ type: 'unfit', text: `Posting requires ${lang}, which is NOT declared in your profile — add it if you speak it.` });
        return { verdict: 'FAIL', reasons, note: `Posting requires ${lang} which is not declared in your profile` };
      }
      reasons.push({ type: 'fit', text: `Posting requires ${lang} — you declared ${declared.language} (${declared.level || 'level not set'}).` });
    }
  }
  if (!reasons.length) reasons.push({ type: 'neutral', text: 'No specific language requirements detected in the posting.' });
  return { verdict: 'PASS', reasons, note: 'Language requirements met' };
}

function checkEligibility(posting) {
  const postingText = (posting || '').toLowerCase();
  const reasons = [];
  const flags = [];
  if (postingText.includes('citizen')) flags.push('citizenship');
  if (postingText.includes('permanent resident')) flags.push('permanent residency');
  if (postingText.includes('security clearance')) flags.push('security clearance');
  if (postingText.includes('work permit') || postingText.includes('visa sponsorship')) flags.push('work permit / visa');
  if (flags.length) {
    reasons.push({ type: 'unfit', text: `Posting mentions ${flags.join(', ')} requirements — verify your eligibility before applying.` });
    return { verdict: 'FLAG', reasons, note: 'Posting may have citizenship/residency/clearance requirements - verify before applying' };
  }
  reasons.push({ type: 'fit', text: 'No citizenship, residency, or clearance restrictions detected in the posting.' });
  return { verdict: 'PASS', reasons, note: 'No eligibility restrictions detected' };
}

function extractStrengths(eval_) {
  const strengths = [];
  if (eval_.technicalSkills.score >= 70 && eval_.technicalSkills.matchedSkills?.length) {
    strengths.push(`Strong technical match (${eval_.technicalSkills.matched}/${eval_.technicalSkills.total}): ${eval_.technicalSkills.matchedSkills.slice(0, 5).map(s => s.toUpperCase()).join(', ')}`);
  }
  if (eval_.experienceMatch.score >= 70) {
    strengths.push(`Experience exceeds requirement (${eval_.experienceMatch.yearsExp} years vs ${eval_.experienceMatch.requiredYears || 'no minimum'} required)`);
  }
  if (eval_.behavioralFit.score >= 70) {
    strengths.push(`Culture fit signals present${eval_.behavioralFit.cultureSignals?.length ? ': ' + eval_.behavioralFit.cultureSignals.join(', ') : ' from your behavioral traits'}`);
  }
  if (eval_.careerAlignment.score >= 70 && eval_.careerAlignment.matchedRoles?.length) {
    strengths.push(`Aligns with your target roles: ${eval_.careerAlignment.matchedRoles.join(', ')}`);
  }
  if (eval_.location.pass) {
    strengths.push('Location requirement satisfied');
  }
  return strengths.length > 0 ? strengths : ['Complete your Candidate Profile (skills, experience, goals) for a more accurate assessment'];
}

function extractGaps(eval_) {
  const gaps = [];
  if (eval_.technicalSkills.score < 70 && eval_.technicalSkills.missingSkills?.length) {
    gaps.push(`Skills missing from your profile: ${eval_.technicalSkills.missingSkills.slice(0, 6).map(s => s.toUpperCase()).join(', ')}${eval_.technicalSkills.missingSkills.length > 6 ? ' and others' : ''}. Add these if you have the experience, or highlight transferable skills in your application.`);
  }
  if (eval_.experienceMatch.requiredYears > 0 && eval_.experienceMatch.yearsExp < eval_.experienceMatch.requiredYears) {
    gaps.push(`Experience shortfall: ${eval_.experienceMatch.yearsExp} years vs ${eval_.experienceMatch.requiredYears} required. Emphasize relevant projects and achievements to compensate.`);
  }
  if (eval_.behavioralFit.score < 70) {
    gaps.push('Behavioral/culture fit uncertain — add behavioral traits to your profile and research the company culture to tailor your application.');
  }
  if (eval_.careerAlignment.total > 0 && eval_.careerAlignment.matches === 0) {
    gaps.push(`No alignment with your target roles (${eval_.careerGoalsNote || 'see career goals'}). Confirm this role fits your long-term direction before applying.`);
  }
  if (!eval_.location.pass) {
    gaps.push('Location does not appear to match — confirm relocation, remote options, or visa sponsorship.');
  }
  return gaps;
}

// --- CV Generation ---
api['POST /api/generate-cv'] = (req, res, body) => {
  const { company, role, posting } = body;
  const { tailoredProfile, report } = tailoredFor(body);

  const tex = generateCVTex(tailoredProfile, company, role, posting);
  sendJSON(res, 200, { ok: true, tex, report, filename: `main_${slugify(company)}_${slugify(role)}.tex` });
};

function generateCVTex(profile, company, role, posting) {
  const name = profile.identity?.name || '[YOUR NAME]';
  const nameParts = name.split(' ');
  const firstName = nameParts[0] || '[First]';
  const lastName = nameParts.slice(1).join(' ') || '[Last]';
  const email = profile.identity?.email || 'your.email@example.com';
  const phone = profile.identity?.phone || '+XX XXXXXXXXXX';
  const linkedin = profile.identity?.linkedin || 'https://linkedin.com/in/your-profile';
  const github = profile.identity?.github || 'https://github.com/your-username';
  const address = profile.identity?.location || '[Your Address, City, Country]';

  const skills = profile.skills || { primary: [], secondary: [], domain: [], software: [] };
  const education = profile.education || [];
  const experience = profile.experience || [];

  let tex = `%% CV - ${company}, ${role}
%% Generated by AI Job Search Web
%% Compile with: lualatex main_${slugify(company)}_${slugify(role)}.tex

\\documentclass[11pt,a4paper,sans]{moderncv}
\\moderncvstyle{banking}
\\moderncvcolor{blue}

\\renewcommand*{\\namefont}{\\fontsize{34}{36}\\bfseries\\upshape}
\\colorlet{firstnamecolor}{color1}
\\colorlet{lastnamecolor}{color1}
\\colorlet{namecolor}{color1}
\\renewcommand*{\\sectionstyle}[1]{{\\sectionfont\\color{color1}#1}}

\\usepackage[utf8]{inputenc}
\\ifpdftex\\usepackage[T1]{fontenc}\\fi
\\AtEndPreamble{\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    filecolor=magenta,
    urlcolor=blue,
    pdftitle={${escapeLatex(name)} - CV},
    pdfpagemode=UseNone,
}}
\\usepackage[scale=0.80]{geometry}
\\usepackage{import}
\\usepackage{needspace}

\\name{${escapeLatex(firstName)}}{${escapeLatex(lastName)}}
\\address{${escapeLatex(address)}}{}{}
\\phone[mobile]{${phone}}
\\email{${email}}
\\extrainfo{\\href{${linkedin}}{LinkedIn}, \\href{${github}}{GitHub}}

\\begin{document}

\\makecvtitle

\\vspace{6pt}
\\small{${escapeLatex(profile.summary || `Profile statement tailored for ${role} at ${company}.`)}}

${(profile.highlights && profile.highlights.length) ? `\\section{Why My Background Fits This Role}
\\vspace{1pt}
\\begin{itemize}
${profile.highlights.map(h => `    \\item {${escapeLatex(h)}}\n`).join('')}\\end{itemize}

` : ''}\\section{Core Competencies}
\\vspace{1pt}
\\begin{itemize}
`;

  if (skills.primary && skills.primary.length > 0) {
    tex += `\\item \\textbf{Primary Skills}: ${skills.primary.map(escapeLatex).join(', ')}\n`;
  }
  if (skills.secondary && skills.secondary.length > 0) {
    tex += `\\item \\textbf{Secondary Skills}: ${skills.secondary.map(escapeLatex).join(', ')}\n`;
  }
  if (skills.domain && skills.domain.length > 0) {
    tex += `\\item \\textbf{Domain Expertise}: ${skills.domain.map(escapeLatex).join(', ')}\n`;
  }
  if (skills.software && skills.software.length > 0) {
    tex += `\\item \\textbf{Software \\& Tools}: ${skills.software.map(escapeLatex).join(', ')}\n`;
  }

  tex += `\\end{itemize}

\\section{Professional Experience}
\\vspace{3pt}
\\begin{itemize}
`;

  experience.forEach(exp => {
    tex += `\\needspace{5\\baselineskip}\n`;
    const dateText = (exp.start || exp.end) ? `${exp.start || ''}${exp.start && exp.end ? '–' : ''}${exp.end || ''}` : '';
    tex += `\\item{\\cventry{${dateText}}{${escapeLatex(exp.title || 'Job Title')}}{${escapeLatex(exp.company || 'Company')}}{${escapeLatex(exp.location || '')}}{}{\\vspace{1pt}\n\\begin{itemize}\n`;
    (exp.bullets || exp.responsibilities || []).forEach(b => {
      tex += `    \\item {${escapeLatex(b)}}\n`;
    });
    if (!exp.bullets && !exp.responsibilities) {
      tex += `    \\item {Key responsibility or achievement}\n`;
    }
    tex += `\\end{itemize}}}\n\\vspace{3pt}\n\n`;
  });

  tex += `\\end{itemize}

\\section{Education}
\\vspace{1pt}
\\begin{itemize}
`;

  education.forEach(edu => {
    tex += `\\item{\\cventry{${edu.start || 'YYYY'}-${edu.end || 'YYYY'}}{${escapeLatex(edu.degree || 'Degree')}}{${escapeLatex(edu.institution || 'Institution')}}{${escapeLatex(edu.location || '')}}{}{\\vspace{1pt}\n${escapeLatex(edu.description || edu.topics || '')}\n}}\n\\vspace{3pt}\n\n`;
  });

  tex += `\\end{itemize}

\\section{Languages}
\\vspace{1pt}
\\begin{itemize}
\\item {${(profile.languages || []).map(l => `${l.language} (${l.level})`).join(', ') || '[Language 1] (native), [Language 2] (fluent)'}}
\\end{itemize}

\\section{References}
\\vspace{1pt}
\\begin{itemize}
\\item{Available upon request.}
\\end{itemize}

\\end{document}
`;

  return tex;
}

// --- Cover Letter Generation ---
api['POST /api/generate-cover-letter'] = (req, res, body) => {
  const { company, role, posting } = body;
  const { tailoredProfile } = tailoredFor(body);

  const tex = generateCoverLetterTex(tailoredProfile, company, role, posting);
  sendJSON(res, 200, { ok: true, tex, filename: `cover_${slugify(company)}_${slugify(role)}.tex` });
};

function generateCoverLetterTex(profile, company, role, posting) {
  const name = profile.identity?.name || '[YOUR NAME]';
  const email = profile.identity?.email || 'your.email@example.com';
  const phone = profile.identity?.phone || '+XX XXXXXXXXXX';
  const linkedin = profile.identity?.linkedin || 'https://linkedin.com/in/yourprofile';

  const experience = profile.experience || [];
  const topExp = experience[0] || {};

  return `%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Cover Letter - ${escapeLatex(company)}, ${escapeLatex(role)}
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

\\documentclass[]{cover}
\\usepackage{fancyhdr}

\\pagestyle{fancy}
\\fancyhf{}

\\rfoot{Page \\thepage \\hspace{0pt}}
\\thispagestyle{empty}
\\renewcommand{\\headrulewidth}{0pt}
\\begin{document}

\\namesection{}{\\Huge{${escapeLatex(name)}}}{  \\href{mailto:${email}}{${email}} | ${phone} |  \\urlstyle{same}\\href{${linkedin}}{LinkedIn}
}

\\currentdate{\\today}
\\lettercontent{Dear Hiring Manager,}

\\lettercontent{I am writing to express my strong interest in the ${escapeLatex(role)} position at ${escapeLatex(company)}. ${profile.summary ? escapeLatex(profile.summary) : (topExp.title ? `With my background as a ${escapeLatex(topExp.title)}` : 'With my professional background') + ' and a proven track record of delivering results, I am confident I would be a valuable addition to your team.'}}

\\lettercontent{Here is how my experience maps to your requirements:}

{\\raggedright\\fontspec[Path = OpenFonts/fonts/raleway/, BoldFont = Raleway-Bold]{Raleway-Medium}\\fontsize{11pt}{13pt}\\selectfont
\\begin{itemize}
${(profile.highlights && profile.highlights.length ? profile.highlights : (topExp.bullets || []).slice(0, 2)).map(h => `    \\item \\textbf{Relevant Experience:} ${escapeLatex(h)}\n`).join('')}    \\item \\textbf{Relevant Competencies:} ${((profile.skills?.primary || []).length ? profile.skills.primary.slice(0, 5) : ['Your primary skills']).map(escapeLatex).join(', ')}
\\end{itemize}\\par}
\\vspace{6pt}

\\lettercontent{I am particularly drawn to ${escapeLatex(company)} because this ${escapeLatex(role)} role aligns closely with the experience and strengths set out above. I would welcome the opportunity to discuss how I can contribute to your team's goals.}

\\lettercontent{I look forward to hearing from you.}

\\begin{flushright}
\\closing{Kind regards,}

\\signature{${escapeLatex(name)}}
\\end{flushright}
\\end{document}
`;
}

// --- Interview Prep ---
api['POST /api/interview-prep'] = async (req, res, body) => {
  const profile = readJSON(DATA_FILES.profile) || {};
  const { company, role, posting } = body;
  const language = body.language || 'en';

  if (llmConfigured()) {
    try {
      const prep = await aiInterviewPrep(profile, company, role, posting, language);
      return sendJSON(res, 200, prep);
    } catch (e) {
      console.error('AI interview prep failed, using local logic:', e.message);
      const prep = {
        company,
        role,
        starExamples: generateSTARExamples(profile, company, role, posting),
        likelyQuestions: generateLikelyQuestions(role, posting, profile),
        talkingPoints: generateTalkingPoints(profile, role, posting),
        questionsToAsk: generateQuestionsToAsk(company, role, posting),
        source: 'local',
        warning: e.message,
      };
      return sendJSON(res, 200, prep);
    }
  }

  const prep = {
    company,
    role,
    starExamples: generateSTARExamples(profile, company, role, posting),
    likelyQuestions: generateLikelyQuestions(role, posting, profile),
    talkingPoints: generateTalkingPoints(profile, role, posting),
    questionsToAsk: generateQuestionsToAsk(company, role, posting),
    source: 'local',
  };

  sendJSON(res, 200, prep);
};

/**
 * Generate STAR examples from either user-supplied starExamples (preferred —
 * real stories) or profile experience bullets with concrete placeholders.
 * When starExamples exists, return them verbatim; otherwise derive Situations
 * and Tasks from the candidate's own work history and leave Actions/Results
 * as focused fill-in prompts that reference the actual posting requirements.
 */
function generateSTARExamples(profile, company, role, posting) {
  const postText = String(posting || '').toLowerCase();
  const exps = profile.experience || [];
  const skills = (profile.skills?.primary || []);
  const behav = profile.behavioral || {};
  const prebuilt = Array.isArray(profile.starExamples) ? profile.starExamples : [];

  // If the user has already filled in their own STAR stories, use them directly.
  if (prebuilt.length > 0) return prebuilt.map(s => ({
    title: s.title || 'Key Achievement',
    situation: s.situation || '',
    task: s.task || '',
    action: s.action || '',
    result: s.result || '',
  }));

  // Derive situations/tasks from real experience, using posting keywords where possible.
  return exps.slice(0, 4).map((exp, i) => {
    const topBullet = (exp.bullets || exp.responsibilities || [])[0] || '';
    return {
      title: `${exp.title || 'Project'} at ${exp.company || 'Company'}`,
      situation: `As a ${exp.title || 'professional'} at ${exp.company || 'my organization'}, responsible for ${topBullet.replace(/[^a-zA-Z ]/g, '').slice(0, 80)}${topBullet ? '…' : 'key operations'}.`,
      task: exp.location ? `Balance delivery across ${exp.location}${skills.length ? ' while applying ' + skills.slice(0, 2).join(' and ') : ''}` : `Deliver on core KPIs including throughput, quality, cost control, and stakeholder satisfaction.`,
      action: `Outline the specific decisions, tools, frameworks, and cross-functional coordination you used. Reference a measurable metric if possible.`,
      result: `Quantify the outcome — revenue, headcount, SLA improvement, cycle-time reduction, or customer retention — and state what you changed for future iterations.`,
    };
  });
}

/**
 * Generate posting-aware interview questions drawn from three sources:
 *  (1) posting-derived questions from extracted competencies / keywords,
 *  (2) behavior-based questions tailored by seniority signal,
 *  (3) universal opening/closing. This replaces the previous hardcoded list.
 */
function generateLikelyQuestions(role, posting, profile) {
  const roleLower = String(role || '').toLowerCase();
  const postLower = String(posting || '').toLowerCase();

  // Extract role-relevant terms from the posting to drive question generation.
  const keyTerms = new Set([
    ...(postLower.match(/\b(?:python|java|typescript|react|aws|kubernetes|docker|sql|no-sql|leader|manager|negotiation|sourcing|supply chain|logistics|import|export|customs|marketing|sales|finance|engineering|quality|audit)\b/gi) || []),
    ...(roleLower.split(/\s+/).filter(w => w.length > 4) || []),
  ]);

  const q = new Set();

  // Universal anchors.
  q.add('Tell me about yourself and why this role at our company matters to you right now.');
  q.add('Why do you want to work here rather than a peer company?');
  q.add('What strengths make you confident you can deliver in this role from day one?');
  q.add('Describe a challenging project or situation and how you navigated it.');
  q.add('Where do you see yourself professionally in three to five years?');
  q.add('What motivates you most and what drains your energy?');
  q.add('What do you know about our products, market position, or recent initiatives?');
  q.add("I'd like to hear about a time you worked with a difficult colleague or stakeholder.");
  q.add('What are your salary expectations for this level?');
  q.add("Is there anything we have not covered that you would like me to know?");

  // Posting-driven questions.
  if (keyTerms.size > 0) {
    const sampled = [...new Set([...keyTerms].slice(0, 5))];
    q.add(`How have you applied ${sampled.join(' / ')} in your recent roles?`);
    q.add('Which of the core competencies listed in this posting do you feel strongest against, and where might you need support early on?');
  }

  // Seniority-specific.
  if (/manager|lead|head|director|principal|senior/i.test(roleLower)) {
    q.add('How do you handle conflict or underperformance within your team?');
    q.add('Describe your management and delegation style with a concrete example.');
    q.add('When priorities collide, how do you decide what to defer?');
    q.add('How do you align a team around a ambiguous or evolving goal?');
  }
  if (/engineer|developer|data|analyst|scientist|architect/i.test(roleLower)) {
    q.add('Walk me through a technical decision you made recently and why.');
    q.add('How do you balance shipping fast against code quality and maintainability?');
    q.add('Tell me about a time you mentored someone or raised the bar for the team.');
  }

  return [...q];
}

/**
 * Talking points built from the candidate's own evidence — not generic filler.
 */
function generateTalkingPoints(profile, role, posting) {
  const skills = profile.skills || { primary: [], domain: [] };
  const exps = profile.experience || [];
  const behav = profile.behavioral || {};
  const topExp = exps[0] || {};
  const goals = profile.careerGoals || {};

  const items = [];
  if (skills.primary.length) {
    items.push(`${skills.primary.slice(0, 4).join(', ')} — how each maps to a requirement in this posting`);
  }
  if (topExp.title && topExp.company) {
    items.push(`My background as a ${topExp.title} at ${topExp.company}: ${((topExp.bullets || [])[0] || 'consistent delivery').replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 100)}`);
  }
  if (skills.domain.length) {
    items.push(`Domain depth in ${skills.domain.slice(0, 2).join(', ')} — relevant because this role operates at that intersection`);
  }
  if (goals.targetRoles?.length) {
    items.push(`Career trajectory: moving toward ${goals.targetRoles.slice(0, 2).join(' / ')}, which is why this next step makes sense now`);
  }
  if (behav.strengths?.length) {
    items.push(`Recurring strengths I bring: ${behav.strengths.slice(0, 3).join(', ')}`);
  }
  // Fallback when the profile is thin.
  if (!items.length) {
    items.push('Core competencies that match the posting');
    items.push('Two or three measurable wins from my most recent role');
    items.push('Why I am motivated to join this company specifically');
  }
  return items;
}

/**
 * Questions the candidate should ask — tied to company/role, not boilerplate.
 */
function generateQuestionsToAsk(company, role, posting) {
  const postLower = String(posting || '').toLowerCase();
  const qs = [
    `What does success look like in the first six to twelve months for a ${role}?`,
    "Who will I report to and how is the team structured?",
    `What are the biggest blockers the person in this role will face in quarter one?`,
    'How does the company invest in growth and internal mobility?',
    "What does the onboarding and ramp-up path look like?",
    'What are the next steps and timeline in the process?',
  ];

  // Tailor follow-ups based on what appears in the posting.
  if (/remote|hybrid|flex/i.test(postLower)) {
    qs.push("How does the team collaborate asynchronously versus synchronously?");
  }
  if (/scale|growth|fast.?moving/i.test(postLower)) {
    qs.push('What stage of scaling is the org in, and what has been the hardest lesson so far?');
  }
  if (/lead|manager|head/i.test(String(role || '').toLowerCase())) {
    qs.push('How are performance reviews and promotions handled here?');
    qs.push('What autonomy does this role have over hiring and budget?');
  }

  return qs;
}

// --- HTML Report Generation ---
api['POST /api/html-report'] = (req, res, body) => {
  const tracker = readJSON(DATA_FILES.tracker);
  const html = generateHTMLReport(tracker);
  sendJSON(res, 200, { ok: true, html });
};

function generateHTMLReport(tracker) {
  const statusBuckets = { Drafted: 0, Active: 0, Interview: 0, Offer: 0, Hired: 0, 'Rejected/Closed': 0 };
  const sectors = {};
  const channels = {};
  let total = 0;

  tracker.forEach(t => {
    if (t.status === 'drafted') { statusBuckets.Drafted++; return; }
    total++;
    const norm = normalizeStatus(t.status);
    if (statusBuckets[norm] !== undefined) statusBuckets[norm]++;
    if (t.sector) sectors[t.sector] = (sectors[t.sector] || 0) + 1;
    if (t.channel) channels[t.channel] = (channels[t.channel] || 0) + 1;
  });

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Job Search Dashboard</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;padding:20px;background:#f5f5f5;color:#333}
.container{max-width:1200px;margin:0 auto}
h1{color:#2A9D8F}
.stat-cards{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:20px 0}
.stat-card{background:#fff;border-radius:8px;padding:15px;box-shadow:0 1px 3px rgba(0,0,0,.1);border-left:4px solid}
.stat-card .num{font-size:28px;font-weight:bold}
.stat-card .label{font-size:12px;color:#666;text-transform:uppercase}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}
th,td{padding:10px;text-align:left;border-bottom:1px solid #eee}
th{background:#2A9D8F;color:#fff}
tr:nth-child(even){background:#f9f9f9}
.badge{padding:2px 8px;border-radius:12px;font-size:11px;font-weight:bold;color:#fff}
</style></head><body><div class="container">
<h1>Job Search Dashboard</h1>
<p>Generated: ${new Date().toISOString()}</p>
<div class="stat-cards">
${Object.entries(statusBuckets).map(([k, v]) => {
  const colors = { Drafted: '#64748b', Active: '#3b82f6', Interview: '#f59e0b', Offer: '#8b5cf6', Hired: '#22c55e', 'Rejected/Closed': '#ef4444' };
  return `<div class="stat-card" style="border-color:${colors[k]}"><div class="num">${v}</div><div class="label">${k}</div></div>`;
}).join('')}
</div>
<h2>Applications (${tracker.length})</h2>
<table><tr><th>Date</th><th>Company</th><th>Role</th><th>Sector</th><th>Status</th><th>Fit</th><th>Notes</th></tr>
${tracker.map(t => `<tr><td>${t.date || '-'}</td><td>${t.company || '-'}</td><td>${t.role || '-'}</td><td>${t.sector || '-'}</td><td><span class="badge" style="background:${statusColor(normalizeStatus(t.status))}">${t.status || '-'}</span></td><td>${t.fitRating || '-'}</td><td>${(t.notes || '').substring(0, 80)}</td></tr>`).join('')}
</table>
</div></body></html>`;
}

function normalizeStatus(status) {
  const map = {
    'drafted': 'Drafted', 'applied': 'Active', 'interview': 'Interview',
    'offer': 'Offer', 'hired': 'Hired',
    'rejected': 'Rejected/Closed', 'no_response': 'Rejected/Closed', 'no response': 'Rejected/Closed',
    'offer_declined': 'Rejected/Closed', 'offer declined': 'Rejected/Closed', 'withdrawn': 'Rejected/Closed'
  };
  return map[status?.toLowerCase()] || 'Rejected/Closed';
}

function statusColor(status) {
  const colors = { Drafted: '#64748b', Active: '#3b82f6', Interview: '#f59e0b', Offer: '#8b5cf6', Hired: '#22c55e', 'Rejected/Closed': '#ef4444' };
  return colors[status] || '#64748b';
}

// --- Utilities ---
function slugify(s) {
  // Keep unicode letters/digits (supports Chinese, accents, etc.), replace everything else with underscore
  const slug = String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'na';
}

function escapeLatex(s) {
  return String(s || '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

// --- Repo file access (read-only) ---
api['GET /api/repo-files'] = (req, res, body, params, query) => {
  const relPath = query.path || '';
  const safePath = path.normalize(relPath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(REPO_DIR, safePath);
  if (!fullPath.startsWith(REPO_DIR)) {
    sendJSON(res, 403, { error: 'Access denied' });
    return;
  }
  try {
    if (fs.statSync(fullPath).isDirectory()) {
      const items = fs.readdirSync(fullPath).map(name => {
        const stat = fs.statSync(path.join(fullPath, name));
        return { name, isDirectory: stat.isDirectory(), size: stat.size };
      });
      sendJSON(res, 200, { type: 'directory', items });
    } else {
      const content = fs.readFileSync(fullPath, 'utf-8');
      sendJSON(res, 200, { type: 'file', content, name: path.basename(fullPath) });
    }
  } catch (e) {
    sendJSON(res, 404, { error: 'File not found', path: safePath });
  }
};

// --- Stats ---
api['GET /api/stats'] = (req, res) => {
  const tracker = readJSON(DATA_FILES.tracker);
  const seenJobs = readJSON(DATA_FILES.seenJobs);
  const profile = readJSON(DATA_FILES.profile);

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const urgentEntries = tracker.filter(t => {
    if (!t.deadline) return false;
    const dl = new Date(t.deadline);
    if (isNaN(dl.getTime())) return false;
    return dl >= now && dl <= sevenDaysLater && t.status !== 'hired' && t.status !== 'rejected' && t.status !== 'withdrawn';
  });

  const stats = {
    totalApplications: tracker.filter(t => t.status !== 'drafted').length,
    drafted: tracker.filter(t => t.status === 'drafted').length,
    active: tracker.filter(t => t.status === 'applied').length,
    interview: tracker.filter(t => t.status === 'interview').length,
    offer: tracker.filter(t => t.status === 'offer').length,
    hired: tracker.filter(t => t.status === 'hired').length,
    rejected: tracker.filter(t => ['rejected', 'no_response', 'no response'].includes(t.status)).length,
    urgentDeadlines: urgentEntries.length,
    seenJobs: Object.keys(seenJobs.seen || {}).length,
    profileComplete: calculateProfileCompletion(profile),
  };

  // Funnel
  const total = stats.totalApplications;
  stats.funnel = {
    applied: total,
    interview: stats.interview + stats.offer + stats.hired,
    offer: stats.offer + stats.hired,
    hired: stats.hired,
  };
  stats.funnelRate = total > 0 ? Math.round((stats.funnel.interview / total) * 100) : 0;

  // Sectors
  const sectors = {};
  tracker.forEach(t => { if (t.sector) sectors[t.sector] = (sectors[t.sector] || 0) + 1; });
  stats.sectors = sectors;

  // Channels
  const channels = {};
  tracker.forEach(t => { if (t.channel) channels[t.channel] = (channels[t.channel] || 0) + 1; });
  stats.channels = channels;

  sendJSON(res, 200, stats);
};

function calculateProfileCompletion(profile) {
  let filled = 0;
  let total = 10;
  if (profile.identity?.name) filled++;
  if (profile.identity?.email) filled++;
  if (profile.identity?.location) filled++;
  if ((profile.languages || []).length > 0) filled++;
  if ((profile.education || []).length > 0) filled++;
  if ((profile.experience || []).length > 0) filled++;
  if ((profile.skills?.primary || []).length > 0) filled++;
  if ((profile.careerGoals?.targetRoles || []).length > 0) filled++;
  if ((profile.behavioral?.traits || []).length > 0) filled++;
  if ((profile.starExamples || []).length > 0 || (profile.experience || []).length > 0) filled++;
  return Math.round((filled / total) * 100);
}

// ============ RESUME ANALYSIS ============

function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from('--' + boundary);
  let start = buffer.indexOf(boundaryBuffer);
  while (start !== -1) {
    let end = buffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (end === -1) break;
    const partData = buffer.slice(start + boundaryBuffer.length + 2, end - 2); // -2 for \r\n before boundary
    if (partData.length === 0) break;
    // Find headers/body separator (\r\n\r\n)
    const headerEnd = partData.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      start = end;
      continue;
    }
    const headerStr = partData.slice(0, headerEnd).toString('utf-8');
    const data = partData.slice(headerEnd + 4);
    // Parse Content-Disposition
    const filenameMatch = headerStr.match(/filename="([^"]*)"/);
    const nameMatch = headerStr.match(/name="([^"]*)"/);
    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : null,
      headers: headerStr,
      data: data,
    });
    start = end;
  }
  return parts;
}

/**
 * Extract a resume section by locating a header that occupies its own line.
 * Returns the text between the header and the next section header.
 */
function extractSection(fullText, headerNames, stopHeaders) {
  const lines = fullText.split(/\r?\n/);
  const headerRe = new RegExp('^(?:' + headerNames.join('|') + ')\\s*[:：]?\\s*$', 'i');
  const stopRe = new RegExp('^(?:' + stopHeaders.join('|') + ')\\s*[:：]?\\s*$', 'i');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i].trim())) { start = i + 1; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (stopRe.test(lines[i].trim())) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

// --- Chinese CV section helpers (local fallback when the LLM is unavailable) ---
const CN_DATE_TOKEN_RE = /(?:19|20)\d{2}(?:[.\-\/年]\d{1,2}(?!\d)(?:[.\-\/月]\d{1,2}(?!\d))?日?)?|至今|现在|目前|Present|Current/gi;
const CN_COMPANY_RE = /(?:有限公司|股份有限公司|有限责任公司|科技公司|集团|公司|企业|研究院|研究所|事务所|工作室|银行|医院|学校|工厂|中心|科技|网络|信息|技术|数据|传媒|互联)/;
const CN_ROLE_RE = /(?:首席|高级|资深|主管|经理|总监|总裁|总经理|副总|工程师|架构师|设计师|分析师|产品经理|项目经理|开发|研发|运营|销售|市场|会计|财务|人事|行政|实习|专员|助理|顾问|研究员|讲师|教师|医生|律师|技师|负责人|组长|leader|manager|engineer|developer|analyst|designer|director|consultant|intern)/i;
const CN_BULLET_RE = /^(?:[-•*·▪◦‣⁃➤→\uf0b7]|\d{1,2}[.)、]|[(（]\d{1,2}[)）]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/;
const CN_LABEL_ONLY_RE = /^(?:工作职责|职责业绩|岗位职责|工作内容|工作描述|主要职责|工作业绩|项目职责|Responsibilities?)\s*[:：]?$/i;
const CN_DEGREE_RE = /(?:博士研究生|硕士研究生|博士|硕士|本科|学士|大专|专科|学位|MBA|Bachelor|Master|PhD|Diploma)/i;
const CN_SCHOOL_RE = /(?:大学|学院|学校|研究院|校区|Polytechnic|University|College|Institute)/i;

function splitCnParts(value) {
  const result = [];

  // Extract and store dates first
  let startDate = '';
  let endDate = '';
  const dateMatch = String(value || '').match(/(\d{4})[\-～至](\d{4}|至今)/);
  if (dateMatch) {
    startDate = dateMatch[1];
    endDate = dateMatch[2];
  }

  // Remove all date-related content from the string
  let core = value
    .replace(/\d{4}[\-～至]\d{4}|至今/g, '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .trim();

  // Clean up symbols
  core = core.replace(/[｜\-——～,，、\s]+/g, ' ').trim();

  // Split by spaces
  const tokens = core.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    const part = token.trim();
    if (!part || part.length < 2) continue;
    result.push(part);
  }

  return result;
}

function parseChineseExperience(text) {
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur && (cur.title || cur.company || cur.bullets.length)) out.push(cur);
    cur = null;
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || isResumeSectionHeader(line) || CN_LABEL_ONLY_RE.test(line)) continue;
    const dates = line.match(CN_DATE_TOKEN_RE) || [];
    const bullets = CN_BULLET_RE.test(line);

    if (dates.length) {
      const parts = splitCnParts(line);
      let title = '';
      let company = '';
      for (const part of parts) {
        if (!title && CN_ROLE_RE.test(part) && !/(?:有限公司|集团公司|集团|公司)/.test(part)) title = part;
        else if (!company && CN_COMPANY_RE.test(part)) company = part;
      }
      if (title || company) {
        flush();
        cur = { title, company, start: dates[0] || '', end: dates[1] || '', location: '', bullets: [] };
        continue;
      }
    }

    const looksLikeTitle = CN_ROLE_RE.test(line) && line.length <= 30 && !CN_COMPANY_RE.test(line) && !bullets;
    const looksLikeCompany = CN_COMPANY_RE.test(line) && line.length <= 60 && !bullets;
    if (looksLikeTitle) {
      flush();
      cur = { title: line, company: '', start: '', end: '', location: '', bullets: [] };
    } else if (looksLikeCompany && !cur) {
      cur = { title: '', company: line, start: '', end: '', location: '', bullets: [] };
    } else if (looksLikeCompany && cur && !cur.company && !cur.bullets.length) {
      cur.company = line;
    } else if (dates.length && !cur) {
      cur = { title: '', company: '', start: dates[0] || '', end: dates[1] || '', location: '', bullets: [] };
    } else if (dates.length && cur && !cur.start) {
      cur.start = dates[0] || '';
      cur.end = dates[1] || '';
    } else if (bullets) {
      if (!cur) cur = { title: '', company: '', start: '', end: '', location: '', bullets: [] };
      const bullet = line.replace(CN_BULLET_RE, '').trim();
      if (bullet.length > 2) cur.bullets.push(bullet);
    } else if (cur && line.length > 6) {
      if (cur.bullets.length) cur.bullets[cur.bullets.length - 1] += ' ' + line;
      else if (!cur.title && !cur.company) cur.title = line;
      else cur.bullets.push(line);
    }
  }
  flush();
  return out;
}

function parseChineseEducation(text) {
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur && (cur.degree || cur.institution)) out.push(cur);
    cur = null;
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || isResumeSectionHeader(line)) continue;
    if (CN_BULLET_RE.test(line)) {
      if (cur) cur.topics = (cur.topics ? cur.topics + ' ' : '') + line.replace(CN_BULLET_RE, '').trim();
      continue;
    }
    const years = (line.match(CN_DATE_TOKEN_RE) || []).filter(token => /^\d/.test(token));
    const parts = splitCnParts(line);
    let degree = '';
    let institution = '';
    const topics = [];
    for (const part of parts) {
      if (!degree && CN_DEGREE_RE.test(part)) degree = part;
      else if (!institution && CN_SCHOOL_RE.test(part)) institution = part;
      else topics.push(part.replace(/^(?:主修课程|专业|方向|研究领域)\s*[:：]?\s*/, ''));
    }
    if (degree || institution) {
      flush();
      cur = { degree, institution, start: years[0] || '', end: years[1] || '', topics: topics.filter(Boolean).join(' ') };
    } else if (cur) {
      cur.topics = (cur.topics ? cur.topics + ' ' : '') + line;
    }
  }
  flush();
  return out;
}

function parseChineseLanguages(text) {
  const out = [];
  const levelMap = { 母语: 'Native', 精通: 'Fluent', 流利: 'Fluent', 熟练: 'Advanced', 高级: 'Advanced', 良好: 'Intermediate', 中级: 'Intermediate', 初级: 'Basic', 基础: 'Basic' };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.trim().match(/^(中文|普通话|汉语|英语|英文|泰语|日语|韩语|法语|德语|西班牙语|俄语|粤语)\s*[:：]\s*(.+?)\s*$/);
    if (!m) continue;
    out.push({ language: m[1], level: levelMap[m[2]] || m[2].substring(0, 40) });
  }
  return out;
}

function analyzeResumeText(text, languageInfo = null) {
  const cleaned = cleanResumeText(text);
  const lang = languageInfo || detectResumeLanguage(cleaned);
  const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const fullText = cleaned;

  const profile = {
    identity: { name: '', location: '', phone: '', email: '', linkedin: '', github: '', status: '', cvLanguage: lang.label },
    languages: [],
    education: [],
    experience: [],
    skills: { primary: [], secondary: [], domain: [], software: [] },
    publications: [],
    awards: [],
    references: [],
    behavioral: { traits: [], strengths: [], growthAreas: [], thrivesIn: [] },
    careerGoals: { targetRoles: [], targetSectors: [], dealBreakers: [], whatExcites: [], whatDrains: [] },
    writingStyle: { tone: '', structure: '', dos: [], donts: [] },
    cvTemplates: [],
    coverLetterTemplates: [],
    starExamples: [],
    searchConfig: { roleTitles: [], keySkills: [], targetCompanies: [], locations: [], portals: [] }
  };

  // --- Extract Email ---
  const emailMatch = fullText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (emailMatch) profile.identity.email = emailMatch[0];

  // --- Extract Phone ---
  const phoneMatch = fullText.match(/(\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/);
  if (phoneMatch) {
    const phone = phoneMatch[0].trim();
    if (phone.length >= 7) profile.identity.phone = phone;
  }

  // --- Extract LinkedIn ---
  const linkedinMatch = fullText.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|pub)\/([\w\-]+)/i);
  if (linkedinMatch) profile.identity.linkedin = 'https://linkedin.com/in/' + linkedinMatch[1];

  // --- Extract GitHub ---
  const githubMatch = fullText.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([\w\-]+)/i);
  if (githubMatch) profile.identity.github = 'https://github.com/' + githubMatch[1];

  // --- Extract Name (explicit labels first, then first lines) ---
  const explicitName = fullText.match(/(?:^|\n)\s*(?:姓名|名字|候选人|Name)\s*[:：]\s*([^\n|｜]{1,40})/i);
  if (explicitName && !isResumeSectionHeader(explicitName[1])) {
    profile.identity.name = cleanField(explicitName[1]);
  }
  for (let i = 0; i < Math.min(8, lines.length) && !profile.identity.name; i++) {
    let line = lines[i];
    // Skip lines that look like contact info or URLs
    if (line.includes('@') || line.includes('http') || line.includes('www.')) continue;
    if (/^\+?\d/.test(line)) continue;
    if (isResumeSectionHeader(line)) continue;
    if (/\b(diploma|degree|bachelor|master|university|college|institute|certificate)\b/i.test(line)) continue;
    if (/大学|学院|学校|学历|学位|毕业/.test(line)) continue;
    // Explicit Chinese / Thai labels
    line = line.replace(/^(姓名|名字|候选人)\s*[:：]\s*/, '').trim();
    if (lang.code === 'zh' || lang.code === 'ja') {
      const chineseName = line.match(/^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF·]{2,8}$/);
      if (chineseName) { profile.identity.name = chineseName[0]; break; }
    }
    if (lang.code === 'th') {
      const thaiName = line.match(/^[\u0E00-\u0E7F\s]{3,60}$/);
      if (thaiName) { profile.identity.name = thaiName[0].trim(); break; }
    }
    // Name is typically 2-5 words, mostly letters, no digits
    if (line.match(/^[A-Za-z\u00C0-\u017F][A-Za-z\u00C0-\u017F\s.\-'’]{2,60}$/) && line.split(/\s+/).length <= 5) {
      profile.identity.name = line;
      break;
    }
  }

  // --- Extract Location ---
  // Look for common location patterns - use [^\S\n] instead of \s to avoid matching across lines
  const locationPatterns = [
    // "Location: City, Country" or "Based in: City, Country" (strict format with label)
    /(?:Address|Based in|Lives in|Location)\s*[:：]\s*(.+?)\s*(?:\||\n|$)/i,
    // Chinese labels followed by location
    /(?:所在地|现居地|居住地|现居住地|地址|地点|籍贯)\s*[:：]?\s*(.+?)\s*(?:\||\n|$)/i,
    // City, Country on its own line (must have comma for Western format)
    /(?:^|\n)\s*([A-Z][a-z]+(?:[^\S\n][A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:[^\S\n][A-Z][a-z]+)*)\s*(?:\n|$)/,
    // City, Country in a pipe-separated contact line: "London, United Kingdom | email"
    /(?:^|\n|\|\s*)([A-Z][a-z]+(?:[^\S\n][A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:[^\S\n][A-Z][a-z]+)*)\s*\|/,
    // Format like "Thailand-based" or "Bangkok, Thailand-based"
    /([A-Z][a-z]+(?:[^\S\n][A-Z][a-z]+)*)-\s*based\b/i,
    // Direct country name at start of line (common in CV headers)
    /(?:^|\n)\s*([A-Z][a-z]+)\b(?=\s*$|[•\|])/i,
  ];

  // Common countries and regions for validation
  const COMMON_LOCATIONS = new Set([
    'Thailand', 'Bangkok', 'China', 'Shanghai', 'Beijing', 'Guangzhou', 'Shenzhen',
    'USA', 'United States', 'New York', 'California', 'Singapore', 'Malaysia',
    'Hong Kong', 'Japan', 'Tokyo', 'Korea', 'Seoul', 'Australia', 'Sydney',
    'UK', 'United Kingdom', 'London', 'Germany', 'France', 'Canada', 'India',
  ]);

  function isValidLocation(text) {
    if (!text || text.length < 2 || text.length > 100) return false;

    const trimmed = text.trim();

    // Must contain at least one comma (City, Country format) or CJK chars or '-based' suffix
    const hasComma = trimmed.includes(',');
    const hasCjk = CJK_CHAR.test(trimmed);
    const isBasedFormat = /-[ ]*based\b/i.test(trimmed);

    if (!hasComma && !hasCjk && !isBasedFormat) return false;

    // Skip if it ends with sentence punctuation or looks like prose
    if (/[.。！？]$/.test(trimmed)) return false;

    // Skip if it starts with lowercase letter (likely mid-sentence)
    if (/^[a-z]/.test(trimmed)) return false;

    // For non-CJK text without '-based' format: must have proper format
    if (!hasCjk && !isBasedFormat) {
      // Must have comma-separated parts that both look meaningful
      const parts = trimmed.split(',').map(p => p.trim()).filter(p => p.length > 0);
      // Need at least 2 meaningful parts separated by comma
      if (parts.length >= 2) {
        const hasMeaningfulPart = parts.some(p => p.length >= 3 && /^[A-Z][a-z]+/.test(p));
        if (hasMeaningfulPart) return true;
      }
      // Check for common location words or exact match
      const hasLocationWord = /\b(城市|国家|州|省|郡|区|市|县|乡|镇|村|府|都|京|邦)\b/.test(text) ||
                             COMMON_LOCATIONS.has(trimmed.toLowerCase());
      return hasLocationWord;
    }

    // For '-based' format or CJK text
    if (isBasedFormat) {
      // Extract the location part before '-based'
      const match = trimmed.match(/^([^-]+)-\s*based\b/i);
      if (match && match[1]) {
        const loc = match[1].trim();
        return loc.length >= 2 && !/\b(城市|国家|州|省)\b/.test(loc);
      }
    }

    // CJK text just needs basic validity
    return true;
  }

  for (const pattern of locationPatterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      let loc = match[1].trim();
      // Remove trailing parts after pipe or newline
      loc = loc.replace(/\s*\|.*$/, '').replace(/\s*\n.*$/, '').substring(0, 100);
      // Skip section headers
      if (isResumeSectionHeader(loc)) continue;
      // Skip if contains degree/school keywords
      if (/\b(diploma|degree|bachelor|master|university|college|institute|certificate)\b/i.test(loc)) continue;
      // Validate location format
      if (isValidLocation(loc)) {
        profile.identity.location = loc;
        break;
      }
    }
  }
  // Chinese CVs often put the city on its own line without a "所在地：" label.
  if (!profile.identity.location && (lang.code === 'zh' || lang.code === 'ja')) {
    const cityRe = /^(北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|重庆|天津|苏州|长沙|厦门|青岛|大连|沈阳|郑州|济南|合肥|福州|昆明|宁波|无锡|东莞|佛山|珠海|香港|澳门|台北| Tokyo|东京|大阪|曼谷)$/;
    for (let i = 0; i < Math.min(8, lines.length); i++) {
      const hit = lines[i].match(cityRe);
      if (hit) { profile.identity.location = hit[1].trim(); break; }
    }
  }

  // --- Extract Skills ---
  const knownSkills = {
    primary: ['python', 'java', 'javascript', 'typescript', 'c++', 'c#', 'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r', 'matlab', 'perl', 'dart', 'lua', 'elixir', 'clojure', 'f#', 'haskell', 'objc', 'objective-c'],
    secondary: ['react', 'vue', 'angular', 'node', 'node.js', 'express', 'django', 'flask', 'fastapi', 'spring', 'spring boot', '.net', 'asp.net', 'rails', 'laravel', 'symfony', 'next.js', 'nuxt', 'svelte', 'jquery', 'bootstrap', 'tailwind', 'redux', 'graphql', 'apollo', 'grpc', 'websocket', 'socket.io', 'webpack', 'vite', 'babel', 'esbuild'],
    domain: ['fintech', 'healthtech', 'edtech', 'e-commerce', 'ecommerce', 'saas', 'ai', 'ml', 'machine learning', 'deep learning', 'nlp', 'computer vision', 'data science', 'data analysis', 'business intelligence', 'cybersecurity', 'devops', 'cloud computing', 'iot', 'blockchain', 'game development', 'mobile development', 'embedded systems', 'distributed systems', 'microservices', 'real-time systems'],
    software: ['git', 'docker', 'kubernetes', 'k8s', 'jenkins', 'circleci', 'github actions', 'aws', 'azure', 'gcp', 'google cloud', 'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'kafka', 'rabbitmq', 'terraform', 'ansible', 'vault', 'consul', 'nginx', 'apache', 'linux', 'bash', 'powershell', 'jira', 'confluence', 'slack', 'tableau', 'power bi', 'excel', 'hadoop', 'spark', 'airflow', 'dbt', 'snowflake', 'bigquery', 'databricks', 'pytorch', 'tensorflow', 'scikit-learn', 'pandas', 'numpy', 'scipy', 'matplotlib', 'seaborn', 'plotly', 'jupyter', 'vscode', 'intellij', 'eclipse'],
  };

  const textLower = fullText.toLowerCase();
  for (const [category, skills] of Object.entries(knownSkills)) {
    for (const skill of skills) {
      // Match as whole word
      const regex = new RegExp('\\b' + skill.replace(/[.+*?^$()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (regex.test(textLower)) {
        // Capitalize properly
        const capitalized = skill.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        if (!profile.skills[category].includes(capitalized)) {
          profile.skills[category].push(capitalized);
        }
      }
    }
  }

  // Also look for a "Skills" section and extract additional skills
  const skillsSectionText = extractSection(fullText,
    ['SKILLS', 'TECHNICAL SKILLS', 'CORE COMPETENCIES', 'TECHNOLOGIES', 'TECH STACK', '技能', '专业技能', '技术技能', '核心能力', '技能清单'],
    ['EXPERIENCE', 'EDUCATION', 'PROJECTS', 'LANGUAGES', 'PROFESSIONAL EXPERIENCE', 'WORK EXPERIENCE', '工作经历', '工作经验', '教育背景', '教育经历', '项目经历', '项目经验', '语言能力']);
  const skillsSection = skillsSectionText ? { 1: skillsSectionText } : null;
  if (skillsSection && skillsSection[1]) {
    const sectionText = skillsSection[1];
    // Extract skill-like items (Chinese and Western separators)
    const items = sectionText.split(/[,，、;；\n•|｜]/).map(s => s.trim())
      .map(s => s.replace(/^(?:技能|专业技能|技术技能|核心能力|技能清单|Skills?)\s*[:：]\s*/i, '').trim())
      .filter(s => s.length > 1 && s.length < 40 && !isResumeSectionHeader(s) && !/[\u4e00-\u9fff]{12,}/.test(s));
    for (const item of items) {
      // Check if it's already captured
      const allExisting = [...profile.skills.primary, ...profile.skills.secondary, ...profile.skills.domain, ...profile.skills.software].map(s => s.toLowerCase());
      if (!allExisting.includes(item.toLowerCase())) {
        // Prefer an exact known-skill match so a whole "A、B、C" line is not one skill.
        const itemLower = item.toLowerCase();
        const normalizeSkill = s => s.toLowerCase().replace(/[.\s+#]/g, '');
        const normalizedItem = normalizeSkill(itemLower);
        const exact = category => knownSkills[category].some(s => normalizeSkill(s) === normalizedItem);
        if (exact('primary')) {
          profile.skills.primary.push(item);
        } else if (exact('secondary')) {
          profile.skills.secondary.push(item);
        } else if (exact('domain')) {
          profile.skills.domain.push(item);
        } else if (exact('software')) {
          profile.skills.software.push(item);
        } else {
          profile.skills.secondary.push(item);
        }
      }
    }
  }

  // --- Extract Experience ---
  // Find the experience section (stop at next major section)
  const expSectionText = extractSection(fullText,
    ['PROFESSIONAL EXPERIENCE', 'WORK EXPERIENCE', 'EMPLOYMENT HISTORY', 'WORK HISTORY', 'CAREER HISTORY', 'EXPERIENCE', '工作经历', '工作经验', '工作履历', '职业经历', '从业经历'],
    ['EDUCATION', 'ACADEMIC BACKGROUND', 'QUALIFICATIONS', 'SKILLS', 'TECHNICAL SKILLS', 'CORE COMPETENCIES', 'PROJECTS', 'CERTIFICATIONS', 'AWARDS', 'PUBLICATIONS', 'LANGUAGES', 'REFERENCES', 'INTERESTS', 'ADDITIONAL INFORMATION', '教育背景', '教育经历', '学历', '技能', '专业技能', '项目经历', '项目经验', '证书', '奖项', '荣誉', '语言能力', '自我评价', '求职意向']);
  const expSectionMatch = expSectionText ? { 1: expSectionText } : null;
  let expText = expSectionMatch ? expSectionMatch[1] : fullText;

  let experiences = [];
  let currentExp = null;
  const expLines = expText.split(/\n/).map(l => l.trim()).filter(Boolean);
  const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December';
  const dateAnywhere = new RegExp(`((?:${MONTHS})\\s+\\d{4})|(\\b20\\d{2}\\b)|(\\b19\\d{2}\\b)|(Present|Current|Now)`, 'gi');

  // Bullet markers: -, •, *, ·, or arrow characters
  const isBullet = (line) => /^[-•*·▪◦‣⁃➤→\uf0b7]\s+/.test(line);
  // A job-title line: "Title | Company", "Title at Company", "Title, Company",
  // or a short TitleCase line containing a role keyword with no bullet marker
  const ROLE_WORDS = /(manager|engineer|developer|analyst|director|lead|supervisor|coordinator|specialist|executive|officer|programmer|consultant|assistant|associate|administrator|designer|architect|technician|sales|marketing|accountant|controller|recruiter|clerk|intern|trainee|head|chief|president|partner|analyst|代表|经理|工程师|主管|专员|总监|开发|设计)/i;

  function isJobTitleLine(line) {
    if (isBullet(line) || line.length > 120) return false;
    // Strong signal: contains a pipe separator with role words
    if (/[|｜]/.test(line) && ROLE_WORDS.test(line)) return true;
    // "Title at Company"
    if (/\s+at\s+/i.test(line) && ROLE_WORDS.test(line) && line.length < 90) return true;
    // Title + date on same line
    if (dateAnywhere.test(line) && ROLE_WORDS.test(line) && line.length < 100) { dateAnywhere.lastIndex = 0; return true; }
    return false;
  }

  function splitTitleCompany(line) {
    // Remove trailing date portion
    let clean = line.replace(new RegExp(`\\s*[|｜,\\-–—]\\s*((?:${MONTHS})\\s+\\d{4}.*|20\\d{2}.*|Present.*)$`, 'i'), '').trim();
    const parts = clean.split(/\s*[|｜]\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { title: parts[0], company: parts.slice(1, 3).join(' | ') };
    }
    // "Title at Company"
    const atMatch = clean.match(/^(.{3,70}?)\s+at\s+(.{2,60})$/i);
    if (atMatch) return { title: atMatch[1], company: atMatch[2] };
    // "Title, Company"
    const commaMatch = clean.match(/^(.{3,70}?),\s*(.{2,60})$/);
    if (commaMatch && ROLE_WORDS.test(commaMatch[1])) return { title: commaMatch[1], company: commaMatch[2] };
    return { title: clean, company: '' };
  }

  function extractDates(line) {
    const matches = line.match(dateAnywhere) || [];
    dateAnywhere.lastIndex = 0;
    return matches.map(d => d.trim()).filter(Boolean);
  }

  for (let i = 0; i < expLines.length; i++) {
    const line = expLines[i];
    if (!line) continue;

    if (isJobTitleLine(line)) {
      // Start a new experience entry
      if (currentExp) experiences.push(currentExp);
      const { title, company } = splitTitleCompany(line);
      const dates = extractDates(line);
      currentExp = { title, company, start: dates[0] || '', end: dates[1] || '', location: '', bullets: [] };
      // Check next line for a date range / location
      if (i + 1 < expLines.length) {
        const next = expLines[i + 1];
        if (!isJobTitleLine(next) && !isBullet(next)) {
          const d = extractDates(next);
          if (d.length) {
            if (!currentExp.start) currentExp.start = d[0];
            if (d[1]) currentExp.end = d[1];
            // Remaining text after dates = location
            const loc = next.replace(dateAnywhere, '').replace(/[|｜,\-–—]\s*/g, '').trim();
            if (loc) currentExp.location = loc.substring(0, 80);
          } else if (!/[.!?]$/.test(next) && next.length < 80 && /\b(Bangkok|London|Remote|Malaysia|Thailand|Singapore|China|US|UK|Germany|Shanghai|Beijing|Hong Kong)\b/i.test(next)) {
            currentExp.location = next;
          }
        }
      }
      continue;
    }

    if (!currentExp) continue;

    // Skip known section headers and summary text that slipped in
    if (/^(CORE COMPETENCIES|PROFESSIONAL EXPERIENCE|PROFESSIONAL SUMMARY|SUMMARY|EDUCATION|SKILLS|LANGUAGES|REFERENCES|INTERESTS|AWARDS|CERTIFICATIONS|ADDITIONAL)/i.test(line)) continue;

    // Date-only line
    if (line.length < 60 && extractDates(line).length && !isBullet(line)) {
      const d = extractDates(line);
      if (!currentExp.start) currentExp.start = d[0];
      if (d[1]) currentExp.end = d[1];
      continue;
    }

    // Bullet point
    const bullet = isBullet(line) ? line.replace(/^[-•*·▪◦‣⁃➤→\uf0b7]\s+/, '').trim() : null;
    if (bullet && bullet.length > 3) {
      currentExp.bullets.push(bullet);
    }
    // Long non-bullet prose after bullets: treat as continuation of last bullet if it doesn't look like a title
    else if (!isBullet(line) && currentExp.bullets.length && line.length > 15 && !ROLE_WORDS.test(line.split(' ').slice(0, 4).join(' '))) {
      // continuation of previous bullet (wrapped line)
      currentExp.bullets[currentExp.bullets.length - 1] += ' ' + line;
    }
  }
  if (currentExp && (currentExp.title || currentExp.bullets.length)) experiences.push(currentExp);

  // Chinese CVs use layouts the generic parser cannot see (date-first job headers,
  // title/company on separate lines, 1./（1） bullets). Prefer the dedicated parser.
  if (lang.code === 'zh' || lang.code === 'ja') {
    const cnExperiences = parseChineseExperience(expText);
    if (cnExperiences.length) experiences = cnExperiences;
  }

  // Clean up: deduplicate bullets, drop empty entries, merge wrapped lines
  const cleanedExperiences = experiences.map(e => ({
    ...e,
    bullets: [...new Set(e.bullets)]
      .map(b => b.replace(/\s+/g, ' ').trim())
      .filter(b => b.length > 3)
      .slice(0, 20),
  })).filter(e => e.title && (e.company || e.bullets.length));
  profile.experience = cleanedExperiences.slice(0, 20); // Limit to 20 entries

  // --- Extract Education ---
  const eduSectionText = extractSection(fullText,
    ['EDUCATION', 'ACADEMIC BACKGROUND', 'QUALIFICATIONS', 'ACADEMIC QUALIFICATIONS', '教育背景', '教育经历', '学历', '学习经历'],
    ['EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'WORK EXPERIENCE', 'SKILLS', 'PROJECTS', 'CERTIFICATIONS', 'AWARDS', 'PUBLICATIONS', 'LANGUAGES', 'REFERENCES', 'INTERESTS', '工作经历', '工作经验', '技能', '专业技能', '项目经历', '项目经验', '证书', '语言能力', '自我评价']);
  const eduSectionMatch = eduSectionText ? { 1: eduSectionText } : null;
  if (eduSectionMatch && eduSectionMatch[1]) {
    const eduLines = eduSectionMatch[1].split(/\n/).map(l => l.trim()).filter(Boolean);
    let currentEdu = null;
    for (const line of eduLines) {
      // Skip bullet points
      if (line.match(/^[•·\-*\u2022\u00B7]/)) {
        if (currentEdu && line.length > 5) {
          const topic = line.replace(/^[•·\-*\u2022\u00B7]\s*/, '').trim();
          currentEdu.topics = (currentEdu.topics ? currentEdu.topics + ' ' : '') + topic;
        }
        continue;
      }
      // Look for degree keywords
      const degreeMatch = line.match(/(Bachelor|Master|PhD|Doctorate|BSc|MSc|BA|MA|MBA|BEng|MEng|B Tech|M Tech|Associate|Diploma|Certificate|B\.S\.|M\.S\.|B\.A\.|M\.A\.|Doctor|博士|硕士|本科|学士|大专|专科|学位)/i);
      const yearMatch = line.match(/(19\d{2}|20\d{2})/g);

      if (degreeMatch) {
        if (currentEdu) profile.education.push(currentEdu);
        // Try to separate degree from institution (split by comma or pipe)
        const parts = line.split(/[,|｜]/).map(s => s.trim()).filter(Boolean);
        let degree = '';
        let institution = '';
        let start = '';
        let end = '';
        // Find the part containing a degree keyword; use it as the degree.
        let degreeIndex = -1;
        for (let pi = 0; pi < parts.length; pi++) {
          if (degreeMatch && degreeMatch[0] && parts[pi].includes(degreeMatch[0])) { degree = parts[pi]; degreeIndex = pi; break; }
        }
        if (!degree) { degree = parts[0] || line; degreeIndex = 0; }
        // Prefer an explicit university/college/school part as the institution.
        for (let pi = 0; pi < parts.length; pi++) {
          if (pi === degreeIndex) continue;
          if (/University|College|Institute|School|Academy|Polytechnic|大学|学院|学校/i.test(parts[pi])) {
            institution = parts[pi];
            break;
          }
        }
        if (!institution && parts.length > 1) institution = parts.find((_, i) => i !== degreeIndex) || '';
        if (yearMatch) {
          start = yearMatch[0];
          end = yearMatch.length > 1 ? yearMatch[yearMatch.length - 1] : yearMatch[0];
        }
        currentEdu = {
          degree: degree.substring(0, 120),
          institution: institution.substring(0, 100),
          start,
          end,
          topics: '',
        };
      } else if (currentEdu && !line.match(/^(SKILLS|EXPERIENCE|PROJECTS|CERTIFICATIONS|AWARDS|PUBLICATIONS|LANGUAGES|REFERENCES)/i)) {
        // Could be institution name or topics
        if (!currentEdu.institution && (line.match(/[A-Z]|[\u4e00-\u9fff]/)) && line.match(/University|College|Institute|School|Academy|Polytechnic|大学|学院|学校/i) && line.length < 100) {
          currentEdu.institution = line.substring(0, 100);
        } else if (line.length > 5) {
          currentEdu.topics = (currentEdu.topics ? currentEdu.topics + ' ' : '') + line;
        }
      }
    }
    if (currentEdu) profile.education.push(currentEdu);
  }
  if (lang.code === 'zh' || lang.code === 'ja') {
    const cnEducation = parseChineseEducation(eduSectionMatch?.[1] || fullText);
    if (cnEducation.length) profile.education = cnEducation;
  }

  // --- Extract Languages ---
  const langSectionText = extractSection(fullText,
    ['LANGUAGES', 'LANGUAGE PROFICIENCY', 'LANGUAGE SKILLS', '语言能力', '语言', '语种'],
    ['EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'EDUCATION', 'SKILLS', 'PROJECTS', 'CERTIFICATIONS', 'AWARDS', 'PUBLICATIONS', 'REFERENCES', 'INTERESTS', '工作经历', '教育背景', '专业技能']);
  const langSectionMatch = langSectionText ? { 1: langSectionText } : null;
  if (langSectionMatch && langSectionMatch[1]) {
    const langText = langSectionMatch[1];
    // Use multi-word language names first to avoid partial matches
    const knownLangs = ['Mandarin Chinese', 'English', 'Mandarin', 'Chinese', 'Cantonese', 'Spanish', 'French', 'German', 'Dutch', 'Danish', 'Swedish', 'Norwegian', 'Finnish', 'Italian', 'Portuguese', 'Russian', 'Japanese', 'Korean', 'Arabic', 'Hindi', 'Turkish', 'Polish', 'Czech', 'Greek', 'Hebrew', 'Thai', 'Vietnamese', 'Indonesian', '中文', '普通话', '汉语', '英语', '英文', '泰语', '日语', '韩语'];
    const foundLangs = new Set();
    for (const lang of knownLangs) {
      // Skip if already matched as part of a multi-word language
      const isSubWord = foundLangs.has('Mandarin Chinese') && (lang === 'Mandarin' || lang === 'Chinese');
      if (isSubWord) continue;
      const escapedLang = lang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const boundary = CJK_CHAR.test(lang) ? '' : '\\b';
      const regex = new RegExp(boundary + escapedLang + boundary, 'i');
      if (regex.test(langText)) {
        // Try to find level - check for "Language (Level)" or "Language: Level" or "Language - Level"
        const escapedLang = lang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const levelMatch = langText.match(new RegExp(escapedLang + '\\s*[:：\\-\\(]\\s*(Native|Fluent|Proficient|Advanced|Intermediate|Basic|Beginner|C1|C2|B1|B2|A1|A2|Professional|Conversational|Business|母语|流利|熟练|良好|基础|初级|中级|高级|精通)', 'i'));
        const levelMap = { 母语: 'Native', 精通: 'Fluent', 流利: 'Fluent', 熟练: 'Advanced', 高级: 'Advanced', 良好: 'Intermediate', 中级: 'Intermediate', 初级: 'Basic', 基础: 'Basic' };
        foundLangs.add(lang);
        profile.languages.push({
          language: lang,
          level: levelMatch ? (levelMap[levelMatch[1]] || levelMatch[1]) : 'Professional',
        });
      }
    }
    // Chinese resumes commonly write "中文：母语" style entries.
    for (const match of langText.matchAll(/(中文|普通话|汉语|英语|英文|泰语|日语|韩语)\s*[:：]\s*(母语|流利|熟练|良好|基础|初级|中级|高级|精通)/g)) {
      if (profile.languages.some(l => l.language === match[1])) continue;
      const levelMap = { 母语: 'Native', 精通: 'Fluent', 流利: 'Fluent', 熟练: 'Advanced', 高级: 'Advanced', 良好: 'Intermediate', 中级: 'Intermediate', 初级: 'Basic', 基础: 'Basic' };
      profile.languages.push({ language: match[1], level: levelMap[match[2]] || match[2] });
    }
    if (lang.code === 'zh' || lang.code === 'ja') {
      const cnLanguages = parseChineseLanguages(langSectionMatch?.[1] || '');
      if (cnLanguages.length) profile.languages = cnLanguages;
    }
  }
  // If no languages found, default to English
  if (profile.languages.length === 0) {
    profile.languages.push({ language: 'English', level: 'Professional' });
  }

  // --- Extract Career Goals (infer from experience and skills) ---
  // Use most recent job title as target role
  if (profile.experience.length > 0) {
    const recentTitle = profile.experience[0].title;
    if (recentTitle) {
      const roles = [recentTitle];
      // Add a "Senior" variant only if the title doesn't already start with "Senior"
      if (!recentTitle.match(/^senior/i)) {
        roles.push('Senior ' + recentTitle);
      }
      // Also add "Lead" variant
      if (!recentTitle.match(/^lead/i)) {
        roles.push('Lead ' + recentTitle);
      }
      profile.careerGoals.targetRoles = roles;
    }
  }
  // Infer target sectors from domain skills
  if (profile.skills.domain.length > 0) {
    profile.careerGoals.targetSectors = profile.skills.domain.slice(0, 5);
  }

  // --- Extract Behavioral Traits (infer from resume language) ---
  const traitKeywords = {
    'Leadership': ['led', 'managed', 'directed', 'supervised', 'mentored', 'coached', 'head of', 'team lead', 'leadership'],
    'Collaborative': ['collaborated', 'team', 'cross-functional', 'partnered', 'worked with', 'collaboration'],
    'Independent': ['independently', 'self-directed', 'autonomous', 'self-motivated', 'initiative'],
    'Detail-oriented': ['detail', 'precise', 'meticulous', 'thorough', 'careful'],
    'Innovative': ['innovated', 'designed', 'created', 'pioneered', 'invented', 'innovation', 'novel'],
    'Problem-solver': ['solved', 'resolved', 'troubleshoot', 'optimized', 'improved', 'problem'],
    'Results-driven': ['achieved', 'delivered', 'increased', 'reduced', 'improved', 'results', 'impact'],
    'Fast learner': ['learned', 'adapted', 'quickly', 'fast-paced', 'agile'],
  };
  for (const [trait, keywords] of Object.entries(traitKeywords)) {
    for (const kw of keywords) {
      if (textLower.includes(kw)) {
        if (!profile.behavioral.traits.includes(trait)) {
          profile.behavioral.traits.push(trait);
        }
        break;
      }
    }
  }
  // Infer strengths from skills
  if (profile.skills.primary.length > 0) {
    profile.behavioral.strengths = [...profile.skills.primary.slice(0, 3)];
  }

  return profile;
}

// ============ SERVER ============

const server = http.createServer((req, res) => {
  // CORS
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  // Auth pages are served from the project root but called from the app origin.
  // Reflect the origin + allow credentials for auth routes so the session cookie is stored.
  const needsCredentials = pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/register') && !pathname.startsWith('/api/auth/login') && pathname !== '/api/forgot' && !pathname.startsWith('/api/reset-password');
  if (needsCredentials && req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Public health check for Node hosts and container orchestrators.
  if (pathname === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({
      ok: true,
      database: store.ping() ? 'ok' : 'error',
      uptimeSeconds: Math.floor(process.uptime()),
      time: new Date().toISOString(),
    }));
    return;
  }

  // API routes
  if (pathname.startsWith('/api/')) {
    const contentType = req.headers['content-type'] || '';
    const isMultipart = contentType.includes('multipart/form-data');
    let body = '';
    let rawBody = null;
    let chunks = [];
    req.on('data', chunk => {
      if (isMultipart) {
        chunks.push(chunk);
      } else {
        body += chunk;
      }
    });
    req.on('end', () => {
      let parsedBody = {};
      if (isMultipart) {
        rawBody = Buffer.concat(chunks);
      } else if (body) {
        try { parsedBody = JSON.parse(body); } catch (e) {}
      }

      // Try exact match
      const method = req.method;
      let routeKey = `${method} ${pathname}`;

      // Try parameterized routes
      let handler = api[routeKey];
      let params = {};

      if (!handler) {
        // Check parameterized routes
        for (const key of Object.keys(api)) {
          const [m, pattern] = key.split(' ');
          if (m !== method) continue;
          const patternParts = pattern.split('/');
          const pathParts = pathname.split('/');
          if (patternParts.length !== pathParts.length) continue;
          let match = true;
          params = {};
          for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(':')) {
              params[patternParts[i].slice(1)] = pathParts[i];
            } else if (patternParts[i] !== pathParts[i]) {
              match = false;
              break;
            }
          }
          if (match) {
            handler = api[key];
            routeKey = key;
            break;
          }
        }
      }

      const decision = auth.authorize(req, routeKey);
      if (!decision.ok) {
        if (decision.code === 'PLAN_REQUIRED') res.setHeader('X-Required-Plan', String(decision.plan || ''));
        return sendJSON(res, decision.status, {
          error: decision.error,
          code: decision.code,
          feature: decision.feature,
          requiredPlan: decision.requiredPlan,
        });
      }

      if (handler) {
        try {
          const result = auth.runWithUser(req.user ? req.user.id : ownerId, () =>
            handler(req, res, parsedBody, params, query, rawBody)
          );
          if (result && typeof result.catch === 'function') {
            result.catch(e => {
              console.error('API handler error:', e);
              if (!res.headersSent) sendJSON(res, 500, { error: e.message });
            });
          }
        } catch (e) {
          sendJSON(res, 500, { error: e.message });
        }
      } else {
        sendJSON(res, 404, { error: 'API endpoint not found', path: pathname });
      }
    });
    return;
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b1029"/><path d="M18 22h28v6H18zm0 12h20v6H18zm0 12h14v6H18z" fill="#35e6ff"/></svg>');
  }

  // The user registry must never be public. Owners use /api/admin/users.xlsx.
  if (pathname === '/data/Registered_Users.xlsx') {
    return sendJSON(res, 404, { error: 'Not found' });
  }

  if (pathname === '/login_page_ref.jpg') {
    return sendFile(res, path.join(ROOT, 'login_page_ref.jpg'), 'image/jpeg');
  }

  // Standalone auth/admin pages live in the project root.
  const ROOT_PAGES = {
    '/login': 'login.html', '/login.html': 'login.html',
    '/register': 'register.html', '/register.html': 'register.html',
    '/reset-password': 'reset-password.html', '/reset-password.html': 'reset-password.html',
    '/admin': 'admin.html', '/admin.html': 'admin.html',
  };
  if (ROOT_PAGES[pathname]) {
    return sendFile(res, path.join(ROOT, ROOT_PAGES[pathname]), 'text/html; charset=utf-8');
  }

  // Static files
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.join(ROOT, 'public', filePath);

  // Prevent directory traversal
  if (!fullPath.startsWith(path.join(ROOT, 'public'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT' && !ext) {
        // SPA fallback
        sendFile(res, path.join(ROOT, 'public', 'index.html'), 'text/html; charset=utf-8');
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

// --- LLM Configuration ---
api['GET /api/llm-config'] = (req, res) => {
  const config = readLLMConfig();
  sendJSON(res, 200, {
    ...config,
    configured: llmConfigured(),
    storagePath: path.relative(ROOT, DATA_FILES.llmConfig).replace(/\\/g, '/'),
  });
};

api['POST /api/llm-config'] = (req, res, body) => {
  const existing = readLLMConfig();
  let next;

  if (Array.isArray(body.models)) {
    next = normalizeLLMConfig({
      ...existing,
      models: body.models,
      activeModelId: body.activeModelId || existing.activeModelId,
    });
  } else if (body.provider && body.apiKey && body.model) {
    // Backward-compatible single-model save.
    const models = existing.models.slice();
    const id = body.id || 'default';
    const entry = {
      id,
      label: body.label || `${body.provider} / ${body.model}`,
      provider: String(body.provider).trim(),
      apiKey: String(body.apiKey).trim(),
      model: String(body.model).trim(),
      baseUrl: body.baseUrl ? String(body.baseUrl).trim() : '',
      enabled: true,
    };
    const index = models.findIndex(m => m.id === id);
    if (index >= 0) models[index] = { ...models[index], ...entry };
    else models.push(entry);
    next = normalizeLLMConfig({
      ...existing,
      models,
      activeModelId: body.activeModelId || id,
    });
  } else {
    sendJSON(res, 400, { error: 'Provider, API key, and model are required' });
    return;
  }

  next.updatedAt = new Date().toISOString();
  writeLLMConfig(next);
  sendJSON(res, 200, { ok: true, ...next });
};

api['POST /api/llm-test'] = async (req, res, body) => {
  const config = readLLMConfig();
  const override = {};
  ['provider', 'apiKey', 'model', 'baseUrl', 'label'].forEach(key => {
    if (body && body[key]) override[key] = String(body[key]).trim();
  });

  let targets;
  if (override.provider && override.apiKey && override.model) {
    targets = [{ id: '', label: 'Unsaved model', ...override }];
  } else if (body && body.modelId && body.modelId !== 'auto') {
    targets = config.models.filter(m => m.id === body.modelId && m.enabled !== false);
  } else if (config.activeModelId !== 'auto') {
    targets = config.models.filter(m => m.id === config.activeModelId && m.enabled !== false);
  } else {
    targets = config.models.filter(m => m.enabled !== false);
  }

  if (!targets.length) {
    sendJSON(res, 400, { ok: false, error: 'No enabled LLM model to test' });
    return;
  }

  const testedAt = new Date().toISOString();
  const results = [];
  for (const target of targets) {
    try {
      const reply = await callSingleLLM(target, 'Reply with the single word OK.', 'You are a connectivity test. Reply only OK.', {
        maxTokens: 16,
        timeout: 20000,
        autoMode: true,
      });
      if (!String(reply || '').trim()) throw new Error('Provider returned an empty response');
      if (target.id) updateModelStatus(target.id, true);
      results.push({ id: target.id, label: target.label, model: target.model, ok: true, reply: String(reply || '').trim().slice(0, 80) });
    } catch (e) {
      if (target.id) updateModelStatus(target.id, false, e.message);
      results.push({ id: target.id, label: target.label, model: target.model, ok: false, error: e.message });
    }
  }

  sendJSON(res, 200, {
    ok: results.some(r => r.ok),
    mode: config.activeModelId,
    results,
    testedAt,
  });
};

api['DELETE /api/llm-config'] = (req, res) => {
  const empty = normalizeLLMConfig({ models: [], activeModelId: 'auto' });
  writeLLMConfig(empty);
  sendJSON(res, 200, { ok: true });
};

const origWriteHead = http.ServerResponse.prototype.writeHead;
// --- Authentication and entitlements ---
api['POST /api/auth/register'] = (req, res, body) => {
  const result = auth.registerUser(body);
  if (result.error) return sendJSON(res, 400, { error: result.error });
  initializeUserDataFiles(result.user.id);
  res.setHeader('Set-Cookie', auth.sessionCookie(result.token));
  sendJSON(res, 200, { ok: true, user: result.user, entitlements: auth.entitlementsFor(result.user) });
};

api['POST /api/auth/login'] = (req, res, body) => {
  const result = auth.loginUser(body);
  if (result.error) return sendJSON(res, 401, { error: result.error });
  initializeUserDataFiles(result.user.id);
  res.setHeader('Set-Cookie', auth.sessionCookie(result.token));
  sendJSON(res, 200, { ok: true, user: result.user, entitlements: auth.entitlementsFor(result.user) });
};

api['POST /api/auth/logout'] = (req, res) => {
  auth.logoutUser(req);
  res.setHeader('Set-Cookie', auth.clearSessionCookie());
  sendJSON(res, 200, { ok: true });
};

// --- Owner user administration (keeps users.json and the Excel registry in step) ---
function requireOwner(req, res) {
  if (!req.user || req.user.plan !== 'owner') {
    sendJSON(res, 403, { error: 'Owner access required' });
    return false;
  }
  return true;
}
function adminUserView(user) {
  return {
    id: user.id,
    name: user.name || '',
    email: user.email,
    level: user.plan || 'free',
    status: user.status || 'Active',
    registeredAt: user.createdAt || '',
  };
}
function generateUsersWorkbook() {
  const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const payloadFile = path.join(os.tmpdir(), `users_payload_${stamp}.json`);
  const outFile = path.join(os.tmpdir(), `users_${stamp}.xlsx`);
  try {
    const users = Object.values(auth.readUsers()).map(adminUserView);
    fs.writeFileSync(payloadFile, JSON.stringify({ users, plans: auth.PLANS }, null, 2), 'utf8');
    execFileSync('python', [path.join(ROOT, 'scripts', 'export_users_db.py'), payloadFile, outFile], {
      cwd: ROOT, stdio: 'pipe', timeout: 30000,
    });
    return fs.readFileSync(outFile);
  } finally {
    try { fs.unlinkSync(payloadFile); } catch (e) {}
    try { fs.unlinkSync(outFile); } catch (e) {}
  }
}

function refreshUserExcel() {
  // SQLite is the source of truth now; the workbook is generated on download.
}
const VALID_LEVELS = new Set(['free', 'pro', 'team', 'owner']);

api['GET /api/admin/users'] = (req, res) => {
  if (!requireOwner(req, res)) return;
  const users = Object.values(auth.readUsers()).map(adminUserView);
  sendJSON(res, 200, { ok: true, users });
};

api['GET /api/admin/users.xlsx'] = (req, res) => {
  if (!requireOwner(req, res)) return;
  try {
    const content = generateUsersWorkbook();
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="Registered_Users.xlsx"',
      'Content-Length': content.length,
      'Cache-Control': 'no-store',
    });
    res.end(content);
  } catch (e) {
    sendJSON(res, 500, { error: 'Could not generate user export: ' + e.message });
  }
};

api['POST /api/admin/users'] = (req, res, body) => {
  if (!requireOwner(req, res)) return;
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const level = String(body?.level || body?.plan || 'pro').toLowerCase();
  const status = String(body?.status || 'Active');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJSON(res, 400, { error: 'A valid email is required' });
  if (password.length < 8) return sendJSON(res, 400, { error: 'Password must be at least 8 characters' });
  if (!VALID_LEVELS.has(level)) return sendJSON(res, 400, { error: 'Invalid user level' });
  if (!['Active', 'Disabled'].includes(status)) return sendJSON(res, 400, { error: 'Invalid status' });
  const users = auth.readUsers();
  if (Object.values(users).some(u => String(u.email).toLowerCase() === email)) {
    return sendJSON(res, 400, { error: 'An account with this email already exists' });
  }
  const id = 'user_' + require('crypto').randomBytes(6).toString('hex');
  users[id] = {
    id, email, name: String(body?.name || '').trim() || email.split('@')[0],
    plan: level, status, passwordHash: auth.hashPassword(password), createdAt: new Date().toISOString(),
  };
  auth.writeUsers(users);
  auth.initializeUserData(id);
  refreshUserExcel();
  sendJSON(res, 200, { ok: true, user: adminUserView(users[id]) });
};

api['PUT /api/admin/users/:id'] = (req, res, body, params) => {
  if (!requireOwner(req, res)) return;
  const users = auth.readUsers();
  const id = String(params.id || '');
  const user = users[id];
  if (!user) return sendJSON(res, 404, { error: 'User not found' });
  if (body?.name !== undefined) user.name = String(body.name).trim() || user.name;
  if (body?.status !== undefined) {
    if (!['Active', 'Disabled'].includes(String(body.status))) return sendJSON(res, 400, { error: 'Invalid status' });
    user.status = String(body.status);
  }
  if (body?.level !== undefined || body?.plan !== undefined) {
    const level = String(body.level || body.plan).toLowerCase();
    if (!VALID_LEVELS.has(level)) return sendJSON(res, 400, { error: 'Invalid user level' });
    if (user.plan === 'owner' && level !== 'owner' &&
        Object.values(users).filter(u => u.plan === 'owner').length <= 1) {
      return sendJSON(res, 400, { error: 'Cannot demote the last owner account' });
    }
    user.plan = level;
  }
  if (body?.password) {
    const password = String(body.password);
    if (password.length < 8) return sendJSON(res, 400, { error: 'Password must be at least 8 characters' });
    user.passwordHash = auth.hashPassword(password);
  }
  auth.writeUsers(users);
  refreshUserExcel();
  sendJSON(res, 200, { ok: true, user: adminUserView(user) });
};

api['DELETE /api/admin/users/:id'] = (req, res, body, params) => {
  if (!requireOwner(req, res)) return;
  const users = auth.readUsers();
  const id = String(params.id || '');
  const user = users[id];
  if (!user) return sendJSON(res, 404, { error: 'User not found' });
  if (user.plan === 'owner' && Object.values(users).filter(u => u.plan === 'owner').length <= 1) {
    return sendJSON(res, 400, { error: 'Cannot delete the last owner account' });
  }
  delete users[id];
  auth.writeUsers(users);
  store.deleteUserData(id);
  refreshUserExcel();
  sendJSON(res, 200, { ok: true });
};

api['POST /api/forgot'] = async (req, res, body) => {
  const email = String(body?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return sendJSON(res, 400, { ok: false, error: 'Please enter a valid email address.' });
  }

  const result = auth.createPasswordReset(email);
  if (!result.found) {
    return sendJSON(res, 404, {
      ok: false,
      code: 'EMAIL_NOT_REGISTERED',
      error: 'No account was found for that email address. Please check the spelling or create a new account.',
    });
  }

  const config = mailConfig();
  const baseUrl = String(config.baseUrl || `http://localhost:${PORT}`).replace(/\/+$/, '');
  const resetUrl = `${baseUrl}/reset-password?token=${result.token}`;
  const delivery = await sendResetEmail({
    to: email,
    name: result.user?.name || '',
    resetUrl,
  });

  if (!delivery.delivered) {
    return sendJSON(res, 500, {
      ok: false,
      code: 'EMAIL_DELIVERY_FAILED',
      error: 'The account exists, but the reset email could not be sent. Please try again later.',
      detail: delivery.error,
    });
  }

  sendJSON(res, 200, {
    ok: true,
    message: 'A password reset link has been sent to your email address. Please check your inbox and spam folder.',
    expiresInMinutes: 30,
    ...(process.env.NODE_ENV === 'production' ? {} : { devResetUrl: delivery.transport === 'outbox' ? resetUrl : undefined }),
    transport: delivery.transport,
    outboxFile: delivery.file,
  });
};

api['POST /api/reset-password/validate'] = (req, res, body) => {
  const result = auth.validatePasswordReset(body?.token);
  if (!result.ok) return sendJSON(res, 400, { ok: false, error: result.error });
  sendJSON(res, 200, { ok: true, email: result.email, name: result.name });
};

api['POST /api/reset-password'] = (req, res, body) => {
  const result = auth.resetPasswordWithToken(body?.token, body?.password);
  if (!result.ok) return sendJSON(res, 400, { ok: false, error: result.error });
  sendJSON(res, 200, { ok: true, message: 'Your password has been reset. You can now sign in with your new password.' });
};

api['GET /api/auth/me'] = (req, res) => {
  const user = auth.getSessionUser(req);
  if (!user) return sendJSON(res, 200, { user: null, entitlements: null });
  const profile = auth.publicUser(user);
  sendJSON(res, 200, { user: profile, entitlements: auth.entitlementsFor(profile) });
};

http.ServerResponse.prototype.writeHead = function(statusCode, ...args) {
  this.setHeader('X-Content-Type-Options', 'nosniff');
  this.setHeader('X-Frame-Options', 'DENY');
  this.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  // CORS is set per-route later; these are safe defaults for all responses
  return origWriteHead.call(this, statusCode, ...args);
};

server.listen(PORT, () => {
  console.log(`\n  AI Job Search Web Application`);
  console.log(`  ==============================`);
  console.log(`  Environment : ${NODE_ENV}`);
  console.log(`  Port        : ${PORT}`);
  console.log(`  Data dir    : ${DATA_DIR}`);
  console.log(`  Repo dir    : ${REPO_DIR}`);
  if (NODE_ENV === 'production') {
    console.log(`  Note        : Run behind a reverse proxy (nginx/caddy) in production.`);
  }
  console.log(`\n  Press Ctrl+C to stop.\n`);
});
