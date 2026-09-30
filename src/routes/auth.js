const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { get, logAuth } = require('../db');
const { buildRedirect, redirectMatches, safeEqual } = require('../util');
const { limit, clientIp, clear } = require('../rate-limit');

const router = express.Router();

const SESSION_EXPIRY = config.SESSION_TTL_HOURS * 60 * 60 * 1000;

const userLoginLimit = limit({
  name: 'user-login',
  max: config.RATE_LIMIT_USER_MAX,
  keyFn: (req) => `${clientIp(req)}:${String(req.body.username || '').toLowerCase()}`
});

function sessionIsLive(req) {
  return Boolean(req.session.endUserId && req.session.endExpiry && req.session.endExpiry > Date.now());
}

router.get('/authorize', async (req, res, next) => {
  try {
    const { client_id: clientId, redirect_uri: redirectUri, client_secret: clientSecret } = req.query;

    if (!clientId) return res.status(400).send('Missing client_id');

    const app = await get(`SELECT * FROM apps WHERE client_id = ?`, [clientId]);
    if (!app) return res.status(403).send('Unknown client_id');

    // The redirect target must be exactly the one registered for this app.
    // Anything else is rejected rather than followed, which is what closes the
    // open redirect: the value from the query string is never used to redirect.
    if (!redirectMatches(app.redirect_uri, redirectUri)) {
      return res.status(400).send('redirect_uri does not match the value registered for this app');
    }

    if (clientSecret && !safeEqual(clientSecret, app.client_secret)) {
      return res.status(403).send('Invalid client_secret');
    }

    const target = app.redirect_uri;

    if (sessionIsLive(req)) {
      const access = await get(
        `SELECT 1 AS ok FROM user_apps WHERE user_id = ? AND app_id = ?`,
        [req.session.endUserId, app.id]
      );
      if (access) {
        await logAuth({
          userId: req.session.endUserId,
          appId: app.id,
          ip: clientIp(req),
          userAgent: req.get('user-agent'),
          success: true,
          event: 'authorize'
        });
        return res.redirect(buildRedirect(target, { auth: 'success', user: req.session.endUsername }));
      }
      await logAuth({
        userId: req.session.endUserId,
        appId: app.id,
        ip: clientIp(req),
        userAgent: req.get('user-agent'),
        success: false,
        event: 'no_access'
      });
      return res.redirect(buildRedirect(target, { auth: 'failed', reason: 'no_access' }));
    }

    req.session.endUserId = null;
    req.session.endExpiry = null;

    return res.render('auth/login', {
      client_id: clientId,
      redirect_uri: target,
      app_name: app.name,
      error: null
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', userLoginLimit, async (req, res, next) => {
  try {
    const { username, password, client_id: clientId } = req.body;

    if (!clientId) return res.status(400).send('Missing client_id');

    const app = await get(`SELECT * FROM apps WHERE client_id = ?`, [clientId]);
    if (!app) return res.status(403).send('Unknown client_id');

    // The redirect target comes from the database on every request. The value
    // posted back by the form is deliberately ignored.
    const target = app.redirect_uri;

    const user = await get(`SELECT * FROM users WHERE username = ? AND is_admin = 0`, [username]);

    const ok = user && bcrypt.compareSync(String(password || ''), user.password);

    if (!ok) {
      await logAuth({
        userId: user ? user.id : null,
        appId: app.id,
        ip: clientIp(req),
        userAgent: req.get('user-agent'),
        success: false,
        event: 'bad_credentials'
      });
      return res.status(401).render('auth/login', {
        client_id: clientId,
        redirect_uri: target,
        app_name: app.name,
        error: 'Invalid username or password'
      });
    }

    const access = await get(`SELECT 1 AS ok FROM user_apps WHERE user_id = ? AND app_id = ?`, [
      user.id,
      app.id
    ]);

    if (!access) {
      await logAuth({
        userId: user.id,
        appId: app.id,
        ip: clientIp(req),
        userAgent: req.get('user-agent'),
        success: false,
        event: 'no_access'
      });
      return res.redirect(buildRedirect(target, { auth: 'failed', reason: 'no_access' }));
    }

    clear(req.rateLimitKey);
    req.session.endUserId = user.id;
    req.session.endUsername = user.username;
    req.session.endExpiry = Date.now() + SESSION_EXPIRY;

    await logAuth({
      userId: user.id,
      appId: app.id,
      ip: clientIp(req),
      userAgent: req.get('user-agent'),
      success: true,
      event: 'login'
    });

    return res.redirect(buildRedirect(target, { auth: 'success', user: user.username }));
  } catch (err) {
    next(err);
  }
});

router.get('/logout', (req, res) => {
  req.session.endUserId = null;
  req.session.endUsername = null;
  req.session.endExpiry = null;
  res.redirect('/');
});

module.exports = router;
