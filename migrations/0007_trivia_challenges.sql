CREATE TABLE trivia_games (
 id TEXT PRIMARY KEY,
 creator_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('solo','challenge')),
 invite_token TEXT UNIQUE,
 topic TEXT NOT NULL,
 difficulty TEXT NOT NULL,
 question_count INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 completed_at INTEGER,
 UNIQUE(creator_id,request_id)
);
CREATE TABLE trivia_game_questions (
 game_id TEXT NOT NULL REFERENCES trivia_games(id),
 position INTEGER NOT NULL,
 question_id TEXT NOT NULL REFERENCES questions(id),
 PRIMARY KEY(game_id,position)
);
CREATE TABLE trivia_players (
 id TEXT PRIMARY KEY,
 game_id TEXT NOT NULL REFERENCES trivia_games(id),
 seat TEXT NOT NULL CHECK(seat IN ('host','guest')),
 user_id TEXT REFERENCES users(id),
 guest_hash TEXT,
 name TEXT NOT NULL,
 joined_at INTEGER NOT NULL,
 completed_at INTEGER,
 score INTEGER,
 UNIQUE(game_id,seat)
);
CREATE TABLE trivia_answers (
 player_id TEXT NOT NULL REFERENCES trivia_players(id),
 position INTEGER NOT NULL,
 choice INTEGER NOT NULL,
 correct INTEGER NOT NULL,
 PRIMARY KEY(player_id,position)
);
CREATE TABLE challenge_notifications (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 game_id TEXT NOT NULL REFERENCES trivia_games(id),
 created_at INTEGER NOT NULL,
 read_at INTEGER,
 UNIQUE(user_id,game_id)
);
CREATE INDEX challenge_inbox ON challenge_notifications(user_id,read_at,created_at);
CREATE INDEX trivia_player_account ON trivia_players(user_id,game_id);
