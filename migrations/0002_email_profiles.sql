ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
ALTER TABLE users ADD COLUMN profile TEXT NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX users_email_unique ON users(email) WHERE email IS NOT NULL;
CREATE TABLE email_tokens (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 email TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('reset','link')),
 expires_at INTEGER NOT NULL,
 used_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX email_tokens_owner ON email_tokens(user_id,purpose,created_at);
CREATE TABLE approved_topics (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 topic TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id, topic)
);
CREATE TABLE daily_assignments (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 question_id TEXT NOT NULL REFERENCES questions(id),
 PRIMARY KEY(user_id, day)
);
