const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const store = require('./store');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
const RESETS_FILE = path.join(DATA_DIR, 'password_resets.json');
const USER_DATA_ROOT = path.join(DATA_DIR, 'users');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

const requestContext = new AsyncLocalStorage();

const BASE_FILES = {
  profile: 'profile.json',
  tracker: 'tracker.json',
  seenJobs: 'seen_jobs.json',
  applications: 'applications.json',
  searchQueries: 'search_queries.json',
  salaryData: 'salary_data.json',
  reports: 'reports.json',
  llmConfig: 'llm-config.json',
};

// Every existing DATA_FILES.xxx reference resolves to the current user's dir.
const DATA_FILES = new Proxy({}, {
  get(_target, key) {
    if (!Object.prototype.hasOwnProperty.call(BASE_FILES, key)) return undefined;
    const ctx = requestContext.getStore() || {};
    const userId = safeUserId(ctx.userId || 'owner');
    return path.join(USER_DATA_ROOT, userId, BASE_FILES[key]);
  },
});

const PLANS = {
  free: {
    label: 'Free',
    features: { resumeParse: true, aiTailoring: false, aiInterview: false, llmConfig: false, repo: false, exports: false },
    limits: { resumeParse: 20, aiTailoring: 0, aiInterview: 0, llmConfig: 0, repo: 0, exports: 0 },
  },
  pro: {
    label: 'Pro',
    features: { resumeParse: true, aiTailoring: true, aiInterview: true, llmConfig: false, repo: false, exports: true },
    limits: { resumeParse: 500, aiTailoring: 300, aiInterview: 300, llmConfig: 0, repo: 0, exports: 500 },
  },
  team: {
    label: 'Team',
    features: { resumeParse: true, aiTailoring: true, aiInterview: true, llmConfig: true, repo: true, exports: true },
    limits: { resumeParse: 5000, aiTailoring: 3000, aiInterview: 3000, llmConfig: 1000, repo: 5000, exports: 3000 },
  },
  owner: {
    label: 'Owner',
    features: { resumeParse: true, aiTailoring: true, aiInterview: true, llmConfig: true, repo: true, exports: true },
    limits: { resumeParse: Infinity, aiTailoring: Infinity, aiInterview: Infinity, llmConfig: Infinity, repo: Infinity, exports: Infinity },
  },
};

const ROUTE_RULES = {
  'POST /api/tailor-resume': 'aiTailoring',
  'POST /api/interview-prep': 'aiInterview',
  'POST /api/analyze-resume': 'resumeParse',
  'POST /api/upload-resume': 'resumeParse',
  'GET /api/llm-config': 'llmConfig',
  'POST /api/llm-config': 'llmConfig',
  'DELETE /api/llm-config': 'llmConfig',
  'POST /api/llm-test': 'llmConfig',
  'GET /api/repo-files': 'repo',
  'POST /api/generate-cv': 'exports',
  'POST /api/generate-cover-letter': 'exports',
  'POST /api/html-report': 'exports',
};

const PUBLIC_ROUTES = new Set([
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/forgot',
  'POST /api/reset-password/validate',
  'POST /api/reset-password',
  'GET /api/auth/me',
]);

function safeUserId(id) {
  return String(id || 'owner').replace(/[^a-zA-Z0-9_-]/g, '') || 'owner';
}

function nowIso() {
  return new Date().toISOString();
}

function readJSON(file) {
  if (file === USERS_FILE) return store.readUsers();
  if (file === SESSIONS_FILE) return store.readSessions();
  if (file === USAGE_FILE) return store.readUsage();
  if (file === RESETS_FILE) return store.readResets();
  return store.readFile(file);
}

