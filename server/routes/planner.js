import express from 'express';
import { get, all, run, nowIso, dayKey } from '../lib/db.js';
import { asyncHandler, bad, notFound, id, str, addDays } from '../lib/util.js';
import { planWindow, regeneratePlan, publicTask } from '../lib/planner.js';
import { upsertPlanDay } from '../lib/activity.js';

const router = express.Router();

const TASK_TYPES = ['review', 'quiz', 'read', 'weak', 'new', 'set', 'custom'];
const STATUSES = ['pending', 'done', 'skipped', 'missed', 'rescheduled'];

router.get('/planner', asyncHandler(async (req, res) => {
  const days = Math.min(60, Math.max(7, Number.parseInt(req.query.days, 10) || 14));
  const profile = get('SELECT * FROM profiles WHERE user_id = ?', [req.user.id]);
  const window = planWindow(req.user.id, days);
  res.json({
    days: window,
    examDate: profile?.exam_date || null,
    dailyMinutes: profile?.daily_minutes ?? 45,
    note: 'Plans adjust automatically as your review queue and quiz results change. Missing a day does not reset your progress.',
  });
}));

router.post('/planner/regenerate', asyncHandler(async (req, res) => {
  const days = Math.min(60, Math.max(7, Number.parseInt(req.body?.days, 10) || 14));
  regeneratePlan(req.user.id, days);
  res.json({ days: planWindow(req.user.id, days) });
}));

router.post('/planner/tasks', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const b = req.body || {};
  const date = str(b.date, 10) || dayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Invalid date.', 'invalid_date');
  const type = TASK_TYPES.includes(b.type) ? b.type : 'custom';
  const title = str(b.title, 200);
  if (!title) throw bad('Give the session a title.', 'title_required');
  const estMinutes = Math.max(5, Math.min(240, Number(b.estMinutes) || 20));
  const taskId = id('tsk_');
  run(
    `INSERT INTO study_tasks (id, user_id, date, type, title, detail, ref_set_id, est_minutes, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [taskId, userId, date, type, title, str(b.detail, 400) || null, b.refSetId || null, estMinutes, nowIso()],
  );
  res.status(201).json({ task: publicTask(get('SELECT * FROM study_tasks WHERE id = ?', [taskId])) });
}));

router.put('/planner/tasks/:id', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const t = get('SELECT * FROM study_tasks WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!t) throw notFound('Task not found.');
  const b = req.body || {};
  const status = STATUSES.includes(b.status) ? b.status : t.status;
  const date = b.date ? str(b.date, 10) : t.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Invalid date.', 'invalid_date');
  run(
    `UPDATE study_tasks SET status = ?, date = ?, title = ?, detail = ?, est_minutes = ?, completed_at = ?
     WHERE id = ? AND user_id = ?`,
    [status, date,
     b.title !== undefined ? (str(b.title, 200) || t.title) : t.title,
     b.detail !== undefined ? (str(b.detail, 400) || null) : t.detail,
     b.estMinutes !== undefined ? Math.max(5, Math.min(240, Number(b.estMinutes) || t.est_minutes)) : t.est_minutes,
     status === 'done' ? nowIso() : null, t.id, userId],
  );
  if (status === 'done') {
    run('UPDATE daily_activity SET sessions_completed = sessions_completed + 1 WHERE user_id = ? AND date = ?', [userId, date]);
  }
  res.json({ task: publicTask(get('SELECT * FROM study_tasks WHERE id = ?', [t.id])) });
}));

router.delete('/planner/tasks/:id', asyncHandler(async (req, res) => {
  const t = get('SELECT * FROM study_tasks WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!t) throw notFound('Task not found.');
  run('DELETE FROM study_tasks WHERE id = ? AND user_id = ?', [t.id, req.user.id]);
  res.json({ ok: true });
}));

router.put('/planner/days/:date', asyncHandler(async (req, res) => {
  const date = str(req.params.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Invalid date.', 'invalid_date');
  const b = req.body || {};
  const day = upsertPlanDay(req.user.id, date, {
    goalCards: b.goalCards !== undefined ? Math.max(0, Math.min(1000, Number(b.goalCards) || 0)) : undefined,
    goalMinutes: b.goalMinutes !== undefined ? Math.max(0, Math.min(600, Number(b.goalMinutes) || 0)) : undefined,
    status: ['open', 'rest', 'complete'].includes(b.status) ? b.status : undefined,
    notes: b.notes !== undefined ? str(b.notes, 500) : undefined,
  });
  res.json({ day });
}));

export default router;
