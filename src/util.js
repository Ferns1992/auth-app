const crypto = require('crypto');
const config = require('./config');

function buildRedirect(registeredUri, params) {
  let url;
  try {
    url = new URL(registeredUri);
  } catch {
    throw new Error(`Registered redirect_uri is not a valid absolute URL: ${registeredUri}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Registered redirect_uri must be http(s): ${registeredUri}`);
  }
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function redirectMatches(registeredUri, requestedUri) {
  if (!requestedUri) return true;
  if (typeof requestedUri !== 'string') return false;
  return requestedUri === registeredUri;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function passwordProblem(password) {
  if (typeof password !== 'string' || !password) return 'Password is required';
  if (password.length < config.MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${config.MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 200) return 'Password must be 200 characters or fewer';
  return null;
}

function usernameProblem(username) {
  if (typeof username !== 'string' || !username.trim()) return 'Username is required';
  if (username.length > 64) return 'Username must be 64 characters or fewer';
  if (!/^[A-Za-z0-9._-]+$/.test(username)) {
    return 'Username may only contain letters, numbers, dot, underscore and hyphen';
  }
  return null;
}

function redirectUriProblem(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Redirect URI is required';
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return 'Redirect URI must be a valid absolute URL';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'Redirect URI must start with http:// or https://';
  }
  return null;
}

module.exports = {
  buildRedirect,
  redirectMatches,
  safeEqual,
  passwordProblem,
  usernameProblem,
  redirectUriProblem,
};
