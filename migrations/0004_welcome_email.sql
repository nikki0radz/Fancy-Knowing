CREATE TABLE email_outbox (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 email TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 sent_at INTEGER,
 attempts INTEGER NOT NULL DEFAULT 0,
 last_attempt_at INTEGER
);
