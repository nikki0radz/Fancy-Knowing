PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 salt TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS questions (
 id TEXT PRIMARY KEY, day TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL UNIQUE,
 concept TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 question_id TEXT NOT NULL REFERENCES questions(id), choice INTEGER, typed TEXT,
 correct INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_user_question ON attempts(user_id, question_id, created_at DESC);
CREATE TABLE IF NOT EXISTS saved (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 question_id TEXT NOT NULL REFERENCES questions(id), due_at INTEGER NOT NULL,
 saved_at INTEGER NOT NULL, PRIMARY KEY(user_id, question_id)
);
CREATE TABLE IF NOT EXISTS chats (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 question_id TEXT NOT NULL REFERENCES questions(id), role TEXT NOT NULL, content TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chats_owner ON chats(user_id, question_id, id);
CREATE TABLE IF NOT EXISTS budgets (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS locks (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
