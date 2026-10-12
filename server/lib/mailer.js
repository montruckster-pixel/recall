/**
 * Recall — transactional email delivery.
 *
 * Transports (chosen by RECALL_MAIL_TRANSPORT, default "auto"):
 *
 *   smtp     Real delivery through an SMTP provider (nodemailer).
 *   file     Writes each message to RECALL_MAIL_OUTBOX_DIR as .json + .txt.
 *            Great for local development and for automated tests.
 *   console  Prints the message to the server log.
 *   none     Disables sending entirely; sendMail() throws.
 *
 * "auto" picks smtp when SMTP_HOST is set, otherwise file when an outbox
 * directory is configured, otherwise console.
 *
 * Only the "smtp" transport actually reaches a user's inbox, so that is the
 * only transport mailStatus() reports as `configured`. The others exist so the
 * app runs and stays testable with no external services.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './util.js';

const APP_NAME = 'Recall';
const DEFAULT_FROM_NAME = 'Recall';
const DEFAULT_TIMEOUT_MS = 15000;

function env(name) {
  return String(process.env[name] ?? '').trim();
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

// ---- Transport resolution -------------------------------------------------

export function resolveTransport() {
  const explicit = (env('RECALL_MAIL_TRANSPORT') || 'auto').toLowerCase();
  const host = env('SMTP_HOST');

  switch (explicit) {
    case 'smtp': return host ? 'smtp' : 'console';
    case 'file': return 'file';
    case 'console': return 'console';
    case 'none': return 'none';
    default:
      if (host) return 'smtp';
      if (env('RECALL_MAIL_OUTBOX_DIR')) return 'file';
      return 'console';
  }
}

function outboxDir() {
  return env('RECALL_MAIL_OUTBOX_DIR') || path.resolve(process.cwd(), 'data', 'outbox');
}

function fromAddress() {
  const raw = env('MAIL_FROM') || env('SMTP_FROM') || env('SMTP_USER');
  if (!raw) return '';
  if (raw.includes('<')) return raw;
  const name = env('MAIL_FROM_NAME') || DEFAULT_FROM_NAME;
  return `${name} <${raw}>`;
}

function smtpSettings() {
  const port = Number(env('SMTP_PORT') || 587);
  const secureFlag = env('SMTP_SECURE');
  const timeout = Number(env('SMTP_TIMEOUT_MS') || DEFAULT_TIMEOUT_MS);
  const user = env('SMTP_USER');
  return {
    host: env('SMTP_HOST'),
    port,
    // Port 465 is implicit TLS; 587 uses STARTTLS. An explicit SMTP_SECURE wins.
    secure: secureFlag ? truthy(secureFlag) : port === 465,
    auth: user ? { user, pass: env('SMTP_PASS') } : undefined,
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  };
}

/**
 * Human-readable delivery status. Safe to expose to the browser: it never
 * includes credentials or the SMTP host.
 */
export function mailStatus() {
  const transport = resolveTransport();
  const configured = transport === 'smtp';
  let message;
  if (configured) {
    message = `Password-reset emails are delivered over SMTP${env('SMTP_HOST') ? '' : ' (no host configured)'}.`;
  } else if (transport === 'file') {
    message = 'Emails are written to a local outbox directory instead of being delivered. Configure SMTP before production.';
  } else if (transport === 'console') {
    message = 'No SMTP provider is configured. Reset links are written to the server log. Configure SMTP before production.';
  } else {
    message = 'Email delivery is disabled (RECALL_MAIL_TRANSPORT=none).';
  }
  return {
    transport,
    configured,
    from: configured ? (fromAddress() || null) : null,
    message,
  };
}

// ---- Sending --------------------------------------------------------------

let cachedTransporter = null;

async function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    throw new HttpError(
      503,
      'SMTP delivery needs the "nodemailer" package. Install it with: npm install nodemailer',
      'mail_dependency_missing',
    );
  }
  cachedTransporter = nodemailer.createTransport(smtpSettings());
  return cachedTransporter;
}

async function sendViaSmtp(message) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail(message);
  return { transport: 'smtp', id: info.messageId || null, accepted: info.accepted || [] };
}

