import {fail,randomToken,DAY} from './core.mjs';
import {resultNotice} from './ranking.mjs';
import {playerTable,answerTable} from './participants.mjs';
export async function finishGroup(env,game,player){
 const stored=await env.DB.prepare('SELECT * FROM quiz_participants WHERE id=?').bind(player.id).first();if(!stored?.completed_at||stored.finalized_at)return;
 const now=Date.now(),commands=[];
 if(stored.user_id){const answers=(await env.DB.prepare('SELECT a.*,g.question_id FROM quiz_responses a JOIN trivia_game_questions g ON g.game_id=? AND g.position=a.position WHERE a.player_id=?').bind(game.id,stored.id).all()).results;for(const a of answers)commands.push(env.DB.prepare('INSERT INTO attempts(id,user_id,question_id,choice,typed,correct,created_at) VALUES (?,?,?,?,NULL,?,?) ON CONFLICT(id) DO NOTHING').bind('game:'+game.id+':'+stored.id+':'+a.position,stored.user_id,a.question_id,a.choice,a.correct,now))}
 // A database claim and all side effects execute atomically; a replay cannot resurface a read alert.
 commands.push(env.DB.prepare('UPDATE quiz_participants SET finalized_at=? WHERE id=? AND finalized_at IS NULL').bind(now,stored.id));
 if(stored.user_id&&stored.seat!=='host')commands.push(env.DB.prepare("INSERT INTO challenge_notifications(id,user_id,game_id,created_at,kind) VALUES (?,?,?,?,'result') ON CONFLICT(user_id,game_id) DO UPDATE SET kind='result',created_at=excluded.created_at,read_at=NULL WHERE challenge_notifications.kind='invite'").bind(crypto.randomUUID(),stored.user_id,game.id,now));
 const players=(await env.DB.prepare('SELECT * FROM quiz_participants WHERE game_id=?').bind(game.id).all()).results;
 for(const recipient of players.filter(p=>p.user_id&&p.id!==stored.id&&(p.completed_at||p.seat==='host'))){const message=resultNotice(stored,recipient,game.question_count);commands.push(env.DB.prepare("INSERT INTO challenge_notifications(id,user_id,game_id,created_at,kind,message) VALUES (?,?,?,?,'score',?) ON CONFLICT(user_id,game_id) DO UPDATE SET kind='score',message=excluded.message,created_at=excluded.created_at,read_at=NULL WHERE EXISTS(SELECT 1 FROM quiz_participants WHERE id=? AND finalized_at=?)").bind(crypto.randomUUID(),recipient.user_id,game.id,now,message,stored.id,now))}
 await env.DB.batch(commands);
}
export async function validateFriendIds(env,user,ids){
 if(!Array.isArray(ids)||ids.length>50||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))fail('Choose up to 50 friends.');
 for(const id of new Set(ids)){if(id===user.id)continue;const [low,high]=[id,user.id].sort();if(!await env.DB.prepare('SELECT user_low FROM friendships WHERE user_low=? AND user_high=? AND accepted_at IS NOT NULL').bind(low,high).first())fail('Invite accepted friends from your friend list.',403)}return ids;
}
export async function inviteFriends(env,game,user,ids){
 if(user.id!==game.creator_id)fail('Only the host can invite people.',403);if(game.closed_at)fail('Reopen entries before inviting more people.',409);
 if(!Array.isArray(ids)||ids.length>50||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))fail('Choose up to 50 friends.');
 const commands=[],now=Date.now();
 for(const id of new Set(ids)){
  if(id===user.id)continue;const [low,high]=[id,user.id].sort();if(!await env.DB.prepare('SELECT user_low FROM friendships WHERE user_low=? AND user_high=? AND accepted_at IS NOT NULL').bind(low,high).first())fail('Invite accepted friends from your friend list.',403);
  if(await env.DB.prepare('SELECT user_id FROM quiz_invitations WHERE game_id=? AND user_id=?').bind(game.id,id).first())continue;
  commands.push(env.DB.prepare('INSERT INTO quiz_invitations(game_id,user_id,created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING').bind(game.id,id,now));commands.push(env.DB.prepare("INSERT INTO challenge_notifications(id,user_id,game_id,created_at,kind) VALUES (?,?,?,?,'invite') ON CONFLICT(user_id,game_id) DO NOTHING").bind(crypto.randomUUID(),id,game.id,now));
 }
 if(commands.length)await env.DB.batch(commands);
}
export async function shareRoom(env,game,user){
 if(game.creator_id!==user.id)fail('Only the host can share this quiz.',403);
 if(game.group_mode)return game;
 const now=Date.now(),token=game.invite_token||randomToken(),columns='id,game_id,seat,user_id,guest_hash,name,joined_at,completed_at,score,verdict,question_started_at,elapsed_ms,started_at';
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO quiz_participants(${columns},finalized_at) SELECT ${columns},completed_at FROM trivia_players WHERE game_id=?`).bind(game.id),
  env.DB.prepare('INSERT INTO quiz_responses(player_id,position,choice,correct) SELECT a.player_id,a.position,a.choice,a.correct FROM trivia_answers a JOIN trivia_players p ON p.id=a.player_id WHERE p.game_id=?').bind(game.id),
  env.DB.prepare('DELETE FROM trivia_answers WHERE player_id IN (SELECT id FROM trivia_players WHERE game_id=?)').bind(game.id),env.DB.prepare('DELETE FROM trivia_players WHERE game_id=?').bind(game.id),
  env.DB.prepare("UPDATE trivia_games SET group_mode=1,kind='challenge',invite_token=?,completed_at=NULL,invitee_id=NULL WHERE id=?").bind(token,game.id)
 ]);return env.DB.prepare('SELECT * FROM trivia_games WHERE id=?').bind(game.id).first();
}
