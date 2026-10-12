import express from 'express';
import { get, all, run, nowIso } from '../lib/db.js';
import { asyncHandler, bad, notFound, id, str, paginate } from '../lib/util.js';
import { aiConfig, recordAiUsage, AiNotConfigured } from '../lib/ai.js';
import { generateQuestions } from '../lib/studygen.js';
import { assertWithinLimit } from '../lib/billing.js';
import { bumpActivity } from '../lib/activity.js';
import { regeneratePlan } from '../lib/planner.js';

const router = express.Router();

function publicQuiz(q, extra = {}) {
  return {
    id: q.id, title: q.title, mode: q.mode, timeLimitSec: q.time_limit_sec,
    questionCount: q.question_count, difficulty: q.difficulty, topic: q.topic,
    showExplanations: Boolean(q.show_explanations), status: q.status,
    setId: q.set_id, materialId: q.material_id,
    createdAt: q.created_at, completedAt: q.completed_at,
    ...extra,
  };
}

function publicQuestion(q, { reveal = false } = {}) {
  return {
    id: q.id, type: q.type, prompt: q.prompt,
    options: JSON.parse(q.options || '[]'),
    topic: q.topic, difficulty: q.difficulty, position: q.position,
    ...(reveal ? { correctAnswer: q.correct_answer, explanation: q.explanation, misconception: q.misconception, sourceRef: q.source_ref } : {}),
  };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeAnswer(v) { return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }

// ---- Listing --------------------------------------------------------------

router.get('/quizzes', asyncHandler(async (req, res) => {
  const { limit, offset } = paginate(req.query, 20, 100);
  const params = [req.user.id];
  let where = 'WHERE q.user_id = ?';
  if (req.query.mode) { where += ' AND q.mode = ?'; params.push(str(req.query.mode, 20)); }
  if (req.query.setId) { where += ' AND q.set_id = ?'; params.push(req.query.setId); }
  const total = get(`SELECT COUNT(*) AS n FROM quizzes q ${where}`, params).n;
  const rows = all(
    `SELECT q.*, (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.submitted_at IS NOT NULL) AS attempt_count,
            (SELECT MAX(a.score) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.submitted_at IS NOT NULL) AS best_score
     FROM quizzes q ${where} ORDER BY q.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  res.json({ total, limit, offset, items: rows.map((q) => publicQuiz(q, { attemptCount: q.attempt_count, bestScore: q.best_score })) });
}));

router.get('/quizzes/:id', asyncHandler(async (req, res) => {
  const q = get('SELECT * FROM quizzes WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!q) throw notFound('Quiz not found.');
  const questions = all('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position', [q.id]);
  // Answers are revealed only after submission, or in practice mode when the
  // quiz is configured to show explanations immediately.
  const reveal = req.query.reveal === '1';
  res.json({ quiz: publicQuiz(q), questions: questions.map((x) => publicQuestion(x, { reveal })) });
}));

// ---- Builder --------------------------------------------------------------

/**
 * Create a quiz. Sources:
 *   - set:      from a saved study set (AI-generated when AI is configured,
 *               otherwise a grounded recall/MCQ quiz built from the cards)
 *   - material: AI-generated from an uploaded document
 *   - manual:   from explicitly supplied questions
 */
router.post('/quizzes', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const b = req.body || {};
  const source = str(b.source, 20) || 'set';
  const mode = b.mode === 'exam' ? 'exam' : 'practice';
  const questionCount = Math.max(3, Math.min(50, Number(b.questionCount) || 10));
  const timeLimitSec = b.timeLimitSec ? Math.max(60, Math.min(3 * 3600, Number(b.timeLimitSec))) : null;
  const showExplanations = b.showExplanations === false ? 0 : 1;
  const difficulty = ['easy', 'medium', 'hard', 'mixed'].includes(b.difficulty) ? b.difficulty : 'mixed';
  const topic = str(b.topic, 120) || null;

  if (mode === 'exam') assertWithinLimit(userId, 'practiceExamsPerMonth', 1);

  const ts = nowIso();
  const workspace = get('SELECT id FROM workspaces WHERE user_id = ? AND is_active = 1', [userId]);
  let setId = null; let materialId = null; let title = str(b.title, 200);
  let questions = [];

  if (source === 'set') {
    const set = get('SELECT * FROM study_sets WHERE id = ? AND user_id = ?', [b.setId, userId]);
    if (!set) throw bad('Choose a study set.', 'invalid_set');
    setId = set.id;
    title = title || `${set.title} — ${mode === 'exam' ? 'practice exam' : 'quiz'}`;
    const cards = all(
      'SELECT * FROM flashcards WHERE set_id = ? AND user_id = ? AND archived = 0 ORDER BY RANDOM() LIMIT 60',
      [set.id, userId],
    );
    if (cards.length < 3) throw bad('That study set needs at least 3 cards to build a quiz.', 'not_enough_cards');

    if (aiConfig().configured && b.useAi !== false) {
      assertWithinLimit(userId, 'aiCreditsPerMonth', 1);
      const sourceText = cards.map((c, i) => `Card ${i + 1} — Q: ${c.front}\nA: ${c.back}${c.example ? `\nExample: ${c.example}` : ''}`).join('\n\n');
      const gen = await generateQuestions({ sourceText, title: set.title, counts: { mcqs: questionCount, trueFalse: 0, shortAnswers: 0 } });
      recordAiUsage(userId, 'quiz_questions', 1);
      questions = gen.mcqs.slice(0, questionCount).map((q) => ({
        type: 'mcq', prompt: q.prompt, options: q.options, correct: q.options[q.correctIndex],
        explanation: q.explanation, misconception: q.misconception, topic: q.topic || set.topic, difficulty: String(q.difficulty || 2),
      }));
    }
    if (!questions.length) {
      // Non-AI grounded fallback: multiple choice with distractors drawn from
      // other cards in the same set.
      const pool = cards.map((c) => c.back);
      for (const card of shuffle(cards).slice(0, questionCount)) {
        const distractors = shuffle(pool.filter((p) => p !== card.back)).slice(0, 3);
        if (distractors.length < 1) continue;
        const options = shuffle([card.back, ...distractors]);
        questions.push({
          type: 'mcq', prompt: card.front, options, correct: card.back,
          explanation: `Correct answer: ${card.back}`, misconception: null,
          topic: card.topic || set.topic, difficulty: String(card.difficulty || 2),
        });
      }
    }
  } else if (source === 'material') {
    const material = get('SELECT * FROM materials WHERE id = ? AND user_id = ?', [b.materialId, userId]);
    if (!material) throw bad('Choose an uploaded material.', 'invalid_material');
    if (!material.extracted_text) throw bad('That material has no extracted text yet.', 'no_text');
    if (!aiConfig().configured) throw new AiNotConfigured();
    assertWithinLimit(userId, 'aiCreditsPerMonth', 1);
    materialId = material.id;
    title = title || `${material.title} — ${mode === 'exam' ? 'practice exam' : 'quiz'}`;
    const gen = await generateQuestions({
      sourceText: material.extracted_text, title: material.title,
      counts: { mcqs: Math.ceil(questionCount * 0.7), trueFalse: Math.floor(questionCount * 0.3), shortAnswers: 0 },
    });
    recordAiUsage(userId, 'quiz_questions', 1);
    questions = [
      ...gen.mcqs.map((q) => ({ type: 'mcq', prompt: q.prompt, options: q.options, correct: q.options[q.correctIndex], explanation: q.explanation, misconception: q.misconception, topic: q.topic, difficulty: String(q.difficulty) })),
      ...gen.trueFalse.map((q) => ({ type: 'tf', prompt: q.prompt, options: ['True', 'False'], correct: q.correct ? 'True' : 'False', explanation: q.explanation, misconception: null, topic: q.topic, difficulty: String(q.difficulty) })),
    ];
  } else if (source === 'manual') {
    const supplied = Array.isArray(b.questions) ? b.questions : [];
    if (!supplied.length) throw bad('Supply at least one question.', 'no_questions');
    title = title || 'Custom quiz';
    questions = supplied.map((q) => {
      const type = ['mcq', 'tf', 'short'].includes(q.type) ? q.type : 'short';
      const options = type === 'mcq' ? (Array.isArray(q.options) ? q.options.map((o) => str(o, 400)).filter(Boolean) : []) : (type === 'tf' ? ['True', 'False'] : []);
      return {
        type, prompt: str(q.prompt, 600), options,
        correct: type === 'mcq' ? str(q.correct, 400) : (type === 'tf' ? (q.correct ? 'True' : 'False') : str(q.answer, 2000)),
        explanation: str(q.explanation, 800), misconception: str(q.misconception, 500),
        topic: str(q.topic, 120) || topic, difficulty: String(q.difficulty || 2),
      };
    }).filter((q) => q.prompt && q.correct);
  } else {
    throw bad('Unknown quiz source.', 'invalid_source');
  }

  if (!questions.length) throw bad('No questions could be built from that source.', 'no_questions');
  if (topic) questions = questions.filter((q) => !q.topic || q.topic === topic).length ? questions.filter((q) => !q.topic || q.topic === topic) : questions;

  const quizId = id('qz_');
  run(
    `INSERT INTO quizzes (id, user_id, workspace_id, set_id, material_id, title, mode, time_limit_sec, question_count, difficulty, topic, show_explanations, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
    [quizId, userId, workspace?.id || null, setId, materialId, title, mode, timeLimitSec,
     questions.length, difficulty, topic, showExplanations, ts],
  );
  questions.forEach((q, i) => {
    run(
      `INSERT INTO quiz_questions (id, quiz_id, user_id, type, prompt, options, correct_answer, explanation, misconception, topic, difficulty, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id('qq_'), quizId, userId, q.type, q.prompt, JSON.stringify(q.options), q.correct,
       q.explanation || null, q.misconception || null, q.topic || null, q.difficulty, i],
    );
  });

  const created = get('SELECT * FROM quizzes WHERE id = ?', [quizId]);
  res.status(201).json({ quiz: publicQuiz(created), questionCount: questions.length });
}));

// ---- Attempts -------------------------------------------------------------

router.post('/quizzes/:id/attempts', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const q = get('SELECT * FROM quizzes WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!q) throw notFound('Quiz not found.');
  const attemptId = id('att_');
  run(
    `INSERT INTO quiz_attempts (id, quiz_id, user_id, started_at, total) VALUES (?, ?, ?, ?, ?)`,
    [attemptId, q.id, userId, nowIso(), q.question_count],
  );
  res.status(201).json({ attemptId, startedAt: nowIso(), timeLimitSec: q.time_limit_sec });
}));

router.get('/attempts/:id', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const attempt = get('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!attempt) throw notFound('Attempt not found.');
  const quiz = get('SELECT * FROM quizzes WHERE id = ?', [attempt.quiz_id]);
  const answers = all('SELECT * FROM attempt_answers WHERE attempt_id = ?', [attempt.id]);
  const questions = all('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position', [attempt.quiz_id]);
  const byQuestion = new Map(answers.map((a) => [a.question_id, a]));
  res.json({
    attempt: {
      id: attempt.id, quizId: attempt.quiz_id, startedAt: attempt.started_at,
      submittedAt: attempt.submitted_at, timeSpentSec: attempt.time_spent_sec,
      score: attempt.score, total: attempt.total, correctCount: attempt.correct_count,
    },
    quiz: publicQuiz(quiz),
    questions: questions.map((q) => {
      const a = byQuestion.get(q.id);
      return {
        ...publicQuestion(q, { reveal: Boolean(attempt.submitted_at) }),
        response: a?.response ?? null,
        isCorrect: a ? Boolean(a.is_correct) : null,
        aiScore: a?.ai_score ?? null,
        aiFeedback: a?.ai_feedback ?? null,
      };
    }),
  });
}));

/** Save a single answer (supports resume after accidental navigation). */
router.post('/attempts/:id/answers', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const attempt = get('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!attempt) throw notFound('Attempt not found.');
  if (attempt.submitted_at) throw bad('This attempt has already been submitted.', 'already_submitted');
  const q = get('SELECT * FROM quiz_questions WHERE id = ? AND quiz_id = ?', [req.body?.questionId, attempt.quiz_id]);
  if (!q) throw notFound('Question not found.');

  const existing = get('SELECT id FROM attempt_answers WHERE attempt_id = ? AND question_id = ?', [attempt.id, q.id]);
  const response = str(req.body?.response, 4000);
  if (existing) {
    run('UPDATE attempt_answers SET response = ?, answered_at = ? WHERE id = ?', [response, nowIso(), existing.id]);
  } else {
    run(
      `INSERT INTO attempt_answers (id, attempt_id, question_id, user_id, response, topic, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id('ans_'), attempt.id, q.id, userId, response, q.topic, nowIso()],
    );
  }
  res.json({ ok: true });
}));

async function gradeQuestion(q, response) {
  if (q.type === 'mcq' || q.type === 'tf') {
    const correct = normalizeAnswer(response) === normalizeAnswer(q.correct_answer);
    return { isCorrect: correct ? 1 : 0, aiScore: correct ? 1 : 0, aiFeedback: null };
  }
  // Short answer: AI grading when available, otherwise self-grading.
  if (aiConfig().configured) {
    try {
      const { gradeShortAnswer } = await import('../lib/studygen.js');
      const rubric = q.explanation ? [q.explanation] : [];
      const result = await gradeShortAnswer({ prompt: q.prompt, modelAnswer: q.correct_answer, rubric, response });
      return { isCorrect: result.score >= 0.6 ? 1 : 0, aiScore: result.score, aiFeedback: result.feedback, needsSelfGrade: false };
    } catch {
      return { isCorrect: 0, aiScore: null, aiFeedback: null, needsSelfGrade: true };
    }
  }
  return { isCorrect: 0, aiScore: null, aiFeedback: null, needsSelfGrade: true };
}

router.post('/attempts/:id/submit', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const attempt = get('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!attempt) throw notFound('Attempt not found.');
  if (attempt.submitted_at) throw bad('This attempt has already been submitted.', 'already_submitted');
  const quiz = get('SELECT * FROM quizzes WHERE id = ?', [attempt.quiz_id]);
  const questions = all('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position', [quiz.id]);

  const answers = all('SELECT * FROM attempt_answers WHERE attempt_id = ?', [attempt.id]);
  const byQ = new Map(answers.map((a) => [a.question_id, a]));
  let correctCount = 0;
  let needsSelfGrade = false;

  for (const q of questions) {
    const a = byQ.get(q.id);
    const response = a?.response ?? '';
    const graded = await gradeQuestion(q, response);
    if (graded.needsSelfGrade) needsSelfGrade = true;
    if (graded.isCorrect) correctCount += 1;
    if (a) {
      run('UPDATE attempt_answers SET is_correct = ?, ai_score = ?, ai_feedback = ? WHERE id = ?',
        [graded.isCorrect, graded.aiScore, graded.aiFeedback, a.id]);
    } else {
      run(
        `INSERT INTO attempt_answers (id, attempt_id, question_id, user_id, response, is_correct, ai_score, ai_feedback, topic, answered_at)
         VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?)`,
        [id('ans_'), attempt.id, q.id, userId, graded.isCorrect, graded.aiScore, graded.aiFeedback, q.topic, nowIso()],
      );
    }
  }

  const total = questions.length;
  const score = total ? correctCount / total : 0;
  const timeSpent = Math.max(0, Math.round((Date.now() - new Date(attempt.started_at).getTime()) / 1000));
  run(
    `UPDATE quiz_attempts SET submitted_at = ?, time_spent_sec = ?, score = ?, total = ?, correct_count = ? WHERE id = ?`,
    [nowIso(), timeSpent, score, total, correctCount, attempt.id],
  );
  run('UPDATE quizzes SET completed_at = ?, status = \'completed\' WHERE id = ?', [nowIso(), quiz.id]);
  bumpActivity(userId, undefined, { questionsAnswered: total, correctAnswers: correctCount, studySeconds: timeSpent });
  regeneratePlan(userId, 14);

  res.json({ attemptId: attempt.id, score, correctCount, total, timeSpentSec: timeSpent, needsSelfGrade });
}));

/** Self-grade a short-answer question when AI grading is unavailable. */
router.post('/attempts/:id/self-grade', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const attempt = get('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!attempt) throw notFound('Attempt not found.');
  const { questionId, correct } = req.body || {};
  const a = get('SELECT * FROM attempt_answers WHERE attempt_id = ? AND question_id = ? AND user_id = ?', [attempt.id, questionId, userId]);
  if (!a) throw notFound('Answer not found.');
  run('UPDATE attempt_answers SET is_correct = ?, ai_score = ? WHERE id = ?', [correct ? 1 : 0, correct ? 1 : 0, a.id]);

  const agg = get('SELECT SUM(is_correct) AS c, COUNT(*) AS t FROM attempt_answers WHERE attempt_id = ?', [attempt.id]);
  const score = agg.t ? agg.c / agg.t : 0;
  run('UPDATE quiz_attempts SET score = ?, correct_count = ? WHERE id = ?', [score, agg.c, attempt.id]);
  res.json({ score, correctCount: agg.c, total: agg.t });
}));

/** Create a new quiz from the questions missed in an attempt. */
router.post('/attempts/:id/retry-incorrect', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const attempt = get('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!attempt) throw notFound('Attempt not found.');
  const missed = all(
    `SELECT qq.* FROM attempt_answers aa JOIN quiz_questions qq ON qq.id = aa.question_id
     WHERE aa.attempt_id = ? AND aa.user_id = ? AND aa.is_correct = 0 ORDER BY qq.position`,
    [attempt.id, userId],
  );
  if (!missed.length) throw bad('No missed questions to retry.', 'no_missed');
  const original = get('SELECT * FROM quizzes WHERE id = ?', [attempt.quiz_id]);
  const quizId = id('qz_');
  const ts = nowIso();
  run(
    `INSERT INTO quizzes (id, user_id, workspace_id, set_id, material_id, title, mode, question_count, difficulty, show_explanations, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'practice', ?, 'mixed', 1, 'ready', ?)`,
    [quizId, userId, original.workspace_id, original.set_id, original.material_id,
     `Retry missed — ${original.title}`.slice(0, 200), missed.length, ts],
  );
  missed.forEach((q, i) => {
    run(
      `INSERT INTO quiz_questions (id, quiz_id, user_id, type, prompt, options, correct_answer, explanation, misconception, topic, difficulty, source_ref, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id('qq_'), quizId, userId, q.type, q.prompt, q.options, q.correct_answer, q.explanation,
       q.misconception, q.topic, q.difficulty, q.source_ref, i],
    );
  });
  res.status(201).json({ quizId, questionCount: missed.length });
}));

/** Results summary for an attempt (used by the results page). */
router.get('/attempts/:id/summary', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const attempt = get('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!attempt) throw notFound('Attempt not found.');
  const quiz = get('SELECT * FROM quizzes WHERE id = ?', [attempt.quiz_id]);
  const byTopic = all(
    `SELECT COALESCE(NULLIF(topic,''),'Uncategorized') AS topic, COUNT(*) AS answers, SUM(is_correct) AS correct
     FROM attempt_answers WHERE attempt_id = ? GROUP BY topic ORDER BY answers DESC`,
    [attempt.id],
  ).map((r) => ({ topic: r.topic, answers: r.answers, correct: r.correct, accuracy: r.answers ? r.correct / r.answers : 0 }));

  const prior = all(
    `SELECT score, submitted_at FROM quiz_attempts
     WHERE user_id = ? AND quiz_id = ? AND submitted_at IS NOT NULL AND id <> ?
     ORDER BY submitted_at DESC LIMIT 5`,
    [userId, attempt.quiz_id, attempt.id],
  );

  res.json({
    attempt: {
      id: attempt.id, score: attempt.score, total: attempt.total,
      correctCount: attempt.correct_count, timeSpentSec: attempt.time_spent_sec,
      startedAt: attempt.started_at, submittedAt: attempt.submitted_at,
    },
    quiz: publicQuiz(quiz),
    byTopic,
    previousScores: prior.map((p) => ({ score: p.score, submittedAt: p.submitted_at })),
    disclaimer: 'These are AI-generated or card-derived practice questions, not official certification exam questions.',
  });
}));

export default router;