async function sendViaFile(message, tag) {
  const dir = outboxDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeTo = String(message.to || 'unknown').replace(/[^A-Za-z0-9@._-]/g, '_');
  const base = `${stamp}_${safeTo}`;
  const payload = {
    to: message.to,
    from: message.from,
    subject: message.subject,
    text: message.text || null,
    html: message.html || null,
    tag: tag || null,
    sentAt: new Date().toISOString(),
    transport: 'file',
  };
  const jsonPath = path.join(dir, `${base}.json`);
  const textPath = path.join(dir, `${base}.txt`);
  await fs.promises.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.promises.writeFile(
    textPath,
    `To: ${message.to}\nFrom: ${message.from}\nSubject: ${message.subject}\nDate: ${payload.sentAt}\n\n${message.text || ''}\n`,
    'utf8',
  );
  return { transport: 'file', id: base, outboxDir: dir, previewPath: textPath };
}

function sendViaConsole(message) {
  const line = '─'.repeat(64);
  console.log(`\n${line}\n[Recall mail → console transport]\nTo:      ${message.to}\nFrom:    ${message.from}\nSubject: ${message.subject}\n${line}\n${message.text || ''}\n${line}\n`);
  return { transport: 'console', id: null };
}

/**
 * Send a message through the configured transport.
 * Throws when delivery is disabled or misconfigured.
 */
export async function sendMail({ to, subject, text, html, replyTo, tag } = {}) {
  if (!to) throw new HttpError(500, 'sendMail() requires a recipient.', 'mail_no_recipient');
  const transport = resolveTransport();
  if (transport === 'none') {
    throw new HttpError(503, 'Email delivery is disabled (RECALL_MAIL_TRANSPORT=none).', 'mail_disabled');
  }
  const message = {
    from: fromAddress() || `${DEFAULT_FROM_NAME} <no-reply@localhost>`,
    to,
    subject,
    text,
    html,
    ...(replyTo ? { replyTo } : {}),
  };
  if (transport === 'smtp') return sendViaSmtp(message);
  if (transport === 'file') return sendViaFile(message, tag);
  return sendViaConsole(message);
}

// ---- Templates ------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function passwordResetEmail({ name, resetUrl, expiresMinutes = 60 }) {
  const safeName = escapeHtml(name || '').trim();
  const greeting = safeName ? `Hi ${safeName},` : 'Hi,';
  const url = String(resetUrl || '');
  const safeUrl = escapeHtml(url);
  const minutes = Number(expiresMinutes) > 0 ? Number(expiresMinutes) : 60;
  const window = minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`;

  const subject = `Reset your ${APP_NAME} password`;

  const text = [
    greeting,
    '',
    `We received a request to reset the password for your ${APP_NAME} account.`,
    'Open the link below to choose a new password:',
    '',
    url,
    '',
    `This link expires in ${window} and can only be used once.`,
    '',
    "If you didn't request a password reset you can ignore this email — your password will not change.",
    '',
    `— ${APP_NAME}`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
<tr><td style="padding:24px 28px 0;font:600 17px/1.2 ${FONT};color:#0f172a;">${APP_NAME}</td></tr>
<tr><td style="padding:18px 28px 0;">
<h1 style="margin:0 0 12px;font:600 22px/1.3 ${FONT};color:#0f172a;">Reset your password</h1>
<p style="margin:0 0 12px;font:400 15px/1.6 ${FONT};color:#334155;">${greeting}</p>
<p style="margin:0 0 12px;font:400 15px/1.6 ${FONT};color:#334155;">We received a request to reset the password for your ${APP_NAME} account. Click the button below to choose a new password.</p>
</td></tr>
<tr><td style="padding:8px 28px 20px;">
<a href="${safeUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font:600 15px/1 ${FONT};padding:13px 22px;border-radius:8px;">Reset password</a>
</td></tr>
<tr><td style="padding:0 28px 22px;">
<p style="margin:0 0 6px;font:400 13px/1.6 ${FONT};color:#64748b;">If the button doesn&rsquo;t work, copy and paste this link into your browser:</p>
<p style="margin:0;font:400 13px/1.6 ${FONT};color:#4f46e5;word-break:break-all;">${safeUrl}</p>
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #e5e7eb;">
<p style="margin:0;font:400 13px/1.6 ${FONT};color:#64748b;">This link expires in ${window} and can only be used once. If you didn&rsquo;t request a password reset you can ignore this email &mdash; your password will not change.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}

export async function sendPasswordResetEmail({ to, name, resetUrl, expiresMinutes = 60 }) {
  const { subject, text, html } = passwordResetEmail({ name, resetUrl, expiresMinutes });
  return sendMail({ to, subject, text, html, tag: 'password-reset' });
}

/** Reset the cached SMTP connection pool. Used by tests. */
export function resetMailer() {
  cachedTransporter = null;
}
