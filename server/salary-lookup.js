/**
 * Salary benchmark lookup.
 *
 * Port of the original repository's salary_lookup.py so the web app behaves
 * the same way: fuzzy company matching, Nordic spelling variants, legal
 * suffix stripping, city filtering and index/category rendering.
 */

// Legal suffixes and noise removed before comparing company names.
const STRIP_PATTERNS = [
  /\ba\/s\b/giu,
  /\baps\b/giu,
  /\bi\/s\b/giu,
  /\bp\/s\b/giu,
  /\bk\/s\b/giu,
  /\bivs\b/giu,
  /\bamba\b/giu,
  /\ba\.m\.b\.a\.?\b/giu,
  /\(vg\)/giu,
  /\(.*?\)/gu,
  /\bdanmark\b/giu,
  /\bdenmark\b/giu,
  /\bscandinavia\b/giu,
  /\bnordic\b/giu,
  /\bgroup\b/giu,
  /\bholding\b/giu,
  /,\s*.*$/u,
];

const SPELLING_VARIANTS = [
  ['ø', 'o'], ['æ', 'ae'], ['å', 'aa'],
  ['ö', 'o'], ['ä', 'ae'], ['ü', 'u'],
  ['þ', 'th'], ['ð', 'd'],
];

const DEFAULT_METADATA = {
  source: 'Personal research',
  index_baseline: 100,
  index_label: 'Index',
  baseline_description: 'Index 100 = baseline',
};

const MIN_SCORE = 30;

function casefold(value) {
  return String(value == null ? '' : value)
    .normalize('NFC')
    .toLowerCase()
    .replace(/ß/g, 'ss');
}

function isWordChar(ch) {
  return /[\p{L}\p{N}\p{M}]/u.test(ch);
}

/** Normalize a company name for exact/contains comparisons. */
function normalize(value) {
  let text = casefold(value).trim();
  for (const pattern of STRIP_PATTERNS) text = text.replace(pattern, '');
  return Array.from(text.normalize('NFC')).filter(isWordChar).join('');
}

/** Fold Nordic spellings first, then strip accents (ASCII-typed queries). */
function anglicize(value) {
  let text = String(value == null ? '' : value).toLowerCase();
  for (const [from, to] of SPELLING_VARIANTS) text = text.split(from).join(to);
  return text.normalize('NFKD').replace(/\p{M}/gu, '');
}

/** Meaningful words of a company name, ignoring legal suffixes/noise. */
function extractCoreWords(value) {
  let text = casefold(value);
  for (const pattern of STRIP_PATTERNS) text = text.replace(pattern, '');
  text = Array.from(text.normalize('NFC'))
    .map(ch => (isWordChar(ch) ? ch : ' '))
    .join('');
  return text.split(/\s+/).filter(word => word.length > 1);
}

function precomputeQuery(query) {
  const qNorm = normalize(query);
  const qWords = extractCoreWords(query);
  return {
    qNorm,
    qAng: anglicize(qNorm),
    qWordsSet: new Set(qWords),
    qWordsAngSet: new Set(qWords.map(anglicize)),
  };
}

/** Score one company name against a precomputed query, 0 - 100. */
function matchScoreOptimized(pre, entryName) {
  const nNorm = normalize(entryName);
  const { qNorm, qAng, qWordsSet, qWordsAngSet } = pre;
  if (!qNorm || !nNorm) return 0;

  if (qNorm === nNorm) return 100;

  if (nNorm.includes(qNorm)) {
    const ratio = qNorm.length / nNorm.length;
    if (qNorm.length <= 4 && ratio < 0.5) {
      const nWords = new Set(extractCoreWords(entryName));
      if ([...qWordsSet].some(word => nWords.has(word))) {
        return 80 + Math.floor(ratio * 10);
      }
    } else {
      return 80 + Math.floor(ratio * 10);
    }
  }

  if (qNorm.includes(nNorm)) {
    const ratio = nNorm.length / qNorm.length;
    if (!(nNorm.length <= 4 && ratio < 0.5)) {
      return 80 + Math.floor(ratio * 10);
    }
  }

  const nAng = anglicize(nNorm);
  if (qAng === nAng) return 85;
  if (qAng && nAng && (nAng.includes(qAng) || qAng.includes(nAng))) {
    const shorter = Math.min(qAng.length, nAng.length);
    const longer = Math.max(qAng.length, nAng.length);
    if (shorter <= 4 && shorter / longer < 0.5) {
      const nWordsAng = new Set([...extractCoreWords(entryName)].map(anglicize));
      if ([...qWordsAngSet].some(word => nWordsAng.has(word))) return 75;
    } else {
      return 75;
    }
  }

  const nWords = new Set(extractCoreWords(entryName));
  if (!qWordsSet.size || !nWords.size) return 0;

  let overlap = new Set([...qWordsSet].filter(word => nWords.has(word)));
  if (!overlap.size) {
    const nWordsAng = new Set([...nWords].map(anglicize));
    overlap = new Set([...qWordsAngSet].filter(word => nWordsAng.has(word)));
  }
  if (!overlap.size) return 0;

  if (qWordsSet.size === 1) {
    const qWord = [...qWordsSet][0];
    const nWordsAng = new Set([...nWords].map(anglicize));
    return nWords.has(qWord) || nWordsAng.has(anglicize(qWord)) ? 70 : 0;
  }

  return Math.floor(30 + (overlap.size / qWordsSet.size) * 40);
}

