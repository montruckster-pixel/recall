/**
 * Authentication: scrypt password hashing, opaque server-side sessions stored in
 * SQLite, and Express middleware. Session cookies are httpOnly + SameSite=Lax.
 * Raw session tokens are never stored — only their SHA-256 hash.
 */
import crypto from 'node:crypto';
import { get, run, nowIso } from './db.js';
import { id, unauthorized, bad, isEmail, str, HttpError } from './util.js';

const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw bad('Password must be at least 8 characters.', 'weak_password');
  }
  if (password.length > 200) throw bad('Password is too long.', 'weak_password');
  return password;
}

export function createUser({ email, password, displayName }) {
  if (!isEmail(email)) throw bad('Enter a valid email address.', 'invalid_email');
  validatePassword(password);
  const normalized = email.trim().toLowerCase();
  const existing = get('SELECT id FROM users WHERE email = ?', [normalized]);
  if (existing) throw bad('An account with that email already exists.', 'email_taken');

  const userId = id('usr_');
  const ts = nowIso();
  run(
    `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, normalized, hashPassword(password), str(displayName, 80) || null, ts, ts],
  );
  run(
    `INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?)`,
    [userId, ts],
  );
  run(
    `INSERT INTO subscriptions (id, user_id, plan, status, created_at, updated_at)
     VALUES (?, ?, 'free', 'active', ?, ?)`,
    [id('sub_'), userId, ts, ts],
  );
  return get('SELECT * FROM users WHERE id = ?', [userId]);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  run(
    `INSERT INTO sessions (id, user_id, expires_at, created_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [hashToken(token), userId, expires, nowIso(),
     str(req?.headers?.['user-agent'], 300) || null,
     str(req?.ip, 60) || null],
  );
  return { token, expires };
}

export function destroySession(token) {
  if (!token) return;
  run('DELETE FROM sessions WHERE id = ?', [hashToken(token)]);
}

export function destroyAllSessions(userId) {
  run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

export const COOKIE_NAME = 'recall_session';

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || process.env.RECALL_SECURE_COOKIES === '1',
    maxAge: SESSION_DAYS * 864e5,
    path: '/',
  };
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

/** Resolve the signed-in user (or null) from the session cookie. */
export function resolveUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  const row = get(
    `SELECT u.*, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
    [hashToken(token)],
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    run('DELETE FROM sessions WHERE id = ?', [hashToken(token)]);
    return null;
  }
  if (row.deleted_at) return null;
  delete row.expires_at;
  return row;
}

/** Populates req.user when a valid session exists; never blocks. */
export function attachUser(req, _res, next) {
  req.user = resolveUser(req);
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Reject cross-site state-changing requests that are not same-origin JSON. */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Billing webhooks are authenticated by signature, not cookies.
  if (req.path.startsWith('/api/billing/webhook')) return next();
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'same-site', 'none'].includes(site)) {
    return next(new HttpError(403, 'Cross-site request blocked.', 'csrf'));
  }
  next();
}

// ---- Password reset -------------------------------------------------------

/** How long a password-reset link stays valid. Default 60 minutes. */
export function resetTokenMinutes() {
  const raw = Number(process.env.RECALL_RESET_TOKEN_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 24 * 60) : 60;
}

export function createResetToken(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  run(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id('rst_'), userId, hashToken(token),
     new Date(Date.now() + resetTokenMinutes() * 60e3).toISOString(), nowIso()],
  );
  return token;
}

export function consumeResetToken(token, newPassword) {
  const row = get(
    'SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL',
    [hashToken(token || '')],
  );
  if (!row) throw bad('That reset link is invalid or has already been used.', 'invalid_token');
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw bad('That reset link has expired. Request a new one.', 'expired_token');
  }
  validatePassword(newPassword);
  run('UPDATE password_resets SET used_at = ? WHERE id = ?', [nowIso(), row.id]);
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    [hashPassword(newPassword), nowIso(), row.user_id]);
  destroyAllSessions(row.user_id);
  return row.user_id;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name || (user.email || '').split('@')[0],
    role: user.role,
    onboarded: Boolean(user.onboarded_at),
    createdAt: user.created_at,
  };
}
