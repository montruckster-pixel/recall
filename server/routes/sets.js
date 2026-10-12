import express from 'express';
import { get, all, run, nowIso } from '../lib/db.js';
import { asyncHandler, bad, notFound, id, str, paginate, like } from '../lib/util.js';
import { ensureSchedule, dueCount } from '../lib/fsrs.js';
import { assertWithinLimit } from '../lib/billing.js';
import { regeneratePlan } from '../lib/planner.js';

const router = express.Router();

const SORTS = {
  recent: 's.updated_at DESC',
  created: 's.created_at DESC',
  title: 's.title COLLATE NOCASE ASC',
  cards: 'card_count DESC',
  due: 'due_count DESC',
  studied: 's.last_studied_at DESC NULLS LAST',
};

function publicSet(s) {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    subject: s.subject,
    topic: s.topic,
    materialId: s.material_id,
    isFavorite: Boolean(s.is_favorite),
    archived: Boolean(s.archived),
    cardCount: s.card_count ?? 0,
    dueCount: s.due_count ?? 0,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    lastStudiedAt: s.last_studied_at,
  };
}

function publicCard(c) {
  return {
    id: c.id,
    setId: c.set_id,
    front: c.front,
    back: c.back,
    example: c.example,
    sourceRef: c.source_ref,
    subject: c.subject,
    topic: c.topic,
    difficulty: c.difficulty,
    archived: Boolean(c.archived),
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    schedule: c.state ? {
      state: c.state, dueAt: c.due_at, reps: c.reps, lapses: c.lapses,
      stability: c.stability, difficulty: c.difficulty_fsrs,
      scheduledDays: c.scheduled_days, lastReviewedAt: c.last_reviewed_at,
    } : undefined,
  };
}

router.get('/sets', asyncHandler(async (req, res) => {
  const { limit, offset } = paginate(req.query, 20, 100);
  const params = [req.user.id];
  const clauses = ['s.user_id = ?'];
  if (req.query.archived === '1') clauses.push('s.archived = 1');
  else if (req.query.archived !== 'all') clauses.push('s.archived = 0');
  if (req.query.favorite === '1') clauses.push('s.is_favorite = 1');
  if (req.query.subject) { clauses.push('s.subject = ?'); params.push(str(req.query.subject, 120)); }
  if (req.query.topic) { clauses.push('s.topic = ?'); params.push(str(req.query.topic, 120)); }
  if (req.query.query) {
    clauses.push('(s.title LIKE ? ESCAPE \'\\\' OR s.description LIKE ? ESCAPE \'\\\')');
    params.push(like(str(req.query.query, 80)), like(str(req.query.query, 80)));
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const order = SORTS[req.query.sort] || SORTS.recent;

  const total = get(`SELECT COUNT(*) AS n FROM study_sets s ${where}`, params).n;
  const rows = all(
    `SELECT s.*,
       (SELECT COUNT(*) FROM flashcards f WHERE f.set_id = s.id AND f.archived = 0) AS card_count,
       (SELECT COUNT(*) FROM card_schedule cs JOIN flashcards f2 ON f2.id = cs.card_id
         WHERE f2.set_id = s.id AND f2.archived = 0 AND cs.due_at <= ?) AS due_count
     FROM study_sets s ${where}
     ORDER BY ${order} LIMIT ? OFFSET ?`,
    [nowIso(), ...params, limit, offset],
  );
  res.json({ total, limit, offset, items: rows.map(publicSet) });
}));

router.get('/sets/facets', asyncHandler(async (req, res) => {
  const subjects = all(
    "SELECT DISTINCT subject FROM study_sets WHERE user_id = ? AND subject IS NOT NULL AND subject <> '' ORDER BY subject",
    [req.user.id],
  ).map((r) => r.subject);
  const topics = all(
    "SELECT DISTINCT topic FROM study_sets WHERE user_id = ? AND topic IS NOT NULL AND topic <> '' ORDER BY topic",
    [req.user.id],
  ).map((r) => r.topic);
  res.json({ subjects, topics });
}));

router.post('/sets', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const title = str(req.body?.title, 200);
  if (!title) throw bad('A study set needs a title.', 'title_required');
  assertWithinLimit(userId, 'maxStudySets', 1);
  const ts = nowIso();
  const workspace = get('SELECT id FROM workspaces WHERE user_id = ? AND is_active = 1', [userId]);
  const setId = id('set_');
  run(
    `INSERT INTO study_sets (id, user_id, workspace_id, material_id, title, description, subject, topic, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [setId, userId, workspace?.id || null, req.body?.materialId || null, title,
     str(req.body?.description, 900) || null, str(req.body?.subject, 120) || null,
     str(req.body?.topic, 120) || null, ts, ts],
  );
  res.status(201).json({ set: publicSet(get('SELECT * FROM study_sets WHERE id = ?', [setId])) });
}));

router.get('/sets/:id', asyncHandler(async (req, res) => {
  const s = get('SELECT * FROM study_sets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!s) throw notFound('Study set not found.');
  res.json({
    set: publicSet({
      ...s,
      card_count: get('SELECT COUNT(*) AS n FROM flashcards WHERE set_id = ? AND archived = 0', [s.id]).n,
      due_count: dueCount(req.user.id, s.id),
    }),
  });
}));

router.put('/sets/:id', asyncHandler(async (req, res) => {
  const s = get('SELECT * FROM study_sets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!s) throw notFound('Study set not found.');
  const b = req.body || {};
  run(
    `UPDATE study_sets SET title = ?, description = ?, subject = ?, topic = ?, is_favorite = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [b.title !== undefined ? (str(b.title, 200) || s.title) : s.title,
     b.description !== undefined ? (str(b.description, 900) || null) : s.description,
     b.subject !== undefined ? (str(b.subject, 120) || null) : s.subject,
     b.topic !== undefined ? (str(b.topic, 120) || null) : s.topic,
     b.isFavorite !== undefined ? (b.isFavorite ? 1 : 0) : s.is_favorite,
     nowIso(), s.id, req.user.id],
  );
  res.json({ set: publicSet(get('SELECT * FROM study_sets WHERE id = ?', [s.id])) });
}));

