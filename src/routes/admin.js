const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { get, all, run, getSetting, setSetting, logAuth } = require('../db');
const { passwordProblem, usernameProblem, redirectUriProblem } = require('../util');
const { limit, clientIp, clear } = require('../rate-limit');

const router = express.Router();

// Shared locals for every admin view, including the layout partials.
router.use((req, res, next) => {
  res.locals.adminName = req.session.adminUsername || 'admin';
  res.locals.active = '';
  next();
});

const adminLoginLimit = limit({
  name: 'admin-login',
  max: config.RATE_LIMIT_ADMIN_MAX,
  keyFn: (req) => clientIp(req)
});

const FLASH = {
  user_created: { type: 'success', text: 'User created.' },
  user_deleted: { type: 'success', text: 'User deleted.' },
  app_created: { type: 'success', text: 'App registered.' },
  app_deleted: { type: 'success', text: 'App deleted.' },
  secret_rotated: { type: 'success', text: 'Client secret rotated. Update anything that stored the old one.' },
  app_assigned: { type: 'success', text: 'App access granted.' },
  app_revoked: { type: 'success', text: 'App access revoked.' },
  base_url_saved: { type: 'success', text: 'Base URL saved.' },
  password_updated: { type: 'success', text: 'Admin password updated.' },
  bad_current_password: { type: 'danger', text: 'Current password is incorrect.' },
  weak_password: { type: 'danger', text: 'New password does not meet the policy.' },
  password_mismatch: { type: 'danger', text: 'The two new passwords do not match.' },
  username_taken: { type: 'danger', text: 'That username already exists.' },
  app_name_taken: { type: 'danger', text: 'That app name already exists.' },
  invalid_username: { type: 'danger', text: 'Username may only contain letters, numbers, dot, underscore and hyphen.' },
  invalid_redirect: { type: 'danger', text: 'Redirect URI must be a valid absolute http(s) URL.' },
  missing_fields: { type: 'danger', text: 'All fields are required.' }
};

function flashFrom(req) {
  const code = req.query.msg;
  return code && FLASH[code] ? FLASH[code] : null;
}

const requireAdmin = (req, res, next) => {
  if (req.session.adminId) return next();
  res.redirect('/admin/login');
};

router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin/dashboard');
  res.render('admin/login', { error: null, flash: null });
});

