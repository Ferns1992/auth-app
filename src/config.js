const crypto = require('crypto');

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `See .env.example and set it in your environment before starting.`
    );
  }
  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const sessionSecret = required('SESSION_SECRET');
if (sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters long.');
}
if (sessionSecret === 'auth-gateway-secret') {
  throw new Error('SESSION_SECRET is still the value committed to the public repository. Change it.');
}

module.exports = {
  PORT: int('PORT', 4040),
  BASE_DIR: optional('DATA_DIR', require('path').join(__dirname, '..', 'data')),

  SESSION_SECRET: sessionSecret,
  SESSION_TTL_HOURS: int('SESSION_TTL_HOURS', 24),
  SECURE_COOKIES: optional('SECURE_COOKIES', 'auto'),

  ADMIN_USERNAME: optional('ADMIN_USERNAME', 'admin'),
  ADMIN_PASSWORD: optional('ADMIN_PASSWORD', null),

  MIN_PASSWORD_LENGTH: int('MIN_PASSWORD_LENGTH', 8),
  BCRYPT_ROUNDS: int('BCRYPT_ROUNDS', 10),

  RATE_LIMIT_WINDOW_MINUTES: int('RATE_LIMIT_WINDOW_MINUTES', 15),
  RATE_LIMIT_ADMIN_MAX: int('RATE_LIMIT_ADMIN_MAX', 8),
  RATE_LIMIT_USER_MAX: int('RATE_LIMIT_USER_MAX', 10),

  TRUST_PROXY: optional('TRUST_PROXY', '1'),
  LOG_LEVEL: optional('LOG_LEVEL', 'info'),

  newClientId: () => crypto.randomBytes(16).toString('hex'),
  newClientSecret: () => crypto.randomBytes(32).toString('hex'),
};
