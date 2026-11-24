/* AI Job Search - Web Application */

async function apiRequest(path, options = {}) {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin', ...options });
  let data = {};
  try { data = await response.json(); } catch (e) { /* non-JSON error */ }
  if (response.status === 401 && !String(path).startsWith('auth/')) {
    if (typeof showAuthScreen === 'function') showAuthScreen(tr('Session expired. Please sign in again.'));
    const error = new Error(data.error || 'Login required');
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

const API = {
  get: (path) => apiRequest(path),
  post: (path, body) => apiRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  put: (path, body) => apiRequest(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  del: (path) => apiRequest(path, { method: 'DELETE' }),
};

/** Language code currently selected in the UI, used for AI-generated prose. */
function currentUILanguage() {
  try {
    return (window.I18N && typeof I18N.current === 'function' && I18N.current()) || localStorage.getItem('lang') || 'en';
  } catch (e) {
    return 'en';
  }
}

let currentPage = 'dashboard';
let profileData = null;
let currentUser = null;
let entitlements = null;

const PAGE_FEATURES = {
  apply: 'aiTailoring',
  interview: 'aiInterview',
  repo: 'repo',
  report: 'exports',
  'llm-config': 'llmConfig',
  admin: 'owner',
};

// Pages that require no feature gate (accessible to all logged-in users)
const PUBLIC_PAGES = new Set([
  'dashboard', 'search', 'evaluate', 'tracker', 'salary', 'profile', 'queries'
]);

function can(feature) {
  if (feature === 'owner') return isOwner();
  // If no feature required for this page, allow access
  if (!feature) return true;
  return !!(entitlements && entitlements.features && entitlements.features[feature]);
}

function requiredPlanFor(feature) {
  if (feature === 'owner') return 'Owner';
  return feature === 'repo' || feature === 'llmConfig' ? 'Team' : 'Pro';
}

function showUpgradeNotice(feature) {
  tAlert(`This page requires the ${requiredPlanFor(feature)} plan.`);
}

/** Escape untrusted values before injecting them into HTML templates. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const esc = escapeHtml;

// ============ Navigation ============
document.querySelectorAll('.nav-item').forEach(item => {
  if (item.dataset.external === 'true') return;
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    if (page === 'admin' && !isOwner()) return;
    const feature = PAGE_FEATURES[page];
    if (!can(feature)) {
      showUpgradeNotice(feature);
      return;
    }
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    currentPage = page;
    renderPage();
  });
});

function isOwner() {
  return !!(currentUser && currentUser.plan === 'owner');
}

function applyAccessRules() {
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    const feature = PAGE_FEATURES[item.dataset.page];
    const allowed = can(feature);
    item.classList.toggle('nav-locked', !allowed);
    item.title = allowed ? '' : `Requires ${requiredPlanFor(feature)} plan`;
  });
  const adminNav = document.getElementById('admin-nav-item');
  if (adminNav) adminNav.hidden = !isOwner();
}

function renderPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="display:flex;justify-content:center;padding:40px"><div class="loader"></div></div>';
  
  switch (currentPage) {
    case 'dashboard': renderDashboard(); break;
    case 'search': renderSearch(); break;
    case 'evaluate': renderEvaluate(); break;
    case 'apply': renderApply(); break;
    case 'tracker': renderTracker(); break;
    case 'interview': renderInterview(); break;
    case 'salary': renderSalary(); break;
    case 'profile': renderProfile(); break;
    case 'queries': renderQueries(); break;
    case 'repo': renderRepo(); break;
    case 'report': renderReport(); break;
    case 'llm-config': renderLLMConfig(); break;
    case 'admin': renderAdminPanel(); break;
  }
}

window.renderPage = renderPage;

// ============ Dashboard ============
async function renderDashboard() {
  const [stats, profile] = await Promise.all([API.get('stats'), API.get('profile')]);
  profileData = profile;
  updateProfileStatus(stats.profileComplete);

  const statusColors = {
    Drafted: 'var(--neutral)', Active: 'var(--info)', Interview: 'var(--warning)',
    Offer: 'var(--accent-3)', Hired: 'var(--success)', 'Rejected/Closed': 'var(--danger)'
  };

  document.getElementById('page-content').innerHTML = `
    <h1 class="page-title">Dashboard</h1>
    <p class="page-subtitle">Overview of your job search pipeline</p>

    <div class="grid grid-6" style="margin-bottom:20px">
      <div class="stat-card active"><div class="stat-num">${stats.active}</div><div class="stat-label">Active</div></div>
      <div class="stat-card drafted"><div class="stat-num">${stats.drafted}</div><div class="stat-label">Drafted</div></div>
      <div class="stat-card interview"><div class="stat-num">${stats.interview}</div><div class="stat-label">Interview</div></div>
      <div class="stat-card offer"><div class="stat-num">${stats.offer}</div><div class="stat-label">Offer</div></div>
      <div class="stat-card hired"><div class="stat-num">${stats.hired}</div><div class="stat-label">Hired</div></div>
      <div class="stat-card rejected"><div class="stat-num">${stats.rejected}</div><div class="stat-label">Rejected</div></div>
    </div>
    ${stats.urgentDeadlines > 0 ? `
    <div class="alert alert-warning" style="margin-bottom:16px;padding:12px 16px">
      <strong>${stats.urgentDeadlines} application${stats.urgentDeadlines === 1 ? ' has' : 's have'} deadline in the next 7 days</strong>. Check your Tracker page and follow up before they expire.
    </div>` : ''}

    <div class="grid grid-2">
      <div class="chart-container">
        <div class="chart-title">Application Funnel</div>
        ${renderFunnel(stats.funnel, stats.totalApplications)}
      </div>
      <div class="chart-container">
        <div class="chart-title">Profile Completion</div>
        <div style="text-align:center;padding:20px">
          <div class="score-circle ${stats.profileComplete >= 75 ? 'strong' : stats.profileComplete >= 50 ? 'good' : stats.profileComplete >= 25 ? 'moderate' : 'weak'}" 
               style="width:80px;height:80px;font-size:24px;margin:0 auto 12px">
            ${stats.profileComplete}%
          </div>
          <p style="color:var(--muted);font-size:13px">${stats.profileComplete >= 75 ? 'Profile ready for applications' : 'Complete your profile to improve results'}</p>
          <button class="btn btn-primary btn-sm" onclick="document.querySelector('[data-page=profile]').click()" style="margin-top:8px">Edit Profile</button>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="chart-container">
        <div class="chart-title">By Sector</div>
        ${renderBarChart(stats.sectors)}
      </div>
      <div class="chart-container">
        <div class="chart-title">By Channel</div>
        ${renderBarChart(stats.channels)}
      </div>
    </div>

    <div class="grid grid-3" style="margin-top:16px">
      <div class="stat-card"><div class="stat-num">${stats.totalApplications}</div><div class="stat-label">Total Applications Sent</div></div>
      <div class="stat-card"><div class="stat-num">${stats.seenJobs}</div><div class="stat-label">Jobs Discovered</div></div>
      <div class="stat-card"><div class="stat-num">${stats.funnelRate}%</div><div class="stat-label">Funnel Rate (Past Resume Screen)</div></div>
    </div>
  `;
}

function renderFunnel(funnel, total) {
  if (!funnel || total === 0) return '<div class="empty-state">No applications yet</div>';
  const steps = [
    { label: 'Applied', value: funnel.applied, color: 'var(--info)' },
    { label: 'Interview', value: funnel.interview, color: 'var(--warning)' },
    { label: 'Offer', value: funnel.offer, color: 'var(--accent-3)' },
    { label: 'Hired', value: funnel.hired, color: 'var(--success)' },
  ];
  return steps.map(s => {
    const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
    return `<div class="funnel-step">
      <div class="funnel-label">${s.label}</div>
      <div class="funnel-bar"><div class="funnel-fill" style="width:${Math.max(pct, s.value > 0 ? 8 : 0)}%;background:${s.color}">${s.value} (${pct}%)</div></div>
    </div>`;
  }).join('');
}

function renderBarChart(data) {
  if (!data || Object.keys(data).length === 0) return '<div class="empty-state">No data</div>';
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(e => e[1]));
  const colors = ['var(--accent)', 'var(--info)', 'var(--warning)', 'var(--accent-3)', 'var(--success)', 'var(--danger)'];
  return entries.map((e, i) => {
    const pct = max > 0 ? Math.round((e[1] / max) * 100) : 0;
    return `<div class="funnel-step">
      <div class="funnel-label" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e[0]}</div>
      <div class="funnel-bar"><div class="funnel-fill" style="width:${pct}%;background:${colors[i % colors.length]}">${e[1]}</div></div>
    </div>`;
  }).join('');
}

function updateProfileStatus(pct) {
  const ring = document.getElementById('status-ring');
  if (ring) {
    ring.style.background = `conic-gradient(var(--accent) ${pct * 3.6}deg, rgba(255,255,255,0.1) 0deg)`;
  }
  const pctEl = document.getElementById('profile-pct');
  if (pctEl) pctEl.textContent = pct + '%';
}

// ============ Job Search ============
// Job Search is always scoped to the location in Candidate Profile.
const JOB_LOCATION_COUNTRY = [
  ['thailand', /thailand|bangkok|chiang mai|phuket/i],
  ['malaysia', /malaysia|kuala lumpur|\bkl\b|penang/i],
  ['vietnam', /viet ?nam|ho chi minh|hanoi|\bhn\b|danang/i],
  ['china', /china|beijing|shanghai|shenzhen|guangzhou|hangzhou/i],
  ['singapore', /singapore/i],
  ['japan', /japan|tokyo/i],
  ['united kingdom', /uk|united kingdom|london|england/i],
  ['united states', /usa|united states|new york|san francisco/i],
];
function detectJobCountry(location) {
  const text = String(location || '');
  for (const [country, re] of JOB_LOCATION_COUNTRY) if (re.test(text)) return country;
  return '';
}
function jobMatchesProfileLocation(job) {
  const profileLoc = String(window._jobProfileLocation || '').trim().toLowerCase();
  if (!profileLoc) return true;
  const jobLoc = String((job && job.location) || '').trim().toLowerCase();
  if (!jobLoc) return true; // unknown location: keep but sort after local matches
  const tokens = [...new Set(profileLoc.split(/[,/|]+|\s+/).map(t => t.trim()).filter(t => t.length > 1))];
  const country = detectJobCountry(profileLoc);
  if (country) tokens.push(country);
  if (tokens.some(t => jobLoc.includes(t) || (t.includes(jobLoc) && jobLoc.length > 2))) return true;
  return /remote|anywhere|worldwide|work from home|telecommute/i.test(jobLoc);
}
function locationRank(job) {
  const profileLoc = String(window._jobProfileLocation || '').trim().toLowerCase();
  if (!profileLoc) return 0;
  const jobLoc = String((job && job.location) || '').trim().toLowerCase();
  if (!jobLoc) return 1;
  const tokens = [...new Set(profileLoc.split(/[,/|]+|\s+/).map(t => t.trim()).filter(t => t.length > 1))];
  const country = detectJobCountry(profileLoc);
  if (country) tokens.push(country);
  if (tokens.some(t => jobLoc.includes(t) || (t.includes(jobLoc) && jobLoc.length > 2))) return 2;
  return /remote|anywhere|worldwide|work from home|telecommute/i.test(jobLoc) ? 1 : 0;
}

async function renderSearch() {
  const [discovered, searchQueries, profile] = await Promise.all([
    API.get('jobs/discovered'),
    API.get('search-queries'),
    API.get('profile')
  ]);

  const queries = searchQueries.priorities || [];
  const profileLocation = (profile.identity && profile.identity.location) || '';
  window._jobProfileLocation = profileLocation;
  window._allSeenJobs = discovered.all || [];
  window._matchedSeenJobs = discovered.matched || [];
  window._jobProfileCriteria = discovered.criteria || {};
  window._showAllJobs = false;
  const countryLabel = detectJobCountry(profileLocation);
  const criteria = window._jobProfileCriteria;
  const defaultKeywords = (profile.searchConfig && profile.searchConfig.roleTitles || [])[0]
    || (criteria.roles || [])[0] || '';
  const criteriaSummary = [
    (criteria.roles || []).length ? `${criteria.roles.length} target roles` : '',
    (criteria.skills || []).length ? `${criteria.skills.length} skills` : '',
    (criteria.companies || []).length ? `${criteria.companies.length} target companies` : '',
  ].filter(Boolean).join(' · ') || 'no profile criteria';

  document.getElementById('page-content').innerHTML = `
    <h1 class="page-title">Job Search</h1>
    <p class="page-subtitle">Only jobs matching your profile are listed</p>

    <div class="alert alert-info" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <strong>Active location:</strong> ${profileLocation ? escapeHtml(tr(profileLocation)) : '<em>not set</em>'}
          ${countryLabel ? ` <span class="badge badge-active">${escapeHtml(tr(countryLabel))}</span>` : ''}
          <div style="font-size:12px;margin-top:3px">Matching against: ${escapeHtml(tr(criteriaSummary))}. Only jobs with a profile match and a matching location are listed.</div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="document.querySelector('[data-page=profile]').click()">Change in Profile</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-title" style="margin-bottom:6px">📍 Job Sites for Your Location</div>
      <p style="color:var(--muted);font-size:13px;margin:0 0 6px">Based on your profile location, these are the relevant job websites. Click any link to open a live search in your browser (works even on sites that block automated access).</p>
      <p style="color:var(--muted);font-size:12px;margin:0 0 12px">Set your location in <a href="#" onclick="document.querySelector('[data-page=profile]').click()">Candidate Profile → Identity</a> to change these suggestions.</p>
      <div class="form-group" style="max-width:420px">
        <label>Keywords for site search links</label>
        <input type="text" class="form-input" id="site-keywords" placeholder="e.g. Import Export Manager" value="${escapeHtml(defaultKeywords)}" oninput="loadJobSites()">
      </div>
      <div id="job-sites-list"><div style="padding:12px"><div class="loader" style="display:inline-block"></div> Loading sites...</div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-title" style="margin-bottom:6px">🔍 Search Live Job APIs</div>
      <p style="color:var(--muted);font-size:13px;margin:0 0 12px">Searches live listings from RemoteOK and Arbeitnow (public APIs) and saves matching jobs</p>
      <div class="form-group">
        <label>Keywords</label>
        <input type="text" class="form-input" id="search-keywords" placeholder="e.g. Python, Data Scientist, Engineer"
               value="${escapeHtml(defaultKeywords)}">
      </div>
      <button class="btn btn-primary" onclick="performSearch()">Search Live Jobs</button>
      <button class="btn btn-secondary btn-sm" style="margin-left:8px" onclick="saveCurrentAsQuery()" title="Save current keywords as a searchable priority">💾 Save As Query</button>
      <div id="search-results" style="margin-top:16px"></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-title" style="margin-bottom:6px">🔗 Extract Jobs from a URL</div>
      <p style="color:var(--muted);font-size:13px;margin:0 0 12px">Paste a job board URL — the system tries multiple methods to retrieve listings. If a site blocks automated access (HTTP 403), it automatically falls back to a text proxy and a related job-news search, and always gives you a direct browser link.</p>
      <div class="form-group">
        <label>Job Page URL</label>
        <input type="url" class="form-input" id="search-url" placeholder="https://www.jobthai.com/en/job/list  or  https://boards.greenhouse.io/companyname">
      </div>
      <button class="btn btn-secondary" onclick="retrieveJobsFromUrl()">Extract Jobs from URL</button>
      <div id="url-results" style="margin-top:16px"></div>
      <details style="margin-top:14px;border-top:1px solid var(--stroke);padding-top:12px">
        <summary style="cursor:pointer;font-weight:600;color:var(--accent)">Sites blocking access? Paste the job listings text instead</summary>
        <p style="color:var(--muted);font-size:13px;margin:8px 0">Open the site in your browser, select and copy the job listings (titles + company names), then paste below.</p>
        <textarea class="form-textarea" id="paste-jobs-text" rows="10" placeholder="Senior Python Engineer&#10;Acme Corp | London, UK&#10;Data Scientist&#10;TechCo | Remote"></textarea>
        <button class="btn btn-secondary" style="margin-top:8px" onclick="parsePastedJobs()">Extract Jobs from Text</button>
        <div id="paste-results" style="margin-top:12px"></div>
      </details>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-title" style="margin-bottom:6px">⚙️ Add Your Own Job Website</div>
      <p style="color:var(--muted);font-size:13px;margin:0 0 12px">Add a job site you want to search. Use <code>{q}</code> for keywords and <code>{l}</code> for location in the URL, e.g. <code>https://example.com/jobs?q={q}&location={l}</code></p>
      <div class="grid grid-2">
        <div class="form-group"><label>Site Name</label><input type="text" class="form-input" id="custom-site-name" placeholder="e.g. My Local Jobs"></div>
        <div class="form-group"><label>Search URL Template</label><input type="text" class="form-input" id="custom-site-url" placeholder="https://example.com/jobs?q={q}&location={l}"></div>
      </div>
      <button class="btn btn-primary" onclick="addCustomSite()">Add Website</button>
      <div id="custom-sites-list" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <div class="card-header" style="margin-bottom:12px">
        <div class="card-title" id="discovered-title">Discovered Jobs</div>
        <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:5px;cursor:pointer">
          <input type="checkbox" id="show-all-jobs" onchange="window._showAllJobs=this.checked; renderDiscoveredJobs()"> Show all locations
        </label>
      </div>
      <div id="discovered-jobs-container"></div>
    </div>

    ${queries.length > 0 ? `<div class="card">
      <div class="card-title" style="margin-bottom:12px">Configured Search Priorities</div>
      ${queries.map((q, i) => `<div style="padding:8px 0;border-bottom:1px solid var(--stroke)">
        <strong>Priority ${i + 1}: ${escapeHtml(q.name || 'Unnamed')}</strong><br>
        <span style="font-size:13px;color:var(--muted)">${escapeHtml((q.terms || []).join(', '))}</span>
      </div>`).join('')}
    </div>` : ''}
  `;

  // Load location-based job sites and custom sites
  renderDiscoveredJobs();
  loadJobSites();
  loadCustomSites();
}

function renderDiscoveredJobs() {
  const container = document.getElementById('discovered-jobs-container');
  if (!container) return;
  const all = window._allSeenJobs || [];
  const matched = window._matchedSeenJobs || [];
  const location = window._jobProfileLocation || '';
  const showAll = window._showAllJobs === true;
  const jobs = (showAll ? all.slice() : matched.slice())
    .sort((a, b) => ((b.profileMatch && b.profileMatch.score) || 0) - ((a.profileMatch && a.profileMatch.score) || 0)
      || locationRank(b) - locationRank(a)
      || String(b.first_seen || '').localeCompare(String(a.first_seen || '')));

  const title = document.getElementById('discovered-title');
  if (title) {
    title.textContent = showAll
      ? `All discovered jobs (${jobs.length})`
      : `Discovered jobs matching your profile (${jobs.length})`;
  }
  if (!jobs.length) {
    container.innerHTML = `<div class="empty-state">${all.length
      ? `No discovered jobs match your profile and ${escapeHtml(location || 'your location')} yet. Run a search above or tick "Show all locations".`
      : 'No jobs discovered yet. Run a search above.'}</div>`;
    return;
  }
  container.innerHTML = `
    ${!showAll && all.length > jobs.length ? `<div style="font-size:12px;color:var(--muted);margin-bottom:8px">Showing ${jobs.length} of ${all.length} location-matched jobs that also match your profile. Best matches are listed first.</div>` : ''}
    <div class="table-container"><table>
      <tr><th>Title</th><th>Company</th><th>Location</th><th>Why it matches</th><th>Fit</th><th>Source</th><th>Date</th><th>Action</th></tr>
      ${jobs.map(j => `<tr>
        <td>${j.url ? `<a href="${escapeHtml(j.url)}" target="_blank" rel="noopener">${escapeHtml(j.title || '-')}</a>` : escapeHtml(j.title || '-')}</td>
        <td>${escapeHtml(j.company || '-')}</td>
        <td>${escapeHtml(tr(j.location || '-'))}</td>
        <td style="font-size:11px;color:var(--muted);max-width:260px">${escapeHtml((j.profileMatch && j.profileMatch.reasons || []).join(' · ') || '-')}</td>
        <td><span class="badge badge-${j.fit || 'draft'}">${escapeHtml(tr(j.fit || '-'))}</span></td>
        <td>${escapeHtml(j.source || '-')}</td>
        <td>${j.first_seen || '-'}</td>
        <td><button class="btn btn-primary btn-sm" onclick="evaluateFromSearch('${encodeURIComponent(j.title || '')}','${encodeURIComponent(j.company || '')}','${encodeURIComponent(j.description || '')}')">Evaluate</button></td>
      </tr>`).join('')}
    </table></div>`;
}

async function loadJobSites() {
  const container = document.getElementById('job-sites-list');
  if (!container) return;
  const keywords = document.getElementById('site-keywords')?.value || '';
  try {
    const result = await API.post('jobs/sites', { keywords, location: window._jobProfileLocation || '' });
    window._jobProfileCountry = result.country || '';
    const countryLabel = result.country ? result.country.replace(/\b\w/g, c => c.toUpperCase()) : 'Global';
    const sites = result.sites || [];
    container.innerHTML = `
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Detected region: <strong>${escapeHtml(tr(countryLabel))}</strong> · ${sites.length} job sites</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${sites.map(s => `
          <div style="border:1px solid var(--stroke);border-radius:8px;padding:10px 12px;min-width:180px;background:${s.custom ? 'var(--success-soft)' : 'var(--panel)'}">
            <div style="font-weight:600;font-size:13px;margin-bottom:2px">${escapeHtml(s.name)} ${s.custom ? '<span style="font-size:10px;color:var(--success)">custom</span>' : ''}</div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:6px">${s.tier === 1 ? 'Major site' : 'Additional site'}</div>
            <div style="display:flex;gap:6px">
              <a class="btn btn-primary btn-sm" href="${escapeHtml(s.searchUrl)}" target="_blank" rel="noopener" style="text-decoration:none">Open Search ↗</a>
              <button class="btn btn-secondary btn-sm" onclick="retrieveFromSite('${escapeHtml(s.searchUrl)}')">Fetch Jobs</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Could not load job sites: ${escapeHtml(e.message)}</div>`;
  }
}

async function retrieveFromSite(url) {
  document.getElementById('search-url').value = url;
  retrieveJobsFromUrl({ strictSite: true });
  document.getElementById('url-results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadCustomSites() {
  const container = document.getElementById('custom-sites-list');
  if (!container) return;
  try {
    const sites = await API.get('jobs/custom-sites');
    if (!Array.isArray(sites) || !sites.length) {
      container.innerHTML = '<p style="color:var(--muted);font-size:13px;margin:0">No custom websites added yet.</p>';
      return;
    }
    container.innerHTML = sites.map((s, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border:1px solid var(--stroke);border-radius:6px;margin-bottom:6px">
        <div><strong style="font-size:13px">${escapeHtml(s.name)}</strong><br><code style="font-size:11px;color:var(--muted)">${escapeHtml(s.url)}</code></div>
        <button class="btn btn-danger btn-sm" onclick="removeCustomSite(${i})">Remove</button>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Could not load custom sites: ${escapeHtml(e.message)}</div>`;
  }
}

async function addCustomSite() {
  const name = document.getElementById('custom-site-name').value.trim();
  const url = document.getElementById('custom-site-url').value.trim();
  if (!name || !url) { tAlert('Please enter both site name and URL.'); return; }
  const result = await API.post('jobs/custom-sites', { name, url });
  if (!result.ok) { tAlert(result.error || 'Could not add site'); return; }
  document.getElementById('custom-site-name').value = '';
  document.getElementById('custom-site-url').value = '';
  loadCustomSites();
  loadJobSites();
  showSaved();
}

async function removeCustomSite(id) {
  showConfirmModal('Remove this custom job website?', async () => {
    await API.del(`jobs/custom-sites/${id}`);
    loadCustomSites();
    loadJobSites();
  });
}

async function performSearch() {
  const keywords = document.getElementById('search-keywords').value.trim();
  const resultsDiv = document.getElementById('search-results');
  resultsDiv.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:12px"><div class="loader"></div> Searching live job boards...</div>';

  try {
    const result = await API.post('jobs/search', { keywords, limit: 40, location: window._jobProfileLocation || '' });
    if (!result.ok && !result.jobs?.length) {
      resultsDiv.innerHTML = `<div class="alert alert-danger">Search failed: ${escapeHtml(result.error || 'Unknown error')}</div>`;
      return;
    }
    const jobs = result.jobs || [];
    if (jobs.length === 0) {
      resultsDiv.innerHTML = `<div class="alert alert-warning">No live jobs for "${escapeHtml(keywords)}" matched your profile and ${escapeHtml(tr(window._jobProfileLocation || 'your location'))}. Try broader keywords or update your profile roles/skills.</div>`;
      return;
    }
    const errNote = (result.errors && result.errors.length)
      ? `<div class="alert alert-warning" style="font-size:12px;margin-top:8px">Some sources were unavailable: ${escapeHtml(result.errors.join('; '))}</div>` : '';
    resultsDiv.innerHTML = `
      <div class="alert alert-success">Found ${jobs.length} live job postings matching your profile and <strong>${escapeHtml(result.location || window._jobProfileLocation || 'your location')}</strong>${result.profileMatched !== undefined ? ` (${result.profileMatched} of ${result.profileTotal} location-matched jobs passed the profile filter)` : ''}${result.errors?.length ? ' (some sources unavailable)' : ''}. Click "Save & Evaluate" to score a job against your profile.</div>
      <div class="table-container" style="margin-top:12px;max-height:420px;overflow:auto">
        <table>
          <tr><th>Title</th><th>Company</th><th>Location</th><th>Source</th><th>Action</th></tr>
          ${jobs.map((r, idx) => `<tr>
            <td>${r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>` : escapeHtml(r.title)}</td>
            <td>${escapeHtml(r.company)}</td>
            <td>${escapeHtml(r.location || '-')}</td>
            <td>${escapeHtml(r.source || '-')}</td>
            <td><button class="btn btn-primary btn-sm" onclick="saveLiveJob(${idx})">Save & Evaluate</button></td>
          </tr>`).join('')}
        </table>
      </div>
      ${errNote}
    `;
    window._liveSearchJobs = jobs;
  } catch (e) {
    resultsDiv.innerHTML = `<div class="alert alert-danger">Search failed: ${escapeHtml(e.message)}</div>`;
  }
}

async function retrieveJobsFromUrl(options = {}) {
  const url = document.getElementById('search-url').value.trim();
  const resultsDiv = document.getElementById('url-results');
  if (!url) {
    resultsDiv.innerHTML = '<div class="alert alert-warning">Please enter a URL first.</div>';
    return;
  }
  const keywords = document.getElementById('site-keywords')?.value || document.getElementById('search-keywords')?.value || '';
  resultsDiv.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:12px"><div class="loader"></div> Trying multiple retrieval methods (direct, proxy, fallback)...</div>';

  try {
    const result = await API.post('jobs/retrieve', { url, keywords, location: window._jobProfileLocation || '', strictSite: options.strictSite === true });
    const attemptsHtml = (result.attempts && result.attempts.length)
      ? `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--muted)">Retrieval attempts (${result.attempts.length})</summary><ul style="font-size:12px;color:var(--muted);margin:6px 0 0;padding-left:18px">${result.attempts.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul></details>` : '';
    const browserLink = result.browserUrl ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(result.browserUrl)}" target="_blank" rel="noopener" style="text-decoration:none;margin-top:8px;display:inline-block">Open Site in Browser ↗</a>` : '';

    if (!result.ok || !result.jobs?.length) {
      resultsDiv.innerHTML = `
        <div class="alert alert-warning">
          <strong>Could not automatically retrieve listings</strong><br>${escapeHtml(result.error || 'Unknown error')}
          <div style="margin-top:8px">${browserLink} ${result.strictSite ? '<button class="btn btn-primary btn-sm" onclick="findSimilarJobs()" style="margin-left:6px">Find similar jobs on public boards</button>' : ''}</div>
          ${attemptsHtml}
        </div>`;
      return;
    }
    const jobs = result.jobs;
    resultsDiv.innerHTML = `
      <div class="alert alert-success">Found ${jobs.length} listing(s) from this site matching your profile and <strong>${escapeHtml(result.location || window._jobProfileLocation || 'your location')}</strong>${result.profileMatched !== undefined ? ` (${result.profileMatched} of ${result.profileTotal} matched)` : ''}. ${result.addedToSeen ? `${result.addedToSeen} new job(s) added to Discovered Jobs.` : ''}
        ${result.note ? `<br><span style="font-size:12px">${escapeHtml(result.note)}</span>` : ''}
      </div>
      <div style="margin-bottom:8px">${browserLink}</div>
      <div class="table-container" style="max-height:360px;overflow:auto">
        <table>
          <tr><th>Title</th><th>Company</th><th>Location</th><th>Source</th><th>Action</th></tr>
          ${jobs.map((r, idx) => `<tr>
            <td>${r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>` : escapeHtml(r.title)}</td>
            <td>${escapeHtml(r.company || '-')}</td>
            <td>${escapeHtml(r.location || '-')}</td>
            <td>${escapeHtml(r.source || '-')}</td>
            <td><button class="btn btn-primary btn-sm" onclick="saveLiveJob(${idx}, 'url')">Save & Evaluate</button></td>
          </tr>`).join('')}
        </table>
      </div>
      ${attemptsHtml}
    `;
    window._urlSearchJobs = jobs;
  } catch (e) {
    resultsDiv.innerHTML = `<div class="alert alert-danger">Fetch failed: ${escapeHtml(e.message)}</div>`;
  }
}

// Explicitly generic search — never presented as listings from a specific site.
async function findSimilarJobs() {
  const keywords = document.getElementById('site-keywords')?.value || document.getElementById('search-keywords')?.value || '';
  const input = document.getElementById('search-keywords');
  if (input) input.value = keywords;
  const results = document.getElementById('search-results');
  if (results) results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  await performSearch();
}

async function fetchJobsFromUrl() {
  const url = document.getElementById('search-url').value.trim();
  const resultsDiv = document.getElementById('url-results');
  if (!url) {
    resultsDiv.innerHTML = '<div class="alert alert-warning">Please enter a URL first.</div>';
    return;
  }
  resultsDiv.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:12px"><div class="loader"></div> Fetching and analyzing the page...</div>';

  try {
    const result = await API.post('jobs/fetch-url', { url, location: window._jobProfileLocation || '' });
    if (!result.ok) {
      resultsDiv.innerHTML = `
        <div class="alert alert-warning">
          <strong>Could not extract jobs</strong><br>${escapeHtml(result.error || 'Unknown error')}
          ${result.blocked ? '<br><span style="font-size:12px">Tip: Sites like JobStreet/Indeed require a browser session. Copy a Greenhouse or Lever careers URL instead, or use the keyword search above.</span>' : ''}
        </div>`;
      return;
    }
    const jobs = result.jobs || [];
    if (!jobs.length) {
      resultsDiv.innerHTML = '<div class="alert alert-warning">The page was fetched but no job listings were detected. This can happen if the site loads jobs dynamically with JavaScript.</div>';
      return;
    }
    resultsDiv.innerHTML = `
      <div class="alert alert-success">Extracted ${jobs.length} job listing(s) matching <strong>${escapeHtml(result.location || window._jobProfileLocation || 'your location')}</strong> from the page. ${result.addedToSeen ? `${result.addedToSeen} new job(s) added to Discovered Jobs.` : 'All jobs were already discovered.'}</div>
      <div class="table-container" style="margin-top:12px;max-height:360px;overflow:auto">
        <table>
          <tr><th>Title</th><th>Company</th><th>Location</th><th>Action</th></tr>
          ${jobs.map((r, idx) => `<tr>
            <td>${r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>` : escapeHtml(r.title)}</td>
            <td>${escapeHtml(r.company || '-')}</td>
            <td>${escapeHtml(r.location || '-')}</td>
            <td><button class="btn btn-primary btn-sm" onclick="saveLiveJob(${idx}, 'url')">Save & Evaluate</button></td>
          </tr>`).join('')}
        </table>
      </div>
    `;
    window._urlSearchJobs = jobs;
  } catch (e) {
    resultsDiv.innerHTML = `<div class="alert alert-danger">Fetch failed: ${escapeHtml(e.message)}</div>`;
  }
}

async function saveLiveJob(index, source) {
  const jobs = source === 'url' ? (window._urlSearchJobs || [])
    : source === 'paste' ? (window._pasteSearchJobs || [])
    : (window._liveSearchJobs || []);
  const j = jobs[index];
  if (!j) return;
  await API.post('seen-jobs', {
    title: j.title, company: j.company, location: j.location,
    url: j.url, source: j.source || 'url', fit: j.fit || '',
    status: 'new', description: (j.description || '').substring(0, 2000),
  });
  goEvaluate(j);
}

async function parsePastedJobs() {
  const text = document.getElementById('paste-jobs-text').value.trim();
  const resultsDiv = document.getElementById('paste-results');
  if (!text) { resultsDiv.innerHTML = '<div class="alert alert-warning">Paste some job listings text first.</div>'; return; }
  resultsDiv.innerHTML = '<div style="padding:12px"><div class="loader" style="display:inline-block"></div> Parsing text...</div>';
  try {
    const result = await API.post('jobs/parse-text', { text, location: window._jobProfileLocation || '' });
    if (!result.ok || !result.jobs?.length) {
      resultsDiv.innerHTML = `<div class="alert alert-warning">${escapeHtml(result.error || 'No job listings detected. Try including job titles on their own lines.')}</div>`;
      return;
    }
    const jobs = result.jobs;
    resultsDiv.innerHTML = `
      <div class="alert alert-success">Detected ${jobs.length} job(s) matching your profile and <strong>${escapeHtml(result.location || window._jobProfileLocation || 'your location')}</strong>${result.profileMatched !== undefined ? ` (${result.profileMatched} of ${result.profileTotal} matched)` : ''}. ${result.addedToSeen ? `${result.addedToSeen} new job(s) added.` : ''}</div>
      <div class="table-container" style="margin-top:8px;max-height:300px;overflow:auto">
        <table><tr><th>Title</th><th>Company</th><th>Location</th><th>Action</th></tr>
          ${jobs.map((r, idx) => `<tr>
            <td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.company || '-')}</td><td>${escapeHtml(r.location || '-')}</td>
            <td><button class="btn btn-primary btn-sm" onclick="saveLiveJob(${idx}, 'paste')">Save & Evaluate</button></td>
          </tr>`).join('')}
        </table>
      </div>`;
    window._pasteSearchJobs = jobs;
  } catch (e) {
    resultsDiv.innerHTML = `<div class="alert alert-danger">Parse failed: ${escapeHtml(e.message)}</div>`;
  }
}

function goEvaluate(j) {
  document.querySelector('[data-page=evaluate]').click();
  setTimeout(() => {
    const ta = document.getElementById('eval-posting');
    if (ta) ta.value = `Job Title: ${j.title || ''}\nCompany: ${j.company || ''}\nLocation: ${j.location || ''}\n\n${(j.description || '').substring(0, 3000)}`;
  }, 120);
}

// Backwards-compatible handler used by the Discovered Jobs table
function evaluateFromSearch(title, company, description) {
  goEvaluate({
    title: decodeURIComponent(title || ''),
    company: decodeURIComponent(company || ''),
    description: decodeURIComponent(description || ''),
  });
}

// ============ Evaluate Fit ============
async function renderEvaluate() {
  document.getElementById('page-content').innerHTML = `
    <h1 class="page-title">Evaluate Job Fit</h1>
    <p class="page-subtitle">Paste a job posting to evaluate it against your profile using the 5-dimension scoring framework</p>

    <div class="card">
      <div class="form-group">
        <label>Job Posting (URL or full text)</label>
        <textarea class="form-textarea" id="eval-posting" rows="12" placeholder="Paste the full job posting text here, or a job posting URL..."></textarea>
      </div>
      <button class="btn btn-primary" onclick="runEvaluation()">Evaluate Fit</button>
    </div>

    <div id="eval-results"></div>
  `;
}

async function runEvaluation() {
  const posting = document.getElementById('eval-posting').value.trim();
  if (!posting) return;

  const resultsDiv = document.getElementById('eval-results');
  resultsDiv.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:20px"><div class="loader"></div> Evaluating fit...</div>';

  const result = await API.post('evaluate', { posting });

  const scoreClass = result.overall >= 75 ? 'strong' : result.overall >= 60 ? 'good' : result.overall >= 45 ? 'moderate' : result.overall >= 30 ? 'weak' : 'poor';

  // Helper to render reason bullets with color coding
  const reasonList = (reasons) => (reasons && reasons.length)
    ? `<ul style="list-style:none;padding:0;margin:6px 0 0">
        ${reasons.map(r => {
          const icon = r.type === 'fit' ? '✓' : r.type === 'unfit' ? '✗' : 'ℹ';
          const color = r.type === 'fit' ? 'var(--success)' : r.type === 'unfit' ? 'var(--danger)' : 'var(--muted)';
          return `<li style="display:flex;gap:8px;margin-bottom:5px;font-size:13px;line-height:1.4">
            <span style="color:${color};font-weight:700;flex-shrink:0">${icon}</span>
            <span>${escapeHtml(r.text)}</span>
          </li>`;
        }).join('')}
      </ul>`
    : '<p style="font-size:13px;color:var(--muted);margin:6px 0">No specific detail available.</p>';

  const dimCard = (title, score, weight, dim) => `
    <div style="border:1px solid var(--stroke);border-radius:8px;padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <strong style="font-size:14px">${title} <span style="font-weight:400;color:var(--muted);font-size:12px">(${weight})</span></strong>
        <span class="badge ${score >= 70 ? 'badge-hired' : score >= 45 ? 'badge-interview' : 'badge-rejected'}">${score}/100</span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px">${escapeHtml(dim.note || '')}</div>
      ${reasonList(dim.reasons)}
    </div>
  `;

  resultsDiv.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;gap:20px;margin-bottom:12px">
        <div class="score-circle ${scoreClass}" style="width:72px;height:72px;font-size:22px">${result.overall}</div>
        <div>
          <div style="font-size:20px;font-weight:700">${result.verdict}</div>
          <div style="color:var(--muted);font-size:14px">Overall Fit Score: ${result.overall}/100</div>
        </div>
      </div>

      <div class="alert alert-info" style="font-size:13px;margin-bottom:16px"><strong>Summary:</strong> ${escapeHtml(result.summary || '')}</div>

      ${result.eligibilityGate.verdict !== 'PASS' ? `<div class="alert alert-warning"><strong>Eligibility ${result.eligibilityGate.verdict}:</strong> ${escapeHtml(result.eligibilityGate.note)}${reasonList(result.eligibilityGate.reasons)}</div>` : ''}
      ${result.languageGate.verdict === 'FAIL' ? `<div class="alert alert-danger"><strong>Language Gate FAILED:</strong> ${escapeHtml(result.languageGate.note)}${reasonList(result.languageGate.reasons)}</div>` : ''}

      <h3 style="font-size:15px;margin:18px 0 10px">Detailed Scoring Breakdown</h3>
      ${dimCard('Technical Skills', result.evaluation.technicalSkills.score, '30% weight', result.evaluation.technicalSkills)}
      ${dimCard('Experience Match', result.evaluation.experienceMatch.score, '25% weight', result.evaluation.experienceMatch)}

      <div style="border:1px solid var(--stroke);border-radius:8px;padding:14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <strong style="font-size:14px">Location <span style="font-weight:400;color:var(--muted);font-size:12px">(Pass/Fail gate)</span></strong>
          <span class="badge ${result.evaluation.location.pass ? 'badge-hired' : 'badge-rejected'}">${result.evaluation.location.pass ? 'PASS' : 'FAIL'}</span>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">${escapeHtml(result.evaluation.location.note || '')}</div>
        ${reasonList(result.evaluation.location.reasons)}
      </div>

      ${dimCard('Behavioral Fit', result.evaluation.behavioralFit.score, '15% weight', result.evaluation.behavioralFit)}
      ${dimCard('Career Alignment', result.evaluation.careerAlignment.score, '30% weight', result.evaluation.careerAlignment)}

      <div class="grid grid-2" style="margin-top:16px">
        <div style="border:1px solid rgba(111,240,192,.3);border-radius:8px;padding:14px;background:var(--success-soft)">
          <h3 style="font-size:14px;margin-bottom:8px;color:var(--success)">✓ Why it fits</h3>
          <ul style="font-size:13px;padding-left:18px;margin:0">
            ${result.strengths.map(s => `<li style="margin-bottom:4px">${escapeHtml(s)}</li>`).join('')}
          </ul>
        </div>
        <div style="border:1px solid rgba(255,128,152,.3);border-radius:8px;padding:14px;background:var(--danger-soft)">
          <h3 style="font-size:14px;margin-bottom:8px;color:var(--danger)">✗ Concerns / gaps</h3>
          <ul style="font-size:13px;padding-left:18px;margin:0">
            ${result.gaps.length > 0 ? result.gaps.map(g => `<li style="margin-bottom:4px">${escapeHtml(g)}</li>`).join('') : '<li style="color:var(--success)">No significant gaps detected</li>'}
          </ul>
        </div>
      </div>

      <div style="margin-top:16px">
        <button class="btn btn-primary" onclick="proceedToApply()">Proceed to Apply Workflow</button>
      </div>
    </div>
  `;
}

function proceedToApply() {
  document.querySelector('[data-page=apply]').click();
}

// ============ Apply Workflow ============
async function renderApply() {
  document.getElementById('page-content').innerHTML = `
    <h1 class="page-title">Apply Workflow</h1>
    <p class="page-subtitle">HR-tailored workflow: analyze the posting, review the resume edits, then generate a CV + cover letter built for this role</p>

    <div class="card">
      <div class="card-title" style="margin-bottom:12px">Step 1: Job Details</div>
      <div class="grid grid-2">
        <div class="form-group">
          <label>Company Name</label>
          <input type="text" class="form-input" id="apply-company" placeholder="e.g. Acme Corp">
        </div>
        <div class="form-group">
          <label>Role Title</label>
          <input type="text" class="form-input" id="apply-role" placeholder="e.g. Senior Data Scientist">
        </div>
      </div>
      <div class="form-group">
        <label>Job Posting Text (required for tailoring)</label>
        <textarea class="form-textarea" id="apply-posting" rows="8" placeholder="Paste the full job posting here. The more detail you paste, the better the CV can be tailored..."></textarea>
      </div>
      <button class="btn btn-primary" onclick="analyzeAndTailor()">🔍 Analyze Job & Tailor Resume</button>
    </div>

    <div id="apply-tailoring"></div>
    <div id="apply-results"></div>
  `;
}

// Step 2: HR tailoring review — shows exactly how the resume was reworked.
async function analyzeAndTailor() {
  const company = document.getElementById('apply-company').value.trim();
  const role = document.getElementById('apply-role').value.trim();
  const posting = document.getElementById('apply-posting').value.trim();

  if (!company || !role) { tAlert('Please enter both company name and role title.'); return; }
  if (!posting) { tAlert('Please paste the job posting text so the resume can be tailored to it.'); return; }

  window._applyContext = { company, role, posting };
  const panel = document.getElementById('apply-tailoring');
  panel.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:20px"><div class="loader"></div> HR manager is tailoring your resume to this posting...</div>';

  const language = currentUILanguage();
  const result = await API.post('tailor-resume', { company, role, posting, language });
  if (!result.ok) { panel.innerHTML = `<div class="alert alert-danger">${escapeHtml(result.error || 'Tailoring failed.')}</div>`; return; }
  const r = result.report;
  const sourceBadge = result.source === 'ai'
    ? '<span class="badge badge-active" style="margin-left:8px">AI</span>'
    : (result.warning ? `<span class="badge badge-rejected" style="margin-left:8px">Local fallback: ${escapeHtml(result.warning)}</span>` : '');
  window._tailoringReport = r;

  const localLanguageNotice = result.source !== 'ai' && language !== 'en'
    ? `<div class="alert alert-warning" style="margin-bottom:12px">${escapeHtml(tr('Local template content is in English. Configure a working AI model to generate content in the selected language.'))}</div>`
    : '';
  const coverageColor = r.coverage >= 70 ? 'var(--success)' : (r.coverage >= 40 ? 'var(--warning)' : 'var(--danger, var(--danger))');
  panel.innerHTML = `${localLanguageNotice}
    <div class="card" style="margin-top:16px;border-left:4px solid var(--accent)">
      <div class="card-header" style="align-items:flex-start">
        <div>
          <div class="card-title">Step 2: HR Tailoring Review ${sourceBadge}</div>
          <p style="font-size:13px;color:var(--muted);margin:2px 0 0">How your resume was adjusted for <strong>${escapeHtml(role)}</strong> at <strong>${escapeHtml(company)}</strong></p>
        </div>
        <div style="text-align:center;min-width:90px">
          <div style="font-size:26px;font-weight:800;color:${coverageColor}">${r.coverage}%</div>
          <div style="font-size:11px;color:var(--muted)">requirements matched</div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:8px">
        <div style="border:1px solid rgba(111,240,192,.3);border-radius:8px;padding:12px;background:var(--success-soft)">
          <h3 style="font-size:13px;margin:0 0 8px;color:var(--success)">✓ Competencies highlighted (from your profile)</h3>
          <div style="display:flex;flex-wrap:wrap;gap:5px">
            ${r.matched.length ? r.matched.map(s => `<span class="badge" style="background:var(--accent-soft);color:var(--success)">${escapeHtml(s)}</span>`).join('') : '<span style="font-size:12px;color:var(--muted)">No direct keyword matches — add relevant skills to your profile.</span>'}
          </div>
        </div>
        <div style="border:1px solid rgba(255,128,152,.3);border-radius:8px;padding:12px;background:var(--danger-soft)">
          <h3 style="font-size:13px;margin:0 0 8px;color:var(--danger)">! Requirements to address honestly</h3>
          <p style="font-size:12px;margin:0;color:var(--danger)">${r.missing.length ? escapeHtml(r.missing.join(', ')) : 'All requirements in the posting appear to be covered by your profile.'}</p>
          <p style="font-size:11px;margin:6px 0 0;color:var(--danger)">These were NOT added to your CV as claims — only mention them if they are genuinely true.</p>
        </div>
      </div>

      <div style="margin-top:12px">
        <h3 style="font-size:13px;margin:0 0 6px">What the HR review changed</h3>
        <ul style="font-size:13px;padding-left:18px;margin:0;color:var(--text)">
          ${r.changes.map(c => `<li style="margin-bottom:4px">${escapeHtml(c)}</li>`).join('')}
        </ul>
      </div>

      <div class="form-group" style="margin-top:14px">
        <label>Tailored profile statement <span style="font-weight:normal;color:var(--muted)">(you can refine this before generating)</span></label>
        <textarea class="form-textarea" id="tailor-summary" rows="3">${escapeHtml(r.summary)}</textarea>
      </div>
      <div class="form-group">
        <label>Selected achievements for this role <span style="font-weight:normal;color:var(--muted)">(one per line)</span></label>
        <textarea class="form-textarea" id="tailor-highlights" rows="4">${escapeHtml((r.highlights || []).join('\n'))}</textarea>
      </div>

      <button class="btn btn-primary" onclick="generateDocuments()">Generate Tailored CV & Cover Letter</button>
    </div>
  `;
  document.getElementById('apply-results').innerHTML = '';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function generateDocuments() {
  const company = document.getElementById('apply-company').value.trim();
  const role = document.getElementById('apply-role').value.trim();
  const posting = document.getElementById('apply-posting').value.trim();

  if (!company || !role || !posting) {
    tAlert('Please complete Step 1 (company, role and job posting) first.');
    return;
  }

  const summaryOverride = document.getElementById('tailor-summary')?.value.trim() || '';
  const highlightsOverride = (document.getElementById('tailor-highlights')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const payload = { company, role, posting, summaryOverride, highlightsOverride };

  const resultsDiv = document.getElementById('apply-results');
  resultsDiv.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:20px"><div class="loader"></div> Generating tailored documents...</div>';

  const [cvResult, clResult, cvPreview, clPreview] = await Promise.all([
    API.post('generate-cv', payload),
    API.post('generate-cover-letter', payload),
    API.post('generate-cv-preview', payload),
    API.post('generate-cover-letter-preview', payload),
  ]);

  // Handle generation errors gracefully
  if (!cvResult.ok || !cvResult.tex || !clResult.ok || !clResult.tex) {
    const errMsg = cvResult.error || clResult.error || 'Unknown error during document generation.';
    resultsDiv.innerHTML = `
      <div class="alert alert-danger">
        <strong>Generation failed:</strong> ${escapeHtml(errMsg)}<br>
        <span style="font-size:13px">Please make sure your Candidate Profile is filled in (at least name), then try again.</span>
      </div>
    `;
    return;
  }

  // Store results for preview interactions
  window._generatedDocs = { company, role, cv: cvResult, cl: clResult, cvHtml: cvPreview.html, clHtml: clPreview.html };

  // Also add to tracker as drafted — keep ALL HR-tailoring details + generated
  // doc metadata so they can be revisited from any page.
  const r = window._tailoringReport || {};
  const cvLatex = cvResult.tex || '';
  const clLatex = clResult.tex || '';
  await API.post('tracker', {
    company, role, sector: '', role_type: '', channel: '',
    status: 'drafted', contact_name: '', fitRating: r.coverage?.toString() || '',
    notes: `HR-tailored to this posting (${r.coverage ?? cov ?? 0}% requirements matched). ${r.missing?.length ? 'Missing: ' + r.missing.join(', ') : ''}. Drafted via web workflow`,
    cv_file: `cv/${cvResult.filename}`,
    cover_letter_file: `cover_letters/${clResult.filename}`,
    source: '', deadline: '',
    job_posting: posting,
    // Full tailoring report for review / re-use later
    tailor_coverage: r.coverage,
    tailor_matched: r.matched || [],
    tailor_missing: r.missing || [],
    tailor_summary: r.summary || '',
    tailor_highlights: r.highlights || [],
    tailor_changes: r.changes || [],
    // Generated document sources (LaTeX + rendered HTML previews)
    cv_latex: cvLatex.slice(0, 5000),
    cl_latex: clLatex.slice(0, 5000),
    cv_preview_html: cvPreview.html?.slice(0, 8000) || '',
    cl_preview_html: clPreview.html?.slice(0, 8000) || '',
  });

  resultsDiv.innerHTML = `
    <div class="alert alert-success">
      <strong>Tailored documents generated!</strong> The CV and cover letter are written for <strong>${escapeHtml(role)}</strong> at <strong>${escapeHtml(company)}</strong> using your real experience, reordered to match the posting. Saved as drafted in your tracker.
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--panel);border-bottom:1px solid var(--stroke);padding:8px 14px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;gap:6px">
          <button class="btn btn-primary btn-sm" id="tab-btn-cv" onclick="switchDocPreview('cv')">📄 CV</button>
          <button class="btn btn-secondary btn-sm" id="tab-btn-cl" onclick="switchDocPreview('cl')">✉️ Cover Letter</button>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm" onclick="printGeneratedDoc()">🖨️ Print / Save as PDF</button>
          <button class="btn btn-secondary btn-sm" onclick="openGeneratedDoc()">↗️ Open Full Page</button>
          <button class="btn btn-primary btn-sm" onclick="downloadCurrentDoc('tex')">⬇️ Download .tex</button>
        </div>
      </div>
      <iframe id="doc-preview-frame" title="Document Preview" style="width:100%;height:720px;border:0;background:#fff"></iframe>
    </div>
    <details style="margin-top:10px">
      <summary style="cursor:pointer;color:var(--muted);font-size:13px">Advanced: view / copy raw LaTeX source</summary>
      <div class="card" style="margin-top:8px">
        <div class="card-header">
          <div class="card-title">LaTeX Source — ${escapeHtml(cvResult.filename)}</div>
          <button class="btn btn-secondary btn-sm" onclick="copyToClipboard('cv-code')">Copy CV</button>
        </div>
        <div class="code-block" id="cv-code" style="max-height:220px;overflow:auto">${escapeHtml(cvResult.tex)}</div>
      </div>
      <div class="card" style="margin-top:8px">
        <div class="card-header">
          <div class="card-title">LaTeX Source — ${escapeHtml(clResult.filename)}</div>
          <button class="btn btn-secondary btn-sm" onclick="copyToClipboard('cl-code')">Copy Cover Letter</button>
        </div>
        <div class="code-block" id="cl-code" style="max-height:220px;overflow:auto">${escapeHtml(clResult.tex)}</div>
      </div>
      <p style="font-size:12px;color:var(--muted);margin-top:8px">To compile to PDF: save the .tex files into the repo's <code>cv/</code> and <code>cover_letters/</code> folders, then run <code>lualatex</code> (CV) and <code>xelatex</code> (cover letter).</p>
    </details>
  `;
  switchDocPreview('cv');
}

let currentDocTab = 'cv';
function switchDocPreview(tab) {
  currentDocTab = tab;
  const d = window._generatedDocs;
  if (!d) return;
  const frame = document.getElementById('doc-preview-frame');
  const html = tab === 'cv' ? d.cvHtml : d.clHtml;
  frame.srcdoc = html;
  const cvBtn = document.getElementById('tab-btn-cv');
  const clBtn = document.getElementById('tab-btn-cl');
  if (cvBtn) cvBtn.className = 'btn btn-sm ' + (tab === 'cv' ? 'btn-primary' : 'btn-secondary');
  if (clBtn) clBtn.className = 'btn btn-sm ' + (tab === 'cl' ? 'btn-primary' : 'btn-secondary');
}

function printGeneratedDoc() {
  const frame = document.getElementById('doc-preview-frame');
  if (frame && frame.contentWindow) {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }
}

function openGeneratedDoc() {
  const d = window._generatedDocs;
  if (!d) return;
  const html = currentDocTab === 'cv' ? d.cvHtml : d.clHtml;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function downloadCurrentDoc() {
  const d = window._generatedDocs;
  if (!d) return;
  if (currentDocTab === 'cv') {
    downloadFile(d.cv.filename, 'cv-code');
  } else {
    downloadFile(d.cl.filename, 'cl-code');
  }
}

function copyToClipboard(id) {
  const text = document.getElementById(id).textContent;
  navigator.clipboard.writeText(text).then(() => {
    tAlert('Copied to clipboard!');
  });
}

function downloadFile(filename, codeId) {
  const el = document.getElementById(codeId);
  const content = el ? el.textContent : '';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'document.tex';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============ Tracker ============
async function renderTracker() {
  const tracker = await API.get('tracker');

  document.getElementById('page-content').innerHTML = `
    <h1 class="page-title">${escapeHtml(tr('Application Tracker'))}</h1>
    <p class="page-subtitle">${escapeHtml(tr('Track every application from drafted to outcome — add new applications via the Apply Workflow page'))}</p>

    <div class="table-container">
      ${tracker.length === 0 ? '<div class="empty-state">No applications tracked yet.</div>' :
        `<table>
          <tr><th>${escapeHtml(tr('Date'))}</th><th>${escapeHtml(tr('Company'))}</th><th>${escapeHtml(tr('Role'))}</th><th>${escapeHtml(tr('Channel'))}</th><th>${escapeHtml(tr('Contact'))}</th><th>${escapeHtml(tr('Status'))}</th><th>${escapeHtml(tr('Deadline'))}</th><th>${escapeHtml(tr('Follow-up'))}</th><th>${escapeHtml(tr('Rej. Reason'))}</th><th>${escapeHtml(tr('Actions'))}</th></tr>
          ${tracker.map((t, i) => `<tr>
            <td>${t.date || '-'}</td>
            <td>${t.company || '-'}</td>
            <td>${t.role || '-'}</td>
            <td>${escapeHtml(tr(t.channel || '-'))}</td>
            <td style="font-size:12px;color:var(--muted)">${escapeHtml((t.contact_name||'')+(t.company_email?' '+t.company_email:''))}</td>
            <td><span class="badge badge-${t.status || 'drafted'}">${escapeHtml(tr(t.status || '-'))}</span></td>
            <td>${t.deadline || '-'}</td>
            <td>${t.next_followup || (t.last_touched || '-')}</td>
            <td style="font-size:11px;color:var(--muted)">${escapeHtml((t.rejection_stage?t.rejection_stage+' | ':'')+(t.rejection_reason||''))}</td>
            <td>
              ${t.cv_latex ? `<button class="btn btn-secondary btn-sm" onclick="viewCV(${i})" title="View generated CV">📄</button>` : ''}
              ${t.cl_latex ? `<button class="btn btn-secondary btn-sm" onclick="viewCL(${i})" title="View Cover Letter">✉️</button>` : ''}
              ${t.tailor_summary ? `<button class="btn btn-secondary btn-sm" onclick="viewTailoring(${i})" title="View HR tailoring details">🔍</button>` : ''}
              ${t.job_posting ? `<button class="btn btn-secondary btn-sm" onclick="viewJobPosting(${i})" title="View saved job posting">📝</button>` : ''}
              <button class="btn btn-primary btn-sm" onclick="prepForInterview(${i})">🎤 Prep</button>
              <button class="btn btn-secondary btn-sm" onclick="editTrackerEntry(${i})">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteTrackerEntry(${i})">Delete</button>
            </td>
          </tr>`).join('')}
        </table>`
      }
    </div>
  `;
}

function showAddTrackerModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header sticky">
        <div class="modal-title">Add Application</div>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div class="grid grid-2">
        <div class="form-group"><label>Company</label><input type="text" class="form-input" id="t-company"></div>
        <div class="form-group"><label>Role</label><input type="text" class="form-input" id="t-role"></div>
        <div class="form-group"><label>Sector</label><input type="text" class="form-input" id="t-sector"></div>
        <div class="form-group"><label>Channel</label>
          <select class="form-select" id="t-channel"><option value="">-</option><option value="portal">Portal</option><option value="online">Online</option><option value="referral">Referral</option></select>
        </div>
        <div class="form-group"><label>Contact Person</label><input type="text" class="form-input" id="t-contact" placeholder="e.g. Jane Smith, Recruiter"></div>
        <div class="form-group"><label>Company Email</label><input type="email" class="form-input" id="t-email" placeholder="jane@company.com"></div>
        <div class="form-group"><label>Status</label>
          <select class="form-select" id="t-status">
            <option value="drafted">Drafted</option><option value="applied">Applied</option>
            <option value="interview">Interview</option><option value="offer">Offer</option>
            <option value="hired">Hired</option><option value="rejected">Rejected</option>
            <option value="no_response">No Response</option><option value="withdrawn">Withdrawn</option>
          </select>
        </div>
        <div class="form-group"><label>Fit Rating (0-100)</label><input type="number" class="form-input" id="t-fit" min="0" max="100"></div>
        <div class="form-group"><label>Deadline</label><input type="date" class="form-input" id="t-deadline"></div>
        <div class="form-group"><label>Last Touched</label><input type="date" class="form-input" id="t-last-touched"></div>
        <div class="form-group"><label>Next Follow-up</label><input type="date" class="form-input" id="t-next-followup"></div>
        <div class="form-group"><label>Source URL</label><input type="text" class="form-input" id="t-source"></div>
      </div>
      <div class="grid grid-2" style="margin-top:8px;padding-top:12px;border-top:1px solid var(--stroke)">
        <div class="form-group"><label>Rejection Stage</label>
          <select class="form-select" id="t-rej-stage"><option value="">-</option><option value="application">Application Screen</option><option value="phone">Phone Screen</option><option value="onsite">Onsite Interview</option><option value="final">Final Round</option><option value="offer">Offer Stage</option></select>
        </div>
        <div class="form-group"><label>Rejection Reason</label>
          <input type="text" class="form-input" id="t-rej-reason" placeholder="e.g. Lack of experience in X, Salary mismatch">
        </div>
      </div>
      <button class="btn btn-primary" onclick="saveTrackerEntry()">Save</button>
    </div>
  `;
  document.body.appendChild(modal);
}

async function saveTrackerEntry() {
  const data = {
    company: document.getElementById('t-company').value,
    role: document.getElementById('t-role').value,
    sector: document.getElementById('t-sector').value,
    channel: document.getElementById('t-channel').value,
    contact_name: document.getElementById('t-contact').value,
    company_email: document.getElementById('t-email').value,
    status: document.getElementById('t-status').value,
    fitRating: document.getElementById('t-fit').value,
    deadline: document.getElementById('t-deadline').value,
    last_touched: document.getElementById('t-last-touched').value,
    next_followup: document.getElementById('t-next-followup').value,
    source: document.getElementById('t-source').value,
    rejection_stage: document.getElementById('t-rej-stage').value,
    rejection_reason: document.getElementById('t-rej-reason').value,
    date: new Date().toISOString().split('T')[0],
  };
  await API.post('tracker', data);
  document.querySelector('.modal-overlay').remove();
  renderTracker();
}

async function editTrackerEntry(id) {
  const tracker = await API.get('tracker');
  const t = tracker[id];
  showAddTrackerModal();
  setTimeout(() => {
    document.getElementById('t-company').value = t.company || '';
    document.getElementById('t-role').value = t.role || '';
    document.getElementById('t-sector').value = t.sector || '';
    document.getElementById('t-channel').value = t.channel || '';
    document.getElementById('t-contact').value = t.contact_name || '';
    document.getElementById('t-email').value = t.company_email || '';
    document.getElementById('t-status').value = t.status || 'drafted';
    document.getElementById('t-fit').value = t.fitRating || '';
    document.getElementById('t-deadline').value = t.deadline || '';
    document.getElementById('t-last-touched').value = t.last_touched || '';
    document.getElementById('t-next-followup').value = t.next_followup || '';
    document.getElementById('t-source').value = t.source || '';
    document.getElementById('t-rej-stage').value = t.rejection_stage || '';
    document.getElementById('t-rej-reason').value = t.rejection_reason || '';
    // Change save to update
    const btn = document.querySelector('.modal-overlay .btn-primary');
    btn.onclick = async () => {
      const data = {
        company: document.getElementById('t-company').value,
        role: document.getElementById('t-role').value,
        sector: document.getElementById('t-sector').value,
        channel: document.getElementById('t-channel').value,
        contact_name: document.getElementById('t-contact').value,
        company_email: document.getElementById('t-email').value,
        status: document.getElementById('t-status').value,
        fitRating: document.getElementById('t-fit').value,
        deadline: document.getElementById('t-deadline').value,
        last_touched: document.getElementById('t-last-touched').value,
        next_followup: document.getElementById('t-next-followup').value,
        source: document.getElementById('t-source').value,
        rejection_stage: document.getElementById('t-rej-stage').value,
        rejection_reason: document.getElementById('t-rej-reason').value,
      };
      await API.put(`tracker/${id}`, data);
      document.querySelector('.modal-overlay').remove();
      renderTracker();
    };
  }, 100);
}

async function deleteTrackerEntry(id) {
  showConfirmModal('Delete this tracker entry?', async () => {
    const res = await API.del(`tracker/${id}`);
    if (res.ok) {
      renderTracker();
    } else {
      tAlert('Delete failed: ' + (res.error || 'Unknown error'));
    }
  });
}

/**
 * Show a modal displaying the saved job posting text for a tracker entry.
 * This lets users review the original posting at any time from the Tracker page.
 */
function viewJobPosting(id) {
  API.get('tracker').then(tracker => {
    const t = tracker[id];
    if (!t || !t.job_posting) return;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:700px">
        <div class="modal-header sticky">
          <div class="modal-title">Job Posting — ${esc(t.company || '-')}/ ${esc(t.role || '-')}</div>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        </div>
        <div class="code-block" style="max-height:50vh;overflow:auto;font-size:13px">${escapeHtml(t.job_posting)}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="btn btn-secondary" onclick="copyToClipboard('job-posting-text')">📋 Copy</button>
          <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">Close</button>
        </div>
        <div id="job-posting-text" style="display:none">${escapeHtml(t.job_posting)}</div>
      </div>
    `;
    document.body.appendChild(modal);
  });
}

/** Show a saved CV / cover letter as a formatted document, with LaTeX source optional. */
function showDocumentModal({ prefix, title, html, latex }) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  const formatted = html
    ? `<iframe id="${prefix}-formatted" title="${escapeHtml(title)}" srcdoc="${escapeHtml(html)}" style="display:block;width:100%;height:60vh;border:1px solid var(--stroke);border-radius:8px;background:#fff"></iframe>`
    : `<div id="${prefix}-formatted" class="alert alert-info">${escapeHtml(tr('No formatted preview saved for this document. Generate it again to create one.'))}</div>`;
  modal.innerHTML = `
    <div class="modal" style="max-width:920px;width:94%">
      <div class="modal-header sticky">
        <div class="modal-title">${escapeHtml(title)}</div>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button class="btn btn-secondary btn-sm" id="${prefix}-tab-formatted" onclick="toggleDocumentView('${prefix}','formatted')">${escapeHtml(tr('Formatted'))}</button>
        <button class="btn btn-secondary btn-sm" id="${prefix}-tab-source" onclick="toggleDocumentView('${prefix}','source')">${escapeHtml(tr('LaTeX source'))}</button>
      </div>
      <div id="${prefix}-formatted-wrap">${formatted}</div>
      <div id="${prefix}-source" class="code-block" style="display:none;max-height:55vh;overflow:auto;font-size:12px">${escapeHtml(latex || '')}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn btn-secondary" onclick="copyToClipboard('${prefix}-text')">📋 ${escapeHtml(tr('Copy LaTeX'))}</button>
        <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">${escapeHtml(tr('Close'))}</button>
      </div>
      <div id="${prefix}-text" style="display:none">${escapeHtml(latex || '')}</div>
    </div>`;
  document.body.appendChild(modal);
  toggleDocumentView(prefix, 'formatted');
}

function toggleDocumentView(prefix, mode) {
  const fmt = document.getElementById(prefix + '-formatted-wrap');
  const src = document.getElementById(prefix + '-source');
  const fmtTab = document.getElementById(prefix + '-tab-formatted');
  const srcTab = document.getElementById(prefix + '-tab-source');
  if (!fmt || !src) return;
  const showFormatted = mode === 'formatted';
  fmt.style.display = showFormatted ? 'block' : 'none';
  src.style.display = showFormatted ? 'none' : 'block';
  if (fmtTab) fmtTab.classList.toggle('btn-primary', showFormatted);
  if (srcTab) srcTab.classList.toggle('btn-primary', !showFormatted);
}

/** Show the saved CV for a tracker entry. */
function viewCV(id) {
  API.get('tracker').then(tracker => {
    const t = tracker[id];
    if (!t || (!t.cv_latex && !t.cv_preview_html)) return;
    showDocumentModal({
      prefix: 'cv-doc',
      title: `CV — ${t.company || '-'}/ ${t.role || '-'}`,
      html: t.cv_preview_html || '',
      latex: t.cv_latex || '',
    });
  });
}

/** Show the saved cover letter for a tracker entry. */
function viewCL(id) {
  API.get('tracker').then(tracker => {
    const t = tracker[id];
    if (!t || (!t.cl_latex && !t.cl_preview_html)) return;
    showDocumentModal({
      prefix: 'cl-doc',
      title: `Cover Letter — ${t.company || '-'}/ ${t.role || '-'}`,
      html: t.cl_preview_html || '',
      latex: t.cl_latex || '',
    });
  });
}

/** Show a modal with the HR tailoring report details for a tracker entry. */
function viewTailoring(id) {
  API.get('tracker').then(tracker => {
    const t = tracker[id];
    if (!t || !t.tailor_summary) return;
    const matched = Array.isArray(t.tailor_matched) ? t.tailor_matched.join(', ') : '';
    const missing = Array.isArray(t.tailor_missing) ? t.tailor_missing.join(', ') : '';
    const highlights = Array.isArray(t.tailor_highlights) ? t.tailor_highlights.join('\n') : '';
    const changes = Array.isArray(t.tailor_changes) ? t.tailor_changes.join('\n') : '';
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:750px">
        <div class="modal-header sticky">
          <div class="modal-title">HR Tailoring Review — ${esc(t.company || '-')}/ ${esc(t.role || '-')}</div>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        </div>
        <div style="padding:4px 8px">
          <p><strong>Coverage:</strong> ${t.tailor_coverage ?? '?'}%</p>
          <p><strong>Matched competencies:</strong> ${esc(matched || '—')}</p>
          <p><strong>Missing (do not fabricate):</strong> ${esc(missing || 'None detected')}</p>
          <p><strong>Tailored summary:</strong></p>
          <div class="code-block" style="max-height:80px;overflow:auto;font-size:13px;margin-bottom:8px">${escapeHtml(t.tailor_summary || '')}</div>
          <p><strong>Selected highlights:</strong></p>
          <div class="code-block" style="max-height:120px;overflow:auto;font-size:13px;margin-bottom:8px">${escapeHtml(highlights || '—')}</div>
          <p><strong>What the HR review changed:</strong></p>
          <div class="code-block" style="max-height:160px;overflow:auto;font-size:13px">${escapeHtml(changes || '—')}</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  });
}

// Custom confirmation modal (native confirm() may be blocked in embedded previews)
function showConfirmModal(message, onConfirm) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:380px">
      <div class="modal-header sticky">
        <div class="modal-title">Confirm Action</div>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <p style="margin:0 0 20px">${escapeHtml(message)}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary" id="confirm-cancel">Cancel</button>
        <button class="btn btn-danger" id="confirm-ok">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#confirm-cancel').onclick = () => modal.remove();
  modal.querySelector('#confirm-ok').onclick = async () => {
    modal.remove();
    await onConfirm();
  };
}

/**
 * Pre-populate the Interview Prep page with data from a tracker entry.
 * Switches the user to the interview tab so they can immediately generate
 * a tailored prep pack (STAR examples, likely questions, talking points).
 */
function prepForInterview(id) {
  API.get('tracker').then(tracker => {
    const t = tracker[id];
    if (!t) return;
    // Navigate to interview page and activate the nav item.
    currentPage = 'interview';
    // Activate the Interview Prep sidebar item to match standard navigation behavior.
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector('.nav-item[data-page="interview"]');
    if (navItem) navItem.classList.add('active');
    renderPage();
    setTimeout(() => {
      document.getElementById('int-company').value = t.company || '';
      document.getElementById('int-role').value = t.role || '';
      // Pre-populate the saved job posting if available.
      const postingEl = document.getElementById('int-posting');
      if (postingEl && t.job_posting) {
        postingEl.value = t.job_posting;
      }
      // Auto-select the matching entry in the dropdown so the UI reflects where we came from.
      if (document.getElementById('int-tracker-select')) chooseTrackerOption(id);
    }, 150);
  });
}

/**
 * When the user selects an application from the tracker dropdown on the
 * Interview Prep page, fill in Company and Role from the chosen entry.
 * If a saved job_posting exists, it is also pre-populated into the textarea.
 */
function toggleTrackerSelect(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('int-tracker-menu');
  if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function chooseTrackerOption(index) {
  const menu = document.getElementById('int-tracker-menu');
  const label = document.getElementById('int-tracker-value');
  const chosen = menu?.querySelector(`.custom-select-option[data-index="${index === null ? '' : index}"]`);
  if (label) label.textContent = chosen?.textContent || '-- select none --';
  menu?.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
  chosen?.classList.add('selected');
  if (menu) menu.style.display = 'none';
  onTrackerSelect(index === null ? '' : String(index));
}

function onTrackerSelect(idx) {
  // Clear fields when user selects "-- select none --" or no entry
  if (idx === '' || idx === null || typeof idx === 'undefined') {
    document.getElementById('int-company').value = '';
    document.getElementById('int-role').value = '';
    document.getElementById('int-posting').value = '';
    return;
  }
  API.get('tracker').then(tracker => {
    const t = tracker[parseInt(idx, 10)];
    if (!t) return;
    document.getElementById('int-company').value = t.company || '';
    document.getElementById('int-role').value = t.role || '';
    const postingEl = document.getElementById('int-posting');
    if (postingEl) postingEl.value = t.job_posting || '';
  });
}

document.addEventListener('click', event => {
  const root = event.target.closest?.('#int-tracker-select');
  if (!root) {
    const menu = document.getElementById('int-tracker-menu');
    if (menu) menu.style.display = 'none';
  }
});

// ============ Interview Prep ============
async function renderInterview() {
  const tracker = await API.get('tracker');
  const hasEntries = tracker.length > 0;
  const options = hasEntries
    ? tracker.map((t, i) => `<div class="custom-select-option" data-index="${i}" onclick="chooseTrackerOption(${i})">${esc(t.company || '-')}/ ${esc(t.role || '-')} (${esc(t.status || 'drafted')})</div>`).join('')
    : '';

  document.getElementById('page-content').innerHTML = `
    <h1 class="page-title">Interview Preparation</h1>
    <p class="page-subtitle">Generate stage-specific prep pack: STAR examples, likely questions, talking points</p>

    <div class="card">
      <div class="form-group">
        <label>Select from Tracker (optional)</label>
        <div class="custom-select" id="int-tracker-select">
          <button type="button" class="custom-select-trigger" onclick="toggleTrackerSelect(event)">
            <span id="int-tracker-value">-- select none --</span><span class="custom-select-arrow">▾</span>
          </button>
          <div class="custom-select-menu" id="int-tracker-menu" style="display:none">
            <div class="custom-select-option selected" data-index="" onclick="chooseTrackerOption(null)">-- select none --</div>
            ${options}
          </div>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-top:4px">Choose an application or fill in manually below.</p>
      </div>
      <div class="grid grid-2">
        <div class="form-group"><label>Company</label><input type="text" class="form-input" id="int-company" placeholder="e.g. Acme Corp"></div>
        <div class="form-group"><label>Role</label><input type="text" class="form-input" id="int-role" placeholder="e.g. Senior Data Scientist"></div>
      </div>
      <div class="form-group">
        <label>Job Posting (optional, for tailored questions)</label>
        <textarea class="form-textarea" id="int-posting" rows="6" placeholder="Paste the job posting text..."></textarea>
      </div>
      <button class="btn btn-primary" onclick="generateInterviewPrep()">Generate Prep Pack</button>
    </div>

    <div id="int-results"></div>
  `;
}

async function generateInterviewPrep() {
  const company = document.getElementById('int-company').value.trim();
  const role = document.getElementById('int-role').value.trim();
  const posting = document.getElementById('int-posting').value.trim();

  if (!company || !role) return;

  const resultsDiv = document.getElementById('int-results');
  resultsDiv.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:20px"><div class="loader"></div> Building prep pack...</div>';

  const language = currentUILanguage();
  const prep = await API.post('interview-prep', { company, role, posting, language });
  const sourceBadge = prep.source === 'ai'
    ? '<span class="badge badge-active" style="margin-left:8px">AI</span>'
    : (prep.warning ? `<span class="badge badge-rejected" style="margin-left:8px">Local fallback: ${escapeHtml(prep.warning)}</span>` : '');
  const localLanguageNotice = prep.source !== 'ai' && language !== 'en'
    ? `<div class="alert alert-warning" style="margin-bottom:12px">${escapeHtml(tr('Local template content is in English. Configure a working AI model to generate content in the selected language.'))}</div>`
    : '';

  resultsDiv.innerHTML = `${localLanguageNotice}
    <div class="card">
      <div class="card-title">STAR Examples ${sourceBadge}</div>
      ${(prep.starExamples || []).map(s => `
        <div style="padding:12px;border:1px solid var(--stroke);border-radius:8px;margin-bottom:8px">
          <strong>${escapeHtml(s.title)}</strong>
          <div style="font-size:13px;margin-top:4px"><strong>S:</strong> ${escapeHtml(s.situation)}</div>
          <div style="font-size:13px"><strong>T:</strong> ${escapeHtml(s.task)}</div>
          <div style="font-size:13px"><strong>A:</strong> ${escapeHtml(s.action)}</div>
          <div style="font-size:13px"><strong>R:</strong> ${escapeHtml(s.result)}</div>
        </div>
      `).join('')}
    </div>

    <div class="card">
      <div class="card-title">Likely Interview Questions</div>
      <ol style="font-size:14px;padding-left:20px">
        ${(prep.likelyQuestions || []).map(q => `<li style="margin-bottom:6px">${escapeHtml(q)}</li>`).join('')}
      </ol>
    </div>

    <div class="card">
      <div class="card-title">Talking Points</div>
      <ul style="font-size:14px;padding-left:20px">
        ${(prep.talkingPoints || []).map(t => `<li style="margin-bottom:6px">${escapeHtml(t)}</li>`).join('')}
      </ul>
    </div>

    <div class="card">
      <div class="card-title">Questions to Ask the Interviewer</div>
      <ul style="font-size:14px;padding-left:20px">
        ${(prep.questionsToAsk || []).map(q => `<li style="margin-bottom:6px">${escapeHtml(q)}</li>`).join('')}
      </ul>
    </div>
  `;
}

// ============ LLM Configuration ============
let llmTestSeq = 0;

function llmModelStatusHtml(model) {
  const status = model.lastError
    ? `<span class="badge badge-rejected">${escapeHtml(tr('Failed'))}</span>`
    : (model.lastSuccess ? `<span class="badge badge-active">OK</span>` : `<span class="badge badge-draft">${escapeHtml(tr('Untested'))}</span>`);
  const disabled = model.enabled === false ? `<span class="badge badge-draft">${escapeHtml(tr('Disabled'))}</span>` : '';
  const error = model.lastError
    ? `<div style="font-size:11px;color:var(--danger);margin-top:4px">${escapeHtml(model.lastError)}</div>`
    : '';
  return `${status} ${disabled}${error}`;
}

async function renderLLMConfig() {
  const config = await API.get('llm-config');
  window._llmConfig = config;
  const models = config.models || [];
  const active = config.activeModelId || 'auto';

  const options = `<option value="auto"${active === 'auto' ? ' selected' : ''}>${escapeHtml(tr('AUTO - try models in order'))}</option>` +
    models.map(m => `<option value="${escapeHtml(m.id)}"${active === m.id ? ' selected' : ''}>${escapeHtml(m.label || m.model)}</option>`).join('');

  const rows = models.length ? models.map(m => {
    return `
      <div class="llm-model-card" data-model-id="${escapeHtml(m.id)}" style="padding:12px;margin-bottom:8px;background:var(--bg);border-radius:6px">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
          <div><strong>${escapeHtml(m.label || m.model)}</strong> <span class="llm-model-status">${llmModelStatusHtml(m)}</span>
            <div style="font-size:12px;color:var(--muted)">${escapeHtml(m.provider)} · ${escapeHtml(m.model)}${m.baseUrl ? ' · ' + escapeHtml(m.baseUrl) : ''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" onclick="editLLMModel('${escapeHtml(m.id)}')">${escapeHtml(tr('Edit'))}</button>
            <button class="btn btn-secondary btn-sm" onclick="testLLMModel('${escapeHtml(m.id)}')">${escapeHtml(tr('Test'))}</button>
            <button class="btn btn-danger btn-sm" onclick="removeLLMModel('${escapeHtml(m.id)}')">${escapeHtml(tr('Remove'))}</button>
          </div>
        </div>
        <div class="llm-model-test-result" style="margin-top:8px"></div>
      </div>`;
  }).join('') : `<p style="color:var(--muted)">${escapeHtml(tr('No models saved yet'))}</p>`;

  document.getElementById('page-content').innerHTML = `
    <h1 class="page-title">LLM Config <span id="llm-health-badge"><span class="badge badge-draft" style="margin-left:8px">${escapeHtml(tr('Checking...'))}</span></span></h1>
    <p class="page-subtitle">${escapeHtml(tr('Configure multiple LLM models and choose one, or let the system pick a working model automatically'))}</p>

    <div class="card">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Active Model'))}</div></div>
      <div style="padding:16px">
        <select class="form-select" id="llm-active-model" onchange="setActiveLLMModel(this.value)">${options}</select>
        <p style="font-size:12px;color:var(--muted);margin-top:8px">${escapeHtml(tr('AUTO mode tries each enabled model in order and uses the first one that responds.'))}</p>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Saved Models'))}</div></div>
      <div style="padding:0 16px 8px">
        <button class="btn btn-secondary btn-sm" onclick="testLLMConnection()">${escapeHtml(tr('Test All Models'))}</button>
      </div>
      <div style="padding:16px">${rows}</div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Add / Edit Model'))}</div></div>
      <div style="padding:16px">
        <div class="grid grid-2">
          <div class="form-group"><label>${escapeHtml(tr('Model Label'))}</label><input class="form-input" id="llm-label" placeholder="BigModel GLM / OpenAI gpt-4o-mini"></div>
          <div class="form-group"><label>${escapeHtml(tr('Provider'))}</label><input class="form-input" id="llm-provider" placeholder="OpenAI, Azure, Anthropic, OpenRouter..."></div>
          <div class="form-group"><label>${escapeHtml(tr('API Key'))}</label><input type="password" class="form-input" id="llm-api-key" placeholder="sk-... or your API key"></div>
          <div class="form-group"><label>${escapeHtml(tr('Model Name'))}</label><input class="form-input" id="llm-model" placeholder="gpt-4o-mini, glm-4.7-flash..."></div>
          <div class="form-group"><label>${escapeHtml(tr('Base URL (optional)'))}</label><input class="form-input" id="llm-base-url" placeholder="https://api.openai.com/v1 (leave blank for default)"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="saveLLMModel()">${escapeHtml(tr('Save Model'))}</button>
          <button class="btn btn-secondary" onclick="testCurrentLLMModel()">${escapeHtml(tr('Test Current Model'))}</button>
          <button class="btn btn-secondary" onclick="fillLLMForm(null)">${escapeHtml(tr('New Model'))}</button>
        </div>
        <div id="llm-status"></div>
        <div id="llm-test-results" style="margin-top:12px"></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Saved Configurations'))}</div></div>
      <div style="padding:16px">
        <p style="font-size:12px;color:var(--muted);margin:0">${escapeHtml(tr('Configuration storage path:'))} <code>${escapeHtml(config.storagePath || 'data/llm-config.json')}</code></p>
      </div>
    </div>
  `;
  fillLLMForm(models[0] || null);
  if (config.configured) runLLMHealthCheck(true);
  else updateLLMBadge(false);
}

function fillLLMForm(model) {
  window._editingLLMModelId = model ? model.id : '';
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value || ''; };
  set('llm-label', model?.label);
  set('llm-provider', model?.provider);
  set('llm-api-key', model?.apiKey);
  set('llm-model', model?.model);
  set('llm-base-url', model?.baseUrl);
}

function llmFormData() {
  return {
    provider: document.getElementById('llm-provider')?.value.trim() || '',
    apiKey: document.getElementById('llm-api-key')?.value.trim() || '',
    model: document.getElementById('llm-model')?.value.trim() || '',
    baseUrl: document.getElementById('llm-base-url')?.value.trim() || '',
    label: document.getElementById('llm-label')?.value.trim() || '',
  };
}

function updateLLMBadge(ok, text) {
  const badge = document.getElementById('llm-health-badge');
  if (!badge) return;
  const label = text || (ok ? tr('Connected') : tr('Not connected'));
  badge.innerHTML = `<span class="badge ${ok ? 'badge-active' : 'badge-rejected'}" style="margin-left:8px">${escapeHtml(label)}</span>`;
}

async function saveLLMModel() {
  const form = llmFormData();
  if (!form.provider || !form.apiKey || !form.model) {
    showLLMStatus(tr('Please fill in all required fields'), 'error');
    return;
  }
  const config = window._llmConfig || { models: [], activeModelId: 'auto' };
  const models = (config.models || []).map(m => ({ ...m }));
  const id = window._editingLLMModelId || ('model_' + Date.now());
  const entry = { id, label: form.label || `${form.provider} / ${form.model}`, ...form, enabled: true };
  const index = models.findIndex(m => m.id === id);
  if (index >= 0) models[index] = { ...models[index], ...entry };
  else models.push(entry);
  try {
    const result = await API.post('llm-config', { models, activeModelId: config.activeModelId || 'auto' });
    if (!result.ok) throw new Error(result.error || tr('Save failed'));
    showLLMStatus(tr('Configuration saved successfully'), 'success');
    renderLLMConfig();
  } catch (err) {
    showLLMStatus(`${escapeHtml(tr('Save failed:'))} ${escapeHtml(err.message)}`, 'error');
  }
}

async function editLLMModel(id) {
  const model = (window._llmConfig?.models || []).find(m => m.id === id);
  if (model) fillLLMForm(model);
}

async function removeLLMModel(id) {
  const config = window._llmConfig || { models: [], activeModelId: 'auto' };
  const models = (config.models || []).filter(m => m.id !== id);
  let active = config.activeModelId || 'auto';
  if (active !== 'auto' && !models.some(m => m.id === active)) active = 'auto';
  try {
    const result = await API.post('llm-config', { models, activeModelId: active });
    if (!result.ok) throw new Error(result.error || tr('Save failed'));
    showLLMStatus(tr('Configuration saved successfully'), 'success');
    renderLLMConfig();
  } catch (err) {
    showLLMStatus(`${escapeHtml(tr('Save failed:'))} ${escapeHtml(err.message)}`, 'error');
  }
}

async function setActiveLLMModel(value) {
  const config = window._llmConfig || { models: [], activeModelId: 'auto' };
  try {
    const result = await API.post('llm-config', { models: config.models || [], activeModelId: value });
    if (!result.ok) throw new Error(result.error || tr('Save failed'));
    window._llmConfig = result;
    showLLMStatus(`${escapeHtml(tr('Active Model'))}: ${escapeHtml(value === 'auto' ? tr('AUTO - try models in order') : value)}`, 'success');
  } catch (err) {
    showLLMStatus(`${escapeHtml(tr('Save failed:'))} ${escapeHtml(err.message)}`, 'error');
  }
}

function llmModelCard(id) {
  return [...document.querySelectorAll('.llm-model-card')].find(el => el.dataset.modelId === id) || null;
}

function llmTestMessage(result) {
  const errors = (result.results || []).map(r => r.error).filter(Boolean);
  return result.ok
    ? escapeHtml(tr('Connection test successful! Your provider configuration looks good.'))
    : `${escapeHtml(tr('Connection test failed:'))} ${escapeHtml(errors.join(' | '))}`;
}

async function refreshLLMModelStatus(id) {
  try {
    const config = await API.get('llm-config');
    window._llmConfig = config;
    const model = (config.models || []).find(m => m.id === id);
    const card = llmModelCard(id);
    if (model && card) {
      const statusEl = card.querySelector('.llm-model-status');
      if (statusEl) statusEl.innerHTML = llmModelStatusHtml(model);
    }
  } catch (e) { /* refreshing the badge is cosmetic; keep the test result visible */ }
}

async function testLLMModel(id) {
  const seq = ++llmTestSeq;
  const card = llmModelCard(id);
  const inline = card?.querySelector('.llm-model-test-result');
  const model = (window._llmConfig?.models || []).find(m => m.id === id);
  const label = model?.label || model?.model || id;
  if (inline) inline.innerHTML = `<div style="font-size:12px;color:var(--muted)">${escapeHtml(tr('Checking...'))}</div>`;
  showLLMStatus(`<strong>${escapeHtml(label)}</strong> — ${escapeHtml(tr('Checking...'))}`, 'info');
  try {
    const result = await API.post('llm-test', { modelId: id });
    if (seq !== llmTestSeq) return;
    renderLLMTestResults(result, inline);
    updateLLMBadge(result.ok, result.ok ? tr('Connected') : tr('Not connected'));
    showLLMStatus(llmTestMessage(result), result.ok ? 'success' : 'error');
    await refreshLLMModelStatus(id);
    if (inline) inline.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    if (seq !== llmTestSeq) return;
    if (inline) inline.innerHTML = `<div style="font-size:12px;color:var(--danger)">${escapeHtml(err.message)}</div>`;
    showLLMStatus(`${escapeHtml(tr('Connection test failed:'))} ${escapeHtml(err.message)}`, 'error');
  }
}

async function testCurrentLLMModel() {
  const form = llmFormData();
  if (!form.provider || !form.apiKey || !form.model) {
    showLLMStatus(escapeHtml(tr('Please fill in all required fields')), 'error');
    return;
  }
  const seq = ++llmTestSeq;
  showLLMStatus(escapeHtml(tr('Checking...')), 'info');
  try {
    const result = await API.post('llm-test', form);
    if (seq !== llmTestSeq) return;
    renderLLMTestResults(result);
    showLLMStatus(llmTestMessage(result), result.ok ? 'success' : 'error');
    document.getElementById('llm-test-results')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    if (seq !== llmTestSeq) return;
    showLLMStatus(`${escapeHtml(tr('Connection test failed:'))} ${escapeHtml(err.message)}`, 'error');
  }
}

function renderLLMTestResults(result, box) {
  const target = box || document.getElementById('llm-test-results');
  if (!target) return;
  const rows = (result.results || []).map(r => `
    <div style="font-size:13px;margin-bottom:4px">
      <strong>${escapeHtml(r.label || r.model || '')}</strong>:
      ${r.ok ? `<span style="color:var(--success)">${escapeHtml(tr('Connected'))} ${escapeHtml(r.reply || '')}</span>` : `<span style="color:var(--danger)">${escapeHtml(r.error || '')}</span>`}
    </div>`).join('');
  target.innerHTML = rows ? `<div style="padding:8px;background:var(--bg);border-radius:6px">${rows}</div>` : '';
}

async function runLLMHealthCheck(silent = false) {
  const seq = ++llmTestSeq;
  if (!silent) showLLMStatus('<div style="display:flex;align-items:center;gap:8px"><div class="loader"></div> ' + escapeHtml(tr('Checking...')) + '</div>', 'info');
  try {
    const result = await API.post('llm-test', {});
    if (seq !== llmTestSeq) return;
    updateLLMBadge(result.ok, result.ok ? tr('Connected') : tr('Not connected'));
    if (!silent) {
      renderLLMTestResults(result);
      showLLMStatus(llmTestMessage(result), result.ok ? 'success' : 'error');
    }
  } catch (err) {
    if (seq !== llmTestSeq) return;
    updateLLMBadge(false);
    if (!silent) showLLMStatus(`${escapeHtml(tr('Connection test failed:'))} ${escapeHtml(err.message)}`, 'error');
  }
}

async function testLLMConnection() {
  await runLLMHealthCheck(false);
}

function showLLMStatus(html, type) {
  const statusEl = document.getElementById('llm-status');
  if (!statusEl) return;

  const colors = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--info)' };
  const color = colors[type] || colors.info;

  statusEl.innerHTML = '<p style="color:' + color + ';margin-top:12px;font-size:14px">' + html + '</p>';
}

// ============ Salary Lookup ============
function prettyCategoryKey(key) {
  return String(key || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function salaryValue(value) {
  if (typeof value === 'number') return value.toLocaleString();
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => escapeHtml(tr(prettyCategoryKey(k))) + ': ' + escapeHtml(typeof v === 'number' ? v.toLocaleString() : String(v)))
      .join(' &middot; ');
  }
  return escapeHtml(String(value ?? '-'));
}

async function renderSalary() {
  const data = await API.get('salary/all');
  const companies = data.companies || [];
  const meta = data.metadata || {};
  const description = meta.baseline_description ? (window.I18N ? window.I18N.L(meta.baseline_description) : meta.baseline_description) : '';

  document.getElementById('page-content').innerHTML = `
    <h1 class="page-title">${escapeHtml(tr('Salary Lookup'))}</h1>
    <p class="page-subtitle">${escapeHtml(tr('Compare salaries across Thailand, Malaysia, China, Vietnam'))}</p>

    ${description ? `<div class="alert alert-info" style="margin-bottom:16px">${escapeHtml(description)}</div>` : ''}

    <div class="card">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Salary Lookup'))}</div></div>
      <div style="padding:16px">
        <div class="form-group"><label>${escapeHtml(tr('Company'))}</label><input class="form-input" id="salary-company" placeholder="${escapeHtml(tr('Enter a company or role'))}"></div>
        <div class="form-group"><label>${escapeHtml(tr('City'))}</label><input class="form-input" id="salary-city" placeholder="${escapeHtml(tr('City'))}"></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onclick="lookupSalary()">${escapeHtml(tr('Look Up'))}</button>
          <button class="btn btn-secondary" onclick="renderSalary()">${escapeHtml(tr('List All'))}</button>
        </div>
      </div>
    </div>

    <div id="salary-results" style="margin-top:16px"></div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Salary Data'))} (${companies.length})</div></div>
      <div class="table-container">
        <table><thead><tr><th>${escapeHtml(tr('Company'))}</th><th>${escapeHtml(tr('City'))}</th><th>${escapeHtml(tr('Salary Data'))}</th></tr></thead>
        <tbody>${companies.length ? companies.map(c => `
          <tr><td><strong>${escapeHtml(c.company || c.name || '-')}</strong></td><td>${escapeHtml(c.city || '-')}</td><td>${Object.entries(c.categories || {}).map(([k, v]) => `<div style="margin-bottom:3px"><span class="tag">${escapeHtml(tr(prettyCategoryKey(k)))}</span> ${salaryValue(v)}</div>`).join('') || '-'}</td></tr>
        `).join('') : `<tr><td colspan="3">${escapeHtml(tr('No salary data configured yet.'))}</td></tr>`}</tbody></table>
      </div>
    </div>`;
}

async function lookupSalary() {
  const company = (document.getElementById('salary-company')?.value || '').trim();
  const city = (document.getElementById('salary-city')?.value || '').trim();
  const target = document.getElementById('salary-results');
  if (!target) return;
  if (!company) { target.innerHTML = `<div class="alert alert-warning">${escapeHtml(tr('Enter a company or role'))}</div>`; return; }
  target.innerHTML = `<div class="alert alert-info">${escapeHtml(tr('Loading...'))}</div>`;
  try {
    const result = await API.get(`salary?company=${encodeURIComponent(company)}&city=${encodeURIComponent(city)}`);
    const results = result.results || [];
    target.innerHTML = `
      <div class="card">
        <div class="card-header"><div class="card-title">${escapeHtml(tr('Results'))} (${results.length})</div></div>
        <div class="table-container"><table><thead><tr><th>${escapeHtml(tr('Company'))}</th><th>${escapeHtml(tr('City'))}</th><th>${escapeHtml(tr('Salary Data'))}</th></tr></thead><tbody>
          ${results.length ? results.map(c => `<tr><td><strong>${escapeHtml(c.company || '-')}</strong>${c.matchScore ? ` <span class="badge badge-active">${escapeHtml(String(c.matchScore))}</span>` : ''}</td><td>${escapeHtml(c.city || '-')}</td><td>${Object.entries(c.categories || {}).map(([k, v]) => `<div><span class="tag">${escapeHtml(tr(prettyCategoryKey(k)))}</span> ${salaryValue(v)}</div>`).join('') || '-'}</td></tr>`).join('') : `<tr><td colspan="3">${escapeHtml(tr('No results'))}</td></tr>`}
        </tbody></table></div>
      </div>`;
  } catch (err) {
    target.innerHTML = `<div class="alert alert-danger">${escapeHtml(String(err && err.message ? err.message : err))}</div>`;
  }
}

// ============ Profile ============
function toCommaText(value) {
  return Array.isArray(value) ? value.join(', ') : (value || '');
}

function profileRows(items, render) {
  return (items || []).map((item, i) => render(item, i)).join('');
}

async function renderProfile() {
  const p = await API.get('profile');
  profileData = p;
  const id = p.identity || {};
  const skills = p.skills || {};
  const goals = p.careerGoals || {};

  const langRows = profileRows(p.languages, (l, i) => `
    <div style="display:flex;gap:8px;margin-bottom:6px">
      <input class="form-input" data-lang-name="${i}" value="${escapeHtml(l.language || '')}" placeholder="${escapeHtml(tr('Language'))}">
      <input class="form-input" data-lang-level="${i}" value="${escapeHtml(l.level || '')}" placeholder="${escapeHtml(tr('Level'))}" style="max-width:140px">
      <button class="btn btn-danger btn-sm" onclick="removeProfileRow('languages',${i})">${escapeHtml(tr('Remove'))}</button>
    </div>`) || `<p style="color:var(--muted)">${escapeHtml(tr('None'))}</p>`;

  const expRows = profileRows(p.experience, (e, i) => `
    <div style="padding:12px;margin-bottom:10px;background:var(--bg);border-radius:6px">
      <div style="display:flex;gap:8px;margin-bottom:6px">
        <input class="form-input" data-exp-title="${i}" value="${escapeHtml(e.title || '')}" placeholder="${escapeHtml(tr('Role'))}">
        <input class="form-input" data-exp-company="${i}" value="${escapeHtml(e.company || '')}" placeholder="${escapeHtml(tr('Company'))}">
      </div>
      <div style="display:flex;gap:8px;margin-bottom:6px">
        <input class="form-input" data-exp-start="${i}" value="${escapeHtml(e.start || '')}" placeholder="${escapeHtml(tr('Start'))}">
        <input class="form-input" data-exp-end="${i}" value="${escapeHtml(e.end || '')}" placeholder="${escapeHtml(tr('End'))}">
        <input class="form-input" data-exp-location="${i}" value="${escapeHtml(e.location || '')}" placeholder="${escapeHtml(tr('Location'))}">
      </div>
      <textarea class="form-textarea" data-exp-bullets="${i}" rows="4" placeholder="${escapeHtml(tr('Bullets (one per line)'))}">${escapeHtml((e.bullets || []).join('\n'))}</textarea>
      <button class="btn btn-danger btn-sm" style="margin-top:6px" onclick="removeProfileRow('experience',${i})">${escapeHtml(tr('Remove'))}</button>
    </div>`) || `<p style="color:var(--muted)">${escapeHtml(tr('No experience added'))}</p>`;

  const eduRows = profileRows(p.education, (e, i) => `
    <div style="padding:12px;margin-bottom:10px;background:var(--bg);border-radius:6px">
      <div style="display:flex;gap:8px;margin-bottom:6px">
        <input class="form-input" data-edu-degree="${i}" value="${escapeHtml(e.degree || '')}" placeholder="${escapeHtml(tr('Degree'))}">
        <input class="form-input" data-edu-institution="${i}" value="${escapeHtml(e.institution || '')}" placeholder="${escapeHtml(tr('Institution'))}">
      </div>
      <div style="display:flex;gap:8px;margin-bottom:6px">
        <input class="form-input" data-edu-start="${i}" value="${escapeHtml(e.start || '')}" placeholder="${escapeHtml(tr('Start'))}">
        <input class="form-input" data-edu-end="${i}" value="${escapeHtml(e.end || '')}" placeholder="${escapeHtml(tr('End'))}">
      </div>
      <input class="form-input" data-edu-topics="${i}" value="${escapeHtml(e.topics || '')}" placeholder="${escapeHtml(tr('Topics'))}">
      <button class="btn btn-danger btn-sm" style="margin-top:6px" onclick="removeProfileRow('education',${i})">${escapeHtml(tr('Remove'))}</button>
    </div>`) || `<p style="color:var(--muted)">${escapeHtml(tr('None'))}</p>`;

  document.getElementById('page-content').innerHTML = `
    <h1 class="page-title">${escapeHtml(tr('Profile'))}</h1>
    <p class="page-subtitle">${escapeHtml(id.name || tr('Profile'))}</p>

    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Profile Photo'))}</div></div>
      <div style="padding:16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div id="profile-photo-placeholder" style="width:88px;height:88px;border-radius:50%;background:var(--fill);display:none;align-items:center;justify-content:center;font-size:28px;color:var(--muted)">${escapeHtml((id.name || '?').trim().charAt(0).toUpperCase())}</div>
        <img id="profile-photo-preview" src="/api/profile-photo?v=${Date.now()}" alt="${escapeHtml(tr('Profile Photo'))}" style="width:88px;height:88px;border-radius:50%;object-fit:cover;border:1px solid var(--stroke)" onerror="this.style.display='none';var p=document.getElementById('profile-photo-placeholder');if(p)p.style.display='flex'">
        <div style="flex:1;min-width:240px">
          <input type="file" id="profile-photo-file" class="form-input" accept="image/png,image/jpeg,image/gif,image/webp" style="max-width:380px">
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="uploadProfilePhoto()">${escapeHtml(tr('Upload Photo'))}</button>
            <button class="btn btn-secondary btn-sm" onclick="removeProfilePhoto()">${escapeHtml(tr('Remove Photo'))}</button>
          </div>
          <p style="font-size:12px;color:var(--muted);margin-top:6px">${escapeHtml(tr('PNG, JPG, GIF or WEBP, up to 5 MB.'))}</p>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Upload Resume'))}</div></div>
      <div style="padding:16px">
        <p style="font-size:13px;color:var(--muted);margin-top:0">${escapeHtml(tr('Upload a PDF, DOCX, TXT or HTML resume. The system reads the file directly and extracts profile fields for review.'))}</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="file" id="resume-file" class="form-input" accept=".pdf,.docx,.doc,.txt,.html" style="max-width:420px">
          <button class="btn btn-primary" onclick="uploadResumeFile()">${escapeHtml(tr('Read Resume File'))}</button>
        </div>
        <details style="margin-top:12px">
          <summary style="cursor:pointer;font-size:13px">${escapeHtml(tr('Or paste resume text'))}</summary>
          <textarea class="form-textarea" id="resume-paste" rows="6" style="margin-top:8px" placeholder="${escapeHtml(tr('Paste resume text here'))}"></textarea>
          <button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="analyzePastedResume()">${escapeHtml(tr('Analyze Pasted Text'))}</button>
        </details>
        <div id="resume-review" style="margin-top:12px">${window._uploadedProfile ? resumeReviewHtml(window._uploadedProfile) : ''}</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Personal Info'))}</div></div>
      <div style="padding:16px">
        <div class="grid grid-2">
          <div class="form-group"><label>${escapeHtml(tr('Name'))}</label><input class="form-input" id="profile-name" value="${escapeHtml(id.name || '')}"></div>
          <div class="form-group"><label>${escapeHtml(tr('Email'))}</label><input class="form-input" id="profile-email" value="${escapeHtml(id.email || '')}"></div>
          <div class="form-group"><label>${escapeHtml(tr('Phone'))}</label><input class="form-input" id="profile-phone" value="${escapeHtml(id.phone || '')}"></div>
          <div class="form-group"><label>${escapeHtml(tr('Location'))}</label><input class="form-input" id="profile-location" value="${escapeHtml(id.location || '')}"></div>
          <div class="form-group"><label>LinkedIn</label><input class="form-input" id="profile-linkedin" value="${escapeHtml(id.linkedin || '')}"></div>
          <div class="form-group"><label>GitHub</label><input class="form-input" id="profile-github" value="${escapeHtml(id.github || '')}"></div>
          <div class="form-group"><label>${escapeHtml(tr('CV Language'))}</label><input class="form-input" id="profile-cv-language" value="${escapeHtml(id.cvLanguage || 'English')}"></div>
          <div class="form-group"><label>${escapeHtml(tr('Status'))}</label><input class="form-input" id="profile-status" value="${escapeHtml(id.status || '')}"></div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Skills'))}</div></div>
      <div style="padding:16px">
        <div class="grid grid-2">
          <div class="form-group"><label>${escapeHtml(tr('Primary'))}</label><textarea class="form-textarea" id="profile-skills-primary" rows="4">${escapeHtml(toCommaText(skills.primary))}</textarea></div>
          <div class="form-group"><label>${escapeHtml(tr('Secondary'))}</label><textarea class="form-textarea" id="profile-skills-secondary" rows="4">${escapeHtml(toCommaText(skills.secondary))}</textarea></div>
          <div class="form-group"><label>${escapeHtml(tr('Domain'))}</label><textarea class="form-textarea" id="profile-skills-domain" rows="4">${escapeHtml(toCommaText(skills.domain))}</textarea></div>
          <div class="form-group"><label>${escapeHtml(tr('Software'))}</label><textarea class="form-textarea" id="profile-skills-software" rows="4">${escapeHtml(toCommaText(skills.software))}</textarea></div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Languages'))}</div></div>
      <div style="padding:16px">${langRows}<button class="btn btn-secondary btn-sm" onclick="addProfileRow('languages')">${escapeHtml(tr('Add Language'))}</button></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Experience'))}</div></div>
      <div style="padding:16px">${expRows}<button class="btn btn-secondary btn-sm" onclick="addProfileRow('experience')">${escapeHtml(tr('Add Experience'))}</button></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Education'))}</div></div>
      <div style="padding:16px">${eduRows}<button class="btn btn-secondary btn-sm" onclick="addProfileRow('education')">${escapeHtml(tr('Add Education'))}</button></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Career Goals'))}</div></div>
      <div style="padding:16px">
        <div class="form-group"><label>${escapeHtml(tr('Target Roles'))}</label><textarea class="form-textarea" id="profile-target-roles" rows="3">${escapeHtml(toCommaText(goals.targetRoles))}</textarea></div>
      </div>
    </div>

    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="saveProfileFromForm()">${escapeHtml(tr('Save Profile'))}</button>
      <button class="btn btn-secondary" onclick="downloadProfilePdf()">⬇ ${escapeHtml(tr('Download CV PDF'))}</button>
    </div>`;
}

function resumeReviewHtml(profile) {
  const id = profile.identity || {};
  const exp = (profile.experience || []).length;
  const edu = (profile.education || []).length;
  const skills = Object.values(profile.skills || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
  const meta = window._uploadedParseMeta || {};
  const sourceBadge = meta.source === 'ai'
    ? '<span class="badge badge-active">AI</span>'
    : '<span class="badge badge-draft">Local parser</span>';
  const lang = meta.detectedLanguage;
  const langBadge = lang
    ? `<span class="badge badge-active">${escapeHtml(tr('Detected language:'))} ${escapeHtml(lang.label)}${lang.code === 'zh' ? ' (中文)' : ''}</span>`
    : '';
  return `
    <div class="alert alert-success">
      <strong>${escapeHtml(tr('Resume read successfully'))}</strong> ${sourceBadge} ${langBadge}<br>
      ${meta.warning ? `<span style="color:var(--warning)">${escapeHtml(tr('Parse warning:'))} ${escapeHtml(meta.warning)}</span><br>` : ''}
      ${escapeHtml(tr('Name'))}: ${escapeHtml(id.name || '-')} &middot;
      ${escapeHtml(tr('Email'))}: ${escapeHtml(id.email || '-')} &middot;
      ${escapeHtml(tr('Location'))}: ${escapeHtml(id.location || '-')}<br>
      ${escapeHtml(tr('Experience'))}: ${exp} &middot;
      ${escapeHtml(tr('Education'))}: ${edu} &middot;
      ${escapeHtml(tr('Skills'))}: ${skills}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="applyUploadedProfile('replace')">${escapeHtml(tr('Replace Profile With Resume'))}</button>
      <button class="btn btn-secondary btn-sm" onclick="applyUploadedProfile('merge')">${escapeHtml(tr('Merge Into Profile'))}</button>
    </div>`;
}

async function downloadProfilePdf() {
  try {
    const response = await fetch('/api/generate-cv-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'PDF generation failed');
    }
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match ? match[1] : 'CV.pdf';
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    tAlert(tr('PDF downloaded'));
  } catch (err) {
    tAlert('Download failed: ' + (err && err.message ? err.message : err));
  }
}

async function uploadProfilePhoto() {
  const input = document.getElementById('profile-photo-file');
  const file = input?.files?.[0];
  if (!file) { tAlert(tr('Please choose an image first.')); return; }
  const form = new FormData();
  form.append('file', file, file.name);
  try {
    const response = await fetch('/api/profile-photo', { method: 'POST', body: form, credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Upload failed');
    const img = document.getElementById('profile-photo-preview');
    const placeholder = document.getElementById('profile-photo-placeholder');
    if (img) { img.src = result.photoUrl; img.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';
    if (profileData?.identity) {
      profileData.identity.photoUrl = result.photoUrl;
      try { await API.put('profile', profileData); } catch (e) { /* photo still saved */ }
    }
    tAlert(tr('Photo saved'));
  } catch (err) {
    tAlert('Upload failed: ' + (err && err.message ? err.message : err));
  }
}

async function removeProfilePhoto() {
  if (!confirm(tr('Remove profile photo?'))) return;
  try {
    const result = await API.del('profile-photo');
    if (!result.ok) throw new Error(result.error || 'Remove failed');
    const img = document.getElementById('profile-photo-preview');
    const placeholder = document.getElementById('profile-photo-placeholder');
    if (img) { img.removeAttribute('src'); img.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'flex';
    const input = document.getElementById('profile-photo-file');
    if (input) input.value = '';
    if (profileData?.identity) {
      delete profileData.identity.photoUrl;
      try { await API.put('profile', profileData); } catch (e) { /* photo still removed */ }
    }
    tAlert(tr('Photo removed'));
  } catch (err) {
    tAlert('Remove failed: ' + (err && err.message ? err.message : err));
  }
}

async function uploadResumeFile() {
  const input = document.getElementById('resume-file');
  const file = input?.files?.[0];
  const box = document.getElementById('resume-review');
  if (!file) { tAlert('Please choose a resume file first.'); return; }
  if (box) box.innerHTML = `<div class="alert alert-info">${escapeHtml(tr('Reading resume file...'))}</div>`;
  try {
    const form = new FormData();
    form.append('file', file, file.name);
    const response = await fetch('/api/upload-resume', { method: 'POST', body: form, credentials: 'same-origin' });
    if (response.status === 401) { showAuthScreen(tr('Session expired. Please sign in again.')); return; }
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Upload failed');
    window._uploadedProfile = result.profile;
    window._uploadedParseMeta = { source: result.source, warning: result.warning, detectedLanguage: result.detectedLanguage };
    if (box) box.innerHTML = resumeReviewHtml(result.profile);
  } catch (err) {
    if (box) box.innerHTML = `<div class="alert alert-danger">${escapeHtml(String(err && err.message ? err.message : err))}</div>`;
  }
}

async function analyzePastedResume() {
  const text = (document.getElementById('resume-paste')?.value || '').trim();
  const box = document.getElementById('resume-review');
  if (!text) { tAlert('Please paste resume text first.'); return; }
  if (box) box.innerHTML = `<div class="alert alert-info">${escapeHtml(tr('Analyzing resume text...'))}</div>`;
  try {
    const result = await API.post('analyze-resume', { text, fileName: 'pasted resume' });
    if (!result.ok) throw new Error(result.error || 'Analysis failed');
    window._uploadedProfile = result.profile;
    window._uploadedParseMeta = { source: result.source, warning: result.warning, detectedLanguage: result.detectedLanguage };
    if (box) box.innerHTML = resumeReviewHtml(result.profile);
  } catch (err) {
    if (box) box.innerHTML = `<div class="alert alert-danger">${escapeHtml(String(err && err.message ? err.message : err))}</div>`;
  }
}

function mergeObject(base, incoming) {
  const out = { ...(base || {}) };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (value === '' || value === null || value === undefined) return;
    if (Array.isArray(value)) out[key] = mergeList(out[key], value);
    else if (value && typeof value === 'object') out[key] = mergeObject(out[key], value);
    else out[key] = value;
  });
  return out;
}

function mergeList(base, incoming) {
  const out = Array.isArray(base) ? base.slice() : [];
  incoming.forEach(item => {
    const key = typeof item === 'object' ? JSON.stringify(item) : String(item);
    if (!out.some(existing => (typeof existing === 'object' ? JSON.stringify(existing) : String(existing)) === key)) out.push(item);
  });
  return out;
}

async function applyUploadedProfile(mode) {
  const parsed = window._uploadedProfile;
  if (!parsed) return;
  const next = mode === 'merge' ? mergeObject(profileData, parsed) : parsed;
  try {
    const result = await API.put('profile', next);
    if (!result.ok) throw new Error(result.error || 'Save failed');
    tAlert('Profile saved');
    profileData = next;
    renderProfile();
  } catch (err) {
    tAlert('Save failed: ' + (err && err.message ? err.message : err));
  }
}

function addProfileRow(kind) {
  if (!profileData) return;
  profileData[kind] = profileData[kind] || [];
  if (kind === 'languages') profileData.languages.push({ language: '', level: '' });
  if (kind === 'experience') profileData.experience.push({ title: '', company: '', start: '', end: '', location: '', bullets: [] });
  if (kind === 'education') profileData.education.push({ degree: '', institution: '', start: '', end: '', topics: '' });
  renderProfile();
}

function removeProfileRow(kind, index) {
  if (!profileData || !Array.isArray(profileData[kind])) return;
  profileData[kind].splice(index, 1);
  renderProfile();
}

async function saveProfileFromForm() {
  if (!profileData) return;
  const updated = JSON.parse(JSON.stringify(profileData));
  updated.identity = updated.identity || {};
  const identityMap = {
    name: 'profile-name', email: 'profile-email', phone: 'profile-phone',
    location: 'profile-location', linkedin: 'profile-linkedin', github: 'profile-github',
    cvLanguage: 'profile-cv-language', status: 'profile-status',
  };
  Object.entries(identityMap).forEach(([key, elementId]) => {
    updated.identity[key] = document.getElementById(elementId)?.value.trim() || '';
  });

  const split = value => (value || '').split(',').map(s => s.trim()).filter(Boolean);
  updated.skills = updated.skills || {};
  ['primary', 'secondary', 'domain', 'software'].forEach(key => {
    updated.skills[key] = split(document.getElementById('profile-skills-' + key)?.value);
  });

  updated.languages = Array.from(document.querySelectorAll('[data-lang-name]')).map((el, i) => ({
    language: el.value.trim(),
    level: document.querySelector(`[data-lang-level="${i}"]`)?.value.trim() || '',
  })).filter(l => l.language || l.level);

  updated.experience = Array.from(document.querySelectorAll('[data-exp-title]')).map((el, i) => ({
    title: el.value.trim(),
    company: document.querySelector(`[data-exp-company="${i}"]`)?.value.trim() || '',
    start: document.querySelector(`[data-exp-start="${i}"]`)?.value.trim() || '',
    end: document.querySelector(`[data-exp-end="${i}"]`)?.value.trim() || '',
    location: document.querySelector(`[data-exp-location="${i}"]`)?.value.trim() || '',
    bullets: textLines(document.querySelector(`[data-exp-bullets="${i}"]`)?.value),
  })).filter(e => e.title || e.company || e.bullets.length);

  updated.education = Array.from(document.querySelectorAll('[data-edu-degree]')).map((el, i) => ({
    degree: el.value.trim(),
    institution: document.querySelector(`[data-edu-institution="${i}"]`)?.value.trim() || '',
    start: document.querySelector(`[data-edu-start="${i}"]`)?.value.trim() || '',
    end: document.querySelector(`[data-edu-end="${i}"]`)?.value.trim() || '',
    topics: document.querySelector(`[data-edu-topics="${i}"]`)?.value.trim() || '',
  })).filter(e => e.degree || e.institution);

  updated.careerGoals = updated.careerGoals || {};
  updated.careerGoals.targetRoles = split(document.getElementById('profile-target-roles')?.value);

  try {
    const result = await API.put('profile', updated);
    if (result.ok) {
      profileData = updated;
      tAlert('Profile saved');
      renderProfile();
    } else {
      tAlert('Save failed');
    }
  } catch (err) {
    tAlert('Save failed: ' + (err && err.message ? err.message : err));
  }
}

// ============ Search Queries ============
let searchQueriesState = { priorities: [], locationFilter: {} };
let editingPriorityId = null; // null | 'new' | priority id
let editingLocation = null; // null | { category, index: number|'new', value }

function textLines(value) {
  return (value || '').split('\n').map(s => s.trim()).filter(Boolean);
}

async function renderQueries() {
  const q = await API.get('search-queries');
  searchQueriesState = {
    priorities: Array.isArray(q.priorities) ? q.priorities : [],
    locationFilter: q.locationFilter || {},
  };
  editingPriorityId = null;
  editingLocation = null;
  drawQueries();
}

function priorityEditorHtml(priority, isNew) {
  const p = priority || {};
  return `
    <div class="card" style="margin-bottom:12px;border-color:var(--accent)">
      <div class="card-header"><div class="card-title">${escapeHtml(tr(isNew ? 'Add Priority' : 'Edit'))}</div></div>
      <div style="padding:16px">
        <div class="form-group"><label>${escapeHtml(tr('Name'))}</label><input class="form-input" id="q-edit-name" value="${escapeHtml(p.name || '')}"></div>
        <div class="form-group"><label>${escapeHtml(tr('Keywords'))}</label><textarea class="form-textarea" id="q-edit-terms" rows="3" placeholder="${escapeHtml(tr('One keyword per line'))}">${escapeHtml((p.terms || []).join('\n'))}</textarea></div>
        <div class="form-group"><label>${escapeHtml(tr('Web search'))}</label><textarea class="form-textarea" id="q-edit-websearch" rows="3" placeholder="${escapeHtml(tr('One search query per line'))}">${escapeHtml((p.websearch || []).join('\n'))}</textarea></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="savePriorityEditor()">${escapeHtml(tr(isNew ? 'Create Priority' : 'Save'))}</button>
          <button class="btn btn-secondary" onclick="cancelPriorityEditor()">${escapeHtml(tr('Cancel'))}</button>
        </div>
      </div>
    </div>`;
}

function locationEditorHtml(isNew) {
  return `
    <div style="padding:10px;background:var(--bg);border:1px solid var(--accent);border-radius:6px;margin-bottom:8px">
      <input class="form-input" id="q-location-value" value="${escapeHtml(editingLocation?.value || '')}" placeholder="${escapeHtml(tr('Location name'))}">
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary btn-sm" onclick="saveLocationEditor()">${escapeHtml(tr(isNew ? 'Add Location' : 'Save'))}</button>
        <button class="btn btn-secondary btn-sm" onclick="cancelLocationEditor()">${escapeHtml(tr('Cancel'))}</button>
      </div>
    </div>`;
}

function locationSectionHtml(category, label) {
  const items = Array.isArray(searchQueriesState.locationFilter?.[category])
    ? searchQueriesState.locationFilter[category] : [];
  const isEditing = editingLocation && editingLocation.category === category;
  const rows = items.map((value, i) => {
    if (isEditing && editingLocation.index === i) return locationEditorHtml(false);
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg);border-radius:6px;margin-bottom:6px">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(value)}</span>
        <button class="btn btn-secondary btn-sm" onclick="moveLocation('${category}',${i},'up')" ${i === 0 ? 'disabled' : ''} title="${escapeHtml(tr('Move Up'))}">↑</button>
        <button class="btn btn-secondary btn-sm" onclick="moveLocation('${category}',${i},'down')" ${i === items.length - 1 ? 'disabled' : ''} title="${escapeHtml(tr('Move Down'))}">↓</button>
        <button class="btn btn-secondary btn-sm" onclick="editLocation('${category}',${i})">${escapeHtml(tr('Edit'))}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteLocation('${category}',${i})">${escapeHtml(tr('Delete'))}</button>
      </div>`;
  }).join('');
  const empty = !items.length && !(isEditing && editingLocation.index === 'new')
    ? `<p style="color:var(--muted);font-size:13px">${escapeHtml(tr('No locations configured'))}</p>` : '';
  const addEditor = isEditing && editingLocation.index === 'new' ? locationEditorHtml(true) : '';
  return `
    <div style="margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
        <strong>${escapeHtml(label)} (${items.length})</strong>
        <button class="btn btn-secondary btn-sm" onclick="startNewLocation('${category}')">${escapeHtml(tr('Add Location'))}</button>
      </div>
      ${empty}${rows}${addEditor}
    </div>`;
}

function drawQueries() {
  const target = document.getElementById('page-content');
  if (!target) return;
  const priorities = searchQueriesState.priorities || [];

  const rows = priorities.map((p, i) => {
    if (editingPriorityId === p.id) return priorityEditorHtml(p, false);
    const terms = Array.isArray(p.terms) ? p.terms : [];
    const web = Array.isArray(p.websearch) ? p.websearch : [];
    const preview = [...terms.slice(0, 3), ...web.slice(0, 2)].map(s => escapeHtml(s)).join(' · ');
    return `
      <div class="card" style="margin-bottom:10px">
        <div class="card-header">
          <div class="card-title">#${i + 1} ${escapeHtml(p.name || tr('Untitled'))}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" onclick="movePriority('${escapeHtml(p.id)}','up')" ${i === 0 ? 'disabled' : ''} title="${escapeHtml(tr('Move Up'))}">↑</button>
            <button class="btn btn-secondary btn-sm" onclick="movePriority('${escapeHtml(p.id)}','down')" ${i === priorities.length - 1 ? 'disabled' : ''} title="${escapeHtml(tr('Move Down'))}">↓</button>
            <button class="btn btn-secondary btn-sm" onclick="editPriority('${escapeHtml(p.id)}')">${escapeHtml(tr('Edit'))}</button>
            <button class="btn btn-danger btn-sm" onclick="deletePriority('${escapeHtml(p.id)}')">${escapeHtml(tr('Delete'))}</button>
          </div>
        </div>
        <div style="padding:12px">
          <div style="font-size:13px;color:var(--muted)">${escapeHtml(tr('Keywords'))}: ${terms.length} &middot; ${escapeHtml(tr('Web search'))}: ${web.length}</div>
          ${preview ? `<div style="font-size:12px;color:var(--muted);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  const newEditor = editingPriorityId === 'new' ? priorityEditorHtml(null, true) : '';
  const empty = !priorities.length && editingPriorityId !== 'new'
    ? `<p style="color:var(--muted)">${escapeHtml(tr('No priorities configured'))}</p>` : '';

  target.innerHTML = `
    <h1 class="page-title">${escapeHtml(tr('Search Queries'))}</h1>
    <p class="page-subtitle">${escapeHtml(tr('Configure job search priorities'))}</p>
    <div class="card">
      <div class="card-header">
        <div class="card-title">${escapeHtml(tr('Priorities'))} (${priorities.length})</div>
        <button class="btn btn-primary btn-sm" onclick="startNewPriority()">${escapeHtml(tr('Add Priority'))}</button>
      </div>
      <div style="padding:16px">${empty}${rows}${newEditor}</div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Location Filter'))}</div></div>
      <div style="padding:16px">
        ${locationSectionHtml('areas', tr('Acceptable'))}
        ${locationSectionHtml('borderline', tr('Borderline'))}
        ${locationSectionHtml('tooFar', tr('Too Far'))}
      </div>
    </div>`;
}

function startNewPriority() {
  editingPriorityId = 'new';
  drawQueries();
  document.getElementById('q-edit-name')?.focus();
}

function editPriority(id) {
  editingPriorityId = id;
  drawQueries();
  document.getElementById('q-edit-name')?.focus();
}

function cancelPriorityEditor() {
  editingPriorityId = null;
  drawQueries();
}

async function savePriorityEditor() {
  const name = document.getElementById('q-edit-name')?.value.trim() || '';
  if (!name) { tAlert(tr('Please enter a priority name')); return; }
  const payload = {
    name,
    terms: textLines(document.getElementById('q-edit-terms')?.value),
    websearch: textLines(document.getElementById('q-edit-websearch')?.value),
  };
  const isNew = editingPriorityId === 'new';
  try {
    const result = isNew
      ? await API.post('search-queries/priorities', payload)
      : await API.put('search-queries/priorities/' + encodeURIComponent(editingPriorityId), payload);
    if (!result.ok || !result.priorities) throw new Error(result.error || 'Save failed');
    searchQueriesState.priorities = result.priorities;
    editingPriorityId = null;
    drawQueries();
    tAlert(tr('Saved'));
  } catch (err) {
    tAlert('Save failed: ' + (err && err.message ? err.message : err));
  }
}

async function deletePriority(id) {
  if (!confirm(tr('Delete this priority?'))) return;
  try {
    const result = await API.del('search-queries/priorities/' + encodeURIComponent(id));
    if (!result.ok || !result.priorities) throw new Error(result.error || 'Delete failed');
    searchQueriesState.priorities = result.priorities;
    if (editingPriorityId === id) editingPriorityId = null;
    drawQueries();
    tAlert(tr('Deleted'));
  } catch (err) {
    tAlert('Delete failed: ' + (err && err.message ? err.message : err));
  }
}

async function movePriority(id, direction) {
  try {
    const result = await API.post('search-queries/priorities/' + encodeURIComponent(id) + '/move', { direction });
    if (!result.ok || !result.priorities) throw new Error(result.error || 'Move failed');
    searchQueriesState.priorities = result.priorities;
    drawQueries();
  } catch (err) {
    tAlert('Move failed: ' + (err && err.message ? err.message : err));
  }
}

function startNewLocation(category) {
  editingLocation = { category, index: 'new', value: '' };
  drawQueries();
  document.getElementById('q-location-value')?.focus();
}

function editLocation(category, index) {
  const value = searchQueriesState.locationFilter?.[category]?.[index] || '';
  editingLocation = { category, index, value };
  drawQueries();
  document.getElementById('q-location-value')?.focus();
}

function cancelLocationEditor() {
  editingLocation = null;
  drawQueries();
}

async function saveLocationEditor() {
  if (!editingLocation) return;
  const value = document.getElementById('q-location-value')?.value.trim() || '';
  if (!value) { tAlert(tr('Please enter a location')); return; }
  const base = 'search-queries/locations/' + encodeURIComponent(editingLocation.category);
  const isNew = editingLocation.index === 'new';
  try {
    const result = isNew
      ? await API.post(base, { value })
      : await API.put(base + '/' + editingLocation.index, { value });
    if (!result.ok || !result.locationFilter) throw new Error(result.error || 'Save failed');
    searchQueriesState.locationFilter = result.locationFilter;
    editingLocation = null;
    drawQueries();
    tAlert(tr('Saved'));
  } catch (err) {
    tAlert('Save failed: ' + (err && err.message ? err.message : err));
  }
}

async function deleteLocation(category, index) {
  if (!confirm(tr('Delete this location?'))) return;
  try {
    const result = await API.del('search-queries/locations/' + encodeURIComponent(category) + '/' + index);
    if (!result.ok || !result.locationFilter) throw new Error(result.error || 'Delete failed');
    searchQueriesState.locationFilter = result.locationFilter;
    if (editingLocation && editingLocation.category === category && editingLocation.index === index) editingLocation = null;
    drawQueries();
    tAlert(tr('Deleted'));
  } catch (err) {
    tAlert('Delete failed: ' + (err && err.message ? err.message : err));
  }
}

async function moveLocation(category, index, direction) {
  try {
    const result = await API.post('search-queries/locations/' + encodeURIComponent(category) + '/' + index + '/move', { direction });
    if (!result.ok || !result.locationFilter) throw new Error(result.error || 'Move failed');
    searchQueriesState.locationFilter = result.locationFilter;
    drawQueries();
  } catch (err) {
    tAlert('Move failed: ' + (err && err.message ? err.message : err));
  }
}

// ============ Repo Browser ============
async function renderRepo(relPath = '') {
  try { relPath = decodeURIComponent(relPath || ''); } catch (e) { /* already decoded */ }
  const data = await API.get('repo-files?path=' + encodeURIComponent(relPath));
  const target = document.getElementById('page-content');
  if (!target) return;
  if (data.error) {
    target.innerHTML = `<h1 class="page-title">${escapeHtml(tr('Repo Browser'))}</h1><div class="alert alert-danger">${escapeHtml(data.error)}</div>`;
    return;
  }
  if (data.type === 'file') {
    target.innerHTML = `
      <h1 class="page-title">${escapeHtml(data.name || '')}</h1>
      <button class="btn btn-secondary btn-sm" onclick="renderRepo('')">${escapeHtml(tr('Repositories'))}</button>
      <pre class="code-block" style="margin-top:16px;white-space:pre-wrap">${escapeHtml(data.content || '')}</pre>`;
    return;
  }
  const items = data.items || [];
  const go = value => "renderRepo('" + encodeURIComponent(value).replace(/'/g, '%27') + "')";
  const folderIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent)" aria-hidden="true"><path d="M2 6h7l2 2h11v11H2z"/></svg>';
  const fileIcon = '<svg width="12" height="15" viewBox="0 0 24 24" aria-hidden="true"><path fill="var(--accent)" d="M5 2h9l5 5v15H5z"/><path fill="var(--panel)" d="M14 2v6h5z"/></svg>';
  const rows = items.map(item => {
    const child = relPath ? relPath + '/' + item.name : item.name;
    return `<div class="file-item" onclick="${go(child)}" title="${escapeHtml(child)}"><span class="file-icon">${item.isDirectory ? folderIcon : fileIcon}</span><span class="file-name">${escapeHtml(item.name)}</span><span class="file-size">${item.isDirectory ? '' : item.size + ' B'}</span></div>`;
  }).join('') || `<div class="empty-state">${escapeHtml(tr('No results'))}</div>`;
  const parent = relPath.split('/').slice(0, -1).join('/');
  target.innerHTML = `
    <h1 class="page-title">${escapeHtml(tr('Repo Browser'))}</h1>
    <p class="page-subtitle">${escapeHtml(tr('Browse repository files'))}${relPath ? ' &middot; ' + escapeHtml(relPath) : ''}</p>
    ${relPath ? `<button class="btn btn-secondary btn-sm" onclick="${go(parent)}">..</button>` : ''}
    <div class="card" style="margin-top:12px"><div class="file-browser">${rows}</div></div>`;
}

// ============ HTML Report ============
async function renderReport() {
  document.getElementById('page-content').innerHTML = `
    <h1 class="page-title">${escapeHtml(tr('HTML Report'))}</h1>
    <p class="page-subtitle">${escapeHtml(tr('Generate a comprehensive HTML report from your tracker data including:'))}</p>
    <div class="card">
      <div class="card-header"><div class="card-title">${escapeHtml(tr('Report Options'))}</div></div>
      <div style="padding:16px">
        <ul style="margin-left:20px">
          <li>${escapeHtml(tr('Application Funnel'))}</li>
          <li>${escapeHtml(tr('By Sector'))} / ${escapeHtml(tr('By Channel'))}</li>
          <li>${escapeHtml(tr('Application Tracker'))}</li>
        </ul>
      </div>
      <div style="padding:0 16px 16px"><button class="btn btn-primary" onclick="generateReport()">${escapeHtml(tr('Generate Report'))}</button></div>
    </div>
    <div id="report-result" style="margin-top:16px"></div>`;
}

async function generateReport() {
  const target = document.getElementById('report-result');
  if (!target) return;
  target.innerHTML = `<div class="alert alert-info">${escapeHtml(tr('Generating...'))}</div>`;
  try {
    const result = await API.post('html-report', {});
    if (!result.ok || !result.html) throw new Error(result.error || tr('Unknown error'));
    window._reportData = result.html;
    target.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${escapeHtml(tr('Report Generated'))}</div>
          <button class="btn btn-primary btn-sm" onclick="downloadReport()">${escapeHtml(tr('Download'))}</button>
        </div>
        <div style="padding:16px"><iframe srcdoc="${escapeHtml(result.html)}" style="width:100%;height:600px;border:1px solid var(--stroke);border-radius:6px"></iframe></div>
      </div>`;
  } catch (err) {
    target.innerHTML = `<div class="alert alert-danger">${escapeHtml(String(err && err.message ? err.message : err))}</div>`;
  }
}

function downloadReport() {
  if (!window._reportData) return;
  const blob = new Blob([window._reportData], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'job-report.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

let authMode = 'login';

function renderAuthMode() {
  const isRegister = authMode === 'register';
  const title = document.getElementById('auth-title');
  const submit = document.getElementById('auth-submit');
  const nameGroup = document.getElementById('auth-name-group');
  const switchLink = document.getElementById('auth-switch');
  if (title) title.textContent = tr(isRegister ? 'Create account' : 'Sign in');
  if (submit) submit.textContent = tr(isRegister ? 'Create account' : 'Sign in');
  if (nameGroup) nameGroup.style.display = isRegister ? '' : 'none';
  if (switchLink) switchLink.textContent = tr(isRegister ? 'Already have an account? Sign in' : 'Need an account? Register');
}

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  const error = document.getElementById('auth-error');
  if (error) error.style.display = 'none';
  renderAuthMode();
}

function showAuthScreen(message) {
  // Authentication now lives on the dedicated /login page.
  if (message) {
    try { sessionStorage.setItem('authNotice', message); } catch (e) { /* ignore */ }
  }
  if (!location.pathname.startsWith('/login') && !location.pathname.startsWith('/register')) {
    window.location.assign(message ? '/login?reason=session' : '/login');
  }
}

function hideAuthScreen() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.style.display = 'none';
  const app = document.getElementById('app');
  if (app) app.style.display = '';
}

function applyAuth(data) {
  currentUser = data.user || null;
  entitlements = data.entitlements || null;
  renderAccountPanel();
  applyAccessRules();
}

function renderAccountPanel() {
  const panel = document.getElementById('account-panel');
  if (!panel) return;
  panel.style.display = currentUser ? 'flex' : 'none';
  if (!currentUser) return;
  const email = document.getElementById('account-email');
  const plan = document.getElementById('account-plan');
  if (email) email.textContent = currentUser.email || '';
  if (plan) plan.textContent = (entitlements && entitlements.label) || currentUser.plan || '';
}

async function submitAuth(event) {
  if (event) event.preventDefault();
  const error = document.getElementById('auth-error');
  if (error) error.style.display = 'none';
  const email = (document.getElementById('auth-email')?.value || '').trim();
  const password = document.getElementById('auth-password')?.value || '';
  const name = (document.getElementById('auth-name')?.value || '').trim();
  try {
    const result = await API.post(`auth/${authMode}`, authMode === 'register' ? { email, password, name } : { email, password });
    applyAuth(result);
    hideAuthScreen();
    currentPage = 'dashboard';
    renderPage();
  } catch (err) {
    if (error) {
      error.textContent = err.message || 'Authentication failed';
      error.style.display = '';
    }
  }
}

async function logoutUser() {
  try { await API.post('auth/logout', {}); } catch (e) { /* ignore */ }
  currentUser = null;
  entitlements = null;
  renderAccountPanel();
  applyAccessRules();
  window.location.assign('/login');
}

async function bootstrapAuth() {
  try {
    const result = await API.get('auth/me');
    if (result.user) {
      applyAuth(result);
      hideAuthScreen();
      renderPage();
      return;
    }
  } catch (e) { /* show login below */ }
  showAuthScreen();
}

function bootApp() {
  if (window.initI18n) initI18n();
  renderAuthMode();
  bootstrapAuth();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}

// ============ Admin Panel (owner-only SPA page) ============
async function renderAdminPanel() {
  const content = document.getElementById('page-content');
  if (!isOwner()) {
    content.innerHTML = '<div class="empty-state">Admin access is restricted to Owner accounts.</div>';
    return;
  }
  content.innerHTML = `
    <header class="admin-panel-head">
      <h1 class="page-title">${escapeHtml(tr('Admin'))}</h1>
      <div class="admin-panel-meta" id="adminMeta"></div>
    </header>
    <section class="admin-panel-body">
      <div class="admin-panel-toolbar">
        <input type="search" id="adminSearch" class="form-input" placeholder="${escapeHtml(tr('Search users...'))}" autocomplete="off" />
        <button class="btn btn-secondary btn-sm" id="adminRefresh">${escapeHtml(tr('Refresh'))}</button>
        <button class="btn btn-primary btn-sm" id="adminNewUser">${escapeHtml(tr('New user'))}</button>
        <button class="btn btn-secondary btn-sm" id="adminExport">${escapeHtml(tr('Download Excel'))}</button>
      </div>
      <div class="table-container">
        <table>
          <thead><tr>
            <th>${escapeHtml(tr('Login ID'))}</th>
            <th>${escapeHtml(tr('Name'))}</th>
            <th>${escapeHtml(tr('Email'))}</th>
            <th>${escapeHtml(tr('Level'))}</th>
            <th>${escapeHtml(tr('Registered at'))}</th>
            <th>${escapeHtml(tr('Status'))}</th>
            <th style="width:120px">${escapeHtml(tr('Actions'))}</th>
          </tr></thead>
          <tbody id="adminTableBody"><tr><td colspan="7" class="empty-state">${escapeHtml(tr('Loading users...'))}</td></tr></tbody>
        </table>
      </div>
    </section>
  `;
  window.adminLoad().catch(() => { /* handled inside */ });
}

const API_PREFIX = '/api';
window.adminLoad = async function () {
  try {
    const res = await fetch(API_PREFIX + '/admin/users', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Forbidden');
    const data = await res.json();
    if (!Array.isArray(data.users)) throw new Error('Bad response');
    window.adminUsers = data.users;
    renderAdminTable();
    const meta = document.getElementById('adminMeta');
    if (meta) meta.textContent = data.users.length + ' registered users';
  } catch (e) {
    const body = document.getElementById('adminTableBody');
    if (body) body.innerHTML = `<tr><td colspan="6" class="empty-state">Cannot load users. ${escapeHtml(String(e.message || ''))}</td></tr>`;
    const meta = document.getElementById('adminMeta');
    if (meta) meta.textContent = 'Offline';
  }
};

function renderAdminTable() {
  const query = String((window.adminSearch || {}).value || '').toLowerCase();
  const users = Array.isArray(window.adminUsers) ? window.adminUsers : [];
  const visible = query ? users.filter(u => !query || u.name?.toLowerCase().includes(query) || u.email?.toLowerCase().includes(query)) : users;
  const tbody = document.getElementById('adminTableBody');
  if (!tbody) return;
  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No users found.</td></tr>`;
    return;
  }
  tbody.innerHTML = visible.map(user => {
    const level = String(user.level || 'free').toUpperCase();
    const status = String(user.status || 'Active');
    const id = encodeURIComponent(user.id);
    return `<tr>
      <td><code style="font-size:11px;color:var(--muted)">${escapeHtml(user.loginId || '-')}</code></td>
      <td>${escapeHtml(user.name || '')}</td>
      <td>${escapeHtml(user.email)}</td>
      <td><span class="badge badge-active">${level}</span></td>
      <td>${escapeHtml(user.registeredAt || '')}</td>
      <td><span class="badge ${status === 'Active' ? 'badge-applied' : 'badge-drafted'}">${status}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="window.adminOpenModal(${JSON.stringify(user)})">${escapeHtml(tr('Edit'))}</button>
        <button class="btn btn-danger btn-sm" onclick="window.adminDelete(this)" data-id="${id}">${escapeHtml(tr('Delete'))}</button>
      </td>
    </tr>`;
  }).join('');
}

function showAdminModal(user) {
  const id = document.createElement('div');
  id.className = 'modal-overlay';
  id.dataset.userId = user ? user.id : '';
  id.innerHTML = `
    <div class="modal">
      <div class="modal-header sticky">
        <div class="modal-title">${user ? escapeHtml(tr('Edit user')) : escapeHtml(tr('New user'))}</div>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <form onsubmit="window.adminSaveModal(event, this)">
        <div class="field-group">
          <label>${escapeHtml(tr('Name'))}</label>
          <input name="name" type="text" required value="${escapeHtml(user?.name || '')}" />
        </div>
        <div class="field-group">
          <label>${escapeHtml(tr('Email'))}</label>
          <input name="email" type="email" required ${user ? 'disabled' : ''} value="${escapeHtml(user?.email || '')}" />
        </div>
        <div class="field-group">
          <label>${escapeHtml(tr('Password'))} <span style="color:var(--muted);font-weight:400">${user ? '(' + escapeHtml(tr('leave blank to keep')) + ')' : ''}</span></label>
          <input name="password" type="password" minlength="8" ${user ? '' : 'required'} />
        </div>
        <div class="field-group">
          <label>${escapeHtml(tr('User level'))}</label>
          <select name="level" ${user ? '' : 'required'}>
            <option value="free"${(user?.level||'')==='free'?' selected':''}>Free</option>
            <option value="pro"${(user?.level||'')==='pro'?' selected':''}>Pro</option>
            <option value="team"${(user?.level||'')==='team'?' selected':''}>Team</option>
            <option value="owner"${(user?.level||'')==='owner'?' selected':''}>Owner</option>
          </select>
        </div>
        <div class="field-group">
          <label>${escapeHtml(tr('Status'))}</label>
          <select name="status">
            <option value="Active"${(user?.status||'')==='Active'?' selected':''}>Active</option>
            <option value="Disabled"${(user?.status||'')==='Disabled'?' selected':''}>Disabled</option>
          </select>
        </div>
        <p class="status-msg" aria-live="polite"></p>
        <div class="field-actions">
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">${escapeHtml(tr('Cancel'))}</button>
          <button type="submit" class="btn btn-primary">${user ? escapeHtml(tr('Save changes')) : escapeHtml(tr('Create user'))}</button>
        </div>
      </form>
    </div>
  `;
  id.addEventListener('click', e => { if (e.target === id) id.remove(); });
  document.body.appendChild(id);
  id.querySelector('[name="name"]').focus();
}
window.adminOpenModal = showAdminModal;

async function saveAdminModal(form) {
  const msg = form.querySelector('.status-msg');
  msg.textContent = '';
  msg.style.color = 'var(--muted)';
  try {
    const payload = {
      name: form.name.value.trim(),
      email: form.email.value.trim().toLowerCase(),
      password: form.password.value,
      level: form.level.value,
      status: form.status.value,
    };
    const overlay = form.closest('.modal-overlay');
    const userId = overlay ? overlay.dataset.userId : '';
    const url = API_PREFIX + '/admin/users' + (userId ? '/' + encodeURIComponent(userId) : '');
    const res = await fetch(url, {
      method: userId ? 'PUT' : 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed to save.');
    form.closest('.modal-overlay').remove();
    await window.adminLoad();
  } catch (e) {
    msg.textContent = e.message;
    msg.style.color = 'var(--danger)';
  }
}
window.adminSaveModal = saveAdminModal;

async function deleteAdminUser(button) {
  const id = button.dataset.id;
  if (!confirm(tr('Are you sure you want to remove this user? This cannot be undone.'))) return;
  try {
    const res = await fetch(API_PREFIX + '/admin/users/' + id, { method: 'DELETE', credentials: 'same-origin' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed to delete.');
    await window.adminLoad();
  } catch (e) {
    alert(e.message);
  }
}
window.adminDelete = deleteAdminUser;

// Expose search input for live filtering.
document.addEventListener('click', e => {
  const box = document.getElementById('adminSearch');
  if (!box) return;
  box.addEventListener('input', () => renderAdminTable());
  document.getElementById('adminRefresh')?.addEventListener('click', window.adminLoad);
  document.getElementById('adminNewUser')?.addEventListener('click', () => showAdminModal(null));
  document.getElementById('adminExport')?.addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = API_PREFIX + '/admin/users.xlsx';
    link.download = 'registered_users.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
});
