// SQLite-backed storage. JSON files are kept only as a one-time migration source.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'careercompass.sqlite');

let db = null;

function nowIso() {
  return new Date().toISOString();
}

function safeUserId(id) {
  return String(id || 'owner').replace(/[^a-zA-Z0-9_-]/g, '') || 'owner';
}

function initStore() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL DEFAULT '',
      plan TEXT NOT NULL DEFAULT 'free',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_resets_expiry ON password_resets(expires_at);

    CREATE TABLE IF NOT EXISTS usage (
      user_id TEXT NOT NULL,
      month TEXT NOT NULL,
      feature TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, month, feature)
    );

    CREATE TABLE IF NOT EXISTS user_documents (
      user_id TEXT NOT NULL,
      doc_key TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, doc_key)
    );

    CREATE TABLE IF NOT EXISTS profile_photos (
      user_id TEXT PRIMARY KEY,
      ext TEXT NOT NULL,
      mime TEXT NOT NULL,
      original_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BLOB NOT NULL,
      uploaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  return db;
}

function requireDb() {
  return db || initStore();
}

// ---------- path compatibility ----------
// Existing code passes absolute file paths from auth.DATA_FILES. Map those to
// (user_id, doc_key) so no call site has to change.
function docRefForFile(file) {
  const abs = path.resolve(String(file || ''));
  const rel = path.relative(DATA_DIR, abs).split(path.sep).join('/');
  if (rel.startsWith('users/')) {
    const parts = rel.split('/');
    if (parts.length >= 3) {
      return { userId: safeUserId(parts[1]), key: parts.slice(2).join('/') };
    }
  }
  return { userId: 'global', key: rel };
}

function readFile(file) {
  const ref = docRefForFile(file);
  const row = requireDb().prepare('SELECT data FROM user_documents WHERE user_id = ? AND doc_key = ?')
    .get(ref.userId, ref.key);
  if (!row) return null;
  try { return JSON.parse(row.data); } catch (e) { return null; }
}

function writeFile(file, data) {
  const ref = docRefForFile(file);
  requireDb().prepare(`
    INSERT INTO user_documents (user_id, doc_key, data, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, doc_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(ref.userId, ref.key, JSON.stringify(data), nowIso());
}

function getDoc(userId, key) {
  const row = requireDb().prepare('SELECT data FROM user_documents WHERE user_id = ? AND doc_key = ?')
    .get(safeUserId(userId), String(key));
  if (!row) return null;
  try { return JSON.parse(row.data); } catch (e) { return null; }
}

function putDoc(userId, key, data) {
  writeFile(path.join(DATA_DIR, 'users', safeUserId(userId), String(key)), data);
}

// ---------- auth tables ----------
function readUsers() {
  const rows = requireDb().prepare('SELECT * FROM users').all();
  const out = {};
  rows.forEach(row => {
    out[row.id] = {
      id: row.id,
      email: row.email,
      name: row.name,
      plan: row.plan,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
    };
  });
  return out;
}

function writeUsers(users) {
  const insert = requireDb().prepare(`
    INSERT INTO users (id, email, name, plan, password_hash, created_at)
    VALUES (@id, @email, @name, @plan, @passwordHash, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email, name = excluded.name, plan = excluded.plan,
      password_hash = excluded.password_hash, created_at = excluded.created_at
  `);
  const dbRef = requireDb();
  const removeDuplicateEmail = dbRef.prepare('DELETE FROM users WHERE email = ? AND id <> ?');
  const tx = dbRef.transaction(list => {
    const ids = Object.keys(list || {}).filter(id => list[id] && list[id].id);
    if (!ids.length) {
      dbRef.prepare('DELETE FROM users').run();
      return;
    }
    dbRef.prepare(`DELETE FROM users WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
    Object.values(list || {}).forEach(user => {
      if (!user || !user.id) return;
      removeDuplicateEmail.run(String(user.email || '').toLowerCase(), user.id);
      insert.run({
        id: user.id,
        email: String(user.email || '').toLowerCase(),
        name: user.name || '',
        plan: user.plan || 'free',
        passwordHash: user.passwordHash || user.password_hash || '',
        createdAt: user.createdAt || user.created_at || nowIso(),
      });
    });
  });
  tx(users);
}

function readSessions() {
  const rows = requireDb().prepare('SELECT * FROM sessions').all();
  const out = {};
  rows.forEach(row => {
    out[row.token] = { userId: row.user_id, createdAt: row.created_at, expiresAt: row.expires_at };
  });
  return out;
}

function writeSessions(sessions) {
  const dbRef = requireDb();
  const insert = dbRef.prepare(`
    INSERT INTO sessions (token, user_id, created_at, expires_at)
    VALUES (@token, @userId, @createdAt, @expiresAt)
    ON CONFLICT(token) DO UPDATE SET
      user_id = excluded.user_id, created_at = excluded.created_at, expires_at = excluded.expires_at
  `);
  const tx = dbRef.transaction(list => {
    const tokens = Object.keys(list || {});
    if (!tokens.length) {
      dbRef.prepare('DELETE FROM sessions').run();
      return;
    }
    dbRef.prepare(`DELETE FROM sessions WHERE token NOT IN (${tokens.map(() => '?').join(',')})`).run(...tokens);
    Object.entries(list || {}).forEach(([token, session]) => {
      insert.run({
        token,
        userId: session.userId,
        createdAt: session.createdAt || nowIso(),
        expiresAt: session.expiresAt || nowIso(),
      });
    });
  });
  tx(sessions);
}

