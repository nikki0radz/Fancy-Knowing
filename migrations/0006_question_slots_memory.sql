ALTER TABLE daily_assignments RENAME TO daily_assignments_legacy;
CREATE TABLE daily_assignments (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 slot INTEGER NOT NULL DEFAULT 0 CHECK(slot BETWEEN 0 AND 9),
 question_id TEXT NOT NULL REFERENCES questions(id),
 subject TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,day,slot),
 UNIQUE(user_id,question_id)
);
INSERT INTO daily_assignments(user_id,day,slot,question_id,subject,created_at)
 SELECT a.user_id,a.day,0,a.question_id,COALESCE(json_extract(q.data,'$.topic'),'General knowledge'),q.created_at
 FROM daily_assignments_legacy a JOIN questions q ON q.id=a.question_id;
DROP TABLE daily_assignments_legacy;
CREATE INDEX daily_subject_history ON daily_assignments(user_id,subject,created_at);
CREATE TABLE question_embeddings (
 question_id TEXT PRIMARY KEY REFERENCES questions(id),
 model TEXT NOT NULL,
 vector TEXT NOT NULL
);