router.post('/sets/:id/archive', asyncHandler(async (req, res) => {
  const s = get('SELECT * FROM study_sets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!s) throw notFound('Study set not found.');
  const archived = req.body?.archived === false ? 0 : 1;
  run('UPDATE study_sets SET archived = ?, updated_at = ? WHERE id = ?', [archived, nowIso(), s.id]);
  res.json({ set: publicSet(get('SELECT * FROM study_sets WHERE id = ?', [s.id])) });
}));

router.post('/sets/:id/duplicate', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const s = get('SELECT * FROM study_sets WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!s) throw notFound('Study set not found.');
  const cards = all('SELECT * FROM flashcards WHERE set_id = ? AND user_id = ? AND archived = 0', [s.id, userId]);
  assertWithinLimit(userId, 'maxStudySets', 1);
  assertWithinLimit(userId, 'maxFlashcards', cards.length);

  const ts = nowIso();
  const newId = id('set_');
  run(
    `INSERT INTO study_sets (id, user_id, workspace_id, material_id, title, description, subject, topic, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId, userId, s.workspace_id, s.material_id, `${s.title} (copy)`, s.description, s.subject, s.topic, ts, ts],
  );
  for (const c of cards) {
    const cid = id('card_');
    run(
      `INSERT INTO flashcards (id, user_id, set_id, front, back, example, source_ref, subject, topic, difficulty, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cid, userId, newId, c.front, c.back, c.example, c.source_ref, c.subject, c.topic, c.difficulty, ts, ts],
    );
    ensureSchedule(userId, cid);
  }
  res.status(201).json({ set: publicSet(get('SELECT * FROM study_sets WHERE id = ?', [newId])), cardCount: cards.length });
}));

