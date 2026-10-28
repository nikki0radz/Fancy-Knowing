import {notice} from './admin.mjs';
import {fail,passwordHash,equal,DAY,localDay} from './core.mjs';
import {budget} from './ai.mjs';
import {json,sessionCookie} from './auth.mjs';
import {isAdmin} from './allowances.mjs';
export async function accountApi(request,env,user,body){
 const path=new URL(request.url).pathname,method=request.method;
 if(path==='/api/account/walkthrough'&&method==='PUT'){
  const {step}=await body(request);
  if(!['welcome','question','deeper','profile','friends','done'].includes(step))fail('Choose a valid guide step.');
  await env.DB.prepare('UPDATE users SET walkthrough=? WHERE id=?').bind(step,user.id).run();return json({step});
 }
 if(path==='/api/topic-suggestions'){
  if(method==='POST'){
   const input=await body(request),topic=typeof input.topic==='string'?input.topic.trim():'',note=typeof input.note==='string'?input.note.trim():'';
   if(topic.length<2||topic.length>120||!/[\p{L}\p{N}]/u.test(topic)||note.length>500)fail('Add a topic (2–120 characters) and an optional short note.');
   if(typeof input.id!=='string'||! /^[a-f0-9-]{36}$/.test(input.id))fail('Please reopen the suggestion box.');
   const previous=await env.DB.prepare('SELECT user_id FROM topic_suggestions WHERE id=?').bind(input.id).first();
   if(previous){if(previous.user_id!==user.id)fail('Please reopen the suggestion box.',409);return json({ok:true})}
   await budget(env,`topic-suggestions:${user.id}:${localDay()}`,10,Date.now()+2*DAY,'Your suggestion box is full for today. Try again tomorrow.');
   const name=JSON.parse(user.profile||'{}').name||user.friend_username||'A curious person',now=Date.now(),commands=[env.DB.prepare('INSERT INTO topic_suggestions(id,user_id,topic,note,created_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING').bind(input.id,user.id,topic,note,now)];
   if(note)commands.push(env.DB.prepare("INSERT INTO request_messages(id,owner_id,kind,request_id,sender_id,sender_name,text,created_at) VALUES (?,?,'topic',?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(input.id,user.id,input.id,user.id,name,note,now));
   if(env.ADMIN_USER_ID)commands.push(notice(env,env.ADMIN_USER_ID,'admin_request',name+' suggested a topic: '+topic,note||'A new idea for the question bank.','topic',input.id,'topic:'+input.id));
   await env.DB.batch(commands);return json({ok:true});
  }
  if(!isAdmin(env,user))fail('Only the app administrator can read suggestions.',403);
  if(method==='GET')return json({suggestions:(await env.DB.prepare("SELECT s.*,COALESCE(json_extract(u.profile,'$.name'),u.friend_username) name FROM topic_suggestions s LEFT JOIN users u ON u.id=s.user_id ORDER BY s.status,s.created_at DESC LIMIT 200").all()).results});
  if(method==='PUT'){const {id}=await body(request);if(typeof id!=='string')fail('Choose a suggestion.');await env.DB.prepare("UPDATE topic_suggestions SET status='reviewed' WHERE id=?").bind(id).run();return json({ok:true})}
 }
 if(path==='/api/account'&&method==='DELETE'){
  const input=await body(request);
  if(input.confirm!=='DELETE')fail('Confirm account deletion.');
  await budget(env,`account-delete:${user.id}`,5,Date.now()+DAY,'Too many attempts. Please try again later.');
  if(typeof input.password!=='string'||input.password.length>1024||!equal(await passwordHash(input.password,user.salt),user.password_hash))fail('Your password is incorrect.',403);
  // One atomic batch: remove child records before their non-cascading parents.
  const games='SELECT id FROM trivia_games WHERE creator_id=?',commands=[];
  const add=(sql,...values)=>commands.push(env.DB.prepare(sql).bind(...values));
  add(`DELETE FROM trivia_answers WHERE player_id IN (SELECT id FROM trivia_players WHERE user_id=? OR game_id IN (${games}))`,user.id,user.id);
  add(`DELETE FROM quiz_responses WHERE player_id IN (SELECT id FROM quiz_participants WHERE user_id=? OR game_id IN (${games}))`,user.id,user.id);
  for(const table of ['quiz_comments','quiz_reactions'])add(`DELETE FROM ${table} WHERE author_key=? OR game_id IN (${games})`,user.id,user.id);
  for(const table of ['challenge_notifications','quiz_invitations','trivia_players','quiz_participants'])add(`DELETE FROM ${table} WHERE user_id=? OR game_id IN (${games})`,user.id,user.id);
  add(`DELETE FROM shared_questions WHERE question_id IN (SELECT question_id FROM trivia_game_questions WHERE game_id IN (${games}) AND json_extract((SELECT data FROM questions WHERE id=question_id),'$.origin')='manual')`,user.id);
  add(`DELETE FROM trivia_game_questions WHERE game_id IN (${games})`,user.id);
  add('UPDATE trivia_games SET invitee_id=NULL WHERE invitee_id=?',user.id);
  add('DELETE FROM quiz_jobs WHERE user_id=?',user.id);
  add('DELETE FROM trivia_games WHERE creator_id=?',user.id);
  add('DELETE FROM friendships WHERE user_low=? OR user_high=?',user.id,user.id);
  add('UPDATE request_messages SET sender_id=NULL,sender_name=? WHERE sender_id=?', 'Deleted account',user.id);
  for(const table of ['friend_username_aliases','discovery_queue','daily_ready','discovery_prep_state'])add(`DELETE FROM ${table} WHERE user_id=?`,user.id);
  add('DELETE FROM quiz_requests WHERE user_id=?',user.id);
  add('UPDATE quiz_requests SET reviewed_by=NULL WHERE reviewed_by=?',user.id);
  add('DELETE FROM quiz_grants WHERE user_id=? OR granted_by=?',user.id,user.id);
  add('DELETE FROM ai_usage WHERE user_id=?',user.id);
  // Cascades remove sessions, tokens, personal history, chats, mail and push data.
  add('DELETE FROM users WHERE id=?',user.id);
  await env.DB.batch(commands);
  return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});
 }
 fail('Not found.',404);
}
