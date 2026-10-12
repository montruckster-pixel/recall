/**
 * Daily activity counters and shared aggregate queries used by the dashboard,
 * planner and analytics pages. All figures come from real stored activity.
 */
import { get, all, run, nowIso, dayKey } from './db.js';
import { id } from './util.js';

export function bumpActivity(userId, date, patch) {
  const d = date || dayKey();
  const existing = get('SELECT * FROM daily_activity WHERE user_id = ? AND date = ?', [userId, d]);
  if (!existing) {
    run(
      `INSERT INTO daily_activity (id, user_id, date, cards_reviewed, questions_answered, correct_answers, study_seconds, sessions_completed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id('act_'), userId, d,
       patch.cardsReviewed || 0, patch.questionsAnswered || 0, patch.correctAnswers || 0,
       patch.studySeconds || 0, patch.sessionsCompleted || 0],
    );
    return;
  }
  run(
    `UPDATE daily_activity SET
       cards_reviewed = cards_reviewed + ?,
       questions_answered = questions_answered + ?,
       correct_answers = correct_answers + ?,
       study_seconds = study_seconds + ?,
       sessions_completed = sessions_completed + ?
     WHERE user_id = ? AND date = ?`,
    [patch.cardsReviewed || 0, patch.questionsAnswered || 0, patch.correctAnswers || 0,
     patch.studySeconds || 0, patch.sessionsCompleted || 0, userId, d],
  );
}

export function activityRange(userId, days = 30) {
  const since = dayKey(new Date(Date.now() - (days - 1) * 864e5));
  const rows = all(
    'SELECT * FROM daily_activity WHERE user_id = ? AND date >= ? ORDER BY date ASC',
    [userId, since],
  );
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = dayKey(new Date(Date.now() - i * 864e5));
    const r = byDate.get(d);
    out.push({
      date: d,
      cardsReviewed: r?.cards_reviewed || 0,
      questionsAnswered: r?.questions_answered || 0,
      correctAnswers: r?.correct_answers || 0,
      studySeconds: r?.study_seconds || 0,
      sessionsCompleted: r?.sessions_completed || 0,
    });
  }
  return out;
}

export function todayActivity(userId) {
  const d = dayKey();
  const r = get('SELECT * FROM daily_activity WHERE user_id = ? AND date = ?', [userId, d]);
  return {
    date: d,
    cardsReviewed: r?.cards_reviewed || 0,
    questionsAnswered: r?.questions_answered || 0,
    correctAnswers: r?.correct_answers || 0,
    studySeconds: r?.study_seconds || 0,
    sessionsCompleted: r?.sessions_completed || 0,
  };
}

/** Weak topics: lowest accuracy with a minimum sample size. */
export function weakTopics(userId, { minAnswers = 4, limit = 8 } = {}) {
  const rows = all(
    `SELECT topic,
            COUNT(*) AS answers,
            SUM(is_correct) AS correct
     FROM attempt_answers
     WHERE user_id = ? AND topic IS NOT NULL AND topic <> ''
     GROUP BY topic
     HAVING COUNT(*) >= ?
     ORDER BY (CAST(SUM(is_correct) AS REAL) / COUNT(*)) ASC
     LIMIT ?`,
    [userId, minAnswers, limit],
  );
  return rows.map((r) => ({
    topic: r.topic,
    answers: r.answers,
    correct: r.correct,
    accuracy: r.answers ? r.correct / r.answers : 0,
  }));
}

/** Topic accuracy across all answered quiz questions. */
export function topicPerformance(userId, { minAnswers = 1, limit = 25 } = {}) {
  const rows = all(
    `SELECT COALESCE(NULLIF(topic, ''), 'Uncategorized') AS topic,
            COUNT(*) AS answers, SUM(is_correct) AS correct
     FROM attempt_answers
     WHERE user_id = ?
     GROUP BY topic
     HAVING COUNT(*) >= ?
     ORDER BY answers DESC
     LIMIT ?`,
    [userId, minAnswers, limit],
  );
  return rows.map((r) => ({
    topic: r.topic,
    answers: r.answers,
    correct: r.correct,
    accuracy: r.answers ? r.correct / r.answers : 0,
  }));
}

/** Review accuracy from flashcard ratings (Good/Easy count as correct recall). */
export function reviewAccuracy(userId, sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 864e5).toISOString();
  const row = get(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END) AS good
     FROM card_reviews WHERE user_id = ? AND reviewed_at >= ?`,
    [userId, since],
  );
  const total = row?.total || 0;
  const good = row?.good || 0;
  return { total, good, accuracy: total ? good / total : 0 };
}

/** Study streaks from daily activity. */
export function streak(userId) {
  const rows = all(
    'SELECT date FROM daily_activity WHERE user_id = ? AND (cards_reviewed > 0 OR questions_answered > 0) ORDER BY date DESC LIMIT 400',
    [userId],
  );
  const days = new Set(rows.map((r) => r.date));
  let current = 0;
  for (let i = 0; i < 400; i += 1) {
    const d = dayKey(new Date(Date.now() - i * 864e5));
    if (days.has(d)) current += 1;
    else if (i > 0) break;
  }
  return { current, totalDays: days.size };
}

export function upsertPlanDay(userId, date, patch = {}) {
  const existing = get('SELECT * FROM study_plan_days WHERE user_id = ? AND date = ?', [userId, date]);
  if (existing) {
    run(
      `UPDATE study_plan_days SET goal_cards = ?, goal_minutes = ?, planned_minutes = ?, status = ?, notes = ?
       WHERE user_id = ? AND date = ?`,
      [patch.goalCards ?? existing.goal_cards, patch.goalMinutes ?? existing.goal_minutes,
       patch.plannedMinutes ?? existing.planned_minutes, patch.status ?? existing.status,
       patch.notes ?? existing.notes, userId, date],
    );
  } else {
    run(
      `INSERT INTO study_plan_days (id, user_id, date, goal_cards, goal_minutes, planned_minutes, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id('spd_'), userId, date, patch.goalCards ?? 40, patch.goalMinutes ?? 45,
       patch.plannedMinutes ?? 0, patch.status ?? 'open', patch.notes ?? null],
    );
  }
  return get('SELECT * FROM study_plan_days WHERE user_id = ? AND date = ?', [userId, date]);
}

export function recentActivity(userId, limit = 12) {
  const items = [];
  const materials = all(
    'SELECT id, title, status, created_at FROM materials WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, limit],
  );
  for (const m of materials) items.push({ type: 'material', id: m.id, title: m.title, status: m.status, at: m.created_at });

  const sets = all(
    'SELECT id, title, created_at FROM study_sets WHERE user_id = ? AND archived = 0 ORDER BY created_at DESC LIMIT ?',
    [userId, limit],
  );
  for (const s of sets) items.push({ type: 'set', id: s.id, title: s.title, at: s.created_at });

  const attempts = all(
    `SELECT a.id, a.submitted_at, a.score, a.total, q.title, q.mode
     FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id
     WHERE a.user_id = ? AND a.submitted_at IS NOT NULL
     ORDER BY a.submitted_at DESC LIMIT ?`,
    [userId, limit],
  );
  for (const a of attempts) {
    items.push({ type: 'attempt', id: a.id, title: a.title, mode: a.mode, score: a.score, total: a.total, at: a.submitted_at });
  }

  const reviews = all(
    'SELECT COUNT(*) AS n, MAX(reviewed_at) AS at FROM card_reviews WHERE user_id = ?',
    [userId],
  );
  if (reviews[0]?.at) {
    items.push({ type: 'reviews', title: `${reviews[0].n} flashcard reviews`, count: reviews[0].n, at: reviews[0].at });
  }

  return items.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
}

export { nowIso };
