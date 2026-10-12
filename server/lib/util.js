import crypto from 'node:crypto';

/** Short, URL-safe, collision-resistant id. */
export function id(prefix = '') {
  return prefix + crypto.randomBytes(12).toString('base64url');
}

export function nowIso() {
  return new Date().toISOString();
}

export function dayKey(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

export function monthKey(d = new Date()) {
  return new Date(d).toISOString().slice(0, 7);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** Typed HTTP error the error handler turns into a JSON response. */
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'error';
  }
}

export function bad(message, code = 'bad_request') {
  return new HttpError(400, message, code);
}
export function unauthorized(message = 'Sign in required', code = 'unauthorized') {
  return new HttpError(401, message, code);
}
export function forbidden(message = 'Not allowed', code = 'forbidden') {
  return new HttpError(403, message, code);
}
export function notFound(message = 'Not found', code = 'not_found') {
  return new HttpError(404, message, code);
}
export function conflict(message, code = 'conflict') {
  return new HttpError(409, message, code);
}

/** Wrap an async express handler so rejections reach the error middleware. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Escape a value for use inside a LIKE pattern. */
export function like(value) {
  return '%' + String(value).replace(/[%_\\]/g, '\\$&') + '%';
}

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

export function str(v, max = 500) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

export function parseJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function paginate(query, defaultLimit = 20, maxLimit = 100) {
  const limit = clampInt(query.limit, 1, maxLimit, defaultLimit);
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  return { limit, offset };
}