function deleteSessions(tokens) {
  const stmt = requireDb().prepare('DELETE FROM sessions WHERE token = ?');
  requireDb().transaction(list => list.forEach(token => stmt.run(token)))(tokens || []);
}

function deleteSessionsForUser(userId) {
  requireDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(safeUserId(userId));
}

function readResets() {
  const rows = requireDb().prepare('SELECT * FROM password_resets').all();
  const out = {};
  rows.forEach(row => {
    out[row.token_hash] = {
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
    };
  });
  return out;
}

function writeResets(resets) {
  const dbRef = requireDb();
  const insert = dbRef.prepare(`
    INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, used_at)
    VALUES (@tokenHash, @userId, @createdAt, @expiresAt, @usedAt)
    ON CONFLICT(token_hash) DO UPDATE SET
      user_id = excluded.user_id, created_at = excluded.created_at,
      expires_at = excluded.expires_at, used_at = excluded.used_at
  `);
  const tx = dbRef.transaction(list => {
    const hashes = Object.keys(list || {});
    if (!hashes.length) {
      dbRef.prepare('DELETE FROM password_resets').run();
      return;
    }
    dbRef.prepare(`DELETE FROM password_resets WHERE token_hash NOT IN (${hashes.map(() => '?').join(',')})`).run(...hashes);
    Object.entries(list || {}).forEach(([tokenHash, entry]) => {
      insert.run({
        tokenHash,
        userId: entry.userId,
        createdAt: entry.createdAt || nowIso(),
        expiresAt: entry.expiresAt || nowIso(),
        usedAt: entry.usedAt || null,
      });
    });
  });
  tx(resets);
}

function readUsage() {
  const rows = requireDb().prepare('SELECT * FROM usage').all();
  const out = {};
  rows.forEach(row => {
    out[row.user_id] = out[row.user_id] || {};
    out[row.user_id][row.month] = out[row.user_id][row.month] || {};
    out[row.user_id][row.month][row.feature] = row.used;
  });
  return out;
}

function writeUsage(usage) {
  const insert = requireDb().prepare(`
    INSERT INTO usage (user_id, month, feature, used) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, month, feature) DO UPDATE SET used = excluded.used
  `);
  const tx = requireDb().transaction(data => {
    Object.entries(data || {}).forEach(([userId, months]) => {
      Object.entries(months || {}).forEach(([month, features]) => {
        Object.entries(features || {}).forEach(([feature, used]) => {
          insert.run(safeUserId(userId), String(month), String(feature), Number(used) || 0);
        });
      });
    });
  });
  tx(usage);
}

// ---------- profile photos ----------
function getPhotoMeta(userId) {
  const row = requireDb().prepare(`
    SELECT ext, mime, original_name, size, uploaded_at FROM profile_photos WHERE user_id = ?
  `).get(safeUserId(userId));
  if (!row) return null;
  return {
    ext: row.ext,
    mime: row.mime,
    originalName: row.original_name,
    size: row.size,
    uploadedAt: row.uploaded_at,
  };
}

function getPhoto(userId) {
  const row = requireDb().prepare('SELECT data FROM profile_photos WHERE user_id = ?').get(safeUserId(userId));
  return row ? row.data : null;
}

function savePhoto(userId, meta, buffer) {
  requireDb().prepare(`
    INSERT INTO profile_photos (user_id, ext, mime, original_name, size, data, uploaded_at)
    VALUES (@userId, @ext, @mime, @originalName, @size, @data, @uploadedAt)
    ON CONFLICT(user_id) DO UPDATE SET
      ext = excluded.ext, mime = excluded.mime, original_name = excluded.original_name,
      size = excluded.size, data = excluded.data, uploaded_at = excluded.uploaded_at
  `).run({
    userId: safeUserId(userId),
    ext: meta.ext,
    mime: meta.mime,
    originalName: meta.originalName || 'photo',
    size: buffer.length,
    data: buffer,
    uploadedAt: meta.uploadedAt || nowIso(),
  });
}

function deletePhoto(userId) {
  requireDb().prepare('DELETE FROM profile_photos WHERE user_id = ?').run(safeUserId(userId));
}

function deleteUserData(userId) {
  const dbRef = requireDb();
  const uid = safeUserId(userId);
  const tx = dbRef.transaction(() => {
    dbRef.prepare('DELETE FROM user_documents WHERE user_id = ?').run(uid);
    dbRef.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
    dbRef.prepare('DELETE FROM password_resets WHERE user_id = ?').run(uid);
    dbRef.prepare('DELETE FROM usage WHERE user_id = ?').run(uid);
    dbRef.prepare('DELETE FROM profile_photos WHERE user_id = ?').run(uid);
  });
  tx();
}