router.post('/login', adminLoginLimit, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = await get(`SELECT * FROM users WHERE username = ? AND is_admin = 1`, [username]);
    const ok = user && bcrypt.compareSync(String(password || ''), user.password);

    await logAuth({
      userId: user ? user.id : null,
      appId: null,
      ip: clientIp(req),
      userAgent: req.get('user-agent'),
      success: Boolean(ok),
      event: 'admin_login'
    });

    if (!ok) {
      return res.status(401).render('admin/login', { error: 'Invalid admin credentials', flash: null });
    }

    clear(req.rateLimitKey);
    req.session.adminId = user.id;
    req.session.adminUsername = user.username;
    res.redirect('/admin/dashboard');
  } catch (err) {
    next(err);
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.get('/dashboard', requireAdmin, async (req, res, next) => {
  try {
    const [userRow, appRow, logRow, successRow, failRow, attempts24h, failures24h, topApps, recentLogs] =
      await Promise.all([
        get(`SELECT COUNT(*) AS c FROM users WHERE is_admin = 0`),
        get(`SELECT COUNT(*) AS c FROM apps`),
        get(`SELECT COUNT(*) AS c FROM auth_logs`),
        get(`SELECT COUNT(*) AS c FROM auth_logs WHERE success = 1`),
        get(`SELECT COUNT(*) AS c FROM auth_logs WHERE success = 0`),
        get(`SELECT COUNT(*) AS c FROM auth_logs WHERE timestamp >= datetime('now', '-24 hours')`),
        get(`SELECT COUNT(*) AS c FROM auth_logs WHERE success = 0 AND timestamp >= datetime('now', '-24 hours')`),
        all(`SELECT a.name, COUNT(*) AS uses, SUM(al.success) AS ok
             FROM auth_logs al JOIN apps a ON a.id = al.app_id
             GROUP BY a.id ORDER BY uses DESC LIMIT 5`),
        all(`SELECT al.*, u.username, a.name AS app_name
             FROM auth_logs al
             LEFT JOIN users u ON al.user_id = u.id
             LEFT JOIN apps a ON al.app_id = a.id
             ORDER BY al.timestamp DESC LIMIT 10`)
      ]);

    const total = successRow.c + failRow.c;
    res.locals.active = 'dashboard';
    res.render('admin/dashboard', {
      userCount: userRow.c,
      appCount: appRow.c,
      logCount: logRow.c,
      successCount: successRow.c,
      failCount: failRow.c,
      attempts24h: attempts24h.c,
      failures24h: failures24h.c,
      successRate: total === 0 ? null : Math.round((successRow.c / total) * 100),
      topApps,
      recentLogs,
      minPasswordLength: config.MIN_PASSWORD_LENGTH,
      flash: flashFrom(req)
    });
  } catch (err) {
    next(err);
  }
});

router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const [users, apps, userApps] = await Promise.all([
      all(`SELECT * FROM users WHERE is_admin = 0 ORDER BY username`),
      all(`SELECT * FROM apps ORDER BY name`),
      all(`SELECT * FROM user_apps`)
    ]);
    res.locals.active = 'users';
    res.render('admin/users', {
      users,
      apps,
      userApps,
      minPasswordLength: config.MIN_PASSWORD_LENGTH,
      flash: flashFrom(req)
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users', requireAdmin, async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!username || !password) return res.redirect('/admin/users?msg=missing_fields');
    if (usernameProblem(username)) return res.redirect('/admin/users?msg=invalid_username');
    if (passwordProblem(password)) return res.redirect('/admin/users?msg=weak_password');

    const existing = await get(`SELECT id FROM users WHERE username = ?`, [username]);
    if (existing) return res.redirect('/admin/users?msg=username_taken');

    const hashed = bcrypt.hashSync(password, config.BCRYPT_ROUNDS);
    await run(`INSERT INTO users (username, password, is_admin) VALUES (?, ?, 0)`, [username, hashed]);
    res.redirect('/admin/users?msg=user_created');
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    await run(`DELETE FROM user_apps WHERE user_id = ?`, [req.params.id]);
    await run(`DELETE FROM users WHERE id = ? AND is_admin = 0`, [req.params.id]);
    res.redirect('/admin/users?msg=user_deleted');
  } catch (err) {
    next(err);
  }
});

router.post('/assign-app', requireAdmin, async (req, res, next) => {
  try {
    const { user_id: userId, app_id: appId } = req.body;
    if (!userId || !appId) return res.redirect('/admin/users');
    await run(`INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (?, ?)`, [userId, appId]);
    res.redirect('/admin/users?msg=app_assigned');
  } catch (err) {
    next(err);
  }
});

router.post('/revoke-app', requireAdmin, async (req, res, next) => {
  try {
    const { user_id: userId, app_id: appId } = req.body;
    if (!userId || !appId) return res.redirect('/admin/users');
    await run(`DELETE FROM user_apps WHERE user_id = ? AND app_id = ?`, [userId, appId]);
    res.redirect('/admin/users?msg=app_revoked');
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', requireAdmin, async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    const confirmPassword = String(req.body.confirmPassword || '');

    const admin = await get(`SELECT * FROM users WHERE id = ? AND is_admin = 1`, [req.session.adminId]);
    if (!admin || !bcrypt.compareSync(currentPassword, admin.password)) {
      return res.redirect('/admin/dashboard?msg=bad_current_password');
    }
    if (passwordProblem(newPassword)) return res.redirect('/admin/dashboard?msg=weak_password');
    if (newPassword !== confirmPassword) return res.redirect('/admin/dashboard?msg=password_mismatch');

    const hashed = bcrypt.hashSync(newPassword, config.BCRYPT_ROUNDS);
    await run(`UPDATE users SET password = ? WHERE id = ?`, [hashed, admin.id]);
    res.redirect('/admin/dashboard?msg=password_updated');
  } catch (err) {
    next(err);
  }
});

