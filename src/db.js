const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const config = require('./config');

fs.mkdirSync(config.BASE_DIR, { recursive: true });

const dbPath = path.join(config.BASE_DIR, 'auth-gateway.db');
const db = new sqlite3.Database(dbPath);

// Cascading deletes are declared in the schema but SQLite ignores them unless
// this pragma is on, and it is off by default per connection.
db.run('PRAGMA foreign_keys = ON');

const get = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
const all = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
const run = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve({ lastID: this.lastID, changes: this.changes });
  }));

const initDb = async () => {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    client_id TEXT UNIQUE NOT NULL,
    client_secret TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS user_apps (
    user_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, app_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS auth_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    app_id INTEGER,
    ip_address TEXT,
    user_agent TEXT,
    success INTEGER NOT NULL,
    event TEXT DEFAULT 'auth',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE SET NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  await run('CREATE INDEX IF NOT EXISTS idx_auth_logs_timestamp ON auth_logs (timestamp DESC)');
  await run('CREATE INDEX IF NOT EXISTS idx_auth_logs_success ON auth_logs (success)');
  await run('CREATE INDEX IF NOT EXISTS idx_user_apps_app ON user_apps (app_id)');

  await seedAdmin();
  return { dbPath };
};

async function seedAdmin() {
  const existing = await get(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`);
  if (existing) return;

  const username = config.ADMIN_USERNAME;
  let password = config.ADMIN_PASSWORD;
  let generated = false;

  if (!password) {
    password = crypto.randomBytes(18).toString('base64url');
    generated = true;
  }

  const hashed = bcrypt.hashSync(password, config.BCRYPT_ROUNDS);
  await run(`INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)`, [username, hashed]);

  if (generated) {
    console.log('='.repeat(64));
    console.log('No ADMIN_PASSWORD was set, so a one-time password was generated.');
    console.log(`Admin username: ${username}`);
    console.log(`Admin password: ${password}`);
    console.log('Store it now. It is not written anywhere else and cannot be recovered.');
    console.log('='.repeat(64));
  } else {
    console.log(`Seeded admin account "${username}" from ADMIN_PASSWORD.`);
  }
}

const getSetting = async (key) => {
  const row = await get(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row ? row.value : null;
};

const setSetting = (key, value) =>
  run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);

const logAuth = ({ userId = null, appId = null, ip = null, userAgent = null, success, event = 'auth' }) =>
  run(
    `INSERT INTO auth_logs (user_id, app_id, ip_address, user_agent, success, event)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, appId, ip, userAgent, success ? 1 : 0, event]
  );

module.exports = { db, dbPath, initDb, get, all, run, getSetting, setSetting, logAuth };
