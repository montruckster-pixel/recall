/**
 * End-to-end smoke test. Starts the server on a random port against a temporary
 * database and exercises the full happy path plus key error cases.
 *
 *   node scripts/smoke-test.js
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3700 + Math.floor(Math.random() * 200);
const DB = path.join(os.tmpdir(), `recall-smoke-${Date.now()}.db`);
const UPLOAD = path.join(os.tmpdir(), `recall-smoke-uploads-${Date.now()}`);
const OUTBOX = path.join(os.tmpdir(), `recall-smoke-outbox-${Date.now()}`);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0; let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const child = spawn(process.execPath, ['server/index.js'], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), '..'),
  env: {
    ...process.env,
    PORT: String(PORT),
    RECALL_DB_PATH: DB,
    RECALL_UPLOAD_DIR: UPLOAD,
    RECALL_ALLOW_DEV_UPGRADE: '1',
    // Exercise the password-reset flow end to end without an SMTP server.
    RECALL_MAIL_TRANSPORT: 'file',
    RECALL_MAIL_OUTBOX_DIR: OUTBOX,
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(`[server] ${d}`));
child.stderr.on('data', (d) => process.env.VERBOSE && process.stderr.write(`[server] ${d}`));

function waitForServer() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const tick = async () => {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) return resolve();
      } catch { /* not up yet */ }
      if (Date.now() > deadline) return reject(new Error('server did not start'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

let cookie = '';
async function call(method, path, body, { form } = {}) {
  const headers = { Cookie: cookie };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function main() {
  await waitForServer();
  console.log(`\nRecall smoke test (db: ${DB})\n`);

  // --- Auth ---------------------------------------------------------------
  let r = await call('POST', '/api/auth/signup', { email: 'smoke@test.local', password: 'password123', displayName: 'Smoke Test' });
  check('signup returns 201 + user', r.status === 201 && r.data.user?.email === 'smoke@test.local', JSON.stringify(r.data));

  r = await call('GET', '/api/auth/me');
  check('session persists (me)', r.status === 200 && r.data.user?.email === 'smoke@test.local');

  r = await call('POST', '/api/auth/signup', { email: 'smoke@test.local', password: 'password123' });
  check('duplicate email rejected', r.status === 400 && r.data.code === 'email_taken', JSON.stringify(r.data));

  r = await call('POST', '/api/auth/signup', { email: 'short@test.local', password: 'x' });
  check('weak password rejected', r.status === 400 && r.data.code === 'weak_password');

  // --- Password reset (email delivery) ------------------------------------
  r = await call('GET', '/api/auth/mail-status');
  check('mail status reports the transport',
    r.status === 200 && r.data.transport === 'file' && r.data.configured === false, JSON.stringify(r.data));

  r = await call('POST', '/api/auth/forgot-password', { email: 'smoke@test.local' });
  check('forgot-password accepts a known email', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
  check('reset link exposed while mail is not delivered',
    typeof r.data.devResetUrl === 'string' && r.data.devResetUrl.includes('/#/reset-password?token='), String(r.data.devResetUrl));
  const resetUrl = r.data.devResetUrl || '';

  const outboxFiles = fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).filter((f) => f.endsWith('.json')) : [];
  let sent = null;
  for (const file of outboxFiles) {
    const msg = JSON.parse(fs.readFileSync(path.join(OUTBOX, file), 'utf8'));
    if (msg.tag === 'password-reset' && msg.to === 'smoke@test.local') sent = msg;
  }
  check('reset email written to the outbox', !!sent, `${outboxFiles.length} file(s) in ${OUTBOX}`);
  check('reset email contains the reset link', !!sent && sent.text.includes(resetUrl), sent ? sent.subject : 'no message');
  check('reset email includes an HTML body', !!sent && typeof sent.html === 'string' && sent.html.includes('Reset your password'));
  check('reset email is addressed from Recall', !!sent && /Recall/.test(sent.from || ''), sent ? sent.from : '');

  const resetToken = decodeURIComponent((resetUrl.split('token=')[1] || ''));
  r = await call('POST', '/api/auth/reset-password', { token: resetToken, password: 'newpassword456' });
  check('reset-password accepts the emailed token', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));

  r = await call('POST', '/api/auth/reset-password', { token: resetToken, password: 'newpassword456' });
  check('reset token cannot be reused', r.status === 400, JSON.stringify(r.data));

  r = await call('POST', '/api/auth/login', { email: 'smoke@test.local', password: 'password123' });
  check('old password no longer works', r.status === 401);

  r = await call('POST', '/api/auth/login', { email: 'smoke@test.local', password: 'newpassword456' });
  check('login works with the new password', r.status === 200 && r.data.user?.email === 'smoke@test.local', JSON.stringify(r.data));

  r = await call('POST', '/api/auth/forgot-password', { email: 'nobody@test.local' });
  check('forgot-password does not reveal unknown accounts',
    r.status === 200 && r.data.ok === true && !r.data.devResetUrl, JSON.stringify(r.data));

  // --- Onboarding ---------------------------------------------------------
  r = await call('GET', '/api/certifications');
  check('certifications listed', r.status === 200 && r.data.categories.length >= 4);

  r = await call('POST', '/api/onboarding', {
    displayName: 'Smoke', certSlug: 'comptia-security-plus', certName: 'CompTIA Security+',
    examDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    knowledgeLevel: 'intermediate', dailyMinutes: 45,
    studyMethods: ['flashcards'], preferredDays: [1, 2, 3, 4, 5],
  });
  check('onboarding saves profile', r.status === 200 && r.data.profile?.certSlug === 'comptia-security-plus', JSON.stringify(r.data));

  // --- Study set + cards --------------------------------------------------
  r = await call('POST', '/api/sets', { title: 'Smoke Set', subject: 'Security', topic: 'Basics' });
  check('create study set', r.status === 201 && r.data.set.id);
  const setId = r.data.set.id;

  r = await call('POST', `/api/sets/${setId}/cards`, { cards: [
    { front: 'Q1', back: 'A1', topic: 'Basics' },
    { front: 'Q2', back: 'A2', topic: 'Basics' },
    { front: 'Q3', back: 'A3', topic: 'Basics' },
  ] });
  check('create 3 cards', r.status === 201 && r.data.created === 3, JSON.stringify(r.data));

  r = await call('POST', `/api/sets/${setId}/cards`, { cards: [{ front: '', back: '' }] });
  check('invalid card rejected', r.status === 400 && r.data.code === 'invalid_card');

  // --- Spaced repetition --------------------------------------------------
  r = await call('GET', '/api/study/queue');
  check('due queue returns new cards', r.status === 200 && r.data.items.length === 3, JSON.stringify(r.data).slice(0, 200));
  const cardId = r.data.items[0].id;

  r = await call('POST', '/api/study/review', { cardId, rating: 3, elapsedMs: 3000 });
  check('review with Good schedules future', r.status === 200 && r.data.schedule.state === 'learning' && new Date(r.data.schedule.dueAt) > new Date());
  check('review preview available', r.data.preview && r.data.preview.easy?.label);

  r = await call('POST', '/api/study/review', { cardId, rating: 9 });
  check('invalid rating rejected', r.status === 400 && r.data.code === 'invalid_rating');

  r = await call('POST', '/api/study/review', { cardId, rating: 1 });
  check('Again reschedules soon', r.status === 200 && new Date(r.data.schedule.dueAt) - Date.now() < 3600e3);

  r = await call('POST', '/api/study/session/complete', { cardsReviewed: 3, studySeconds: 120 });
  check('session complete updates activity',
    r.status === 200 && r.data.today.cardsReviewed >= 2 && r.data.today.sessionsCompleted === 1,
    JSON.stringify(r.data.today));

  // --- Quiz ---------------------------------------------------------------
  r = await call('POST', '/api/quizzes', { source: 'set', setId, mode: 'practice', questionCount: 3 });
  check('build quiz from set (non-AI fallback)', r.status === 201 && r.data.questionCount >= 1, JSON.stringify(r.data).slice(0, 200));
  const quizId = r.data.quiz.id;

  r = await call('GET', `/api/quizzes/${quizId}`);
  check('quiz questions hidden before submit', r.status === 200 && r.data.questions[0].correctAnswer === undefined);
  const q0 = r.data.questions[0];

  r = await call('POST', `/api/quizzes/${quizId}/attempts`, {});
  check('start attempt', r.status === 201 && r.data.attemptId);
  const attemptId = r.data.attemptId;

  await call('POST', `/api/attempts/${attemptId}/answers`, { questionId: q0.id, response: q0.options[0] });
  r = await call('POST', `/api/attempts/${attemptId}/submit`, {});
  check('submit attempt returns score', r.status === 200 && typeof r.data.score === 'number', JSON.stringify(r.data));

  r = await call('GET', `/api/attempts/${attemptId}/summary`);
  check('attempt summary has topic breakdown', r.status === 200 && Array.isArray(r.data.byTopic));

  r = await call('POST', `/api/attempts/${attemptId}/submit`, {});
  check('double submit rejected', r.status === 400 && r.data.code === 'already_submitted');

  r = await call('POST', '/api/study/from-missed', { attemptId });
  check('missed questions -> flashcards', r.status === 201 || r.data.code === 'no_missed', JSON.stringify(r.data));

  // --- Materials ----------------------------------------------------------
  const fd = new FormData();
  fd.append('title', 'Pasted notes');
  fd.append('text', 'Security+ study notes. Confidentiality ensures data is only read by authorised parties. Integrity ensures data is not altered. Availability ensures systems are reachable when needed. Multi-factor authentication combines two or more factor categories.');
  r = await call('POST', '/api/materials', undefined, { form: fd });
  check('paste text material extracts', r.status === 201 && r.data.material.charCount > 50, JSON.stringify(r.data).slice(0, 200));
  const materialId = r.data.material.id;

  r = await call('GET', `/api/materials/${materialId}/text`);
  check('material text preview works', r.status === 200 && r.data.text.includes('Confidentiality'));

  const bad = new FormData();
  bad.append('title', 'Bad file');
  bad.append('file', new Blob(['x'], { type: 'application/octet-stream' }), 'virus.exe');
  r = await call('POST', '/api/materials', undefined, { form: bad });
  check('unsupported file type rejected', r.status === 415 && r.data.code === 'unsupported_type', JSON.stringify(r.data));

  // --- Planner & analytics ------------------------------------------------
  r = await call('GET', '/api/planner?days=7');
  check('planner returns 7 days', r.status === 200 && r.data.days.length === 7);

  r = await call('POST', '/api/planner/tasks', { title: 'Extra review', date: new Date().toISOString().slice(0, 10), estMinutes: 20 });
  check('manual planner task created', r.status === 201 && r.data.task.id);
  const taskId = r.data.task.id;
  r = await call('PUT', `/api/planner/tasks/${taskId}`, { status: 'done' });
  check('planner task completed', r.status === 200 && r.data.task.status === 'done');

  r = await call('GET', '/api/analytics?days=30');
  check('analytics returns activity + insights', r.status === 200 && Array.isArray(r.data.activity) && Array.isArray(r.data.insights));

  r = await call('GET', '/api/dashboard');
  check('dashboard aggregates real data', r.status === 200 && r.data.today && r.data.onboarding.onboarded === true);

  // --- Billing / entitlements --------------------------------------------
  r = await call('GET', '/api/billing');
  check('billing returns plans + entitlements', r.status === 200 && r.data.entitlements.planId === 'free');

  r = await call('POST', '/api/billing/dev-activate', { plan: 'plus' });
  check('dev upgrade (test mode) works', r.status === 200 && r.data.entitlements.planId === 'plus', JSON.stringify(r.data));

  r = await call('GET', '/api/analytics?days=30');
  check('plus unlocks advanced analytics', r.status === 200 && r.data.advanced === true && Array.isArray(r.data.topics));

  r = await call('POST', '/api/billing/cancel', {});
  check('cancel sets cancel_at_period_end', r.status === 200 && r.data.entitlements.subscription.cancelAtPeriodEnd === true);

  // --- Webhook security ---------------------------------------------------
  r = await call('POST', '/api/billing/webhook', { type: 'checkout.session.completed' });
  check('unsigned webhook rejected (not activated)', r.status === 503 || r.status === 400, `status ${r.status}`);

  // --- Isolation ----------------------------------------------------------
  const other = await fetch(`${BASE}/api/sets`, { headers: { Cookie: '' } });
  check('unauthenticated request blocked', other.status === 401);

  // --- Export / delete ----------------------------------------------------
  const exp = await fetch(`${BASE}/api/account/export`, { headers: { Cookie: cookie } });
  const exportBody = await exp.text();
  check('data export returns JSON', exp.status === 200 && exportBody.includes('studySets'));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  child.kill();
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  child.kill();
  process.exit(1);
});