router.delete('/sets/:id', asyncHandler(async (req, res) => {
  const s = get('SELECT * FROM study_sets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!s) throw notFound('Study set not found.');
  run('DELETE FROM study_sets WHERE id = ? AND user_id = ?', [s.id, req.user.id]);
  regeneratePlan(req.user.id, 14);
  res.json({ ok: true });
}));

// ---- Cards ----------------------------------------------------------------

router.get('/sets/:id/cards', asyncHandler(async (req, res) => {
  const s = get('SELECT id FROM study_sets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!s) throw notFound('Study set not found.');
  const { limit, offset } = paginate(req.query, 50, 200);
  const params = [req.user.id, s.id];
  let extra = '';
  if (req.query.query) {
    extra = " AND (f.front LIKE ? ESCAPE '\\' OR f.back LIKE ? ESCAPE '\\')";
    params.push(like(str(req.query.query, 80)), like(str(req.query.query, 80)));
  }
  const total = get(`SELECT COUNT(*) AS n FROM flashcards f WHERE f.user_id = ? AND f.set_id = ? AND f.archived = 0 ${extra}`, params).n;
  const rows = all(
    `SELECT f.*, cs.state, cs.due_at, cs.reps, cs.lapses, cs.stability, cs.difficulty_fsrs,
            cs.scheduled_days, cs.last_reviewed_at
     FROM flashcards f LEFT JOIN card_schedule cs ON cs.card_id = f.id
     WHERE f.user_id = ? AND f.set_id = ? AND f.archived = 0 ${extra}
     ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  res.json({ total, limit, offset, items: rows.map(publicCard) });
}));

router.post('/sets/:id/cards', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const s = get('SELECT * FROM study_sets WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!s) throw notFound('Study set not found.');
  const items = Array.isArray(req.body?.cards) ? req.body.cards : [req.body];
  const clean = items
    .map((c) => ({ front: str(c?.front, 500), back: str(c?.back, 2000), example: str(c?.example, 500), sourceRef: str(c?.sourceRef, 200), topic: str(c?.topic, 120), difficulty: Math.max(1, Math.min(4, Number(c?.difficulty) || 2)) }))
    .filter((c) => c.front && c.back);
  if (!clean.length) throw bad('Each card needs a front and a back.', 'invalid_card');
  assertWithinLimit(userId, 'maxFlashcards', clean.length);

  const ts = nowIso();
  const created = [];
  for (const c of clean) {
    const cid = id('card_');
    run(
      `INSERT INTO flashcards (id, user_id, set_id, front, back, example, source_ref, subject, topic, difficulty, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cid, userId, s.id, c.front, c.back, c.example || null, c.sourceRef || null, s.subject, c.topic || s.topic, c.difficulty, ts, ts],
    );
    ensureSchedule(userId, cid);
    created.push(cid);
  }
  run('UPDATE study_sets SET updated_at = ? WHERE id = ?', [ts, s.id]);
  res.status(201).json({ created: created.length, cardIds: created });
}));

router.put('/cards/:id', asyncHandler(async (req, res) => {
  const c = get('SELECT * FROM flashcards WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!c) throw notFound('Card not found.');
  const b = req.body || {};
  run(
    `UPDATE flashcards SET front = ?, back = ?, example = ?, source_ref = ?, topic = ?, difficulty = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [b.front !== undefined ? (str(b.front, 500) || c.front) : c.front,
     b.back !== undefined ? (str(b.back, 2000) || c.back) : c.back,
     b.example !== undefined ? (str(b.example, 500) || null) : c.example,
     b.sourceRef !== undefined ? (str(b.sourceRef, 200) || null) : c.source_ref,
     b.topic !== undefined ? (str(b.topic, 120) || null) : c.topic,
     b.difficulty !== undefined ? Math.max(1, Math.min(4, Number(b.difficulty) || 2)) : c.difficulty,
     nowIso(), c.id, req.user.id],
  );
  res.json({ card: publicCard(get('SELECT * FROM flashcards WHERE id = ?', [c.id])) });
}));

router.delete('/cards/:id', asyncHandler(async (req, res) => {
  const c = get('SELECT * FROM flashcards WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!c) throw notFound('Card not found.');
  run('DELETE FROM flashcards WHERE id = ? AND user_id = ?', [c.id, req.user.id]);
  res.json({ ok: true });
}));

/** Bulk operations: delete, move, set difficulty, archive. */
router.post('/cards/bulk', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
  const action = str(req.body?.action, 30);
  if (!ids.length) throw bad('Select at least one card.', 'no_selection');
  const placeholders = ids.map(() => '?').join(',');
  const owned = all(`SELECT id FROM flashcards WHERE user_id = ? AND id IN (${placeholders})`, [userId, ...ids]);
  if (!owned.length) throw notFound('No matching cards.');
  const ownedIds = owned.map((r) => r.id);
  const ph2 = ownedIds.map(() => '?').join(',');

  if (action === 'delete') {
    run(`DELETE FROM flashcards WHERE user_id = ? AND id IN (${ph2})`, [userId, ...ownedIds]);
  } else if (action === 'move') {
    const target = get('SELECT * FROM study_sets WHERE id = ? AND user_id = ?', [req.body?.targetSetId, userId]);
    if (!target) throw bad('Choose a destination study set.', 'invalid_target');
    run(`UPDATE flashcards SET set_id = ?, updated_at = ? WHERE user_id = ? AND id IN (${ph2})`, [target.id, nowIso(), userId, ...ownedIds]);
  } else if (action === 'difficulty') {
    const d = Math.max(1, Math.min(4, Number(req.body?.difficulty) || 2));
    run(`UPDATE flashcards SET difficulty = ?, updated_at = ? WHERE user_id = ? AND id IN (${ph2})`, [d, nowIso(), userId, ...ownedIds]);
  } else if (action === 'topic') {
    run(`UPDATE flashcards SET topic = ?, updated_at = ? WHERE user_id = ? AND id IN (${ph2})`, [str(req.body?.topic, 120) || null, nowIso(), userId, ...ownedIds]);
  } else {
    throw bad('Unknown bulk action.', 'unknown_action');
  }
  res.json({ ok: true, affected: ownedIds.length });
}));

/** Card-level stats for a set or the whole account. */
router.get('/cards/stats', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const params = [userId];
  let extra = '';
  if (req.query.setId) { extra = ' AND f.set_id = ?'; params.push(req.query.setId); }
  const rows = all(
    `SELECT cs.state, COUNT(*) AS n FROM card_schedule cs
     JOIN flashcards f ON f.id = cs.card_id
     WHERE cs.user_id = ? AND f.archived = 0 ${extra} GROUP BY cs.state`,
    params,
  );
  const byState = { new: 0, learning: 0, review: 0, relearning: 0 };
  for (const r of rows) byState[r.state] = r.n;
  const total = Object.values(byState).reduce((a, b) => a + b, 0);
  res.json({ total, byState, due: dueCount(userId, req.query.setId || null) });
}));

export default router;
