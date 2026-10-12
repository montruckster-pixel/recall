import express from 'express';
import { get, all, nowIso, dayKey } from '../lib/db.js';
import { asyncHandler } from '../lib/util.js';
import { dueCount, scheduleStats } from '../lib/fsrs.js';
import { todayActivity, weakTopics, recentActivity, streak } from '../lib/activity.js';
import { todayTasks } from '../lib/planner.js';
import { entitlementsFor } from '../lib/billing.js';
import { aiConfig } from '../lib/ai.js';

const router = express.Router();

/** Everything the dashboard needs, in one round trip. All from real data. */
router.get('/dashboard', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const profile = get('SELECT * FROM profiles WHERE user_id = ?', [userId]);
  const today = todayActivity(userId);
  const sched = scheduleStats(userId);

  const goalCards = profile?.daily_goal_cards ?? 40;
  const goalMinutes = profile?.daily_goal_minutes ?? 45;

  const lastSet = get(
    `SELECT s.*, (SELECT COUNT(*) FROM flashcards f WHERE f.set_id = s.id AND f.archived = 0) AS card_count
     FROM study_sets s WHERE s.user_id = ? AND s.archived = 0 AND s.last_studied_at IS NOT NULL
     ORDER BY s.last_studied_at DESC LIMIT 1`,
    [userId],
  );
  const lastAttempt = get(
    `SELECT a.*, q.title, q.mode FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id
     WHERE a.user_id = ? AND a.submitted_at IS NULL ORDER BY a.started_at DESC LIMIT 1`,
    [userId],
  );
  const lastCompleted = get(
    `SELECT a.*, q.title, q.mode FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id
     WHERE a.user_id = ? AND a.submitted_at IS NOT NULL ORDER BY a.submitted_at DESC LIMIT 1`,
    [userId],
  );

  let continueItem = null;
  if (lastAttempt) {
    continueItem = { kind: 'attempt', attemptId: lastAttempt.id, quizId: lastAttempt.quiz_id, title: lastAttempt.title, mode: lastAttempt.mode, startedAt: lastAttempt.started_at };
  } else if (sched.due > 0) {
    continueItem = { kind: 'review', title: `${sched.due} cards due for review`, due: sched.due };
  } else if (lastSet) {
    continueItem = { kind: 'set', setId: lastSet.id, title: lastSet.title, cardCount: lastSet.card_count, lastStudiedAt: lastSet.last_studied_at };
  }

  const exam = profile?.exam_date ? buildExam(profile.exam_date, today, sched, userId) : null;

  const materials = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status IN ('extracted','ready') THEN 1 ELSE 0 END) AS ready,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM materials WHERE user_id = ?`,
    [userId],
  );

  const setCount = get('SELECT COUNT(*) AS n FROM study_sets WHERE user_id = ? AND archived = 0', [userId])?.n || 0;

  res.json({
    onboarding: {
      onboarded: Boolean(req.user.onboarded_at),
      hasMaterials: (materials?.total || 0) > 0,
      hasSets: setCount > 0,
      hasCards: sched.total > 0,
      hasReviews: sched.byState.new < sched.total,
    },
    profile: profile ? {
      certName: profile.cert_name, certSlug: profile.cert_slug,
      examDate: profile.exam_date, dailyMinutes: profile.daily_minutes,
      knowledgeLevel: profile.knowledge_level,
    } : null,
    today: {
      tasks: todayTasks(userId),
      progress: {
        cardsReviewed: today.cardsReviewed,
        questionsAnswered: today.questionsAnswered,
        correctAnswers: today.correctAnswers,
        accuracy: today.questionsAnswered ? today.correctAnswers / today.questionsAnswered : null,
        studySeconds: today.studySeconds,
        goalCards,
        goalMinutes,
        cardsPercent: goalCards ? Math.min(1, today.cardsReviewed / goalCards) : 0,
        minutesPercent: goalMinutes ? Math.min(1, (today.studySeconds / 60) / goalMinutes) : 0,
      },
    },
    continue: continueItem,
    exam,
    areasToImprove: weakTopics(userId, { minAnswers: 4, limit: 4 }),
    dueCards: sched.due,
    schedule: sched,
    streak: streak(userId),
    recentActivity: recentActivity(userId, 8),
    materials: {
      total: materials?.total || 0,
      ready: materials?.ready || 0,
      failed: materials?.failed || 0,
    },
    ai: aiConfig(),
    plan: entitlementsFor(userId),
    lastAttempt: lastCompleted ? {
      id: lastCompleted.id, title: lastCompleted.title, score: lastCompleted.score,
      total: lastCompleted.total, submittedAt: lastCompleted.submitted_at,
    } : null,
  });
}));

function buildExam(examDate, today, sched, userId) {
  const exam = new Date(`${examDate}T00:00:00Z`);
  const daysLeft = Math.ceil((exam.getTime() - Date.now()) / 864e5);
  // Readiness is a transparent, explainable blend of coverage and review health.
  const totalCards = sched.total || 0;
  const studiedCards = Math.max(0, totalCards - (sched.byState.new || 0));
  const coverage = totalCards ? studiedCards / totalCards : 0;
  const backlogPenalty = totalCards ? Math.min(0.3, (sched.due / Math.max(1, totalCards)) * 0.3) : 0;
  const quizRow = get(
    `SELECT AVG(score) AS avg FROM (SELECT score FROM quiz_attempts WHERE user_id = ? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 5)`,
    [userId],
  );
  const quizAvg = quizRow?.avg ?? null;
  const quizComponent = quizAvg === null ? 0.3 : quizAvg;
  const readiness = Math.max(0, Math.min(1, coverage * 0.5 + quizComponent * 0.5 - backlogPenalty));
  const recommendedPerDay = daysLeft > 0 && totalCards
    ? Math.ceil((sched.due + (sched.byState.new || 0)) / Math.max(1, daysLeft))
    : 0;
  return {
    examDate,
    daysLeft,
    readiness,
    readinessLabel: readiness >= 0.75 ? 'On track' : readiness >= 0.5 ? 'Getting there' : 'Needs work',
    components: { coverage, quizAverage: quizAvg, backlogPenalty },
    recommendedPerDay,
    totalCards,
    studiedCards,
    note: 'Readiness is an estimate from your own study activity, not a prediction of your exam result.',
  };
}

export default router;
