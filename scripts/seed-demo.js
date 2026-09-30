#!/usr/bin/env node
/**
 * Seeds demo users, apps, access grants and auth log history.
 *
 * Safe to run repeatedly: every insert is guarded by an existence check, so a
 * second run will not duplicate rows or touch the admin account.
 *
 *   node scripts/seed-demo.js
 *
 * Requires the same environment as the server (SESSION_SECRET in particular).
 */

process.env.SEED_DEMO = '1';

const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { initDb, get, run } = require('../src/db');

const DEMO_PASSWORD = 'demo-access-2024';

const DEMO_USERS = [
  { username: 'alice.reyes', apps: ['Driver Ledger PH', 'Nexus Dashboard'] },
  { username: 'bruno.santos', apps: ['Driver Ledger PH'] },
  { username: 'carla.mendoza', apps: ['Modern ERP', 'Nexus Dashboard', 'YT Poster'] },
  { username: 'david.okafor', apps: ['DocChat'] },
  { username: 'elena.cruz', apps: [] }
];

const DEMO_APPS = [
  { name: 'Driver Ledger PH', redirect_uri: 'https://driverledger.sysitadmin.com/auth/callback' },
  { name: 'Nexus Dashboard', redirect_uri: 'https://nexus.sysitadmin.com/oauth/callback' },
  { name: 'Modern ERP', redirect_uri: 'https://erp.sysitadmin.com/sso/return' },
  { name: 'DocChat', redirect_uri: 'https://dococr.sysitadmin.com/auth/callback' },
  { name: 'YT Poster', redirect_uri: 'https://ytposter.sysitadmin.com/oauth2/redirect' }
];

const EVENTS_SUCCESS = ['login', 'authorize'];
const EVENTS_FAILED = ['bad_credentials', 'no_access', 'admin_login'];
const AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
];
const IPS = ['112.134.7.21', '119.91.4.88', '49.144.203.16', '103.179.196.201', '35.209.255.206', '85.217.149.7'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const intBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function isoOffset(hoursAgo) {
  const d = new Date(Date.now() - hoursAgo * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function main() {
  await initDb();

  const hashed = bcrypt.hashSync(DEMO_PASSWORD, config.BCRYPT_ROUNDS);
  const userIds = {};

  for (const demo of DEMO_USERS) {
    let row = await get(`SELECT id FROM users WHERE username = ?`, [demo.username]);
    if (!row) {
      const res = await run(`INSERT INTO users (username, password, is_admin) VALUES (?, ?, 0)`, [
        demo.username,
        hashed
      ]);
      userIds[demo.username] = res.lastID;
      console.log(`created user  ${demo.username}`);
    } else {
      userIds[demo.username] = row.id;
      console.log(`exists  user  ${demo.username}`);
    }
  }

  const appIds = {};

  for (const demo of DEMO_APPS) {
    let row = await get(`SELECT id FROM apps WHERE name = ?`, [demo.name]);
    if (!row) {
      const res = await run(
        `INSERT INTO apps (name, client_id, client_secret, redirect_uri) VALUES (?, ?, ?, ?)`,
        [demo.name, config.newClientId(), config.newClientSecret(), demo.redirect_uri]
      );
      appIds[demo.name] = res.lastID;
      console.log(`created app   ${demo.name}`);
    } else {
      appIds[demo.name] = row.id;
      console.log(`exists  app   ${demo.name}`);
    }
  }

  let grantCount = 0;
  for (const demo of DEMO_USERS) {
    for (const appName of demo.apps) {
      const result = await run(`INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (?, ?)`, [
        userIds[demo.username],
        appIds[appName]
      ]);
      grantCount += result.changes;
    }
  }
  console.log(`grants        ${grantCount} added`);

  const existingLogs = await get(`SELECT COUNT(*) AS c FROM auth_logs`);
  if (existingLogs.c > 0 && process.env.SEED_FORCE !== '1') {
    console.log(`logs          skipped, ${existingLogs.c} already present (set SEED_FORCE=1 to add more)`);
  } else {
    const usernames = Object.keys(userIds);
    const appNames = Object.keys(appIds);
    let inserted = 0;

    for (let i = 0; i < 140; i++) {
      const hoursAgo = Math.round(Math.pow(Math.random(), 2) * 24 * 7 * 10) / 10;
      const success = Math.random() > 0.22;
      const isAdminAttempt = Math.random() < 0.12;

      if (isAdminAttempt) {
        await run(
          `INSERT INTO auth_logs (user_id, app_id, ip_address, user_agent, success, event, timestamp)
           VALUES (?, NULL, ?, ?, ?, 'admin_login', ?)`,
          [null, pick(IPS), pick(AGENTS), success ? 1 : 0, isoOffset(hoursAgo)]
        );
      } else {
        await run(
          `INSERT INTO auth_logs (user_id, app_id, ip_address, user_agent, success, event, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            userIds[pick(usernames)],
            appIds[pick(appNames)],
            pick(IPS),
            pick(AGENTS),
            success ? 1 : 0,
            success ? pick(EVENTS_SUCCESS) : pick(EVENTS_FAILED),
            isoOffset(hoursAgo)
          ]
        );
      }
      inserted++;
    }
    console.log(`logs          ${inserted} entries spread over 7 days`);
  }

  console.log('');
  console.log('Demo users and their passwords:');
  for (const demo of DEMO_USERS) {
    console.log(`  ${demo.username.padEnd(18)} ${DEMO_PASSWORD}   apps: ${demo.apps.join(', ') || 'none'}`);
  }
  console.log('');
  console.log('Delete these accounts before using this for anything real.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
