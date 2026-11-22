/**
 * Job Sites Module
 * - Detects country from a profile location string
 * - Provides country-specific job websites with search URL templates
 * - Supports user-added custom job sites
 * - Multi-strategy job retrieval with fallbacks for blocked (403) sites
 * Uses only Node.js built-in modules.
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Country-specific job sites. Placeholders: {q} = keywords, {l} = location.
 * Labels use region-appropriate naming.
 */
const COUNTRY_SITES = {
  thailand: [
    { name: 'JobThai', url: 'https://www.jobthai.com/en/jobs?keyword={q}', tier: 1 },
    { name: 'JobsDB Thailand', url: 'https://th.jobsdb.com/jobs?keywords={q}&location={l}', tier: 1 },
    { name: 'JobBKK', url: 'https://www.jobbkk.com/jobs/search/{q}', tier: 2 },
    { name: 'JobStreet Thailand', url: 'https://th.jobstreet.com/jobs?keywords={q}&location={l}', tier: 2 },
  ],
  malaysia: [
    { name: 'JobStreet Malaysia', url: 'https://my.jobstreet.com/jobs?keywords={q}&location={l}', tier: 1 },
    { name: 'JobsDB Malaysia', url: 'https://my.jobsdb.com/jobs?keywords={q}&location={l}', tier: 1 },
    { name: 'Foundit Malaysia', url: 'https://www.foundit.my/jobs?keywords={q}&location={l}', tier: 2 },
  ],
  vietnam: [
    { name: 'VietnamWorks', url: 'https://www.vietnamworks.com/job-search?query={q}&location={l}', tier: 1 },
    { name: 'JobStreet Vietnam', url: 'https://vn.jobstreet.com/jobs?keywords={q}&location={l}', tier: 1 },
    { name: 'JobsDB Vietnam', url: 'https://vn.jobsdb.com/jobs?keywords={q}&location={l}', tier: 2 },
  ],
  singapore: [
    { name: 'JobStreet Singapore', url: 'https://sg.jobstreet.com/jobs?keywords={q}&location={l}', tier: 1 },
    { name: 'JobsDB Singapore', url: 'https://sg.jobsdb.com/jobs?keywords={q}&location={l}', tier: 1 },
    { name: 'MyCareersFuture', url: 'https://www.mycareersfuture.gov.sg/search?search={q}', tier: 2 },
  ],
  indonesia: [
    { name: 'JobStreet Indonesia', url: 'https://id.jobstreet.com/jobs?keywords={q}&location={l}', tier: 1 },
    { name: 'Kalibrr', url: 'https://www.kalibrr.com/c/job-search?query={q}', tier: 2 },
  ],
  philippines: [
    { name: 'JobStreet Philippines', url: 'https://ph.jobstreet.com/jobs?keywords={q}&location={l}', tier: 1 },
    { name: 'Foundit Philippines', url: 'https://www.foundit.ph/jobs?keywords={q}&location={l}', tier: 2 },
  ],
  'hong kong, china': [
    { name: 'JobsDB Hong Kong', url: 'https://hk.jobsdb.com/jobs?keywords={q}&location={l}', tier: 1 },
    { name: 'CTgoodjobs', url: 'https://www.ctgoodjobs.hk/job-search?q={q}', tier: 2 },
  ],
  china: [
    { name: 'Liepin', url: 'https://www.liepin.com/zhaopin/?key={q}&city={l}', tier: 1 },
    { name: 'Zhaopin', url: 'https://sou.zhaopin.com/?kw={q}&jl={l}', tier: 1 },
    { name: '51job', url: 'https://we.51job.com/pc/search?keyword={q}', tier: 2 },
  ],
  'taiwan, china': [
    { name: '104 Job Bank', url: 'https://www.104.com.tw/jobs/search/?keyword={q}&area={l}', tier: 1 },
    { name: '1111 Job Bank', url: 'https://www.1111.com.tw/search/job?ks={q}', tier: 2 },
  ],
  'united states': [
    { name: 'Indeed US', url: 'https://www.indeed.com/jobs?q={q}&l={l}', tier: 1 },
    { name: 'LinkedIn Jobs', url: 'https://www.linkedin.com/jobs/search/?keywords={q}&location={l}', tier: 1 },
    { name: 'Glassdoor', url: 'https://www.glassdoor.com/Job/jobs.htm?sc.keyword={q}&locT=C&locKeyword={l}', tier: 2 },
    { name: 'ZipRecruiter', url: 'https://www.ziprecruiter.com/jobs-search?search={q}&location={l}', tier: 2 },
  ],
  'united kingdom': [
    { name: 'Indeed UK', url: 'https://www.indeed.co.uk/jobs?q={q}&l={l}', tier: 1 },
    { name: 'Reed', url: 'https://www.reed.co.uk/jobs/{q}-jobs-in-{l}', tier: 1 },
    { name: 'Totaljobs', url: 'https://www.totaljobs.com/jobs/{q}?location={l}', tier: 2 },
  ],
  australia: [
    { name: 'Seek Australia', url: 'https://www.seek.com.au/{q}-jobs-in-{l}', tier: 1 },
    { name: 'Indeed Australia', url: 'https://au.indeed.com/jobs?q={q}&l={l}', tier: 1 },
  ],
  germany: [
    { name: 'Indeed Germany', url: 'https://de.indeed.com/jobs?q={q}&l={l}', tier: 1 },
    { name: 'Stepstone', url: 'https://www.stepstone.de/jobs/{q}?locatedWhileSearching=true&location={l}', tier: 2 },
  ],
  india: [
    { name: 'Naukri', url: 'https://www.naukri.com/{q}-jobs-in-{l}', tier: 1 },
    { name: 'Indeed India', url: 'https://in.indeed.com/jobs?q={q}&l={l}', tier: 1 },
  ],
  canada: [
    { name: 'Indeed Canada', url: 'https://ca.indeed.com/jobs?q={q}&l={l}', tier: 1 },
    { name: 'LinkedIn Jobs', url: 'https://www.linkedin.com/jobs/search/?keywords={q}&location={l}', tier: 1 },
  ],
  global: [
    { name: 'LinkedIn Jobs', url: 'https://www.linkedin.com/jobs/search/?keywords={q}&location={l}', tier: 1 },
    { name: 'Indeed', url: 'https://www.indeed.com/jobs?q={q}&l={l}', tier: 1 },
    { name: 'RemoteOK', url: 'https://remoteok.com/?q={q}', tier: 2 },
  ],
};

