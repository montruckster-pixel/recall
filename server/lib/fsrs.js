/**
 * Spaced repetition — FSRS-4.5.
 *
 * A faithful implementation of the Free Spaced Repetition Scheduler (FSRS-4.5,
 * the 17-parameter model used by Anki's built-in FSRS), combined with Anki-style
 * short-term learning steps. Ratings are Anki's: 1 Again, 2 Hard, 3 Good, 4 Easy.
 *
 * Reference model:
 *   retrievability  R(t,S) = (1 + FACTOR * t/S) ^ DECAY
 *   interval        I(S)   = (S / FACTOR) * (R_desired^(1/DECAY) - 1)
 *   difficulty      D'     = D - w6*(g-3), then mean-reverted toward D0(4)
 *   stability (recall)   S' = S * (1 + e^w8 * (11-D) * S^-w9 * (e^(w10*(1-R))-1) * hard * easy)
 *   stability (forget)   S' = w11 * D^-w12 * ((S+1)^w13 - 1) * e^(w14*(1-R))
 */
import { get, all, run, nowIso } from './db.js';
import { id } from './util.js';

const W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975,
  0.0310, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246,
  1.5870, 0.2272, 2.8755,
];

const DECAY = -0.5;
const FACTOR = 19 / 81;
const DESIRED_RETENTION = 0.9;
const MAX_INTERVAL_DAYS = 3650;

const LEARNING_STEPS_MIN = [1, 10];
const RELEARNING_STEPS_MIN = [10];

export const RATINGS = { again: 1, hard: 2, good: 3, easy: 4 };
export const STATE_LABELS = { new: 'New', learning: 'Learning', review: 'Review', relearning: 'Relearning' };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function initStability(g) { return Math.max(0.1, W[g - 1]); }
export function initDifficulty(g) { return clamp(W[4] - (g - 3) * W[5], 1, 10); }

export function retrievability(elapsedDays, stability) {
  if (!stability || stability <= 0) return 0;
  return Math.pow(1 + FACTOR * (elapsedDays / stability), DECAY);
}