router.get('/apps', requireAdmin, async (req, res, next) => {
  try {
    const [apps, configuredBaseUrl] = await Promise.all([
      all(`SELECT * FROM apps ORDER BY name`),
      getSetting('base_url')
    ]);
    const baseUrl = configuredBaseUrl || `${req.protocol}://${req.get('host')}`;
    res.locals.active = 'apps';
    res.render('admin/apps', { apps, baseUrl, flash: flashFrom(req) });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/base-url', requireAdmin, async (req, res, next) => {
  try {
    const baseUrl = String(req.body.base_url || '').trim();
    if (baseUrl) {
      if (redirectUriProblem(baseUrl)) return res.redirect('/admin/apps?msg=invalid_redirect');
      await setSetting('base_url', baseUrl.replace(/\/$/, ''));
    } else {
      await setSetting('base_url', '');
    }
    res.redirect('/admin/apps?msg=base_url_saved');
  } catch (err) {
    next(err);
  }
});

router.post('/apps', requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const redirectUri = String(req.body.redirect_uri || '').trim();

    if (!name || !redirectUri) return res.redirect('/admin/apps?msg=missing_fields');
    if (redirectUriProblem(redirectUri)) return res.redirect('/admin/apps?msg=invalid_redirect');

    const existing = await get(`SELECT id FROM apps WHERE name = ?`, [name]);
    if (existing) return res.redirect('/admin/apps?msg=app_name_taken');

    await run(
      `INSERT INTO apps (name, client_id, client_secret, redirect_uri) VALUES (?, ?, ?, ?)`,
      [name, config.newClientId(), config.newClientSecret(), redirectUri]
    );
    res.redirect('/admin/apps?msg=app_created');
  } catch (err) {
    next(err);
  }
});

router.post('/apps/:id/regenerate-secret', requireAdmin, async (req, res, next) => {
  try {
    await run(`UPDATE apps SET client_secret = ? WHERE id = ?`, [
      config.newClientSecret(),
      req.params.id
    ]);
    res.redirect('/admin/apps?msg=secret_rotated');
  } catch (err) {
    next(err);
  }
});

router.post('/apps/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    await run(`DELETE FROM user_apps WHERE app_id = ?`, [req.params.id]);
    await run(`DELETE FROM apps WHERE id = ?`, [req.params.id]);
    res.redirect('/admin/apps?msg=app_deleted');
  } catch (err) {
    next(err);
  }
});

router.get('/logs', requireAdmin, async (req, res, next) => {
  try {
    const logs = await all(`SELECT al.*, u.username, a.name AS app_name
      FROM auth_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN apps a ON al.app_id = a.id
      ORDER BY al.timestamp DESC
      LIMIT 2000`);
    res.locals.active = 'logs';
    res.render('admin/logs', { logs, flash: flashFrom(req) });
  } catch (err) {
    next(err);
  }
});

router.get('/logs.csv', requireAdmin, async (req, res, next) => {
  try {
    const logs = await all(`SELECT al.timestamp, u.username, a.name AS app_name,
        al.ip_address, al.user_agent, al.event, al.success
      FROM auth_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN apps a ON al.app_id = a.id
      ORDER BY al.timestamp DESC
      LIMIT 20000`);

    const cell = (value) => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
    const header = ['timestamp', 'username', 'app', 'ip_address', 'user_agent', 'event', 'success'];
    const lines = [header.join(',')];
    for (const row of logs) {
      lines.push(
        [
          cell(row.timestamp),
          cell(row.username),
          cell(row.app_name),
          cell(row.ip_address),
          cell(row.user_agent),
          cell(row.event),
          cell(row.success ? 'success' : 'failed')
        ].join(',')
      );
    }

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="auth-logs.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