function matchScore(query, entryName) {
  return matchScoreOptimized(precomputeQuery(query), entryName);
}

/** City filter accepting Nordic/anglicized spelling variants. */
function cityMatches(city, entryCity) {
  const wanted = String(city || '').toLowerCase().trim();
  if (!wanted) return true;
  const actual = String(entryCity || '').toLowerCase().trim();
  return actual.includes(wanted) || anglicize(actual).includes(anglicize(wanted));
}

/** Fuzzy company search, mirroring salary_lookup.py search_company(). */
function searchCompany(data, query, city) {
  const companies = Array.isArray(data && data.companies) ? data.companies : [];
  const pre = precomputeQuery(query);
  const scored = [];

  for (const entry of companies) {
    if (!entry || typeof entry.company !== 'string') continue;
    if (!cityMatches(city, entry.city)) continue;
    const score = matchScoreOptimized(pre, entry.company);
    if (score > 0) scored.push({ score, entry });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.entry.company < b.entry.company) return -1;
    if (a.entry.company > b.entry.company) return 1;
    return 0;
  });

  return scored
    .filter(item => item.score >= MIN_SCORE)
    .map(item => ({ ...item.entry, matchScore: item.score }));
}

/**
 * Return displayable categories for an entry. Supports the documented
 * `categories` shape, sibling category objects, and legacy flat numeric
 * fields such as `{ salary: 120000 }`.
 */
function getCategories(entry) {
  if (!entry || typeof entry !== 'object') return {};
  const skip = new Set(['company', 'city', 'categories', 'matchScore', '_score']);
  let categories = {};

  if (entry.categories && typeof entry.categories === 'object' && !Array.isArray(entry.categories)) {
    categories = { ...entry.categories };
  } else {
    for (const [key, value] of Object.entries(entry)) {
      if (!skip.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        categories[key] = value;
      }
    }
  }

  // Legacy flat data: turn numbers into a single index category.
  if (!Object.keys(categories).length) {
    for (const [key, value] of Object.entries(entry)) {
      if (skip.has(key)) continue;
      const numeric = typeof value === 'number' ? value
        : (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
      if (numeric !== null) categories[key] = { index: numeric };
    }
  }

  return categories;
}

/** Percentage difference from baseline; null when not meaningful. */
function relativeToBaseline(index, baseline) {
  if (typeof index !== 'number' || !Number.isFinite(index)) return null;
  const base = Number(baseline);
  if (!Number.isFinite(base) || base === 0) return null;
  // Guard against legacy absolute salaries being compared with index 100.
  if (base === 100 && Math.abs(index) >= 1000) return null;
  return ((index - base) / base) * 100;
}

function formatIndex(index) {
  if (index === null || index === undefined) return '-';
  if (typeof index === 'number' && Number.isFinite(index)) return index.toFixed(1);
  return String(index);
}

function normalizeData(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawMeta = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const metadata = { ...DEFAULT_METADATA, ...rawMeta };
  const errors = [];
  const warnings = [];
  const seen = new Map();
  const companies = [];

  const list = Array.isArray(source.companies) ? source.companies : [];
  list.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      errors.push(`companies[${i}] must be an object`);
      return;
    }
    if (typeof entry.company !== 'string' || !entry.company.trim()) {
      errors.push(`companies[${i}].company must be a non-empty string`);
      return;
    }
    const key = entry.company.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`Duplicate company name "${entry.company}" (entries ${seen.get(key) + 1} and ${i + 1})`);
    } else {
      seen.set(key, i);
    }
    if (entry.city !== undefined && entry.city !== null && typeof entry.city !== 'string') {
      errors.push(`companies[${i}].city must be a string`);
    }
    if (entry.categories !== undefined && entry.categories !== null
      && (typeof entry.categories !== 'object' || Array.isArray(entry.categories))) {
      errors.push(`companies[${i}].categories must be an object`);
    }
    companies.push(entry);
  });

  if (!Array.isArray(source.companies)) errors.push("'companies' must be a list");
  if (!Number.isFinite(Number(metadata.index_baseline))) {
    errors.push("'metadata.index_baseline' must be a finite number");
  }

  return { metadata, companies, errors, warnings };
}

module.exports = {
  normalize,
  anglicize,
  extractCoreWords,
  matchScore,
  searchCompany,
  getCategories,
  relativeToBaseline,
  formatIndex,
  normalizeData,
  cityMatches,
};