// ---------- one-time JSON -> SQLite migration ----------
function legacyJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function migrateLegacy() {
  const dbRef = requireDb();
  if (dbRef.prepare("SELECT 1 FROM migrations WHERE name = 'json-import'").get()) return { migrated: false };

  const counts = { users: 0, sessions: 0, resets: 0, usage: 0, documents: 0, photos: 0 };

  const users = legacyJSON(path.join(DATA_DIR, 'users.json'));
  if (users && Object.keys(users).length) {
    const before = dbRef.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    writeUsers(users);
    counts.users = dbRef.prepare('SELECT COUNT(*) AS n FROM users').get().n - before;
  }

  const sessions = legacyJSON(path.join(DATA_DIR, 'sessions.json'));
  if (sessions && Object.keys(sessions).length) {
    const before = dbRef.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    writeSessions(sessions);
    counts.sessions = dbRef.prepare('SELECT COUNT(*) AS n FROM sessions').get().n - before;
  }

  const resets = legacyJSON(path.join(DATA_DIR, 'password_resets.json'));
  if (resets && Object.keys(resets).length) {
    const before = dbRef.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n;
    writeResets(resets);
    counts.resets = dbRef.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n - before;
  }

  const usage = legacyJSON(path.join(DATA_DIR, 'usage.json'));
  if (usage && Object.keys(usage).length) {
    const before = dbRef.prepare('SELECT COUNT(*) AS n FROM usage').get().n;
    writeUsage(usage);
    counts.usage = dbRef.prepare('SELECT COUNT(*) AS n FROM usage').get().n - before;
  }

  const usersRoot = path.join(DATA_DIR, 'users');
  if (fs.existsSync(usersRoot)) {
    const insertDoc = dbRef.prepare(`
      INSERT OR IGNORE INTO user_documents (user_id, doc_key, data, updated_at) VALUES (?, ?, ?, ?)
    `);
    for (const userId of fs.readdirSync(usersRoot)) {
      const dir = path.join(usersRoot, userId);
      if (!fs.statSync(dir).isDirectory()) continue;
      const uid = safeUserId(userId);
      for (const filename of fs.readdirSync(dir)) {
        if (!filename.endsWith('.json')) continue;
        const data = legacyJSON(path.join(dir, filename));
        if (data == null) continue;
        const result = insertDoc.run(uid, filename, JSON.stringify(data), nowIso());
        counts.documents += result.changes;
      }

      const photoMeta = legacyJSON(path.join(dir, 'profile-photo.json'));
      if (photoMeta && photoMeta.ext) {
        const photoFile = path.join(dir, 'profile-photo' + photoMeta.ext);
        if (fs.existsSync(photoFile)) {
          const exists = dbRef.prepare('SELECT 1 FROM profile_photos WHERE user_id = ?').get(uid);
          if (!exists) {
            savePhoto(uid, {
              ext: photoMeta.ext,
              mime: photoMeta.mime || 'image/png',
              originalName: photoMeta.originalName || 'photo',
              uploadedAt: photoMeta.uploadedAt || nowIso(),
            }, fs.readFileSync(photoFile));
            counts.photos += 1;
          }
        }
      }
    }
  }

  // Legacy single-user installs kept documents at the data root. Give them to
  // the owner account only when the per-user version is missing.
  const legacyRootDocs = [
    'profile.json', 'tracker.json', 'seen_jobs.json', 'applications.json',
    'search_queries.json', 'search-queries.json', 'salary_data.json',
    'reports.json', 'llm-config.json', 'custom_job_sites.json',
  ];
  for (const filename of legacyRootDocs) {
    const data = legacyJSON(path.join(DATA_DIR, filename));
    if (data == null) continue;
    const existing = dbRef.prepare('SELECT 1 FROM user_documents WHERE user_id = ? AND doc_key = ?')
      .get('owner', filename);
    if (!existing) {
      dbRef.prepare('INSERT INTO user_documents (user_id, doc_key, data, updated_at) VALUES (?, ?, ?, ?)')
        .run('owner', filename, JSON.stringify(data), nowIso());
      counts.documents += 1;
    }
  }

  dbRef.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run('json-import', nowIso());
  return { migrated: true, counts };
}

function ping() {
  try {
    requireDb().prepare('SELECT 1 AS ok').get();
    return true;
  } catch (e) {
    return false;
  }
}

function stats() {
  const dbRef = requireDb();
  const count = table => dbRef.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return {
    users: count('users'),
    sessions: count('sessions'),
    passwordResets: count('password_resets'),
    usageRows: count('usage'),
    documents: count('user_documents'),
    photos: count('profile_photos'),
    path: DB_PATH,
  };
}

module.exports = {
  initStore,
  migrateLegacy,
  readFile,
  writeFile,
  getDoc,
  putDoc,
  readUsers,
  writeUsers,
  readSessions,
  writeSessions,
  deleteSessions,
  deleteSessionsForUser,
  readResets,
  writeResets,
  readUsage,
  writeUsage,
  getPhotoMeta,
  getPhoto,
  savePhoto,
  deletePhoto,
  deleteUserData,
  ping,
  stats,
  DB_PATH,
  DATA_DIR,
};