// Country keyword → key mapping (order matters: more specific first)
const COUNTRY_KEYWORDS = [
  ['hong kong, china', /hong kong/i],
  ['taiwan, china', /taiwan|taipei/i],
  ['united states', /\b(usa|u\.s\.a\.|united states|new york|san francisco|seattle|boston|austin|chicago|los angeles)\b/i],
  ['united kingdom', /\b(uk|u\.k\.|united kingdom|england|london|manchester|birmingham|edinburgh)\b/i],
  ['thailand', /thailand|bangkok|chiang mai|phuket/i],
  ['malaysia', /malaysia|kuala lumpur|\bkl\b|penang/i],
  ['vietnam', /viet ?nam|ho chi minh|\bhcm\b|hanoi|danang|da nang/i],
  ['singapore', /singapore/i],
  ['indonesia', /indonesia|jakarta|surabaya/i],
  ['philippines', /philippines|manila|cebu/i],
  ['china', /china|beijing|shanghai|shenzhen|guangzhou|hangzhou/i],
  ['australia', /australia|sydney|melbourne|brisbane|perth/i],
  ['germany', /germany|berlin|munich|hamburg|frankfurt/i],
  ['india', /india|mumbai|delhi|bangalore|bengaluru|hyderabad/i],
  ['canada', /canada|toronto|vancouver|montreal|ottawa/i],
];

/** Detect country key from a location string. */
function detectCountry(location) {
  const loc = String(location || '').toLowerCase();
  for (const [key, re] of COUNTRY_KEYWORDS) {
    if (re.test(loc)) return key;
  }
  return 'global';
}

const REMOTE_LOCATION_RE = /remote|anywhere|worldwide|work from home|telecommute/i;

/** Rank a job against a location: 2 = direct match, 1 = remote, 0 = no match. */
function locationScore(job, location) {
  const raw = String(location || '').trim().toLowerCase();
  if (!raw) return 2;
  const jobLoc = String((job && job.location) || '').toLowerCase();
  const tokens = [...new Set(raw.split(/[,/|]+|\s+/).map(t => t.trim()).filter(t => t.length > 1))];
  const country = detectCountry(raw);
  if (country && country !== 'global') tokens.push(country);
  if (jobLoc && tokens.some(t => jobLoc.includes(t) || (t.includes(jobLoc) && jobLoc.length > 2))) return 2;
  if (REMOTE_LOCATION_RE.test(jobLoc) || (job && job.remote)) return 1;
  return 0;
}

