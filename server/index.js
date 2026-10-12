/**
 * Recall server — Express app, security middleware, API routes and static SPA.
 */
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { attachUser, requireAuth, csrfGuard } from './lib/auth.js';
import { HttpError, asyncHandler } from './lib/util.js';
import { ensureCertifications } from './lib/certifications.js';
import { aiConfig } from './lib/ai.js';
import { billingConfig } from './lib/billing.js';
import { mailStatus } from './lib/mailer.js';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import materialsRoutes from './routes/materials.js';
import setsRoutes from './routes/sets.js';
import studyRoutes from './routes/study.js';
import quizRoutes from './routes/quizzes.js';
import plannerRoutes from './routes/planner.js';
import analyticsRoutes from './routes/analytics.js';
import dashboardRoutes from './routes/dashboard.js';
import billingRoutes, { webhookHandler } from './routes/billing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);

ensureCertifications();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---- Security headers -----------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self' https://checkout.stripe.com https://buy.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; '));
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// ---- Rate limiting --------------------------------------------------------
const buckets = new Map();
function rateLimit({ windowMs, max, key }) {
  return (req, res, next) => {
    const k = `${key}:${req.user?.id || req.ip}`;
    const now = Date.now();
    const entry = buckets.get(k) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
    entry.count += 1;
    buckets.set(k, entry);
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.', code: 'rate_limited' });
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
}, 60000).unref?.();

// Stripe webhooks are authenticated by signature, not by a session, so this
// route is mounted before cookie parsing and requires the raw request body.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), webhookHandler);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);
app.use(csrfGuard);

// ---- API routes -----------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    ai: aiConfig(),
    billing: { mode: billingConfig().mode, webhookConfigured: billingConfig().webhookConfigured },
    mail: mailStatus(),
  });
});

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 40, key: 'auth' }), authRoutes);
app.use('/api', requireAuth, profileRoutes);
app.use('/api', requireAuth, rateLimit({ windowMs: 60 * 1000, max: 240, key: 'api' }), materialsRoutes);
app.use('/api', requireAuth, setsRoutes);
app.use('/api', requireAuth, studyRoutes);
app.use('/api', requireAuth, quizRoutes);
app.use('/api', requireAuth, plannerRoutes);
app.use('/api', requireAuth, analyticsRoutes);
app.use('/api', requireAuth, dashboardRoutes);
app.use('/api', requireAuth, billingRoutes);

// ---- Static SPA -----------------------------------------------------------
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// Client-side routes fall through to the app shell.
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) return next();
  res.sendFile(indexPath);
});

// ---- Errors ---------------------------------------------------------------
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.', code: 'not_found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err instanceof HttpError ? err.status : (err.status || 500);
  if (status >= 500) console.error('[Recall] error:', err);
  res.status(status).json({
    error: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong on our side.' : err.message,
    code: err.code || 'error',
    ...(err.meta ? { meta: err.meta } : {}),
  });
});

app.listen(PORT, () => {
  const ai = aiConfig();
  const billing = billingConfig();
  const mail = mailStatus();
  console.log(`\n  Recall running on http://localhost:${PORT}`);
  console.log(`  AI: ${ai.configured ? `${ai.provider} (${ai.model})` : 'NOT CONFIGURED — document processing and AI question generation are disabled'}`);
  console.log(`  Billing: ${billing.configured ? billing.mode : 'NOT CONFIGURED — upgrades are disabled, free plan is fully usable'}`);
  console.log(`  Email: ${mail.configured ? `smtp (${mail.from || 'no from address'})` : `${mail.transport} — password-reset emails are not delivered`}`);
  console.log(`  Database: ${process.env.RECALL_DB_PATH || path.join(process.cwd(), 'data', 'recall.db')}\n`);
});
