import express from 'express';
import {
  createUser, createSession, destroySession, verifyPassword,
  setSessionCookie, clearSessionCookie, publicUser, createResetToken,
  consumeResetToken, destroyAllSessions, validatePassword, resetTokenMinutes,
} from '../lib/auth.js';
import { get, run, nowIso } from '../lib/db.js';
import { asyncHandler, bad, unauthorized, isEmail, str } from '../lib/util.js';
import { mailStatus, sendPasswordResetEmail } from '../lib/mailer.js';

/**
 * Absolute URL of the reset page. The SPA is hash-routed, so the token has to
 * live in the hash fragment — a path URL would load the app shell and be
 * treated as the landing page.
 */
function resetUrl(req, token) {
  const base = (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/#/reset-password?token=${encodeURIComponent(token)}`;
}

function shouldExposeResetToken(mail) {
  if (process.env.RECALL_EXPOSE_RESET_TOKEN === '1') return true;
  // Outside production, and only when mail is not actually delivered, surface
  // the link so the flow stays testable without an SMTP provider.
  return process.env.NODE_ENV !== 'production' && mail.transport !== 'smtp';
}

// Throttle reset emails per address so this endpoint cannot be used to bomb an
// inbox. Reaching the cooldown does not change the response, so it leaks nothing.
const resetCooldowns = new Map();
const RESET_COOLDOWN_MS = Number(process.env.RECALL_RESET_COOLDOWN_MS || 60000);

function resetAllowed(email) {
  const now = Date.now();
  const last = resetCooldowns.get(email) || 0;
  if (now - last < RESET_COOLDOWN_MS) return false;
  resetCooldowns.set(email, now);
  if (resetCooldowns.size > 5000) {
    for (const [key, at] of resetCooldowns) if (now - at > RESET_COOLDOWN_MS) resetCooldowns.delete(key);
  }
  return true;
}

const router = express.Router();

router.post('/signup', asyncHandler(async (req, res) => {
  const { email, password, displayName } = req.body || {};
  const user = createUser({ email, password, displayName });
  const { token } = createSession(user.id, req);
  setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(user) });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email)) throw bad('Enter a valid email address.', 'invalid_email');
  const user = get('SELECT * FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);
  // Always run a verification to keep timing consistent.
  const ok = user ? verifyPassword(password || '', user.password_hash) : verifyPassword(password || '', 'scrypt$16384$8$1$AAAA$AAAA');
  if (!user || !ok || user.deleted_at) throw unauthorized('Incorrect email or password.', 'bad_credentials');
  const { token } = createSession(user.id, req);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  destroySession(req.cookies?.recall_session);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

router.get('/me', asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
}));

// Lets the client tell the user whether reset emails will really be delivered.
// This is global configuration, never account-specific.
router.get('/mail-status', asyncHandler(async (req, res) => {
  const mail = mailStatus();
  res.json({ configured: mail.configured, transport: mail.transport, message: mail.message });
}));

router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  const user = isEmail(email) ? get('SELECT * FROM users WHERE email = ?', [String(email).trim().toLowerCase()]) : null;
  const mail = mailStatus();

  // The response is identical whether or not the account exists, so this
  // endpoint cannot be used to discover which addresses have accounts.
  const response = {
    ok: true,
    message: 'If an account exists for that email, a reset link is on its way.',
    mailConfigured: mail.configured,
    mailTransport: mail.transport,
  };

  if (user && !user.deleted_at && resetAllowed(user.email)) {
    const token = createResetToken(user.id);
    const url = resetUrl(req, token);
    try {
      const delivery = await sendPasswordResetEmail({
        to: user.email,
        name: user.display_name,
        resetUrl: url,
        expiresMinutes: resetTokenMinutes(),
      });
      console.log(`[Recall] Password reset email sent to ${user.email} via ${delivery.transport}`);
    } catch (err) {
      // Never surface a delivery failure to the caller: doing so would reveal
      // that the address belongs to a real account. Log it for operators.
      console.error(`[Recall] Password reset email failed for ${user.email}: ${err?.message || err}`);
    }

    if (shouldExposeResetToken(mail)) {
      response.devResetUrl = url;
      response.devNote = mail.configured
        ? 'RECALL_EXPOSE_RESET_TOKEN is enabled, so the link is also shown here for testing.'
        : 'No email provider is configured, so the reset link is shown here. Configure SMTP before production.';
    }
  }

  res.json(response);
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, password } = req.body || {};
  const userId = consumeResetToken(token, password);
  res.json({ ok: true, userId });
}));

router.post('/change-password', asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized();
  const { currentPassword, newPassword } = req.body || {};
  const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!verifyPassword(currentPassword || '', user.password_hash)) throw bad('Your current password is incorrect.', 'bad_credentials');
  validatePassword(newPassword);
  const { hashPassword } = await import('../lib/auth.js');
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hashPassword(newPassword), nowIso(), user.id]);
  destroyAllSessions(user.id);
  const { token } = createSession(user.id, req);
  setSessionCookie(res, token);
  res.json({ ok: true });
}));

export default router;
