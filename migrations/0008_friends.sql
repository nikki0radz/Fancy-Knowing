ALTER TABLE users ADD COLUMN friend_username TEXT;
UPDATE users SET friend_username='curious-'||lower(hex(randomblob(6))) WHERE friend_username IS NULL;
CREATE UNIQUE INDEX users_friend_username ON users(friend_username);
CREATE TABLE friendships (
 user_low TEXT NOT NULL REFERENCES users(id),
 user_high TEXT NOT NULL REFERENCES users(id),
 requested_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 accepted_at INTEGER,
 PRIMARY KEY(user_low,user_high),
 CHECK(user_low<user_high),
 CHECK(requested_by=user_low OR requested_by=user_high)
);
CREATE INDEX friendships_high ON friendships(user_high,accepted_at);
ALTER TABLE trivia_games ADD COLUMN invitee_id TEXT REFERENCES users(id);
ALTER TABLE challenge_notifications ADD COLUMN kind TEXT NOT NULL DEFAULT 'result';
