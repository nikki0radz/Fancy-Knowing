CREATE TABLE IF NOT EXISTS shared_questions (
 token TEXT PRIMARY KEY,
 question_id TEXT NOT NULL UNIQUE REFERENCES questions(id),
 created_at INTEGER NOT NULL
);