/** Filter and sort jobs by profile location, keeping local matches first. */
function filterJobsByLocation(jobs, location, options = {}) {
  const allowUnknown = options.allowUnknown === true;
  const scored = (Array.isArray(jobs) ? jobs : [])
    .map(job => ({ job, score: locationScore(job, location) }))
    .filter(item => item.score > 0 || (allowUnknown && !String(item.job.location || '').trim()));
  scored.sort((a, b) => b.score - a.score);
  return scored.map(item => ({ ...item.job, locationRank: item.score }));
}

/** Fill placeholders in a site URL template. */
function fillTemplate(template, keywords, location) {
  const q = encodeURIComponent(String(keywords || '').trim());
  const l = encodeURIComponent(String(location || '').trim());
  return String(template || '')
    .replace(/\{q\}/g, q)
    .replace(/\{l\}/g, l)
    .replace(/\{keywords\}/g, q)
    .replace(/\{location\}/g, l);
}

/** Get job sites relevant to a location, including user-added custom sites. */
function getSitesForLocation(location, customSites = []) {
  const country = detectCountry(location);
  const sites = (COUNTRY_SITES[country] || COUNTRY_SITES.global).map(s => ({ ...s, country, custom: false }));
  // Add global fallbacks not already present
  COUNTRY_SITES.global.forEach(g => {
    if (!sites.some(s => s.name === g.name)) sites.push({ ...g, country: 'global', custom: false });
  });
  const customs = (customSites || []).map(s => ({
    name: s.name || 'Custom site',
    url: s.url || s.template || '',
    tier: s.tier || 1,
    country: 'custom',
    custom: true,
  }));
  return { country, sites: [...customs, ...sites] };
}

