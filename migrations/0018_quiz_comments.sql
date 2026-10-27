CREATE TABLE quiz_comments(id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES trivia_games(id),author_key TEXT NOT NULL,name TEXT NOT NULL,text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 500),created_at INTEGER NOT NULL);
CREATE INDEX quiz_comments_game_time ON quiz_comments(game_id,created_at,id);
