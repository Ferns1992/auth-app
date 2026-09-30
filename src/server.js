const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const SQLiteStore = require('connect-sqlite3')(session);

const config = require('./config');
const { initDb, dbPath } = require('./db');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');

const app = express();

app.set('trust proxy', config.TRUST_PROXY);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

const ttlMs = config.SESSION_TTL_HOURS * 60 * 60 * 1000;

app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: config.BASE_DIR,
    concurrentDB: true
  }),
  name: 'agw.sid',
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.SECURE_COOKIES === 'auto' ? 'auto' : config.SECURE_COOKIES === 'true',
    maxAge: ttlMs
  }
}));

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; " +
      "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:; " +
      "img-src 'self' data:; " +
      "connect-src 'self'; " +
      "form-action 'self'; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'"
  );
  next();
});

app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.get('origin');
  if (!origin) return next();
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return res.status(403).send('Invalid Origin header');
  }
  if (originHost !== req.get('host')) {
    return res.status(403).send('Cross-origin form submission rejected');
  }
  next();
});

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

app.use('/admin', adminRoutes);
app.use('/auth', authRoutes);

app.get('/', (req, res) => {
  if (req.session.adminId) res.redirect('/admin/dashboard');
  else res.redirect('/admin/login');
});

app.use((req, res) => {
  res.status(404).send('Not found');
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).send('Internal server error');
});

let server;

async function start() {
  await initDb();
  server = app.listen(config.PORT, () => {
    console.log(`Auth gateway listening on port ${config.PORT}`);
    console.log(`Database: ${dbPath}`);
  });
  return server;
}

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down.`);
  if (server) {
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = { app, start, shutdown };
