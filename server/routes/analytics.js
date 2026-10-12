import express from 'express';
import { get, all, nowIso } from '../lib/db.js';
import { asyncHandler } from '../lib/util.js';
import { activityRange, weakTopics, topicPerformance, reviewAccuracy, streak } from '../lib/activity.js';
import { dueCount, scheduleStats } from '../lib/fsrs.js';
import { entitlementsFor } from '../lib/billing.js';
import { aiConfig, recordAiUsage } from '../lib/ai.js';
import { generateInsights } from '../lib/studygen.js';

const router = express.Router();

router.get('/analytics', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const days = Math.min(180, Math.max(7, Number.parseInt(req.query.days, 10) || 30));
  const ent = entitlementsFor(userId);
  const advanced = ent.limits.advancedAnalytics === true;

  const activity = activityRange(userId, days);
  const sched = scheduleStats(userId);
  const review = reviewAccuracy(userId, days);
  const streakInfo = streak(userId);

  const quizSeries = all(
    `SELECT a.score, a.total, a.correct_count, a.submitted_at, q.title, q.mode
     FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id
     WHERE a.user_id = ? AND a.submitted_at IS NOT NULL
     ORDER BY a.submitted_at ASC LIMIT 200`,
    [userId],
  ).map((r) => ({ score: r.score, total: r.total, correctCount: r.correct_count, at: r.submitted_at, title: r.title, mode: r.mode }));

  const totals = activity.reduce((acc, d) => ({
    studySeconds: acc.studySeconds + d.studySeconds,
    cardsReviewed: acc.cardsReviewed + d.cardsReviewed,
    questionsAnswered: acc.questionsAnswered + d.questionsAnswered,
    correctAnswers: acc.correctAnswers + d.correctAnswers,
  }), { studySeconds: 0, cardsReviewed: 0, questionsAnswered: 0, correctAnswers: 0 });

  const daysStudied = activity.filter((d) => d.cardsReviewed > 0 || d.questionsAnswered > 0).length;

  const basic = {
    windowDays: days,
    totals: {
      ...totals,
      studyMinutes: Math.round(totals.studySeconds / 60),
      quizAccuracy: totals.questionsAnswered ? totals.correctAnswers / totals.questionsAnswered : null,
    },
    activity: activity.map((d) => ({
      date: d.date,
      minutes: Math.round(d.studySeconds / 60),
      cardsReviewed: d.cardsReviewed,
      questionsAnswered: d.questionsAnswered,
      accuracy: d.questionsAnswered ? d.correctAnswers / d.questionsAnswered : null,
    })),
    reviewAccuracy: review,
    quizzes: quizSeries,
    schedule: sched,
    streak: streakInfo,
    consistency: { daysStudied, days, rate: days ? daysStudied / days : 0 },
    backlog: {
      due: dueCount(userId),
      overdueLearning: sched.byState.learning + sched.byState.relearning,
      totalCards: sched.total,
    },
    improvement: improvement(quizSeries),
    minimumSampleNote: 'Insights require at least a few sessions of data before they are meaningful.',
  };

  // Rule-based insights are derived from the user's own data and are available
  // on every plan. Only the topic breakdowns and AI-generated insights are Plus.
  const weak = weakTopics(userId, { minAnswers: 4, limit: 8 });
  const payload = {
    advanced,
    plan: { id: ent.planId, name: ent.plan.name },
    insights: ruleInsights(basic, weak),
  };

  if (advanced) {
    payload.topics = topicPerformance(userId, { minAnswers: 2, limit: 20 });
    payload.weakTopics = weak;
    payload.frequentlyMissed = all(
      `SELECT COALESCE(NULLIF(topic,''),'Uncategorized') AS topic,
              SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) AS missed,
              COUNT(*) AS total
       FROM attempt_answers WHERE user_id = ?
       GROUP BY topic HAVING missed > 0 ORDER BY missed DESC LIMIT 10`,
      [userId],
    ).map((r) => ({ topic: r.topic, missed: r.missed, total: r.total, missRate: r.total ? r.missed / r.total : 0 }));
  } else {
    payload.upgradeHint = 'Topic-level breakdowns, weak-topic analysis and AI insights are part of Recall Plus.';
  }

  res.json({ ...payload, ...basic });
}));

function improvement(series) {
  if (series.length < 4) return null;
  const recent = series.slice(-5);
  const prior = series.slice(-10, -5);
  const avg = (arr) => (arr.length ? arr.reduce((a, s) => a + s.score, 0) / arr.length : null);
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  return {
    recentAverage: recentAvg,
    priorAverage: priorAvg,
    delta: priorAvg === null ? null : recentAvg - priorAvg,
    sampleSize: series.length,
  };
}

function ruleInsights(basic, weakTopics) {
  const out = [];
  if (basic.backlog.due > 0) out.push(`You have ${basic.backlog.due} cards due for review.`);
  if (weakTopics?.length) {
    const w = weakTopics[0];
    out.push(`${w.topic} questions are currently your weakest area at ${(w.accuracy * 100).toFixed(0)}% accuracy over ${w.answers} answers.`);
  }
  const imp = basic.improvement;
  if (imp && imp.delta !== null) {
    out.push(imp.delta >= 0
      ? `Your quiz accuracy is up ${(imp.delta * 100).toFixed(0)} points over your last five quizzes.`
      : `Your quiz accuracy is down ${Math.abs(imp.delta * 100).toFixed(0)} points over your last five quizzes.`);
  }
  if (basic.consistency.rate >= 0.5 && basic.consistency.days >= 7) {
    out.push(`You studied on ${basic.consistency.daysStudied} of the last ${basic.consistency.days} days — consistency is your strongest habit.`);
  } else if (basic.consistency.days >= 7) {
    out.push(`You studied on ${basic.consistency.daysStudied} of the last ${basic.consistency.days} days. Short daily sessions build retention faster than occasional long ones.`);
  }
  if (basic.reviewAccuracy.total >= 20) {
    out.push(`Your flashcard recall accuracy is ${(basic.reviewAccuracy.accuracy * 100).toFixed(0)}% across ${basic.reviewAccuracy.total} reviews.`);
  }
  return out.slice(0, 6);
}

/** AI-generated insights (Plus, requires AI configuration). */
router.post('/analytics/insights', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const ent = entitlementsFor(userId);
  if (!ent.limits.advancedAnalytics) {
    return res.status(402).json({ error: 'AI insights are part of Recall Plus.', code: 'plan_limit' });
  }
  const cfg = aiConfig();
  if (!cfg.configured) {
    return res.status(503).json({ error: cfg.message, code: 'ai_not_configured' });
  }
  const activity = activityRange(userId, 30);
  const stats = {
    studyMinutes: Math.round(activity.reduce((a, d) => a + d.studySeconds, 0) / 60),
    cardsReviewed: activity.reduce((a, d) => a + d.cardsReviewed, 0),
    questionsAnswered: activity.reduce((a, d) => a + d.questionsAnswered, 0),
    correctAnswers: activity.reduce((a, d) => a + d.correctAnswers, 0),
  };
  const insights = await generateInsights({ stats, weakTopics: weakTopics(userId, { minAnswers: 4, limit: 5 }), dueCount: dueCount(userId) });
  recordAiUsage(userId, 'insights', 1);
  res.json({ insights, generatedAt: nowIso() });
}));

export default router;
