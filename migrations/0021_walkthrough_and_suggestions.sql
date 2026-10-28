ALTER TABLE users ADD COLUMN walkthrough TEXT NOT NULL DEFAULT 'welcome';
-- Existing accounts do not suddenly receive a first-run tour.
UPDATE users SET walkthrough='done';
CREATE TABLE topic_suggestions (
 id TEXT PRIMARY KEY,
 user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 topic TEXT NOT NULL CHECK(length(topic) BETWEEN 2 AND 120),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=500),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed')),
 created_at INTEGER NOT NULL
);
CREATE INDEX topic_suggestions_time ON topic_suggestions(status,created_at);
