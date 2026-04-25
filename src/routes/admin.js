const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db').db;
const { getSetting, setSetting } = require('../db');
const router = express.Router();

const requireAdmin = (req, res, next) => {
  if (req.session.adminId) return next();
  res.redirect('/admin/login');
};

router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin/dashboard');
  res.render('admin/login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ? AND is_admin = 1`, [username], (err, user) => {
    if (err || !user || !bcrypt.compareSync(password, user.password)) {
      return res.render('admin/login', { error: 'Invalid admin credentials' });
    }
    req.session.adminId = user.id;
    res.redirect('/admin/dashboard');
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.get('/dashboard', requireAdmin, (req, res) => {
  db.get(`SELECT COUNT(*) AS userCount FROM users WHERE is_admin = 0`, (err, userRow) => {
    db.get(`SELECT COUNT(*) AS appCount FROM apps`, (err2, appRow) => {
      db.get(`SELECT COUNT(*) AS logCount FROM auth_logs`, (err3, logRow) => {
        db.all(`SELECT al.*, u.username, a.name AS app_name, a.redirect_uri FROM auth_logs al
                LEFT JOIN users u ON al.user_id = u.id
                LEFT JOIN apps a ON al.app_id = a.id
                ORDER BY al.timestamp DESC LIMIT 10`, (err4, recentLogs) => {
          res.render('admin/dashboard', {
            userCount: userRow.userCount,
            appCount: appRow.appCount,
            logCount: logRow.logCount,
            recentLogs,
            successMsg: null,
            errorMsg: null
          });
        });
      });
    });
  });
});

router.get('/users', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM users WHERE is_admin = 0`, (err, users) => {
    db.all(`SELECT * FROM apps`, (err2, apps) => {
      db.all(`SELECT * FROM user_apps`, (err3, userApps) => {
        res.render('admin/users', { users, apps, userApps, error: null });
      });
    });
  });
});

router.post('/users', requireAdmin, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.render('admin/users', { users: [], error: 'Username and password required' });
  const hashed = bcrypt.hashSync(password, 10);
  db.run(`INSERT INTO users (username, password, is_admin) VALUES (?, ?, 0)`, [username, hashed], (err) => {
    if (err) return res.render('admin/users', { users: [], error: 'Username already exists' });
    res.redirect('/admin/users');
  });
});

router.post('/users/:id/delete', requireAdmin, (req, res) => {
  db.run(`DELETE FROM users WHERE id = ? AND is_admin = 0`, [req.params.id], () => {
    res.redirect('/admin/users');
  });
});

router.post('/assign-app', requireAdmin, (req, res) => {
  const { user_id, app_id } = req.body;
  if (user_id && app_id) {
    db.run(`INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (?, ?)`, [user_id, app_id], () => {});
  }
  res.redirect('/admin/users');
});

router.post('/revoke-app', requireAdmin, (req, res) => {
  const { user_id, app_id } = req.body;
  if (user_id && app_id) {
    db.run(`DELETE FROM user_apps WHERE user_id = ? AND app_id = ?`, [user_id, app_id], () => {});
  }
  res.redirect('/admin/users');
});

router.post('/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  db.get(`SELECT * FROM users WHERE id = ? AND is_admin = 1`, [req.session.adminId], (err, admin) => {
    if (!admin || !bcrypt.compareSync(currentPassword, admin.password)) {
      return res.redirect('/admin/dashboard?errorMsg=Invalid current password');
    }
    const hashed = bcrypt.hashSync(newPassword, 10);
    db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashed, admin.id], () => {
      res.redirect('/admin/dashboard?successMsg=Password updated');
    });
  });
});

router.get('/apps', requireAdmin, async (req, res) => {
  db.all(`SELECT * FROM apps`, async (err, apps) => {
    const configuredBaseUrl = await getSetting('base_url');
    const baseUrl = configuredBaseUrl || `${req.protocol}://${req.get('host')}`;
    res.render('admin/apps', { apps, error: null, baseUrl });
  });
});

router.post('/settings/base-url', requireAdmin, async (req, res) => {
  const { base_url } = req.body;
  if (base_url) {
    await setSetting('base_url', base_url.replace(/\/$/, ''));
  }
  res.redirect('/admin/apps');
});

router.post('/apps', requireAdmin, (req, res) => {
  const { name, redirect_uri } = req.body;
  if (!name || !redirect_uri) return res.render('admin/apps', { apps: [], error: 'Name and redirect URI required' });
  const client_id = require('crypto').randomBytes(16).toString('hex');
  const client_secret = require('crypto').randomBytes(32).toString('hex');
  db.run(`INSERT INTO apps (name, client_id, client_secret, redirect_uri) VALUES (?, ?, ?, ?)`,
    [name, client_id, client_secret, redirect_uri], (err) => {
      if (err) return res.render('admin/apps', { apps: [], error: 'App name already exists' });
      res.redirect('/admin/apps');
    });
});

router.post('/apps/:id/delete', requireAdmin, (req, res) => {
  db.run(`DELETE FROM apps WHERE id = ?`, [req.params.id], () => {
    res.redirect('/admin/apps');
  });
});

router.post('/assign-app', requireAdmin, (req, res) => {
  const { user_id, app_id, action } = req.body;
  if (action === 'add') {
    db.run(`INSERT OR IGNORE INTO user_apps (user_id, app_id) VALUES (?, ?)`, [user_id, app_id], () => {
      res.redirect('/admin/users');
    });
  } else {
    db.run(`DELETE FROM user_apps WHERE user_id = ? AND app_id = ?`, [user_id, app_id], () => {
      res.redirect('/admin/users');
    });
  }
});

router.get('/logs', requireAdmin, (req, res) => {
  db.all(`SELECT al.*, u.username, a.name AS app_name, a.redirect_uri FROM auth_logs al
          LEFT JOIN users u ON al.user_id = u.id
          LEFT JOIN apps a ON al.app_id = a.id
          ORDER BY al.timestamp DESC`, (err, logs) => {
    res.render('admin/logs', { logs });
  });
});

module.exports = router;
