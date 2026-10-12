/**
 * Recall — database layer.
 *
 * Uses Node's built-in `node:sqlite` (Node >= 22.5) so the app runs with zero
 * native dependencies. All access is server-side; the browser never touches the
 * database. Every user-owned row carries `user_id` and every query in the route
 * layer is scoped by the authenticated user id.
 *
 * The schema is written in portable SQL so it can be moved to PostgreSQL with
 * minimal changes (see README "Moving to PostgreSQL").
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.RECALL_DB_PATH || path.join(process.cwd(), 'data', 'recall.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  onboarded_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);

CREATE TABLE IF NOT EXISTS certifications (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cert_slug       TEXT REFERENCES certifications(slug),
  cert_name       TEXT,
  exam_date       TEXT,
  knowledge_level TEXT,
  daily_minutes   INTEGER NOT NULL DEFAULT 45,
  study_methods   TEXT NOT NULL DEFAULT '[]',
  preferred_days  TEXT NOT NULL DEFAULT '[]',
  daily_goal_cards   INTEGER NOT NULL DEFAULT 40,
  daily_goal_minutes INTEGER NOT NULL DEFAULT 45,
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cert_slug  TEXT REFERENCES certifications(slug),
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspaces_user ON workspaces(user_id);

CREATE TABLE IF NOT EXISTS materials (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id   TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  filename       TEXT,
  mime           TEXT,
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  storage_path   TEXT,
  status         TEXT NOT NULL DEFAULT 'uploaded',
  error          TEXT,
  extracted_text TEXT,
  char_count     INTEGER NOT NULL DEFAULT 0,
  subject        TEXT,
  topic          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_materials_user ON materials(user_id, created_at);

CREATE TABLE IF NOT EXISTS generations (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  material_id  TEXT REFERENCES materials(id) ON DELETE CASCADE,
  set_id       TEXT REFERENCES study_sets(id) ON DELETE SET NULL,
  quiz_id      TEXT REFERENCES quizzes(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  package      TEXT NOT NULL DEFAULT '{}',
  error        TEXT,
  created_at   TEXT NOT NULL,
  committed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_generations_material ON generations(material_id);

CREATE TABLE IF NOT EXISTS study_sets (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id   TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  material_id    TEXT REFERENCES materials(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  subject        TEXT,
  topic          TEXT,
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  archived       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  last_studied_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sets_user ON study_sets(user_id, archived, created_at);

CREATE TABLE IF NOT EXISTS flashcards (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id     TEXT NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
  front      TEXT NOT NULL,
  back       TEXT NOT NULL,
  example    TEXT,
  source_ref TEXT,
  subject    TEXT,
  topic      TEXT,
  difficulty INTEGER NOT NULL DEFAULT 2,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_set ON flashcards(set_id, archived);
CREATE INDEX IF NOT EXISTS idx_cards_user ON flashcards(user_id);

CREATE TABLE IF NOT EXISTS card_schedule (
  card_id         TEXT PRIMARY KEY REFERENCES flashcards(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state           TEXT NOT NULL DEFAULT 'new',
  due_at          TEXT NOT NULL,
  last_reviewed_at TEXT,
  reps            INTEGER NOT NULL DEFAULT 0,
  lapses          INTEGER NOT NULL DEFAULT 0,
  stability       REAL NOT NULL DEFAULT 0,
  difficulty_fsrs REAL NOT NULL DEFAULT 0,
  scheduled_days  REAL NOT NULL DEFAULT 0,
  step_index      INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sched_due ON card_schedule(user_id, due_at);

CREATE TABLE IF NOT EXISTS card_reviews (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,
  prev_state  TEXT,
  prev_due    TEXT,
  next_due    TEXT,
  elapsed_ms  INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'study'
);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON card_reviews(user_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_reviews_card ON card_reviews(card_id);

CREATE TABLE IF NOT EXISTS quizzes (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id     TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  set_id           TEXT REFERENCES study_sets(id) ON DELETE SET NULL,
  material_id      TEXT REFERENCES materials(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  mode             TEXT NOT NULL DEFAULT 'practice',
  time_limit_sec   INTEGER,
  question_count   INTEGER NOT NULL DEFAULT 0,
  difficulty       TEXT NOT NULL DEFAULT 'mixed',
  topic            TEXT,
  show_explanations INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'ready',
  created_at       TEXT NOT NULL,
  completed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_quizzes_user ON quizzes(user_id, created_at);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id             TEXT PRIMARY KEY,
  quiz_id        TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  prompt         TEXT NOT NULL,
  options        TEXT NOT NULL DEFAULT '[]',
  correct_answer TEXT NOT NULL,
  explanation    TEXT,
  misconception  TEXT,
  topic          TEXT,
  difficulty     TEXT,
  source_ref     TEXT,
  position       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_questions_quiz ON quiz_questions(quiz_id, position);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id             TEXT PRIMARY KEY,
  quiz_id        TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at     TEXT NOT NULL,
  submitted_at   TEXT,
  time_spent_sec INTEGER NOT NULL DEFAULT 0,
  score          REAL NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  correct_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON quiz_attempts(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_attempts_quiz ON quiz_attempts(quiz_id);

CREATE TABLE IF NOT EXISTS attempt_answers (
  id           TEXT PRIMARY KEY,
  attempt_id   TEXT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id  TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response     TEXT,
  is_correct   INTEGER NOT NULL DEFAULT 0,
  ai_score     REAL,
  ai_feedback  TEXT,
  topic        TEXT,
  answered_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_answers_attempt ON attempt_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_answers_user ON attempt_answers(user_id);

CREATE TABLE IF NOT EXISTS study_plan_days (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  goal_cards     INTEGER NOT NULL DEFAULT 40,
  goal_minutes   INTEGER NOT NULL DEFAULT 45,
  planned_minutes INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'open',
  notes          TEXT,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS study_tasks (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  detail       TEXT,
  ref_set_id   TEXT REFERENCES study_sets(id) ON DELETE SET NULL,
  ref_material_id TEXT REFERENCES materials(id) ON DELETE SET NULL,
  est_minutes  INTEGER NOT NULL DEFAULT 15,
  status       TEXT NOT NULL DEFAULT 'pending',
  completed_at TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON study_tasks(user_id, date, status);

CREATE TABLE IF NOT EXISTS daily_activity (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date              TEXT NOT NULL,
  cards_reviewed    INTEGER NOT NULL DEFAULT 0,
  questions_answered INTEGER NOT NULL DEFAULT 0,
  correct_answers   INTEGER NOT NULL DEFAULT 0,
  study_seconds     INTEGER NOT NULL DEFAULT 0,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_activity_user ON daily_activity(user_id, date);

CREATE TABLE IF NOT EXISTS ai_usage (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  units      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage ON ai_usage(user_id, month);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan                  TEXT NOT NULL DEFAULT 'free',
  billing_interval      TEXT,
  status                TEXT NOT NULL DEFAULT 'active',
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  current_period_end    TEXT,
  cancel_at_period_end  INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_events (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL UNIQUE,
  user_id    TEXT,
  provider   TEXT NOT NULL DEFAULT 'stripe',
  type       TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme           TEXT NOT NULL DEFAULT 'system',
  reduced_motion  INTEGER NOT NULL DEFAULT 0,
  email_reminders INTEGER NOT NULL DEFAULT 1,
  ai_consent      INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

db.exec(SCHEMA);

/** Run a statement, returning the raw sqlite result. */
export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

/** Fetch one row (or undefined). */
export function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

/** Fetch all rows. */
export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

/** Run a set of statements inside a transaction. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

/** YYYY-MM-DD in UTC. */
export function dayKey(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}
