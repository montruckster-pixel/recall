import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run, nowIso } from '../lib/db.js';
import { asyncHandler, bad, notFound, id, str, paginate } from '../lib/util.js';
import { assertAcceptable, extractText, MAX_UPLOAD_BYTES, ACCEPTED_EXTENSIONS } from '../lib/extract.js';
import { aiConfig, recordAiUsage, AiNotConfigured } from '../lib/ai.js';
import { generateStudyPackage, normalizePackage } from '../lib/studygen.js';
import { assertWithinLimit } from '../lib/billing.js';
import { regeneratePlan } from '../lib/planner.js';

const router = express.Router();

const UPLOAD_DIR = process.env.RECALL_UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function publicMaterial(m, { includeText = false } = {}) {
  if (!m) return null;
  return {
    id: m.id,
    workspaceId: m.workspace_id,
    title: m.title,
    description: m.description,
    filename: m.filename,
    mime: m.mime,
    sizeBytes: m.size_bytes,
    status: m.status,
    error: m.error,
    subject: m.subject,
    topic: m.topic,
    charCount: m.char_count,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    ...(includeText ? { text: m.extracted_text || '' } : {}),
  };
}

router.get('/materials', asyncHandler(async (req, res) => {
  const { limit, offset } = paginate(req.query, 20, 100);
  const params = [req.user.id];
  let where = 'WHERE user_id = ?';
  if (req.query.status) { where += ' AND status = ?'; params.push(str(req.query.status, 30)); }
  if (req.query.query) { where += ' AND (title LIKE ? OR description LIKE ?)'; params.push(`%${str(req.query.query, 80)}%`, `%${str(req.query.query, 80)}%`); }
  const total = get(`SELECT COUNT(*) AS n FROM materials ${where}`, params).n;
  const rows = all(`SELECT * FROM materials ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  res.json({ total, limit, offset, items: rows.map((m) => publicMaterial(m)) });
}));

router.get('/materials/meta', asyncHandler(async (_req, res) => {
  res.json({ acceptedExtensions: ACCEPTED_EXTENSIONS, maxUploadBytes: MAX_UPLOAD_BYTES, ai: aiConfig() });
}));

/** Upload a file (multipart) or paste text (JSON). */
router.post('/materials', upload.single('file'), asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const title = str(req.body?.title, 200);
  const description = str(req.body?.description, 1000);
  const subject = str(req.body?.subject, 120);
  const topic = str(req.body?.topic, 120);
  const pastedText = str(req.body?.text, 400000);

  if (!title) throw bad('Give your material a title.', 'title_required');

  let buffer = null;
  let filename = '';
  let mime = 'text/plain';

  if (req.file) {
    buffer = req.file.buffer;
    filename = req.file.originalname || 'upload';
    mime = req.file.mimetype || 'application/octet-stream';
    assertAcceptable(filename, mime, buffer.length);
  } else if (pastedText) {
    if (pastedText.length < 40) throw bad('Paste at least a paragraph of text.', 'text_too_short');
    filename = `${title.slice(0, 60).replace(/[^\w.-]+/g, '_')}.txt`;
    buffer = Buffer.from(pastedText, 'utf8');
    mime = 'text/plain';
  } else {
    throw bad('Attach a file or paste some text.', 'no_input');
  }

  const materialId = id('mat_');
  const storagePath = path.join(UPLOAD_DIR, `${materialId}-${path.basename(filename).replace(/[^\w.-]+/g, '_')}`);
  await fs.promises.writeFile(storagePath, buffer);

  const ts = nowIso();
  const workspace = get('SELECT id FROM workspaces WHERE user_id = ? AND is_active = 1', [userId]);

  run(
    `INSERT INTO materials (id, user_id, workspace_id, title, description, filename, mime, size_bytes, storage_path, status, subject, topic, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'extracting', ?, ?, ?, ?)`,
    [materialId, userId, workspace?.id || null, title, description || null, filename, mime, buffer.length, storagePath, subject || null, topic || null, ts, ts],
  );

  // Extract synchronously — it is fast for typical study documents. On failure
  // the row is marked 'failed' with an actionable message and can be retried.
  try {
    const { text, method, charCount, truncated } = await extractText({ buffer, filename, mime });
    run(
      `UPDATE materials SET extracted_text = ?, char_count = ?, status = 'extracted', error = NULL, updated_at = ? WHERE id = ? AND user_id = ?`,
      [text, charCount, nowIso(), materialId, userId],
    );
    const row = get('SELECT * FROM materials WHERE id = ?', [materialId]);
    res.status(201).json({ material: publicMaterial(row), extraction: { method, truncated } });
  } catch (err) {
    run(
      `UPDATE materials SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [err.message || 'Extraction failed.', nowIso(), materialId, userId],
    );
    res.status(err.status || 422).json({
      error: err.message || 'Extraction failed.',
      code: err.code || 'extract_failed',
      material: publicMaterial(get('SELECT * FROM materials WHERE id = ?', [materialId])),
    });
  }
}));

