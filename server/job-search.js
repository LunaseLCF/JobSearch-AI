/**
 * Job Search Module
 * Fetches real job listings from public APIs and user-provided URLs.
 * Uses only Node.js built-in modules (no external dependencies).
 */
const https = require('https');
const http = require('http');
const jobSites = require('./job-sites');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

/** Fetch a URL with redirect following and timeout. Returns {status, body, headers, finalUrl}. */
function fetchUrl(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const headers = { ...BROWSER_HEADERS, ...(options.headers || {}) };
    const req = lib.get(targetUrl, {
      headers,
      timeout: options.timeout || 20000,
    }, (res) => {
      // Follow redirects (max 5)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && (options._redirects || 0) < 5) {
        const next = new URL(res.headers.location, targetUrl).toString();
        res.resume();
        resolve(fetchUrl(next, { ...options, _redirects: (options._redirects || 0) + 1 }));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers, finalUrl: targetUrl }));
    });
    req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
    req.on('error', reject);
  });
}

/** Fetch and JSON.parse a URL. */
async function fetchJson(url, options) {
  const r = await fetchUrl(url, { ...options, headers: { Accept: 'application/json', ...(options?.headers || {}) } });
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status} from ${url}`);
  return JSON.parse(r.body);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

/** Normalize a job object into the app's standard job shape. */
function normalizeJob(j) {
  return {
    title: j.title || j.position || j.jobTitle || '',
    company: j.company || j.company_name || j.hiringOrganization || '',
    location: j.location || j.jobLocation || j.candidateRequiredLocation || '',
    url: j.url || j.apply_url || j.link || j.jobUrl || '',
    description: stripHtml(j.description || j.content || ''),
    // Preserve salary band and posting date from source APIs (e.g. RemoteOK, Arbeitnow).
    salary: j.salary || j.salary_min ? `${j.salary_min}${j.salary_max ? `-${j.salary_max}` : ''}` : (j.salary || ''),
    source: j.source || '',
    remote: j.remote === true || j.remote === 'True' || String(j.remote).toLowerCase() === 'true',
    posted: j.posted || j.date || j.created_at || '',
    fit: j.fit || '',
  };
}

/** Extract JSON-LD JobPosting objects from an HTML page. */
function parseJsonLd(html) {
  const jobs = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
      for (const item of items) {
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        if (types.some(t => String(t).toLowerCase().includes('jobposting'))) {
          const org = item.hiringOrganization || {};
          const loc = item.jobLocation || {};
          const address = loc.address || {};
          jobs.push(normalizeJob({
            title: item.title,
            company: typeof org === 'string' ? org : org.name,
            location: [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ') || (typeof loc === 'string' ? loc : ''),
            url: item.url || (item.applyContactPoints && item.applyContactPoints[0] && item.applyContactPoints[0].url) || '',
            description: item.description,
            source: 'json-ld',
          }));
        }
      }
    } catch (e) { /* skip invalid JSON-LD blocks */ }
  }
  return jobs;
}

/** Parse generic HTML for job card patterns (best-effort). */
function parseHtmlJobs(html, baseUrl) {
  const jobs = [];
  // Pattern: anchors linking to job detail pages with readable text
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
  let m;
  const seen = new Set();
  while ((m = linkRegex.exec(html)) !== null) {
    const href = m[1];
    const inner = m[2];
    const text = stripHtml(inner);
    if (!/^https?:\/\//i.test(href) && !href.startsWith('/')) continue;
    // Heuristic: URL looks like a job posting
    if (!/\/(job|jobs|careers?|vacanc|position|opportunit|lowongan|posting)/i.test(href)) continue;
    if (text.length < 5 || text.length > 150) continue;
    const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);
    // Try to guess company from URL host
    let host = '';
    try { host = new URL(fullUrl).hostname.replace(/^www\./, ''); } catch (e) {}
    jobs.push(normalizeJob({ title: text, company: host, url: fullUrl, source: 'html' }));
    if (jobs.length >= 50) break;
  }
  return jobs;
}

/** Fetch jobs from a Greenhouse board URL. */
async function fetchGreenhouse(url) {
  const match = url.match(/boards\.greenhouse\.io\/([^/?]+)/) || url.match(/boards-api\.greenhouse\.io\/v1\/boards\/([^/?]+)/);
  if (!match) return null;
  const token = match[1];
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
  return (data.jobs || []).map(j => normalizeJob({
    title: j.title, company: j.company?.name || token,
    location: j.location?.name || '', url: j.absolute_url,
    description: stripHtml(j.content), source: 'greenhouse',
  }));
}

/** Fetch jobs from a Lever board URL. */
async function fetchLever(url) {
  const match = url.match(/jobs\.lever\.co\/([^/?]+)/) || url.match(/api\.lever\.co\/v0\/postings\/([^/?]+)/);
  if (!match) return null;
  const token = match[1];
  const data = await fetchJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
  return (Array.isArray(data) ? data : []).map(j => normalizeJob({
    title: j.text, company: token, location: j.categories?.location || '',
    url: j.hostedUrl || j.applyUrl, description: stripHtml(j.descriptionPlain || j.description),
    source: 'lever',
  }));
}

/** Fetch jobs from RemoteOK API (keyword search). */
async function fetchRemoteOk(keywords) {
  const data = await fetchJson('https://remoteok.com/api');
  const terms = (keywords || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  let jobs = data.slice(1).map(j => normalizeJob({
    title: j.position, company: j.company, location: j.location || 'Remote',
    url: j.url || j.apply_url, description: j.description,
    salary: j.salary_min ? `${j.salary_min}-${j.salary_max || ''}` : '',
    source: 'remoteok', remote: true, posted: j.date,
  }));
  if (terms.length) {
    jobs = jobs.filter(j => {
      const hay = `${j.title} ${j.company} ${j.description}`.toLowerCase();
      return terms.some(t => hay.includes(t));
    });
  }
  return jobs;
}

/** Fetch jobs from Arbeitnow API (keyword search). */
async function fetchArbeitnow(keywords) {
  const data = await fetchJson('https://www.arbeitnow.com/api/job-board-api');
  const terms = (keywords || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  let jobs = (data.data || []).map(j => normalizeJob({
    title: j.title, company: j.company_name, location: j.location || '',
    url: j.url, description: j.description,
    remote: j.remote, posted: j.created_at, source: 'arbeitnow',
  }));
  if (terms.length) {
    jobs = jobs.filter(j => {
      const hay = `${j.title} ${j.company} ${j.description}`.toLowerCase();
      return terms.some(t => hay.includes(t));
    });
  }
  return jobs;
}

/** Main: keyword search across multiple public sources, filtered by profile location. */
async function searchByKeywords(keywords, limit = 40, location = '') {
  const results = [];
  const errors = [];
  const sources = [
    { name: 'remoteok', fn: () => fetchRemoteOk(keywords) },
    { name: 'arbeitnow', fn: () => fetchArbeitnow(keywords) },
  ];
  await Promise.all(sources.map(async s => {
    try {
      const jobs = await s.fn();
      results.push(...jobs);
    } catch (e) {
      errors.push(`${s.name}: ${e.message}`);
    }
  }));
  // Deduplicate by URL/title+company
  const seen = new Set();
  const unique = results.filter(j => {
    const key = (j.url || `${j.title}|${j.company}`).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const total = unique.length;
  const matched = jobSites.filterJobsByLocation(unique, location);
  return {
    jobs: matched.slice(0, limit),
    count: total,
    matchedCount: matched.length,
    location: String(location || ''),
    country: jobSites.detectCountry(location),
    errors,
  };
}

/** Main: fetch jobs from a user-provided URL. */
async function searchByUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { jobs: [], error: 'Please provide a valid URL starting with http:// or https://' };
  }
  const errors = [];
  // Try known structured APIs first
  for (const [name, fn] of [['greenhouse', fetchGreenhouse], ['lever', fetchLever]]) {
    if (/greenhouse|lever/i.test(url)) {
      try {
        const jobs = await fn(url);
        if (jobs && jobs.length) return { jobs, count: jobs.length, source: name };
      } catch (e) { errors.push(`${name}: ${e.message}`); }
    }
  }
  // Generic fetch + parse
  try {
    const r = await fetchUrl(url);
    if (r.status === 403 || r.status === 429) {
      return {
        jobs: [],
        blocked: true,
        error: `The site returned HTTP ${r.status} (blocked automated access). This site requires a real browser session. Open the page in your browser, copy the job listings text, and paste it in the "Paste Job Listings" box — or use a Greenhouse/Lever URL / the keyword search above.`,
      };
    }
    if (r.status < 200 || r.status >= 300) {
      return { jobs: [], error: `The site returned HTTP ${r.status}.` };
    }
    let jobs = parseJsonLd(r.body);
    if (!jobs.length) jobs = parseHtmlJobs(r.body, r.finalUrl || url);
    return { jobs: jobs.slice(0, 100), count: jobs.length, source: 'page', truncated: jobs.length > 100, errors };
  } catch (e) {
    return { jobs: [], error: 'Could not fetch the URL: ' + e.message };
  }
}

/** Parse jobs from text the user pasted from a browser page (fallback for blocked sites). */
function parsePastedJobs(text, limit = 100) {
  if (!text || typeof text !== 'string') return { jobs: [], error: 'No text provided' };
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const jobs = [];
  const titleWords = /\b(engineer|developer|manager|analyst|scientist|designer|architect|consultant|specialist|director|lead|executive|associate|coordinator|administrator|technician|senior|junior|staff|principal|intern|officer|representative|supervisor|accountant|controller|marketer|recruiter|sales|support|operations|product|data|software|web|cloud|security|network|system|business)\b|经理|工程师|开发|分析师|设计师|总监|主管|专员|主管|助理|顾问|专家|专员|总裁|董事|架构师|运营|销售|市场|产品|技术|客服|会计|人事|招聘|实习/i;
  const urlRegex = /https?:\/\/[^\s<>"']+/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 6 || line.length > 140) continue;
    if (!titleWords.test(line)) continue;
    // Skip lines that are clearly sentences/paragraphs
    if (/^(we |our |you |the |about |responsibilities|requirements|benefits|description)/i.test(line)) continue;
    if (/[.!?]$/.test(line) && line.split(' ').length > 10) continue;

    const urlMatch = line.match(urlRegex);
    const title = line.replace(urlRegex, '').replace(/\s{2,}/g, ' ').trim();
    if (title.length < 5) continue;

    // Look ahead for company/location in the next 1-2 lines
    let company = '', location = '';
    for (let k = 1; k <= 2 && i + k < lines.length; k++) {
      const next = lines[i + k];
      if (next.length > 100 || titleWords.test(next)) break;
      if (/^\+?\d|^www\.|^@/.test(next)) continue;
      if (!company) {
        const parts = next.split(/\s*[|·–—-]\s*/).filter(Boolean);
        company = parts[0] || next;
        if (parts.length > 1) location = parts.slice(1).join(', ');
      } else if (!location) {
        location = next;
      }
    }
    jobs.push(normalizeJob({
      title, company, location,
      url: urlMatch ? urlMatch[0] : '',
      source: 'pasted',
    }));
    if (jobs.length >= limit) break;
  }

  // Deduplicate
  const seen = new Set();
  const unique = jobs.filter(j => {
    const key = `${j.title.toLowerCase()}|${j.company.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { jobs: unique, count: unique.length, source: 'pasted' };
}

module.exports = { searchByKeywords, searchByUrl, parsePastedJobs, normalizeJob, stripHtml };
