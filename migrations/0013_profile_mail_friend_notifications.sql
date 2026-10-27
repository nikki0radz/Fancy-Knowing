ALTER TABLE email_outbox ADD COLUMN last_error TEXT;
ALTER TABLE email_outbox ADD COLUMN delivery_key TEXT;
INSERT INTO email_outbox(user_id,email,created_at) SELECT id,email,created_at FROM users WHERE email IS NOT NULL ON CONFLICT(user_id) DO NOTHING;
UPDATE email_outbox SET email=(SELECT email FROM users WHERE users.id=email_outbox.user_id) WHERE sent_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE users.id=email_outbox.user_id AND email IS NOT NULL);
UPDATE email_outbox SET attempts=0,last_attempt_at=NULL WHERE sent_at IS NULL AND attempts>=8;
CREATE TABLE friend_notifications (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('request','accepted')),
 created_at INTEGER NOT NULL,
 read_at INTEGER,
 UNIQUE(user_id,actor_id,kind)
);
CREATE INDEX friend_notifications_inbox ON friend_notifications(user_id,read_at,created_at);
INSERT INTO friend_notifications(id,user_id,actor_id,kind,created_at) SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(6))),CASE WHEN requested_by=user_low THEN user_high ELSE user_low END,requested_by,'request',created_at FROM friendships WHERE accepted_at IS NULL;
