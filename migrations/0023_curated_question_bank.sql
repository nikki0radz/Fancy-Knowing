CREATE TABLE curated_questions (
 id TEXT PRIMARY KEY,
 source_id TEXT NOT NULL,
 scope_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 fact_id TEXT NOT NULL,
 category TEXT NOT NULL,
 collection TEXT NOT NULL DEFAULT '',
 topic TEXT NOT NULL,
 difficulty TEXT NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
 tags TEXT NOT NULL,
 data TEXT NOT NULL,
 version TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL
);
CREATE INDEX curated_scope_category ON curated_questions(scope_user_id,enabled,category,difficulty);
ALTER TABLE trivia_games ADD COLUMN bank INTEGER NOT NULL DEFAULT 0;
