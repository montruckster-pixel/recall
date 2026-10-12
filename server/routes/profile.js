import express from 'express';
import { get, all, run, nowIso, dayKey } from '../lib/db.js';
import { asyncHandler, bad, id, str } from '../lib/util.js';
import { publicUser } from '../lib/auth.js';
import { listCertifications } from '../lib/certifications.js';
import { regeneratePlan } from '../lib/planner.js';

const router = express.Router();

function readProfile(userId) {
  const p = get('SELECT * FROM profiles WHERE user_id = ?', [userId]);
  if (!p) return null;
  return {
    certSlug: p.cert_slug,
    certName: p.cert_name,
    examDate: p.exam_date,
    knowledgeLevel: p.knowledge_level,
    dailyMinutes: p.daily_minutes,
    studyMethods: JSON.parse(p.study_methods || '[]'),
    preferredDays: JSON.parse(p.preferred_days || '[]'),
    dailyGoalCards: p.daily_goal_cards,
    dailyGoalMinutes: p.daily_goal_minutes,
    timezone: p.timezone,
    updatedAt: p.updated_at,
  };
}

function readSettings(userId) {
  const s = get('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
  return {
    theme: s?.theme || 'system',
    reducedMotion: Boolean(s?.reduced_motion),
    emailReminders: Boolean(s?.email_reminders),
    aiConsent: Boolean(s?.ai_consent),
  };
}

router.get('/certifications', asyncHandler(async (_req, res) => {
  res.json({ categories: listCertifications() });
}));

router.get('/profile', asyncHandler(async (req, res) => {
  res.json({
    user: publicUser(req.user),
    profile: readProfile(req.user.id),
    settings: readSettings(req.user.id),
  });
}));

const VALID_LEVELS = ['beginner', 'intermediate', 'advanced'];
const VALID_METHODS = ['flashcards', 'practice-questions', 'reading', 'video', 'teaching-others'];

router.post('/onboarding', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const b = req.body || {};
  const certSlug = str(b.certSlug, 60);
  const certName = str(b.certName, 120);
  const level = VALID_LEVELS.includes(b.knowledgeLevel) ? b.knowledgeLevel : 'beginner';
  const dailyMinutes = Math.max(10, Math.min(300, Number(b.dailyMinutes) || 45));
  const methods = Array.isArray(b.studyMethods) ? b.studyMethods.filter((m) => VALID_METHODS.includes(m)) : [];
  const days = Array.isArray(b.preferredDays) ? b.preferredDays.map(Number).filter((n) => n >= 0 && n <= 6) : [];
  const examDate = b.examDate ? str(b.examDate, 10) : null;
  if (examDate && !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) throw bad('Exam date must be a valid date.', 'invalid_date');
  if (certSlug && !get('SELECT slug FROM certifications WHERE slug = ?', [certSlug])) throw bad('Unknown certification.', 'invalid_cert');

  const displayName = str(b.displayName, 80) || req.user.display_name;
  const ts = nowIso();

  if (displayName) run('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?', [displayName, ts, userId]);

  const existing = get('SELECT user_id FROM profiles WHERE user_id = ?', [userId]);
  if (existing) {
    run(
      `UPDATE profiles SET cert_slug=?, cert_name=?, exam_date=?, knowledge_level=?, daily_minutes=?,
         study_methods=?, preferred_days=?, daily_goal_cards=?, daily_goal_minutes=?, updated_at=?
       WHERE user_id=?`,
      [certSlug || null, certName || null, examDate, level, dailyMinutes,
       JSON.stringify(methods), JSON.stringify(days), Math.round(dailyMinutes / 1.2), dailyMinutes, ts, userId],
    );
  } else {
    run(
      `INSERT INTO profiles (user_id, cert_slug, cert_name, exam_date, knowledge_level, daily_minutes,
         study_methods, preferred_days, daily_goal_cards, daily_goal_minutes, timezone, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, certSlug || null, certName || null, examDate, level, dailyMinutes,
       JSON.stringify(methods), JSON.stringify(days), Math.round(dailyMinutes / 1.2), dailyMinutes, 'UTC', ts],
    );
  }

  // Create (or update) the certification workspace.
  const wsName = certName || (certSlug ? get('SELECT name FROM certifications WHERE slug = ?', [certSlug])?.name : null) || 'My certification';
  const ws = get('SELECT * FROM workspaces WHERE user_id = ? AND is_active = 1', [userId]);
  if (!ws) {
    run(
      'INSERT INTO workspaces (id, user_id, cert_slug, name, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      [id('ws_'), userId, certSlug || null, wsName, ts],
    );
  } else {
    run('UPDATE workspaces SET cert_slug = ?, name = ? WHERE id = ?', [certSlug || null, wsName, ws.id]);
  }

  run('UPDATE users SET onboarded_at = COALESCE(onboarded_at, ?), updated_at = ? WHERE id = ?', [ts, ts, userId]);
  regeneratePlan(userId, 14);

  res.json({
    user: publicUser(get('SELECT * FROM users WHERE id = ?', [userId])),
    profile: readProfile(userId),
  });
}));

router.put('/profile', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const b = req.body || {};
  const current = get('SELECT * FROM profiles WHERE user_id = ?', [userId]);
  if (!current) throw bad('Complete onboarding first.', 'not_onboarded');

  const examDate = b.examDate !== undefined ? (b.examDate ? str(b.examDate, 10) : null) : current.exam_date;
  if (examDate && !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) throw bad('Exam date must be a valid date.', 'invalid_date');
  const dailyMinutes = b.dailyMinutes !== undefined ? Math.max(10, Math.min(300, Number(b.dailyMinutes) || 45)) : current.daily_minutes;
  const methods = Array.isArray(b.studyMethods) ? b.studyMethods.filter((m) => VALID_METHODS.includes(m)) : JSON.parse(current.study_methods || '[]');
  const days = Array.isArray(b.preferredDays) ? b.preferredDays.map(Number).filter((n) => n >= 0 && n <= 6) : JSON.parse(current.preferred_days || '[]');

  run(
    `UPDATE profiles SET exam_date=?, knowledge_level=?, daily_minutes=?, study_methods=?, preferred_days=?,
       daily_goal_cards=?, daily_goal_minutes=?, cert_name=?, updated_at=? WHERE user_id=?`,
    [examDate,
     VALID_LEVELS.includes(b.knowledgeLevel) ? b.knowledgeLevel : current.knowledge_level,
     dailyMinutes, JSON.stringify(methods), JSON.stringify(days),
     Math.round(dailyMinutes / 1.2), dailyMinutes,
     b.certName !== undefined ? str(b.certName, 120) : current.cert_name,
     nowIso(), userId],
  );
  regeneratePlan(userId, 14);
  res.json({ profile: readProfile(userId) });
}));

router.put('/settings', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const b = req.body || {};
  const cur = readSettings(userId);
  run(
    `UPDATE user_settings SET theme=?, reduced_motion=?, email_reminders=?, ai_consent=?, updated_at=? WHERE user_id=?`,
    [['system', 'light', 'dark'].includes(b.theme) ? b.theme : cur.theme,
     b.reducedMotion !== undefined ? (b.reducedMotion ? 1 : 0) : (cur.reducedMotion ? 1 : 0),
     b.emailReminders !== undefined ? (b.emailReminders ? 1 : 0) : (cur.emailReminders ? 1 : 0),
     b.aiConsent !== undefined ? (b.aiConsent ? 1 : 0) : (cur.aiConsent ? 1 : 0),
     nowIso(), userId],
  );
  res.json({ settings: readSettings(userId) });
}));

/** Full data export (JSON) for the signed-in user. */
router.get('/account/export', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const payload = {
    exportedAt: nowIso(),
    user: publicUser(req.user),
    profile: readProfile(userId),
    settings: readSettings(userId),
    workspaces: all('SELECT * FROM workspaces WHERE user_id = ?', [userId]),
    materials: all('SELECT id, title, description, status, subject, topic, char_count, created_at FROM materials WHERE user_id = ?', [userId]),
    studySets: all('SELECT * FROM study_sets WHERE user_id = ?', [userId]),
    flashcards: all('SELECT * FROM flashcards WHERE user_id = ?', [userId]),
    cardSchedule: all('SELECT * FROM card_schedule WHERE user_id = ?', [userId]),
    cardReviews: all('SELECT * FROM card_reviews WHERE user_id = ?', [userId]),
    quizzes: all('SELECT * FROM quizzes WHERE user_id = ?', [userId]),
    quizAttempts: all('SELECT * FROM quiz_attempts WHERE user_id = ?', [userId]),
    attemptAnswers: all('SELECT * FROM attempt_answers WHERE user_id = ?', [userId]),
    studyTasks: all('SELECT * FROM study_tasks WHERE user_id = ?', [userId]),
    dailyActivity: all('SELECT * FROM daily_activity WHERE user_id = ?', [userId]),
    subscription: get('SELECT plan, billing_interval, status, current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id = ?', [userId]),
  };
  res.setHeader('Content-Disposition', `attachment; filename="recall-export-${dayKey()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(payload, null, 2));
}));

/** Delete the account and all associated study data. */
router.delete('/account', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  if (req.body?.confirm !== 'DELETE') {
    throw bad('Type DELETE to confirm account deletion.', 'confirm_required');
  }
  const ts = nowIso();
  // Hard-delete study data; keep a tombstone row so the email can be re-registered.
  for (const table of ['card_reviews', 'card_schedule', 'flashcards', 'attempt_answers', 'quiz_attempts',
    'quiz_questions', 'quizzes', 'study_tasks', 'study_plan_days', 'daily_activity', 'ai_usage',
    'study_sets', 'materials', 'workspaces']) {
    run(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
  }
  run('DELETE FROM sessions WHERE user_id = ?', [userId]);
  run('DELETE FROM password_resets WHERE user_id = ?', [userId]);
  run('DELETE FROM profiles WHERE user_id = ?', [userId]);
  run('DELETE FROM user_settings WHERE user_id = ?', [userId]);
  run('UPDATE subscriptions SET plan = ?, status = ?, updated_at = ? WHERE user_id = ?', ['free', 'canceled', ts, userId]);
  const tombstone = `deleted+${userId}@recall.invalid`;
  run('UPDATE users SET email = ?, display_name = ?, deleted_at = ?, updated_at = ? WHERE id = ?', [tombstone, null, ts, ts, userId]);
  res.json({ ok: true });
}));

export default router;