router.get('/materials/:id', asyncHandler(async (req, res) => {
  const m = get('SELECT * FROM materials WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!m) throw notFound('Material not found.');
  const generation = get(
    'SELECT id, status, created_at, committed_at, error FROM generations WHERE material_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
    [m.id, req.user.id],
  );
  const sets = all('SELECT id, title FROM study_sets WHERE material_id = ? AND user_id = ?', [m.id, req.user.id]);
  res.json({ material: publicMaterial(m), generation, studySets: sets });
}));

router.get('/materials/:id/text', asyncHandler(async (req, res) => {
  const m = get('SELECT * FROM materials WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!m) throw notFound('Material not found.');
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(20000, Number.parseInt(req.query.limit, 10) || 8000);
  const text = m.extracted_text || '';
  res.json({
    offset, limit, total: text.length,
    text: text.slice(offset, offset + limit),
    hasMore: offset + limit < text.length,
  });
}));

router.get('/materials/:id/file', asyncHandler(async (req, res) => {
  const m = get('SELECT * FROM materials WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!m || !m.storage_path || !fs.existsSync(m.storage_path)) throw notFound('File not found.');
  res.setHeader('Content-Type', m.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(m.filename || 'material')}"`);
  fs.createReadStream(m.storage_path).pipe(res);
}));

router.post('/materials/:id/retry', asyncHandler(async (req, res) => {
  const m = get('SELECT * FROM materials WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!m) throw notFound('Material not found.');
  if (!m.storage_path || !fs.existsSync(m.storage_path)) throw bad('The original file is no longer available. Re-upload it.', 'file_missing');
  const buffer = await fs.promises.readFile(m.storage_path);
  try {
    const { text, charCount } = await extractText({ buffer, filename: m.filename, mime: m.mime });
    run('UPDATE materials SET extracted_text = ?, char_count = ?, status = \'extracted\', error = NULL, updated_at = ? WHERE id = ?',
      [text, charCount, nowIso(), m.id]);
    res.json({ material: publicMaterial(get('SELECT * FROM materials WHERE id = ?', [m.id])) });
  } catch (err) {
    run('UPDATE materials SET status = \'failed\', error = ?, updated_at = ? WHERE id = ?', [err.message, nowIso(), m.id]);
    res.status(err.status || 422).json({ error: err.message, code: err.code || 'extract_failed' });
  }
}));

router.delete('/materials/:id', asyncHandler(async (req, res) => {
  const m = get('SELECT * FROM materials WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!m) throw notFound('Material not found.');
  run('DELETE FROM materials WHERE id = ? AND user_id = ?', [m.id, req.user.id]);
  res.json({ ok: true });
}));

/** Run AI processing and store a reviewable draft (nothing is saved yet). */
router.post('/materials/:id/generate', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const m = get('SELECT * FROM materials WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!m) throw notFound('Material not found.');
  if (!m.extracted_text) throw bad('This material has no extracted text yet. Retry extraction first.', 'no_text');

  if (!aiConfig().configured) throw new AiNotConfigured();
  assertWithinLimit(userId, 'aiCreditsPerMonth', 1);

  const counts = req.body?.counts || {};
  const generationId = id('gen_');
  run(
    `INSERT INTO generations (id, user_id, material_id, status, package, created_at) VALUES (?, ?, ?, 'processing', '{}', ?)`,
    [generationId, userId, m.id, nowIso()],
  );

  try {
    const pkg = await generateStudyPackage({
      text: m.extracted_text,
      title: m.title,
      subject: m.subject,
      topic: m.topic,
      counts,
    });
    recordAiUsage(userId, 'study_package', 1);
    run('UPDATE generations SET status = \'draft\', package = ? WHERE id = ?', [JSON.stringify(pkg), generationId]);
    run('UPDATE materials SET status = \'ready\', updated_at = ? WHERE id = ?', [nowIso(), m.id]);
    res.json({ generation: { id: generationId, status: 'draft' }, package: pkg });
  } catch (err) {
    run('UPDATE generations SET status = \'failed\', error = ? WHERE id = ?', [err.message, generationId]);
    run('UPDATE materials SET status = \'extracted\', updated_at = ? WHERE id = ?', [nowIso(), m.id]);
    throw err;
  }
}));

router.get('/materials/:id/generation', asyncHandler(async (req, res) => {
  const g = get(
    'SELECT * FROM generations WHERE material_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
    [req.params.id, req.user.id],
  );
  if (!g) throw notFound('No generated content for this material yet.');
  res.json({ generation: { id: g.id, status: g.status, error: g.error, set_id: g.set_id, quiz_id: g.quiz_id }, package: JSON.parse(g.package || '{}') });
}));

/**
 * Commit an edited draft: create a study set (+ flashcards) and a practice quiz
 * from the reviewed content.
 */
router.post('/generations/:id/commit', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const g = get('SELECT * FROM generations WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!g) throw notFound('Draft not found.');
  if (g.status === 'committed') throw bad('This draft has already been saved.', 'already_committed');

  const pkg = normalizePackage(req.body?.package || JSON.parse(g.package || '{}'));
  const material = g.material_id ? get('SELECT * FROM materials WHERE id = ?', [g.material_id]) : null;
  const setTitle = str(req.body?.setTitle, 200) || (material ? material.title : 'Generated study set');

  assertWithinLimit(userId, 'maxStudySets', 1);
  assertWithinLimit(userId, 'maxFlashcards', pkg.flashcards.length);

  const ts = nowIso();
  const setId = id('set_');
  run(
    `INSERT INTO study_sets (id, user_id, workspace_id, material_id, title, description, subject, topic, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [setId, userId, material?.workspace_id || null, material?.id || null, setTitle,
     pkg.summary ? pkg.summary.slice(0, 900) : null, material?.subject || null, material?.topic || null, ts, ts],
  );

  const cardIds = [];
  for (const c of pkg.flashcards) {
    const cardId = id('card_');
    run(
      `INSERT INTO flashcards (id, user_id, set_id, front, back, example, source_ref, subject, topic, difficulty, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cardId, userId, setId, c.front, c.back, c.example || null, c.sourceRef || null,
       material?.subject || null, c.topic || null, c.difficulty, ts, ts],
    );
    run(
      `INSERT INTO card_schedule (card_id, user_id, state, due_at, reps, lapses, stability, difficulty_fsrs, scheduled_days, step_index, updated_at)
       VALUES (?, ?, 'new', ?, 0, 0, 0, 0, 0, 0, ?)`,
      [cardId, userId, ts, ts],
    );
    cardIds.push(cardId);
  }

  // Build a practice quiz from the MCQ + short-answer items.
  let quizId = null;
  const questionItems = [
    ...pkg.mcqs.map((q) => ({ type: 'mcq', ...q })),
    ...pkg.shortAnswers.map((q) => ({ type: 'short', ...q })),
  ];
  if (questionItems.length) {
    quizId = id('qz_');
    run(
      `INSERT INTO quizzes (id, user_id, workspace_id, set_id, material_id, title, mode, question_count, difficulty, show_explanations, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'practice', ?, 'mixed', 1, 'ready', ?)`,
      [quizId, userId, material?.workspace_id || null, setId, material?.id || null,
       `${setTitle} — practice quiz`, questionItems.length, ts],
    );
    questionItems.forEach((q, i) => {
      const options = q.type === 'mcq' ? q.options : ['True', 'False'];
      const correct = q.type === 'mcq' ? options[q.correctIndex] : '';
      run(
        `INSERT INTO quiz_questions (id, quiz_id, user_id, type, prompt, options, correct_answer, explanation, misconception, topic, difficulty, source_ref, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id('qq_'), quizId, userId, q.type, q.prompt, JSON.stringify(options),
         correct, q.explanation || null, q.misconception || null, q.topic || null,
         String(q.difficulty || 2), q.sourceRef || null, i],
      );
    });
  }

  run('UPDATE generations SET status = \'committed\', set_id = ?, quiz_id = ?, package = ?, committed_at = ? WHERE id = ?',
    [setId, quizId, JSON.stringify(pkg), ts, g.id]);
  if (material) run('UPDATE materials SET status = \'ready\', updated_at = ? WHERE id = ?', [ts, material.id]);
  regeneratePlan(userId, 14);

  res.status(201).json({ setId, quizId, cardCount: cardIds.length, questionCount: questionItems.length });
}));

export default router;
