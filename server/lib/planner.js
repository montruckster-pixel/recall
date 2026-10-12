/**
 * Study planner. Builds a rolling plan of concrete daily tasks from the user's
 * real state: cards due, weak topics, unfinished quizzes, exam date, daily time
 * budget and available weekdays. Missed sessions are re-planned rather than
 * left to break the schedule.
 */
import { get, all, run, nowIso, dayKey } from './db.js';
import { id, addDays } from './util.js';
import { dueCount } from './fsrs.js';
import { weakTopics, upsertPlanDay } from './activity.js';

const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun (0 = Sunday)

function weekday(dateStr) { return new Date(`${dateStr}T00:00:00Z`).getUTCDay(); }

export function planWindow(userId, days = 14) {
  const profile = get('SELECT * FROM profiles WHERE user_id = ?', [userId]);
  const availableDays = safeDays(profile?.preferred_days);
  const dailyMinutes = profile?.daily_minutes || 45;

  const existing = all(
    'SELECT * FROM study_tasks WHERE user_id = ? AND date >= ? ORDER BY date, created_at',
    [userId, dayKey()],
  );
  const byDate = new Map();
  for (const t of existing) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }

  const out = [];
  for (let i = 0; i < days; i += 1) {
    const date = dayKey(addDays(new Date(), i));
    const tasks = byDate.get(date) || [];
    const planDay = get('SELECT * FROM study_plan_days WHERE user_id = ? AND date = ?', [userId, date]);
    out.push({
      date,
      available: availableDays.includes(weekday(date)),
      goalMinutes: planDay?.goal_minutes ?? dailyMinutes,
      goalCards: planDay?.goal_cards ?? profile?.daily_goal_cards ?? 40,
      plannedMinutes: tasks.reduce((a, t) => a + (t.status === 'done' ? 0 : t.est_minutes), 0),
      tasks: tasks.map(publicTask),
    });
  }
  return out;
}

export function publicTask(t) {
  return {
    id: t.id, date: t.date, type: t.type, title: t.title, detail: t.detail,
    refSetId: t.ref_set_id, refMaterialId: t.ref_material_id,
    estMinutes: t.est_minutes, status: t.status, completedAt: t.completed_at,
  };
}

function safeDays(json) {
  try {
    const v = JSON.parse(json || '[]');
    if (Array.isArray(v) && v.length) return v.map(Number).filter((n) => n >= 0 && n <= 6);
  } catch { /* ignore */ }
  return DEFAULT_DAYS;
}

/**
 * Regenerate the next `days` days of tasks. Removes only *pending* generated
 * tasks (completed/skipped history is preserved). Marks overdue pending tasks
 * from past days as 'missed' so the UI can show them honestly.
 */
export function regeneratePlan(userId, days = 14) {
  const today = dayKey();

  // Mark overdue tasks.
  run(
    `UPDATE study_tasks SET status = 'missed'
     WHERE user_id = ? AND date < ? AND status = 'pending'`,
    [userId, today],
  );

  // Clear pending future tasks (they will be rebuilt).
  run(
    `DELETE FROM study_tasks WHERE user_id = ? AND date >= ? AND status = 'pending'`,
    [userId, today],
  );

  const profile = get('SELECT * FROM profiles WHERE user_id = ?', [userId]);
  const availableDays = safeDays(profile?.preferred_days);
  const dailyMinutes = Math.max(15, Math.min(240, profile?.daily_minutes || 45));
  const weak = weakTopics(userId, { minAnswers: 4, limit: 3 });
  const due = dueCount(userId);
  const duePerDay = Math.min(due, Math.ceil(due / 3) || 0);

  const sets = all(
    `SELECT s.id, s.title, COUNT(f.id) AS cards
     FROM study_sets s LEFT JOIN flashcards f ON f.set_id = s.id AND f.archived = 0
     WHERE s.user_id = ? AND s.archived = 0
     GROUP BY s.id ORDER BY s.last_studied_at DESC NULLS LAST, s.created_at DESC LIMIT 3`,
    [userId],
  );

  const examDate = profile?.exam_date ? new Date(profile.exam_date) : null;
  const daysToExam = examDate ? Math.ceil((examDate.getTime() - Date.now()) / 864e5) : null;

  for (let i = 0; i < days; i += 1) {
    const date = dayKey(addDays(new Date(), i));
    if (!availableDays.includes(weekday(date))) {
      upsertPlanDay(userId, date, { goalMinutes: 0, goalCards: 0, plannedMinutes: 0, status: 'rest' });
      continue;
    }

    const budget = dailyMinutes;
    const tasks = [];
    let used = 0;
    const push = (t) => {
      if (used + t.est_minutes > budget + 10) return;
      used += t.est_minutes;
      tasks.push(t);
    };

    // 1. Reviews first (the highest-value activity).
    if (due > 0) {
      push({
        type: 'review', title: `Review ${Math.max(10, duePerDay)} due flashcards`,
        detail: 'Clear your spaced-repetition queue for today.',
        est_minutes: Math.min(30, Math.max(10, Math.round(duePerDay * 0.4))),
      });
    }

    // 2. Weak-topic practice.
    for (const w of weak) {
      push({
        type: 'weak', title: `Practice weak topic: ${w.topic}`,
        detail: `Accuracy ${(w.accuracy * 100).toFixed(0)}% over ${w.answers} questions.`,
        est_minutes: 15,
      });
    }

    // 3. A practice quiz, more often as the exam approaches.
    const examPressure = daysToExam !== null && daysToExam <= 21;
    if (i % (examPressure ? 2 : 3) === 0) {
      const setId = sets[i % Math.max(1, sets.length)]?.id || null;
      push({
        type: 'quiz', title: 'Practice quiz',
        detail: sets.length ? 'Generate a quiz from a recent study set.' : 'Generate a quiz from a study set or uploaded material.',
        ref_set_id: setId, est_minutes: 20,
      });
    }

    // 4. New material / card generation.
    if (i % 3 === 1) {
      push({
        type: 'new', title: 'Add new material',
        detail: 'Upload notes or generate new cards to keep coverage growing.',
        est_minutes: 20,
      });
    }

    // 5. Light review of a study set.
    if (tasks.length < 2 && sets.length) {
      push({
        type: 'set', title: `Study set: ${sets[0].title}`,
        detail: `${sets[0].cards} cards`,
        ref_set_id: sets[0].id, est_minutes: 15,
      });
    }

    for (const t of tasks) {
      run(
        `INSERT INTO study_tasks (id, user_id, date, type, title, detail, ref_set_id, ref_material_id, est_minutes, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [id('tsk_'), userId, date, t.type, t.title, t.detail || null, t.ref_set_id || null, t.ref_material_id || null, t.est_minutes, nowIso()],
      );
    }
    upsertPlanDay(userId, date, { goalMinutes: budget, plannedMinutes: used, status: 'open' });
  }
}

/** A short "today" task list for the dashboard (auto-generates if empty). */
export function todayTasks(userId) {
  const today = dayKey();
  let tasks = all(
    `SELECT * FROM study_tasks WHERE user_id = ? AND date = ? AND status IN ('pending','done','skipped')
     ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at`,
    [userId, today],
  );
  if (!tasks.length) {
    regeneratePlan(userId, 14);
    tasks = all(
      `SELECT * FROM study_tasks WHERE user_id = ? AND date = ? ORDER BY created_at`,
      [userId, today],
    );
  }
  return tasks.map(publicTask);
}
