import {hash} from './core.mjs';
export const playerTable=game=>game.group_mode?'quiz_participants':'trivia_players';
export const answerTable=game=>game.group_mode?'quiz_responses':'trivia_answers';
export async function playerFor(env,gameId,user,token){
 const guest=token?await hash(token):'',cols='id,game_id,seat,user_id,guest_hash,name,joined_at,completed_at,score,verdict,question_started_at,elapsed_ms,started_at';
 return env.DB.prepare(`SELECT ${cols},NULL AS finalized_at FROM trivia_players WHERE game_id=? AND (user_id=? OR guest_hash=?) UNION ALL SELECT ${cols},finalized_at FROM quiz_participants WHERE game_id=? AND (user_id=? OR guest_hash=?) LIMIT 1`).bind(gameId,user?.id||'',guest,gameId,user?.id||'',guest).first();
}
