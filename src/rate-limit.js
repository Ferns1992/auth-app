const config = require('./config');

const buckets = new Map();

const WINDOW_MS = config.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;

function prune(now) {
  for (const [key, hits] of buckets) {
    const live = hits.filter((t) => now - t < WINDOW_MS);
    if (live.length === 0) buckets.delete(key);
    else buckets.set(key, live);
  }
}

function clientIp(req) {
  return req.ip || req.connection.remoteAddress || 'unknown';
}

function attempt(key) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  buckets.set(key, hits);
  return hits.length;
}

function isBlocked(key, max) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length < max) return false;
  const retryAfter = Math.ceil((WINDOW_MS - (now - hits[0])) / 1000);
  return { retryAfter };
}

function clear(key) {
  buckets.delete(key);
}

setInterval(() => prune(Date.now()), WINDOW_MS).unref();

function limit({ name, max, keyFn }) {
  return function rateLimit(req, res, next) {
    const key = `${name}:${keyFn(req)}`;
    const blocked = isBlocked(key, max);
    if (blocked) {
      res.set('Retry-After', String(blocked.retryAfter));
      const minutes = Math.max(1, Math.ceil(blocked.retryAfter / 60));
      return res.status(429).send(
        `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
      );
    }
    attempt(key);
    req.rateLimitKey = key;
    next();
  };
}

module.exports = { limit, clientIp, clear, buckets };
