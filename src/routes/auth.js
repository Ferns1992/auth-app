const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db').db;
const router = express.Router();

const SESSION_EXPIRY = 24 * 60 * 60 * 1000;

router.get('/authorize', (req, res) => {
  const { client_id, redirect_uri } = req.query;
  if (!client_id || !redirect_uri) return res.status(400).send('Missing client_id or redirect_uri');

  db.get(`SELECT * FROM apps WHERE client_id = ?`, [client_id], (err, app) => {
    if (!app) return res.status(403).send('Invalid app credentials');
    
    if (req.session.endUserId && req.session.endExpiry && req.session.endExpiry > Date.now()) {
      db.get(`SELECT * FROM user_apps WHERE user_id = ? AND app_id = ?`, [req.session.endUserId, app.id], (err, access) => {
        if (access) {
          logAuth(req, req.session.endUserId, app.id, 1);
          return res.redirect(`${redirect_uri}?auth=success&user=${req.session.endUsername}`);
        }
        logAuth(req, req.session.endUserId, app.id, 0);
        return res.redirect(`${redirect_uri}?auth=failed&reason=no_access`);
      });
    } else {
      req.session.endUserId = null;
      req.session.endExpiry = null;
      res.render('auth/login', { client_id, redirect_uri, error: null });
    }
  });
});

router.post('/login', (req, res) => {
  const { username, password, client_id, redirect_uri } = req.body;
  db.get(`SELECT * FROM apps WHERE client_id = ?`, [client_id], (err, app) => {
    if (!app) return res.status(403).send('Invalid app');
    db.get(`SELECT * FROM users WHERE username = ? AND is_admin = 0`, [username], (err, user) => {
      if (!user || !bcrypt.compareSync(password, user.password)) {
        logAuth(req, user ? user.id : null, app.id, 0);
        return res.render('auth/login', { client_id, redirect_uri, error: 'Invalid credentials' });
      }
      db.get(`SELECT * FROM user_apps WHERE user_id = ? AND app_id = ?`, [user.id, app.id], (err, access) => {
        if (!access) {
          logAuth(req, user.id, app.id, 0);
          return res.render('auth/login', { client_id, redirect_uri, error: 'No access to this app' });
        }
        req.session.endUserId = user.id;
        req.session.endUsername = user.username;
        req.session.endExpiry = Date.now() + SESSION_EXPIRY;
        logAuth(req, user.id, app.id, 1);
        res.redirect(`${redirect_uri}?auth=success&user=${user.username}`);
      });
    });
  });
});

router.get('/logout', (req, res) => {
  req.session.endUserId = null;
  req.session.endExpiry = null;
  res.redirect('/');
});

function logAuth(req, userId, appId, success) {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];
  db.run(`INSERT INTO auth_logs (user_id, app_id, ip_address, user_agent, success) VALUES (?, ?, ?, ?, ?)`,
    [userId, appId, ip, userAgent, success]);
}

module.exports = router;