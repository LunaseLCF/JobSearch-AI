// Child process used by blob-sync.js. Keeps network I/O out of the request path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { getStore } from '@netlify/blobs';

const [mode, dbPath] = process.argv.slice(2);
const key = 'careercompass.sqlite';

if (!process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_BLOBS_TOKEN) {
  console.error('Netlify Blobs credentials are not configured');
  process.exit(1);
}

const store = getStore({
  name: 'careercompass-backup',
  siteID: process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_BLOBS_TOKEN,
});

if (mode === 'restore') {
  const blob = await store.get(key, { type: 'blob' });
  if (!blob) {
    console.log('No remote database backup found');
    process.exit(0);
  }
  const bytes = Buffer.from(await blob.arrayBuffer());
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, bytes);
  console.log(`Restored ${bytes.length} bytes`);
  process.exit(0);
}

if (mode === 'backup') {
  const snapshot = path.join(os.tmpdir(), `cc_snapshot_${Date.now()}.sqlite`);
  try {
    const db = new Database(dbPath, { readonly: true });
    db.pragma('busy_timeout = 5000');
    db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    db.close();
    const bytes = fs.readFileSync(snapshot);
    await store.set(key, bytes, { type: 'blob' });
    console.log(`Backed up ${bytes.length} bytes`);
  } finally {
    try { fs.unlinkSync(snapshot); } catch (e) { /* ignore */ }
  }
  process.exit(0);
}

console.error('Usage: blob-worker.mjs <restore|backup> <db-path>');
process.exit(1);
