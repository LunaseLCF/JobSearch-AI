// Free durability layer: SQLite stays local for speed, and a consistent
// snapshot is mirrored to Netlify Blobs so it survives host restarts.
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'careercompass.sqlite');
const WORKER = path.join(__dirname, 'blob-worker.mjs');

let backupTimer = null;
let backupRunning = false;

function configured() {
  return !!(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN);
}

function restoreSync() {
  if (!configured()) return false;
  if (fs.existsSync(DB_PATH)) {
    console.log('[db] local database found; skipping blob restore');
    return false;
  }
  try {
    execFileSync(process.execPath, [WORKER, 'restore', DB_PATH], {
      stdio: 'pipe', timeout: 90000, env: process.env,
    });
    console.log('[db] database restored from Netlify Blobs');
    return true;
  } catch (e) {
    const detail = String(e.stderr || e.message || '').slice(0, 300);
    console.warn('[db] blob restore failed:', detail);
    return false;
  }
}

function runBackup() {
  backupTimer = null;
  if (backupRunning || !fs.existsSync(DB_PATH)) return;
  backupRunning = true;
  const child = spawn(process.execPath, [WORKER, 'backup', DB_PATH], {
    stdio: 'ignore', env: process.env,
  });
  const finish = () => { backupRunning = false; };
  child.on('exit', finish);
  child.on('error', finish);
}

function scheduleBackup() {
  if (!configured()) return;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(runBackup, 1500);
  if (backupTimer.unref) backupTimer.unref();
}

module.exports = { configured, restoreSync, scheduleBackup };
