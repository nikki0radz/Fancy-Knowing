DROP TRIGGER app_notice_push;
CREATE TRIGGER app_notice_push AFTER INSERT ON app_notifications BEGIN
 INSERT INTO push_outbox(id,user_id,category,payload,created_at) VALUES(lower(hex(randomblob(16))),NEW.user_id,CASE WHEN NEW.type IN ('quiz_ready','quiz_failed') THEN 'quizReady' WHEN NEW.type='admin_request' THEN 'adminRequests' ELSE 'allowanceUpdates' END,json_object('title',NEW.title,'body',NEW.body,'url',CASE WHEN NEW.type IN ('quiz_ready','quiz_failed') THEN '/?inbox=1' ELSE '/?requests=1' END),NEW.created_at);
END;
