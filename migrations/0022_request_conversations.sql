ALTER TABLE quiz_requests ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE quiz_requests ADD COLUMN granted_amount INTEGER;
ALTER TABLE quiz_requests ADD COLUMN reply TEXT NOT NULL DEFAULT '';
ALTER TABLE quiz_grants ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE topic_suggestions ADD COLUMN reply TEXT NOT NULL DEFAULT '';
CREATE TABLE request_messages(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('quiz','topic')),request_id TEXT NOT NULL,sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,sender_name TEXT NOT NULL,text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 500),created_at INTEGER NOT NULL);
CREATE INDEX request_messages_thread ON request_messages(owner_id,kind,request_id,created_at);
CREATE TABLE app_notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,type TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,resource_kind TEXT NOT NULL,resource_id TEXT NOT NULL,dedupe_key TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,read_at INTEGER);
CREATE INDEX app_notifications_inbox ON app_notifications(user_id,created_at);
CREATE TRIGGER app_notice_push AFTER INSERT ON app_notifications BEGIN
 INSERT INTO push_outbox(id,user_id,category,payload,created_at) VALUES(lower(hex(randomblob(16))),NEW.user_id,CASE WHEN NEW.type='admin_request' THEN 'adminRequests' ELSE 'allowanceUpdates' END,json_object('title',NEW.title,'body',NEW.body,'url','/?requests=1'),NEW.created_at);
END;
