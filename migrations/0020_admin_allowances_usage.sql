CREATE TABLE quiz_requests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),day TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 20),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied')),created_at INTEGER NOT NULL,reviewed_at INTEGER,reviewed_by TEXT REFERENCES users(id));
CREATE UNIQUE INDEX quiz_request_pending ON quiz_requests(user_id,day) WHERE status='pending';
CREATE TABLE quiz_grants(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),day TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 20),granted_by TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL);
CREATE INDEX quiz_grants_user_day ON quiz_grants(user_id,day);
CREATE TABLE ai_usage(id TEXT PRIMARY KEY,user_id TEXT,feature TEXT NOT NULL,operation_id TEXT,model TEXT NOT NULL,endpoint TEXT NOT NULL,status INTEGER NOT NULL,input_tokens INTEGER,output_tokens INTEGER,cached_tokens INTEGER,search_calls INTEGER,search_measured INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
CREATE INDEX ai_usage_time ON ai_usage(created_at);
CREATE INDEX ai_usage_feature ON ai_usage(feature,created_at);
CREATE INDEX trivia_games_creator_created ON trivia_games(creator_id,created_at);
