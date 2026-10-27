-- Correct the reported contradictory legacy item, preserving its ID and history.
-- Use a comparison among the displayed options and omit the disputed temperature.
CREATE TABLE corrected_question_keys(question_id TEXT PRIMARY KEY REFERENCES questions(id),previous_data TEXT NOT NULL,corrected_at INTEGER NOT NULL);
INSERT INTO corrected_question_keys(question_id,previous_data,corrected_at)
 SELECT id,data,unixepoch()*1000 FROM questions
 WHERE lower(json_extract(data,'$.q')) LIKE '%boiling%5933.2%'
 AND json_extract(data,'$.options[0]')='Iron' AND json_extract(data,'$.options[1]')='Tungsten'
 AND json_extract(data,'$.options[2]')='Gold' AND json_extract(data,'$.options[3]')='Lead';
UPDATE questions SET data=json_set(data,'$.q','Which of these elements has the highest boiling point?','$.correct',1,'$.correctAnswer','Tungsten','$.explanation','Tungsten has the highest boiling point of these four elements.','$.source','https://periodic-table.rsc.org/element/74/tungsten','$.aliases',json('["W","wolfram"]')) WHERE id IN (SELECT question_id FROM corrected_question_keys);
UPDATE attempts SET correct=CASE WHEN choice=1 OR (choice IS NULL AND lower(trim(typed)) IN ('tungsten','w','wolfram')) THEN 1 ELSE 0 END WHERE question_id IN (SELECT question_id FROM corrected_question_keys);
UPDATE trivia_answers SET correct=CASE WHEN choice=1 THEN 1 ELSE 0 END WHERE EXISTS(SELECT 1 FROM trivia_players p JOIN trivia_game_questions g ON g.game_id=p.game_id AND g.position=trivia_answers.position WHERE p.id=trivia_answers.player_id AND g.question_id IN (SELECT question_id FROM corrected_question_keys));
UPDATE trivia_players SET score=(SELECT SUM(a.correct) FROM trivia_answers a WHERE a.player_id=trivia_players.id) WHERE completed_at IS NOT NULL AND game_id IN (SELECT game_id FROM trivia_game_questions WHERE question_id IN (SELECT question_id FROM corrected_question_keys));
DELETE FROM question_embeddings WHERE question_id IN (SELECT question_id FROM corrected_question_keys);