function fetchUrl(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const headers = { ...BROWSER_HEADERS, ...(options.headers || {}) };
    const req = lib.get(targetUrl, { headers, timeout: options.timeout || 20000 }, (res) => {
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
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Parse jobs from Google News RSS (a reliable fallback when job sites block us).
 * Google News indexes job postings and is generally accessible.
 */
function parseGoogleNewsRss(xml) {
  const jobs = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    const title = (item.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const link = (item.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const desc = (item.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '';
    if (title) {
      jobs.push({
        title: stripHtml(title).substring(0, 140),
        company: '',
        location: '',
        url: stripHtml(link),
        description: stripHtml(desc).substring(0, 500),
        source: 'Google News (job alert)',
        remote: false,
      });
    }
  }
  return jobs;
}

/**
 * Multi-strategy retrieval for a job search URL.
 * Tries: 1) direct fetch + JSON-LD/HTML parse, 2) text proxy (r.jina.ai),
 * 3) Google News RSS job search fallback.
 * Always returns a browserUrl so the user can open the site directly.
 */
async function retrieveJobs(url, keywords, location, options = {}) {
  const attempts = [];
  const strictSite = options.strictSite === true;
  const activeLocation = String(location || '').trim();
  const detectedCountry = detectCountry(activeLocation);
  let siteHost = 'This site';
  try { siteHost = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* keep default */ }
  const siteBlockedError = `${siteHost} blocks automated access or loads its listings with JavaScript, so no listings could be extracted from that site. Open the search in your browser and paste the listings text below, or use "Find similar jobs" to search public job boards instead.`;

  // Strategy 1: direct fetch
  try {
    const r = await fetchUrl(url, { timeout: 15000 });
    if (r.status >= 200 && r.status < 300) {
      // Try JSON-LD
      const jld = parseJsonLdFromHtml(r.body);
      if (jld.length) {
        return { ok: true, jobs: filterJobsByLocation(jld, activeLocation, { allowUnknown: true }), strategy: 'direct (JSON-LD)', browserUrl: url, attempts, location: activeLocation, country: detectedCountry };
      }
      // Try generic HTML job links
      const htmlJobs = parseJobLinks(r.body, url, keywords);
      if (htmlJobs.length) {
        return { ok: true, jobs: filterJobsByLocation(htmlJobs, activeLocation, { allowUnknown: true }), strategy: 'direct (HTML)', browserUrl: url, attempts, location: activeLocation, country: detectedCountry };
      }
      attempts.push('Direct fetch succeeded but no structured job listings found on the page (likely JavaScript-rendered).');
    } else {
      attempts.push(`Direct fetch returned HTTP ${r.status}.`);
    }
  } catch (e) {
    attempts.push('Direct fetch failed: ' + e.message);
  }

  // Strategy 2: text proxy
  try {
    const proxyUrl = url.startsWith('http') ? 'https://r.jina.ai/' + url : url;
    const r = await fetchUrl(proxyUrl, { timeout: 20000 });
    if (r.status >= 200 && r.status < 300 && !/Cloudflare|Attention Required|403|blocked/i.test(r.body.substring(0, 500))) {
      const jld = parseJsonLdFromHtml(r.body);
      const textJobs = jld.length ? jld : parseTextJobListings(r.body);
      if (textJobs.length) {
        return { ok: true, jobs: filterJobsByLocation(textJobs, activeLocation, { allowUnknown: true }), strategy: 'text proxy', browserUrl: url, attempts, location: activeLocation, country: detectedCountry };
      }
      attempts.push('Text proxy fetched the page but no job listings were detected.');
    } else {
      attempts.push('Text proxy was also blocked by the site.');
    }
  } catch (e) {
    attempts.push('Text proxy failed: ' + e.message);
  }

  // A "Fetch Jobs" click on a specific site must not silently return jobs
  // from a different source — those would look identical for every site.
  if (strictSite) {
    return {
      ok: false, jobs: [], browserUrl: url, attempts,
      location: activeLocation, country: detectedCountry,
      strictSite: true, siteBlocked: true,
      error: siteBlockedError,
    };
  }

  // Strategy 3: Real job APIs filtered by location (better than news articles)
  try {
    const q = encodeURIComponent(keywords || 'jobs');
    const apiJobs = [];
    // RemoteOK public API
    try {
      const r = await fetchUrl('https://remoteok.com/api', { timeout: 15000, headers: { Accept: 'application/json' } });
      if (r.status >= 200 && r.status < 300) {
        const data = JSON.parse(r.body).slice(1);
        const terms = String(keywords || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
        const loc = String(location || '').toLowerCase();
        data.forEach(j => {
          const hay = `${j.position || ''} ${j.company || ''} ${j.location || ''}`.toLowerCase();
          const matchKw = !terms.length || terms.some(t => hay.includes(t));
          const matchLoc = !loc || hay.includes(loc) || /remote|anywhere|worldwide/.test(hay);
          if (matchKw && matchLoc) {
            apiJobs.push({
              title: j.position || '', company: j.company || '', location: j.location || 'Remote',
              url: j.url || j.apply_url || '', description: stripHtml(j.description || '').substring(0, 500),
              salary: j.salary_min ? `${j.salary_min}${j.salary_max ? `-${j.salary_max}` : ''}` : '',
              remote: true, posted: '',
              source: 'RemoteOK (fallback)',
            });
          }
        });
      }
    } catch (e) { attempts.push('RemoteOK fallback failed: ' + e.message); }

    // Arbeitnow public API
    try {
      const r = await fetchUrl('https://www.arbeitnow.com/api/job-board-api', { timeout: 15000, headers: { Accept: 'application/json' } });
      if (r.status >= 200 && r.status < 300) {
        const data = JSON.parse(r.body).data || [];
        const terms = String(keywords || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
        const loc = String(location || '').toLowerCase();
        data.forEach(j => {
          const hay = `${j.title || ''} ${j.company_name || ''} ${j.location || ''}`.toLowerCase();
          const matchKw = !terms.length || terms.some(t => hay.includes(t));
          const matchLoc = !loc || hay.includes(loc) || /remote|anywhere|worldwide/.test(hay);
          // Show all when no strict location match; mark remote ones. Include salary band if present.
          if (matchKw && matchLoc) {
            apiJobs.push({
              title: j.title || '', company: j.company_name || '', location: j.location || (j.remote ? 'Remote' : ''),
              url: j.url || '', description: stripHtml(j.description || '').substring(0, 500),
              salary: j.min_money ? `${j.min_money}${j.max_money ? `-${j.max_money}` : ''}` : '',
              remote: !!j.remote, posted: j.created_at || '',
              source: 'Arbeitnow (fallback)',
            });
          }
        });
      }
    } catch (e) { attempts.push('Arbeitnow fallback failed: ' + e.message); }

    if (apiJobs.length) {
      const matched = filterJobsByLocation(apiJobs, activeLocation);
      if (matched.length) {
        return {
          ok: true, jobs: matched.slice(0, 40), strategy: 'public job APIs fallback',
          browserUrl: url, attempts, location: activeLocation, country: detectedCountry,
          note: `These are NOT listings from ${siteHost}. ${siteHost} blocked automated access, so these are related real jobs from public job boards filtered for your profile location. Open the site link to browse its own listings.`,
        };
      }
      attempts.push('Public job API fallback returned no jobs matching your profile location.');
    } else {
      attempts.push('Public job API fallback returned no matching jobs.');
    }
  } catch (e) {
    attempts.push('Public job API fallback failed: ' + e.message);
  }

  // Strategy 4: Google News RSS — last resort for job-related postings
  try {
    const q = encodeURIComponent(`${keywords || 'jobs'} hiring ${location || ''}`.trim());
    const rssUrl = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetchUrl(rssUrl, { timeout: 15000 });
    if (r.status >= 200 && r.status < 300) {
      const jobs = filterJobsByLocation(parseGoogleNewsRss(r.body), activeLocation)
        .filter(j => /job|hiring|vacan|career|recruit|职位|招聘/i.test(j.title));
      if (jobs.length) {
        return {
          ok: true, jobs: jobs.slice(0, 40), strategy: 'Google News fallback',
          browserUrl: url, attempts, location: activeLocation, country: detectedCountry,
          note: `These are NOT listings from ${siteHost}. ${siteHost} blocked automated access and no public-board jobs matched, so these are job-related search results for your profile location. Open the site link to browse its own listings.`,
        };
      }
    }
    attempts.push('Google News fallback returned no relevant results.');
  } catch (e) {
    attempts.push('Google News fallback failed: ' + e.message);
  }

  return {
    ok: false,
    jobs: [],
    browserUrl: url,
    attempts,
    location: activeLocation,
    country: detectedCountry,
    error: 'All automatic retrieval strategies were blocked or returned no listings matching your profile location. Open the site directly in your browser using the link below, or paste the job listings text.',
  };
}

function parseJsonLdFromHtml(html) {
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
          const addr = loc.address || {};
          jobs.push({
            title: item.title || '',
            company: typeof org === 'string' ? org : (org.name || ''),
            location: [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ') || '',
            url: item.url || '',
            description: stripHtml(item.description || '').substring(0, 1000),
            source: 'JSON-LD',
          });
        }
      }
    } catch (e) { /* skip */ }
  }
  return jobs;
}

function parseJobLinks(html, baseUrl, keywords = '') {
  const jobs = [];
  const seen = new Set();
  const roleRe = /\b(engineer|developer|manager|analyst|scientist|designer|architect|consultant|specialist|director|lead|executive|officer|coordinator|administrator|supervisor|accountant|recruiter|sales|marketing|operations|product|software|web|cloud|data|hr|finance|logistics|supply|import|export|经理|工程师|开发|分析师|设计师|主管|专员|招聘|销售|市场|会计|物流|运营)\b/i;
  const navRe = /^(go to|back to|view all|see all|load more|apply now|login|register|home|search|more jobs|ไปหน้า|กลับ|หน้า|สมัคร|ดูทั้งหมด)/i;
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,250}?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const href = m[1];
    const text = stripHtml(m[2]).trim();
    if (!/^https?:\/\//i.test(href) && !href.startsWith('/')) continue;
    // Must look like a link to a specific job, not a listing/navigation page.
    // Covers /job/123, /jobs/123, VietnamWorks "-jd" slugs and localised paths.
    if (!/(\/jobs?\/[^\/?#]+|\/jobs?[-\/][^\/?#]+|-jd(?:[-/?#]|$)|viec-lam|vieclam|lowongan)/i.test(href)) continue;
    if (text.length < 6 || text.length > 120 || navRe.test(text)) continue;
    if (!roleRe.test(text) && !text.includes('|') && !text.includes('·')) continue;
    const full = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
    if (seen.has(full)) continue;
    seen.add(full);
    jobs.push({ title: text, company: '', location: '', url: full, description: '', source: 'HTML' });
    if (jobs.length >= 50) break;
  }
  return jobs;
}

function parseTextJobListings(text) {
  // Parse markdown/text from jina proxy: look for lines with "Title at Company" or job-like headings
  const jobs = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const roleWords = /(engineer|developer|manager|analyst|scientist|designer|director|lead|specialist|consultant|executive|经理|工程师|主管|开发)/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^#{1,6}\s*|^\[|\]\([^)]*\)$/g, '').trim();
    if (line.length < 8 || line.length > 120 || !roleWords.test(line)) continue;
    const urlMatch = line.match(/https?:\/\/[^\s)]+/) || (lines[i + 1] || '').match(/https?:\/\/[^\s)]+/);
    jobs.push({
      title: line.replace(/https?:\/\/[^\s)]+/g, '').trim(),
      company: '', location: '', url: urlMatch ? urlMatch[0] : '', description: '', source: 'proxy',
    });
    if (jobs.length >= 40) break;
  }
  return jobs;
}

module.exports = {
  detectCountry, getSitesForLocation, fillTemplate, retrieveJobs, filterJobsByLocation, locationScore, COUNTRY_SITES,
};
