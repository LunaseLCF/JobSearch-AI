/**
 * Profile-based job matching for the Job Search page.
 * Builds criteria from the reliable parts of the candidate profile and
 * scores jobs so only relevant listings are shown by default.
 */

const STOP_WORDS = new Set([
  'management', 'operations', 'development', 'coordination', 'communication',
  'control', 'planning', 'support', 'analysis', 'experience', 'team', 'senior',
  'lead', 'staff', 'others', 'other', 'work', 'working', 'role', 'position',
  'international', 'business', 'customer', 'customer relationship',
]);

const GENERIC_ROLE_RE = /^(earlier|other|misc|n\/a|none|various|general)/i;

function unique(list) {
  return [...new Set(list.map(s => String(s || '').trim()).filter(Boolean))];
}

function tokensFrom(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff]+/)
    .filter(t => t.length > 3 && !STOP_WORDS.has(t));
}

function cleanRole(title) {
  const value = String(title || '').trim();
  if (!value || value.length > 70 || GENERIC_ROLE_RE.test(value)) return '';
  return value;
}

/** Extract the criteria we can trust from a profile. */
function buildCriteria(profile) {
  const p = profile || {};
  const roles = [];
  const pushRole = (value) => {
    const role = cleanRole(value);
    // Ignore malformed resume-parser output such as "spanning international trade, fruit"
    if (role && !/spanning|fruit|senior spanning|lead spanning/i.test(role)) roles.push(role);
  };
  (p.searchConfig && p.searchConfig.roleTitles || []).forEach(pushRole);
  (p.experience || []).forEach(exp => pushRole(exp && exp.title));
  (p.careerGoals && p.careerGoals.targetRoles || []).forEach(pushRole);

  const skills = unique([
    ...((p.searchConfig && p.searchConfig.keySkills) || []),
    ...((p.skills && p.skills.primary) || []),
    ...((p.skills && p.skills.secondary) || []),
    ...((p.skills && p.skills.domain) || []),
    ...((p.skills && p.skills.software) || []),
  ]);

  const companies = unique((p.searchConfig && p.searchConfig.targetCompanies) || []);
  const location = String((p.identity && p.identity.location) || '').trim();

  const roleTokens = unique(roles.flatMap(tokensFrom));
  const skillTokens = unique(skills.flatMap(tokensFrom));
  // Keep only meaningful, non-overlapping tokens.
  const filteredSkillTokens = skillTokens.filter(t => !roleTokens.includes(t));

  return {
    roles: unique(roles),
    roleTokens,
    skills,
    skillTokens: filteredSkillTokens,
    companies,
    location,
    hasCriteria: roles.length > 0 || filteredSkillTokens.length > 0 || companies.length > 0,
  };
}

/** Score one job against profile criteria. */
function scoreJob(job, criteria) {
  if (!criteria || !criteria.hasCriteria) return { score: 1, reasons: [], matched: true };

  const title = `${(job && job.title) || ''} ${(job && job.company) || ''}`.toLowerCase();
  const full = `${title} ${(job && (job.description || job.posting || '')) || ''}`.toLowerCase();
  let score = 0;
  const reasons = [];

  const roleHit = criteria.roles.find(role => title.includes(role.toLowerCase()));
  if (roleHit) {
    score += 3;
    reasons.push(`Role: ${roleHit}`);
  } else {
    for (const role of criteria.roles) {
      const hits = tokensFrom(role).filter(t => title.includes(t));
      if (hits.length >= 2) {
        score += 2;
        reasons.push(`Role keywords: ${hits.slice(0, 4).join(', ')}`);
        break;
      }
    }
  }

  const skillHits = criteria.skillTokens.filter(t => full.includes(t));
  if (skillHits.length) {
    score += Math.min(3, skillHits.length);
    reasons.push(`Skills: ${skillHits.slice(0, 6).join(', ')}`);
  }

  const companyHit = criteria.companies.find(c =>
    String((job && job.company) || '').toLowerCase().includes(String(c).toLowerCase()));
  if (companyHit) {
    score += 3;
    reasons.push(`Target company: ${companyHit}`);
  }

  return { score, reasons, matched: score >= 2 };
}

/** Filter jobs by profile relevance, keeping the strongest matches first. */
function filterJobsByProfile(jobs, profile) {
  const criteria = buildCriteria(profile);
  const scored = (Array.isArray(jobs) ? jobs : []).map(job => ({ job, match: scoreJob(job, criteria) }));
  const matched = scored.filter(item => item.match.matched)
    .sort((a, b) => b.match.score - a.match.score);
  return {
    jobs: matched.map(item => ({ ...item.job, profileMatch: item.match })),
    total: scored.length,
    matchedCount: matched.length,
    criteria: {
      roles: criteria.roles,
      skills: criteria.skills,
      companies: criteria.companies,
      location: criteria.location,
      hasCriteria: criteria.hasCriteria,
    },
  };
}

module.exports = { buildCriteria, scoreJob, filterJobsByProfile };