export function intervalFor(stability, retention = DESIRED_RETENTION) {
  const raw = (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(raw, 0.01, MAX_INTERVAL_DAYS);
}

export function nextDifficulty(d, g) {
  const dp = d - W[6] * (g - 3);
  const reverted = W[7] * initDifficulty(4) + (1 - W[7]) * dp;
  return clamp(reverted, 1, 10);
}

export function stabilityRecall(d, s, r, g) {
  const hardPenalty = g === 2 ? W[15] : 1;
  const easyBonus = g === 4 ? W[16] : 1;
  const gain = Math.exp(W[8]) *
    (11 - d) *
    Math.pow(s, -W[9]) *
    (Math.exp(W[10] * (1 - r)) - 1) *
    hardPenalty * easyBonus;
  return s * (1 + gain);
}

export function stabilityForget(d, s, r) {
  return W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
}

function minutes(n) { return new Date(Date.now() + n * 60000).toISOString(); }
function days(n) { return new Date(Date.now() + n * 864e5).toISOString(); }

function elapsedDays(lastReviewedAt) {
  if (!lastReviewedAt) return 0;
  return Math.max(0, (Date.now() - new Date(lastReviewedAt).getTime()) / 864e5);
}

/**
 * Compute the next schedule for a card.
 * @param {object|null} sched current card_schedule row (null for a brand-new card)
 * @param {number} rating 1..4
 * @returns {object} next schedule fields (does not persist)
 */
export function schedule(sched, rating) {
  const g = clamp(rating, 1, 4);
  const state = sched?.state || 'new';
  const lastReviewed = sched?.last_reviewed_at || null;

  let D = sched?.difficulty_fsrs || initDifficulty(g);
  let S = sched?.stability || initStability(g);
  let reps = (sched?.reps || 0) + 1;
  let lapses = sched?.lapses || 0;
  let stepIndex = sched?.step_index || 0;
  let nextState = state;
  let scheduledDays = sched?.scheduled_days || 0;
  let dueAt;

  const fresh = !sched || state === 'new';
  if (fresh) {
    D = initDifficulty(g);
    S = initStability(g);
    if (g === 1) { nextState = 'learning'; stepIndex = 0; dueAt = minutes(LEARNING_STEPS_MIN[0]); }
    else if (g === 2) { nextState = 'learning'; stepIndex = 0; dueAt = minutes(Math.round(LEARNING_STEPS_MIN[0] * 1.5)); }
    else if (g === 3) {
      if (LEARNING_STEPS_MIN.length > 1) { nextState = 'learning'; stepIndex = 1; dueAt = minutes(LEARNING_STEPS_MIN[1]); }
      else { nextState = 'review'; scheduledDays = intervalFor(S); dueAt = days(scheduledDays); }
    } else {
      nextState = 'review';
      scheduledDays = Math.max(4, intervalFor(S));
      dueAt = days(scheduledDays);
    }
    return { state: nextState, due_at: dueAt, last_reviewed_at: nowIso(), reps, lapses,
      stability: S, difficulty_fsrs: D, scheduled_days: scheduledDays, step_index: stepIndex };
  }

  if (state === 'learning' || state === 'relearning') {
    const steps = state === 'learning' ? LEARNING_STEPS_MIN : RELEARNING_STEPS_MIN;
    const elapsed = elapsedDays(lastReviewed);
    const r = retrievability(elapsed, S);
    if (g === 1) {
      D = nextDifficulty(D, g);
      S = Math.max(0.1, stabilityForget(D, S, r));
      stepIndex = 0;
      dueAt = minutes(steps[0]);
    } else if (g === 2) {
      D = nextDifficulty(D, g);
      S = stabilityRecall(D, S, r, g);
      stepIndex = clamp(stepIndex, 0, steps.length - 1);
      dueAt = minutes(Math.round(steps[stepIndex] * 1.5));
    } else if (g === 3) {
      D = nextDifficulty(D, g);
      S = stabilityRecall(D, S, r, g);
      const nextStep = stepIndex + 1;
      if (nextStep >= steps.length) {
        nextState = 'review';
        scheduledDays = Math.max(1, intervalFor(S));
        dueAt = days(scheduledDays);
      } else {
        stepIndex = nextStep;
        dueAt = minutes(steps[nextStep]);
      }
    } else {
      D = nextDifficulty(D, g);
      S = stabilityRecall(D, S, r, g);
      nextState = 'review';
      scheduledDays = Math.max(4, intervalFor(S));
      dueAt = days(scheduledDays);
    }
    return { state: nextState, due_at: dueAt, last_reviewed_at: nowIso(), reps, lapses,
      stability: S, difficulty_fsrs: D, scheduled_days: scheduledDays, step_index: stepIndex };
  }

  // review state
  const elapsed = elapsedDays(lastReviewed);
  const r = retrievability(elapsed, S);
  if (g === 1) {
    lapses += 1;
    D = nextDifficulty(D, g);
    S = Math.max(0.1, stabilityForget(D, S, r));
    nextState = 'relearning';
    stepIndex = 0;
    scheduledDays = 0;
    dueAt = minutes(RELEARNING_STEPS_MIN[0]);
  } else {
    D = nextDifficulty(D, g);
    S = stabilityRecall(D, S, r, g);
    nextState = 'review';
    scheduledDays = Math.max(1, intervalFor(S));
    dueAt = days(scheduledDays);
  }
  return { state: nextState, due_at: dueAt, last_reviewed_at: nowIso(), reps, lapses,
    stability: S, difficulty_fsrs: D, scheduled_days: scheduledDays, step_index: stepIndex };
}

/** Preview the next interval for each rating, for display in the study UI. */
export function previewIntervals(sched) {
  const out = {};
  for (const [name, g] of Object.entries(RATINGS)) {
    const next = schedule(sched, g);
    const ms = new Date(next.due_at).getTime() - Date.now();
    out[name] = { dueAt: next.due_at, state: next.state, label: humanInterval(ms) };
  }
  return out;
}

export function humanInterval(ms) {
  const min = ms / 60000;
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const daysN = hours / 24;
  if (daysN < 30) return `${Math.round(daysN)}d`;
  const months = daysN / 30.4;
  if (months < 12) return `${months.toFixed(1)}mo`;
  return `${(daysN / 365).toFixed(1)}y`;
}

/** Ensure a schedule row exists for a card, with sensible new-card defaults. */
export function ensureSchedule(userId, cardId) {
  let row = get('SELECT * FROM card_schedule WHERE card_id = ?', [cardId]);
  if (row) return row;
  const ts = nowIso();
  run(
    `INSERT INTO card_schedule (card_id, user_id, state, due_at, reps, lapses, stability, difficulty_fsrs, scheduled_days, step_index, updated_at)
     VALUES (?, ?, 'new', ?, 0, 0, 0, 0, 0, 0, ?)`,
    [cardId, userId, ts, ts],
  );
  return get('SELECT * FROM card_schedule WHERE card_id = ?', [cardId]);
}

/** Persist a review and update the card's schedule + activity counters. */
export function applyReview(userId, cardId, rating, source = 'study') {
  const sched = ensureSchedule(userId, cardId);
  const prevState = sched.state;
  const prevDue = sched.due_at;
  const next = schedule(sched, rating);
  const ts = nowIso();

  run(
    `UPDATE card_schedule SET state=?, due_at=?, last_reviewed_at=?, reps=?, lapses=?,
       stability=?, difficulty_fsrs=?, scheduled_days=?, step_index=?, updated_at=?
     WHERE card_id=?`,
    [next.state, next.due_at, next.last_reviewed_at, next.reps, next.lapses,
     next.stability, next.difficulty_fsrs, next.scheduled_days, next.step_index, ts, cardId],
  );

  run(
    `INSERT INTO card_reviews (id, card_id, user_id, rating, reviewed_at, prev_state, prev_due, next_due, elapsed_ms, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id('rev_'), cardId, userId, rating, ts, prevState, prevDue, next.due_at, 0, source],
  );

  return next;
}

/** Count of cards due now for a user (optionally within a set). */
export function dueCount(userId, setId = null) {
  const params = [userId, nowIso()];
  let sql = `SELECT COUNT(*) AS n FROM card_schedule s
             JOIN flashcards f ON f.id = s.card_id
             WHERE s.user_id = ? AND f.archived = 0 AND s.due_at <= ?`;
  if (setId) { sql += ' AND f.set_id = ?'; params.push(setId); }
  return get(sql, params)?.n || 0;
}

/** Fetch due cards (joined with their card + set), oldest-due first. */
export function dueCards(userId, { setId = null, limit = 40 } = {}) {
  const params = [userId, nowIso()];
  let sql = `SELECT f.*, s.state, s.due_at, s.reps, s.lapses, s.stability,
                    s.difficulty_fsrs, s.scheduled_days, s.step_index, s.last_reviewed_at,
                    st.title AS set_title
             FROM card_schedule s
             JOIN flashcards f ON f.id = s.card_id
             JOIN study_sets st ON st.id = f.set_id
             WHERE s.user_id = ? AND f.archived = 0 AND s.due_at <= ?`;
  if (setId) { sql += ' AND f.set_id = ?'; params.push(setId); }
  sql += ' ORDER BY s.due_at ASC LIMIT ?';
  params.push(limit);
  return all(sql, params);
}

/** Aggregate schedule stats for a user. */
export function scheduleStats(userId) {
  const due = dueCount(userId);
  const rows = all(
    `SELECT s.state, COUNT(*) AS n FROM card_schedule s
     JOIN flashcards f ON f.id = s.card_id
     WHERE s.user_id = ? AND f.archived = 0 GROUP BY s.state`,
    [userId],
  );
  const byState = { new: 0, learning: 0, review: 0, relearning: 0 };
  for (const r of rows) byState[r.state] = r.n;
  const total = Object.values(byState).reduce((a, b) => a + b, 0);
  return { due, total, byState };
}