function writeJSON(file, data) {
  if (file === USERS_FILE) return store.writeUsers(data);
  if (file === SESSIONS_FILE) return store.writeSessions(data);
  if (file === USAGE_FILE) return store.writeUsage(data);
  if (file === RESETS_FILE) return store.writeResets(data);
  return store.writeFile(file, data);
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), useSalt, 64).toString('hex');
  return `${useSalt}:${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  const candidate = crypto.scryptSync(String(password), parts[0], 64).toString('hex');
  const a = Buffer.from(parts[1], 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readUsers() {
  return readJSON(USERS_FILE) || {};
}

function writeUsers(users) {
  writeJSON(USERS_FILE, users);
}

function userDir(userId) {
  return path.join(USER_DATA_ROOT, safeUserId(userId));
}

function initializeUserData(userId) {
  const dir = userDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name || '', plan: user.plan || 'free', createdAt: user.createdAt };
}

function initAuth() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(USER_DATA_ROOT, { recursive: true });
  store.initStore();
  const migration = store.migrateLegacy();
  if (migration.migrated) console.log('[db] migrated legacy JSON data:', migration.counts);

  const users = readUsers();
  const ownerId = 'owner';
  if (!Object.keys(users).length) {
    const bootstrapPassword = process.env.BOOTSTRAP_PASSWORD || 'admin1234';
    users[ownerId] = {
      id: ownerId,
      email: process.env.BOOTSTRAP_EMAIL || 'admin@local.app',
      name: 'Owner',
      plan: 'owner',
      passwordHash: hashPassword(bootstrapPassword),
      createdAt: nowIso(),
    };
    writeUsers(users);
    initializeUserData(ownerId);
  }
  return { ownerId };
}

function getUser(userId) {
  return readUsers()[safeUserId(userId)] || null;
}

function getUserByEmail(email) {
  const users = readUsers();
  return Object.values(users).find(u => String(u.email || '').toLowerCase() === String(email || '').toLowerCase()) || null;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = readJSON(SESSIONS_FILE) || {};
  Object.keys(sessions).forEach(key => {
    if (new Date(sessions[key].expiresAt) < new Date()) delete sessions[key];
  });
  sessions[token] = { userId: safeUserId(userId), createdAt: nowIso(), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() };
  writeJSON(SESSIONS_FILE, sessions);
  return token;
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function readResets() {
  return readJSON(RESETS_FILE) || {};
}

function cleanResets() {
  const resets = readResets();
  let changed = false;
  Object.keys(resets).forEach(hash => {
    if (new Date(resets[hash].expiresAt) < new Date() || resets[hash].usedAt) {
      delete resets[hash];
      changed = true;
    }
  });
  if (changed) writeJSON(RESETS_FILE, resets);
  return resets;
}

function createPasswordReset(email) {
  const user = getUserByEmail(email);
  if (!user) return { found: false };
  cleanResets();
  const token = crypto.randomBytes(32).toString('hex');
  const resets = readResets();
  resets[hashResetToken(token)] = {
    userId: user.id,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString(),
    usedAt: null,
  };
  writeJSON(RESETS_FILE, resets);
  return { found: true, token, user: publicUser(user) };
}

function validatePasswordReset(token) {
  if (!/^[a-f0-9]{64}$/i.test(String(token || ''))) return { ok: false, error: 'Invalid or expired reset link' };
  const entry = readResets()[hashResetToken(token)];
  if (!entry || entry.usedAt || new Date(entry.expiresAt) < new Date()) {
    return { ok: false, error: 'This reset link has expired or has already been used' };
  }
  const user = getUser(entry.userId);
  if (!user) return { ok: false, error: 'The account for this reset link no longer exists' };
  return { ok: true, email: user.email, name: user.name || '' };
}

function resetPasswordWithToken(token, password) {
  const check = validatePasswordReset(token);
  if (!check.ok) return check;
  if (String(password || '').length < 8) return { ok: false, error: 'Password must be at least 8 characters' };

  const users = readUsers();
  const user = Object.values(users).find(u => String(u.email).toLowerCase() === check.email.toLowerCase());
  if (!user) return { ok: false, error: 'Account not found' };
  user.passwordHash = hashPassword(password);
  writeUsers(users);

  const resets = readResets();
  const hash = hashResetToken(token);
  if (resets[hash]) resets[hash].usedAt = nowIso();
  writeJSON(RESETS_FILE, resets);

  // Sign the user out everywhere after a password change.
  const sessions = readJSON(SESSIONS_FILE) || {};
  Object.keys(sessions).forEach(key => {
    if (sessions[key].userId === user.id) delete sessions[key];
  });
  writeJSON(SESSIONS_FILE, sessions);

  return { ok: true, email: user.email };
}

function secureCookieFlag() {
  return process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
}

function sessionCookie(token) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax${secureCookieFlag()}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function clearSessionCookie() {
  return `sid=; Path=/; HttpOnly; SameSite=Lax${secureCookieFlag()}; Max-Age=0`;
}

function getSessionUser(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/);
  if (!match) return null;
  const sessions = readJSON(SESSIONS_FILE) || {};
  const session = sessions[match[1]];
  if (!session || new Date(session.expiresAt) < new Date()) return null;
  return getUser(session.userId);
}

function consumeUsage(userId, feature) {
  const limit = PLANS[getUser(userId)?.plan || 'free']?.limits?.[feature] ?? 0;
  if (limit === Infinity) return { ok: true, remaining: Infinity };
  const usage = readJSON(USAGE_FILE) || {};
  const uid = safeUserId(userId);
  const month = nowIso().slice(0, 7);
  usage[uid] = usage[uid] || {};
  usage[uid][month] = usage[uid][month] || {};
  const used = Number(usage[uid][month][feature] || 0);
  if (used >= limit) return { ok: false, used, limit };
  usage[uid][month][feature] = used + 1;
  writeJSON(USAGE_FILE, usage);
  return { ok: true, used: used + 1, limit };
}

function authorize(req, routeKey) {
  const user = getSessionUser(req);
  if (user) req.user = user;
  if (PUBLIC_ROUTES.has(routeKey)) return { ok: true };
  if (!user) return { ok: false, status: 401, error: 'Login required' };

  const feature = ROUTE_RULES[routeKey];
  if (!feature) return { ok: true };
  const plan = user.plan || 'free';
  if (!PLANS[plan]?.features?.[feature]) {
    const requiredPlan = suggestPlanFor(feature).toLowerCase();
    return { ok: false, status: 403, error: `This feature requires the ${suggestPlanFor(feature)} plan`, code: 'PLAN_REQUIRED', feature, plan, requiredPlan };
  }
  const usage = consumeUsage(user.id, feature);
  if (!usage.ok) {
    return { ok: false, status: 429, error: 'Monthly limit reached for this feature', code: 'LIMIT_REACHED', feature };
  }
  return { ok: true };
}

function suggestPlanFor(feature) {
  if (feature === 'repo') return 'Team';
  return 'Pro';
}

function registerUser(body) {
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const name = String(body?.name || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'A valid email is required' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters' };
  if (getUserByEmail(email)) return { error: 'Email already registered' };
  const users = readUsers();
  const id = 'user_' + crypto.randomBytes(6).toString('hex');
  users[id] = {
    id, email, name: name || email.split('@')[0], plan: 'pro',
    passwordHash: hashPassword(password), createdAt: nowIso(),
  };
  writeUsers(users);
  initializeUserData(id);
  return { user: publicUser(users[id]), token: createSession(id) };
}

function loginUser(body) {
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) return { error: 'Invalid email or password' };
  return { user: publicUser(user), token: createSession(user.id) };
}

function logoutUser(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/);
  if (match) {
    const sessions = readJSON(SESSIONS_FILE) || {};
    delete sessions[match[1]];
    writeJSON(SESSIONS_FILE, sessions);
  }
}

function entitlementsFor(user) {
  const plan = user?.plan || 'free';
  const definition = PLANS[plan] || PLANS.free;
  return { plan, label: definition.label, features: { ...definition.features } };
}

function runWithUser(userId, callback) {
  return requestContext.run({ userId: safeUserId(userId) }, callback);
}

module.exports = {
  initAuth,
  requestContext,
  DATA_FILES,
  USER_DATA_ROOT,
  PLANS,
  publicUser,
  getUser,
  readUsers,
  writeUsers,
  hashPassword,
  initializeUserData,
  getSessionUser,
  authorize,
  consumeUsage,
  registerUser,
  loginUser,
  logoutUser,
  createPasswordReset,
  validatePasswordReset,
  resetPasswordWithToken,
  entitlementsFor,
  sessionCookie,
  clearSessionCookie,
  runWithUser,
};
