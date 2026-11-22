/**
 * CV Tailoring Engine
 * Reads a job posting and reworks the candidate's real profile so the CV is
 * relevant to that specific role — like an experienced HR manager would.
 *
 * Rules we follow (important for trust):
 *  - Never invent experience, employers, dates or skills the candidate does not have.
 *  - Only reorder, emphasize and rephrase information that is already in the profile.
 *  - Missing requirements are reported, not silently added to the CV.
 */

const STOPWORDS = new Set(`
a an and are as at be been being by can could did do does doing for from had has have
he her here hers him his how i if in into is it its itself may me more most must my
no nor not of on once only or other our ours out over own same she should so some such
than that the their theirs them themselves then there these they this those through to
too under until up very was we were what when where which while who whom why will with
you your yours work working role roles job position company team year years experience
experience required requirement requirements include includes including ability strong
good excellent looking seek seeking new using use used within across about apply
application applicant candidates candidate level relevant skills skill please details
etc per pro plus will would
`.trim().split(/\s+/));

// Canonical competency -> aliases. Used to detect requirements in a posting and
// to recognise the same competency in the candidate's own profile text.
const SKILL_SYNONYMS = [
  ['International Trade & Export Operations', /\b(import|export|customs|shipping|freight|international trade|cross-border|global trade|trade compliance|incoterms|documentation)\b/gi],
  ['Supply Chain & Supplier Management', /\b(supply chain|logistics|procurement|sourcing|supplier|vendor|distribution|shipping coordinator)\b/gi],
  ['Commercial Sales & Business Development', /\b(sales|business development|commercial|revenue|new business|business growth|client acquisition|account growth)\b/gi],
  ['Key Account & Customer Relationship Management', /\b(key account|customer relationship|client relationship|crm|account management|customer service|customer engagement|client communication)\b/gi],
  ['Project Coordination & Delivery', /\b(project management|project coordination|program management|project delivery|coordinat(e|ing|ion)|project planning)\b/gi],
  ['Marketing & Social Media', /\b(marketing|social media|digital marketing|wechat|facebook|content|campaign|brand|market research)\b/gi],
  ['Cost Control & Contract Negotiation', /\b(cost control|budget|costing|negotiation|negotiat(e|ing)|contract|pricing|profitability|purchase)\b/gi],
  ['Quality Assurance & Compliance', /\b(quality assurance|quality control|\bqa\b|\bqc\b|compliance|standards|iso|inspection)\b/gi],
  ['Cross-Cultural Communication', /\b(cross-cultural|multilingual|bilingual|mandarin|chinese|english|thai|malay|vietnamese|interpret|translation)\b/gi],
  ['Team Leadership', /\b(team leader|team lead|leadership|supervis(e|ing|or)|manage a team|people management|mentor)\b/gi],
  ['Data Analysis & Reporting', /\b(data analysis|analytics|reporting|dashboard|excel|data warehousing|business intelligence|power bi)\b/gi],
  ['IT & Process Improvement', /\b(programming|software|developer|coding|debugging|systems|process improvement|automation|erp|it support)\b/gi],
  ['Inventory & Purchasing', /\b(inventory|stock|purchasing|order fulfilment|warehouse|materials)\b/gi],
  ['Customer Gifting & Engagement Programs', /\b(gifting|loyalty|customer program|customer engagement|premium customer|client visit)\b/gi],
  ['Exhibition & Event Coordination', /\b(exhibition|trade show|event coordination|annual event|conference)\b/gi],
];

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(text) {
  return norm(text).split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

function uniq(arr) {
  const seen = new Set();
  return arr.filter(x => { const k = String(x).toLowerCase().trim(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

function countMatches(text, re) {
  re.lastIndex = 0;
  const m = String(text || '').match(re);
  return m ? m.length : 0;
}

/** Extract requirements from the posting. */
function analyzePosting(posting, role, company) {
  const text = `${posting || ''}\n${role || ''}`;
  const words = tokens(text);
  const freq = new Map();
  words.forEach(w => freq.set(w, (freq.get(w) || 0) + 1));
  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 60)
    .map(([term, count]) => ({ term, count }));

  const postingSkills = [];
  SKILL_SYNONYMS.forEach(([name, re]) => {
    const hits = countMatches(text, re);
    if (hits > 0) postingSkills.push({ name, hits });
  });

  const yearsMatch = String(posting || '').match(/(\d{1,2})\s*\+?\s*(?:to|-|–)?\s*(\d{1,2})?\s*years?/i);
  const yearsRequired = yearsMatch ? parseInt(yearsMatch[1], 10) : 0;

  let seniority = '';
  const roleText = norm(role);
  // Only claim seniority when the title explicitly says so — "Manager" alone is
  // not a "Senior" claim and must not be added to the candidate's profile.
  if (/\b(senior|sr|lead|principal|staff|head|director|executive)\b/.test(roleText)) seniority = 'Senior';
  else if (/\b(junior|jr|entry|graduate|assistant)\b/.test(roleText)) seniority = 'Early-career';

  return { company: company || '', role: role || '', keywords, postingSkills, yearsRequired, seniority, text: norm(text) };
}

/** Score any candidate text against the posting. */
function scoreText(text, analysis) {
  const n = norm(text);
  if (!n) return 0;
  let score = 0;
  analysis.postingSkills.forEach(s => {
    const entry = SKILL_SYNONYMS.find(x => x[0] === s.name);
    if (entry && countMatches(n, entry[1]) > 0) score += 8;
  });
  analysis.keywords.slice(0, 40).forEach(k => {
    if (n.includes(k.term)) score += Math.min(k.count, 3);
  });
  return score;
}

function allSkills(profile) {
  const out = [];
  const skills = profile.skills || {};
  ['primary', 'secondary', 'domain', 'software'].forEach(cat => {
    (skills[cat] || []).forEach(name => {
      if (name && String(name).trim()) out.push({ name: String(name).trim(), category: cat, score: 0, order: out.length });
    });
  });
  return out;
}

function readableYears(profile) {
  // Only state a number of years when the candidate's OWN dates support it —
  // never borrow the posting's "5+ years required" and claim it as theirs.
  const years = [];
  (profile.experience || []).forEach(exp => {
    const s = String(exp.start || '').match(/\b(19|20)\d{2}\b/);
    if (s) years.push(parseInt(s[0], 10));
  });
  const eduYears = (profile.education || []).map(e => String(e.end || '').match(/\b(19|20)\d{2}\b/)).filter(Boolean).map(m => parseInt(m[0], 10));
  const all = [...years, ...eduYears];
  if (all.length >= 2) {
    const span = new Date().getFullYear() - Math.min(...all);
    if (span >= 1 && span <= 45) return `${span}+ years`;
  }
  return 'progressive';
}

function makeSummary(profile, analysis, topSkills, topRoles) {
  const target = analysis.role || (profile.careerGoals?.targetRoles || [])[0] || 'this role';
  const yrs = readableYears(profile);
  // Use clean skill names as the "domain" language — job titles read awkwardly
  // after "experience in", e.g. "experience in import & export manager".
  const domains = uniq(topSkills.slice(0, 3).map(s => String(s.name).toLowerCase()))
    .join(', ').replace(/, ([^,]*)$/, ' and $1');
  const skillNames = uniq(topSkills.slice(0, 5).map(s => s.name)).join(', ');
  const lead = analysis.seniority && !String(target).toLowerCase().includes(analysis.seniority.toLowerCase())
    ? `${analysis.seniority} ${target}` : target;

  let summary = `Results-oriented ${lead || 'professional'} with ${yrs} of progressive professional experience${domains ? ` across ${domains}` : ''}.`;
  if (skillNames) summary += ` Core strengths include ${skillNames}.`;
  if (analysis.company) summary += ` Motivated to bring this track record to ${analysis.company} and contribute directly to its ${target} team.`;
  else summary += ` Seeking to apply this background to a ${target} role where delivery and stakeholder trust matter.`;
  return summary;
}

/** Trim long bullets so highlights stay readable on an A4 page. */
// Resume parsers often split one achievement into several lines. Re-join lines
// that clearly continue the previous one (start lowercase / with a clause word)
// so each CV bullet is a complete, readable statement.
function mergeBulletFragments(bullets) {
  const out = [];
  (bullets || []).forEach(raw => {
    const b = typeof raw === 'string' ? raw.trim() : String(raw?.text || '').trim();
    if (!b) return;
    const continues = /^(and|or|but|which|who|whose|that|including|channels|system|to |of |in |for |with |from |such as|and other|customers|approach|relevant|relevant business|required|preparation|inventory|maintained|feedback|it |these|this|coordinated|supported|represent|contribute|monitor|including a)/i.test(b)
      || (/^[a-z]/.test(b) && !/^(e\.g|i\.e)/.test(b));
    if (continues && out.length) {
      const prev = out[out.length - 1];
      out[out.length - 1] = prev.replace(/[,;:]$/, '') + ' ' + b;
    } else {
      out.push(b);
    }
  });
  return out;
}

function trimBullet(text, max = 190) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]$/, '')}…`;
}

/**
 * Tailor a profile to a job posting.
 * Returns { tailoredProfile, report }.
 */
function tailorResume(profile, company, role, posting) {
  const analysis = analyzePosting(posting, role, company);
  const tailored = JSON.parse(JSON.stringify(profile || {}));
  const report = { company: analysis.company, role: analysis.role, changes: [], matched: [], missing: [], coverage: 0, summary: '', highlights: [] };

  // --- Skills: score, dedupe, reorder matched first ---
  const scored = allSkills(profile || {});
  scored.forEach(s => { s.score = scoreText(s.name, analysis); });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const ordered = [];
  scored.forEach(s => {
    const existing = ordered.find(o => norm(o.name) === norm(s.name));
    if (!existing) ordered.push(s);
  });
  const catOrder = ['primary', 'secondary', 'domain', 'software'];
  const rebuilt = { primary: [], secondary: [], domain: [], software: [] };
  ordered.forEach((s, i) => {
    const cat = i < 8 && s.score > 0 ? 'primary' : s.category;
    rebuilt[cat].push(s.name);
  });
  tailored.skills = { ...(tailored.skills || {}), ...rebuilt };
  const matchedSkills = ordered.filter(s => s.score > 0);
  report.matched = matchedSkills.map(s => s.name);
  if (matchedSkills.length) {
    report.changes.push(`Reordered Core Competencies so ${matchedSkills.length} skill${matchedSkills.length === 1 ? '' : 's'} relevant to this posting appear first.`);
  }

  // Requirements the posting asks for that we cannot evidence in the profile.
  // Evidence can live anywhere: skills, languages, experience titles/bullets.
  const profileEvidence = [
    ...allSkills(profile || {}).map(s => s.name),
    ...(profile.languages || []).map(l => `${l.language || ''} ${l.level || ''}`),
    ...(profile.experience || []).flatMap(e => [e.title || '', e.company || '', ...(e.bullets || [])]),
    ...(profile.behavioral?.strengths || []),
  ].map(norm).join(' ');
  analysis.postingSkills.forEach(ps => {
    const entry = SKILL_SYNONYMS.find(x => x[0] === ps.name);
    if (entry && countMatches(profileEvidence, entry[1]) === 0) report.missing.push(ps.name);
  });

  // --- Experience: score and reorder, promote matching bullets ---
  const experience = (tailored.experience || []).map((exp, idx) => {
    const e = { ...exp, _score: scoreText(`${exp.title || ''} ${exp.company || ''} ${(exp.bullets || []).join(' ')}`, analysis), _idx: idx };
    const bullets = mergeBulletFragments(exp.bullets || exp.responsibilities || []).map((txt, bi) => {
      return { txt, score: scoreText(txt, analysis), idx: bi };
    });
    bullets.sort((a, b) => b.score - a.score || a.idx - b.idx);
    e.bullets = bullets.map(b => b.txt);
    delete e.responsibilities;
    e._promoted = bullets.filter(b => b.score > 0).length;
    return e;
  });
  experience.sort((a, b) => b._score - a._score || a._idx - b._idx);
  report.changes.push(`Prioritised ${experience.length} position${experience.length === 1 ? '' : 's'} by relevance to "${analysis.role || 'this role'}"${experience[0]?.title ? ` — leading with ${experience[0].title}` : ''}.`);
  const promoted = experience.reduce((n, e) => n + (e._promoted || 0), 0);
  if (promoted) report.changes.push(`Moved ${promoted} achievement bullet${promoted === 1 ? '' : 's'} that echo the posting's language to the top of their roles.`);
  experience.forEach(e => { delete e._score; delete e._idx; delete e._promoted; });
  tailored.experience = experience;

  // --- Highlights: best real evidence across all roles ---
  // Skip parser fragments that begin mid-sentence (lowercase or a trailing
  // clause) so the "Why my background fits" bullets read cleanly.
  const fragmentStart = /^(and|or|but|which|who|including|including a|channels|system|to |of |in |for |with |as well as|customers|and other|from |such as)/i;
  const candidates = [];
  experience.forEach(exp => {
    (exp.bullets || []).forEach(b => {
      let t = trimBullet(b);
      if (!t || t.length < 25) return;
      if (fragmentStart.test(t)) return;
      // "Express, Foton, and other ..." — a capitalized name-list fragment.
      if (/^[A-Z][a-z]+,\s+[A-Z]/.test(t)) return;
      // A well-formed bullet starts with a capital letter or a verb-like word.
      if (!/^[A-Z]/.test(t) && !/^(manage|lead|plan|coordinate|support|develop|maintain|implement|monitor|oversee|work|perform|provide|handle|drive)/i.test(t)) return;
      candidates.push({ text: t, score: scoreText(t, analysis), idx: candidates.length });
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const highlights = candidates.slice(0, 4).map(c => c.text);
  report.highlights = highlights;
  if (highlights.length) report.changes.push(`Added a "Why My Background Fits" section with ${highlights.length} of your strongest, posting-relevant achievements.`);

  // --- Tailored summary (replaces the old placeholder text) ---
  const roles = experience.map(e => e.title).filter(Boolean);
  const summary = makeSummary(profile || {}, analysis, matchedSkills, roles);
  report.summary = summary;
  report.changes.push('Wrote a targeted profile statement that names the role, your relevant background and the company instead of a generic placeholder.');
  tailored.summary = summary;
  tailored.highlights = highlights;
  tailored._matchedSkills = report.matched;

  const totalReq = analysis.postingSkills.length;
  report.coverage = totalReq ? Math.round((totalReq - report.missing.length) / totalReq * 100) : (report.matched.length ? 100 : 0);
  report.requirements = analysis.postingSkills.map(s => s.name);
  report.yearsRequired = analysis.yearsRequired;
  report.keywords = analysis.keywords.slice(0, 12).map(k => k.term);

  return { tailoredProfile: tailored, report };
}

module.exports = { analyzePosting, tailorResume, scoreText, SKILL_SYNONYMS };
