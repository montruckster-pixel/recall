import express from 'express';
import { get, all, run, nowIso, dayKey } from '../lib/db.js';
import { asyncHandler, bad, notFound, id } from '../lib/util.js';
import { dueCards, dueCount, previewIntervals, applyReview, ensureSchedule, RATINGS } from '../lib/fsrs.js';
import { bumpActivity, todayActivity } from '../lib/activity.js';

const router = express.Router();

function publicDueCard(c) {
  return {
    id: c.id,
    setId: c.set_id,
    setTitle: c.set_title,
    front: c.front,
    back: c.back,
    example: c.example,
    sourceRef: c.source_ref,
    subject: c.subject,
    topic: c.topic,
    difficulty: c.difficulty,
    schedule: {
      state: c.state, dueAt: c.due_at, reps: c.reps, lapses: c.lapses,
      stability: c.stability, scheduledDays: c.scheduled_days, lastReviewedAt: c.last_reviewed_at,
    },
  };
}

/** The Due Today queue (spaced-repetition). */
router.get('/study/queue', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const setId = req.query.setId || null;
  if (setId && !get('SELECT id FROM study_sets WHERE id = ? AND user_id = ?', [setId, userId])) {
    throw notFound('Study set not found.');
  }
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 40));
  const cards = dueCards(userId, { setId, limit });
  res.json({
    dueTotal: dueCount(userId, setId),
    returned: cards.length,
    items: cards.map(publicDueCard),
  });
}));

/** Preview the next interval for each rating without committing a review. */
router.get('/study/cards/:id/preview', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const card = get('SELECT * FROM flashcards WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!card) throw notFound('Card not found.');
  const sched = ensureSchedule(userId, card.id);
  res.json({ preview: previewIntervals(sched) });
}));

/** Record a review rating; schedules the next review with FSRS. */
router.post('/study/review', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const cardId = req.body?.cardId;
  const rating = Number(req.body?.rating);
  const elapsedMs = Math.max(0, Math.min(3600000, Number(req.body?.elapsedMs) || 0));
  if (!RATINGS || !Object.values(RATINGS).includes(rating)) throw bad('Rating must be 1 (Again), 2 (Hard), 3 (Good) or 4 (Easy).', 'invalid_rating');
  const card = get('SELECT * FROM flashcards WHERE id = ? AND user_id = ?', [cardId, userId]);
  if (!card) throw notFound('Card not found.');

  const next = applyReview(userId, card.id, rating, 'study');
  bumpActivity(userId, dayKey(), { cardsReviewed: 1, studySeconds: Math.round(elapsedMs / 1000) });
  run('UPDATE study_sets SET last_studied_at = ? WHERE id = ?', [nowIso(), card.set_id]);

  const updated = ensureSchedule(userId, card.id);
  res.json({
    schedule: {
      state: next.state, dueAt: next.due_at, reps: next.reps, lapses: next.lapses,
      stability: next.stability, scheduledDays: next.scheduled_days,
    },
    preview: previewIntervals(updated),
    remaining: dueCount(userId),
  });
}));

/** Finish a study session: record time, complete the matching plan task. */
router.post('/study/session/complete', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const cardsReviewed = Math.max(0, Math.min(1000, Number(req.body?.cardsReviewed) || 0));
  const studySeconds = Math.max(0, Math.min(8 * 3600, Number(req.body?.studySeconds) || 0));
  const setId = req.body?.setId || null;

  if (studySeconds) bumpActivity(userId, dayKey(), { studySeconds });
  if (cardsReviewed) bumpActivity(userId, dayKey(), { sessionsCompleted: 1 });

  if (req.body?.taskId) {
    run("UPDATE study_tasks SET status = 'done', completed_at = ? WHERE id = ? AND user_id = ?",
      [nowIso(), req.body.taskId, userId]);
  }
  const today = todayActivity(userId);
  const profile = get('SELECT * FROM profiles WHERE user_id = ?', [userId]);
  res.json({
    today,
    goal: {
      cards: profile?.daily_goal_cards ?? 40,
      minutes: profile?.daily_goal_minutes ?? 45,
    },
    remainingDue: dueCount(userId, setId),
  });
}));

/** Weak-card list: cards the user repeatedly rates Again. */
router.get('/study/leeches', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const rows = all(
    `SELECT f.id, f.front, f.back, f.topic, f.set_id, st.title AS set_title,
            cs.lapses, cs.reps, cs.state, cs.due_at
     FROM card_schedule cs
     JOIN flashcards f ON f.id = cs.card_id
     JOIN study_sets st ON st.id = f.set_id
     WHERE cs.user_id = ? AND f.archived = 0 AND cs.lapses > 0
     ORDER BY cs.lapses DESC, cs.reps DESC LIMIT 25`,
    [userId],
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id, front: r.front, back: r.back, topic: r.topic, setId: r.set_id,
      setTitle: r.set_title, lapses: r.lapses, reps: r.reps, state: r.state, dueAt: r.due_at,
    })),
  });
}));

/** Turn missed quiz questions into flashcards. */
router.post('/study/from-missed', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const attemptId = req.body?.attemptId;
  const targetSetId = req.body?.setId;
  if (!attemptId) throw bad('An attempt is required.', 'attempt_required');

  const attempt = get('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?', [attemptId, userId]);
  if (!attempt) throw notFound('Attempt not found.');

  let set = targetSetId ? get('SELECT * FROM study_sets WHERE id = ? AND user_id = ?', [targetSetId, userId]) : null;
  if (targetSetId && !set) throw notFound('Study set not found.');

  const missed = all(
    `SELECT qq.* FROM attempt_answers aa
     JOIN quiz_questions qq ON qq.id = aa.question_id
     WHERE aa.attempt_id = ? AND aa.user_id = ? AND aa.is_correct = 0`,
    [attemptId, userId],
  );
  if (!missed.length) throw bad('There are no missed questions in that attempt.', 'no_missed');

  const ts = nowIso();
  if (!set) {
    const quiz = get('SELECT * FROM quizzes WHERE id = ?', [attempt.quiz_id]);
    set = get('SELECT * FROM study_sets WHERE id = ? AND user_id = ?', [quiz?.set_id, userId]);
  }
  if (!set) {
    const setId = id('set_');
    const ws = get('SELECT id FROM workspaces WHERE user_id = ? AND is_active = 1', [userId]);
    run(
      `INSERT INTO study_sets (id, user_id, workspace_id, title, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [setId, userId, ws?.id || null, 'Missed questions', 'Cards created from questions you answered incorrectly.', ts, ts],
    );
    set = get('SELECT * FROM study_sets WHERE id = ?', [setId]);
  }

  const created = [];
  for (const q of missed) {
    const options = JSON.parse(q.options || '[]');
    const back = q.type === 'mcq'
      ? `${q.correct_answer}${q.explanation ? `\n\n${q.explanation}` : ''}`
      : `${q.correct_answer}`;
    const cid = id('card_');
    run(
      `INSERT INTO flashcards (id, user_id, set_id, front, back, source_ref, subject, topic, difficulty, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cid, userId, set.id, q.prompt, back, options.length ? `Options: ${options.join(' | ')}` : null,
       set.subject, q.topic, Number(q.difficulty) || 2, ts, ts],
    );
    ensureSchedule(userId, cid);
    created.push(cid);
  }
  res.status(201).json({ setId: set.id, created: created.length });
}));

export default router;
