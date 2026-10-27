import {fail,hash,randomToken,DAY,localDay,normalize} from './core.mjs';
import {budget} from './ai.mjs';
import {triviaPack} from './trivia.mjs';
import {approveTopic,displayName} from './profiles.mjs';
import {json} from './auth.mjs';
import {displayQuestion,scoreVerdict,fallbackVerdict} from './quiz.mjs';
import {playerFor,playerTable,answerTable} from './participants.mjs';
import {finishGroup,shareRoom,inviteFriends,validateFriendIds} from './rooms.mjs';
import {EMBEDDING_MODEL} from './memory.mjs';
const cookieName='fk_trivia_guest';
function guestToken(request){const token=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);return /^[a-f0-9]{64}$/.test(token||'')?token:null}

async function gameQuestions(env,id){const rows=await env.DB.prepare('SELECT q.*,g.position FROM trivia_game_questions g JOIN questions q ON q.id=g.question_id WHERE g.game_id=? ORDER BY g.position').bind(id).all();return rows.results.map(row=>({id:row.id,position:row.position,...JSON.parse(row.data)}))}
async function summary(env,game,player=null,origin='',viewerId=null,units='metric'){
 const players=(await env.DB.prepare(`SELECT id,name,seat,user_id,completed_at,score FROM ${playerTable(game)} WHERE game_id=? ORDER BY seat DESC,joined_at`).bind(game.id).all()).results;
 const answered=player?(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${answerTable(game)} WHERE player_id=?`).bind(player.id).first()).n:0;
 const complete=game.group_mode?!!player?.completed_at:!!game.completed_at,host=players.find(p=>p.seat==='host');
 const value={group:!!game.group_mode,roomClosed:!!game.closed_at,isHost:player?.seat==='host',roomComplete:!!game.closed_at&&players.every(p=>p.completed_at),timerSeconds:game.timer_seconds||0,units,id:game.id,kind:game.kind,topic:game.topic,difficulty:game.difficulty,count:game.question_count,createdAt:game.created_at,complete,hostName:host?.name||'A friend',joined:!!player,reserved:!!game.invitee_id,canJoin:(game.group_mode?!game.closed_at:true)&&(!game.invitee_id||game.invitee_id===viewerId)&&game.kind==='challenge'&&!player&&(game.group_mode||!players.some(p=>p.seat==='guest'))&&(!complete||!!game.group_mode),waiting:!game.group_mode&&!!player?.completed_at&&!complete,answered,playerName:player?.name||null,players:players.map(p=>({name:p.name,self:p.id===player?.id,finished:!!p.completed_at,...((complete||!!game.group_mode&&player?.seat==='host')&&player&&p.completed_at?{score:p.score}:{})}))};
 if(!player&&(game.invitee_id===viewerId||game.group_mode&&await env.DB.prepare('SELECT user_id FROM quiz_invitations WHERE game_id=? AND user_id=?').bind(game.id,viewerId||'').first()))value.joinToken=game.invite_token;
 if(player?.seat==='host'&&game.kind==='challenge')value.inviteUrl=origin+'/?challenge='+game.invite_token;
 if(player&&!player.completed_at){if(game.timer_seconds&&!player.question_started_at){await env.DB.prepare(`UPDATE ${playerTable(game)} SET question_started_at=COALESCE(question_started_at,?) WHERE id=?`).bind(Date.now(),player.id).run();player=await playerFor(env,game.id,{id:player.user_id},null)||player;if(!player.user_id)player.question_started_at=(await env.DB.prepare(`SELECT question_started_at FROM ${playerTable(game)} WHERE id=?`).bind(player.id).first()).question_started_at}value.serverNow=Date.now();value.deadline=game.timer_seconds?(player.question_started_at+game.timer_seconds*1000):null;const questions=await gameQuestions(env,game.id),q=questions[answered];if(q)value.question={position:answered,...displayQuestion({q:q.q,options:q.options,format:q.format||'multiple_choice'},units)}}
 if(complete&&player){const questions=await gameQuestions(env,game.id),answers=(await env.DB.prepare(`SELECT position,choice FROM ${answerTable(game)} WHERE player_id=? ORDER BY position`).bind(player.id).all()).results;
  const saved=player.user_id?new Set((await env.DB.prepare('SELECT question_id FROM saved WHERE user_id=?').bind(player.user_id).all()).results.map(row=>row.question_id)):new Set();
  value.verdict=player.verdict||null;value.fallbackVerdict=fallbackVerdict(player.score,game.question_count);
  value.review=questions.map(original=>{const q=displayQuestion(original,units);return ({format:q.format||'multiple_choice',saved:saved.has(q.id),id:q.id,position:q.position,q:q.q,options:q.options,correct:q.correct,explanation:q.explanation,source:q.source,choice:answers.find(a=>a.position===q.position)?.choice})});
  const high=Math.max(...players.map(p=>p.score)),winners=players.filter(p=>p.score===high);value.draw=players.length>1&&winners.length>1;value.winner=value.draw?null:winners[0]?.name;
 }
 return value;
}
async function finishGame(env,game,player){
 if(game.group_mode)return finishGroup(env,game,player);
 const players=(await env.DB.prepare('SELECT * FROM trivia_players WHERE game_id=?').bind(game.id).all()).results;
 if(players.length!==(game.kind==='challenge'?2:1)||players.some(p=>!p.completed_at))return;
 const now=Date.now(),commands=[env.DB.prepare('UPDATE trivia_games SET completed_at=COALESCE(completed_at,?) WHERE id=?').bind(now,game.id)];
 for(const player of players)if(player.user_id){
  if(game.kind==='challenge')commands.push(env.DB.prepare("INSERT INTO challenge_notifications(id,user_id,game_id,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,game_id) DO UPDATE SET kind='result',created_at=excluded.created_at,read_at=NULL WHERE challenge_notifications.kind='invite'").bind(crypto.randomUUID(),player.user_id,game.id,now));
  const answers=(await env.DB.prepare('SELECT a.*,g.question_id FROM trivia_answers a JOIN trivia_game_questions g ON g.game_id=? AND g.position=a.position WHERE a.player_id=?').bind(game.id,player.id).all()).results;
  for(const a of answers)commands.push(env.DB.prepare('INSERT INTO attempts(id,user_id,question_id,choice,typed,correct,created_at) VALUES (?,?,?,?,NULL,?,?) ON CONFLICT(id) DO NOTHING').bind('game:'+game.id+':'+player.id+':'+a.position,player.user_id,a.question_id,a.choice,a.correct,now));
 }
 await env.DB.batch(commands);
}
async function answer(env,game,player,input){
 if(!player)fail('Join this challenge first.',403);
 if(!Number.isInteger(input.position)||input.position<0||input.position>=game.question_count||!Number.isInteger(input.choice))fail('Choose a valid answer.');
 const questions=await gameQuestions(env,game.id),q=questions[input.position];const requestedChoice=input.choice,timedOut=!!game.timer_seconds&&!!player.question_started_at&&Date.now()>=player.question_started_at+game.timer_seconds*1000;if(timedOut)input.choice=-1;if(input.choice<0&&!timedOut||input.choice>=q.options.length)fail('Choose a valid answer.');
 const key='game-answer:'+player.id,lock=await env.DB.prepare('INSERT INTO locks(key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<? RETURNING key').bind(key,Date.now()+30000,Date.now()).first();if(!lock)fail('Your previous answer is still saving.',409);
 try{
  const old=await env.DB.prepare(`SELECT choice FROM ${answerTable(game)} WHERE player_id=? AND position=?`).bind(player.id,input.position).first();
  if(old){if(old.choice!==requestedChoice&&old.choice!==-1)fail('This answer has already been saved.',409);await finishGame(env,game,player);return}
  const count=(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${answerTable(game)} WHERE player_id=?`).bind(player.id).first()).n;
  if(player.completed_at||input.position!==count)fail('Answer the current question first.',409);
  await env.DB.prepare(`INSERT INTO ${answerTable(game)}(player_id,position,choice,correct) VALUES (?,?,?,?)`).bind(player.id,input.position,input.choice,input.choice===q.correct?1:0).run();
  await env.DB.prepare(`UPDATE ${playerTable(game)} SET question_started_at=NULL WHERE id=?`).bind(player.id).run();
  if(count+1===game.question_count){await env.DB.prepare(`UPDATE ${playerTable(game)} SET completed_at=?,score=(SELECT SUM(correct) FROM ${answerTable(game)} WHERE player_id=?) WHERE id=? AND completed_at IS NULL`).bind(Date.now(),player.id,player.id).run();await finishGame(env,game,player)}
 }finally{await env.DB.prepare('DELETE FROM locks WHERE key=?').bind(key).run()}
}
export async function gamesApi(request,env,user,body){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 const invite=path.match(/^\/api\/challenges\/([a-f0-9]{64})(?:\/(join|answer|verdict))?$/);
 if(invite){
  let game=await env.DB.prepare("SELECT * FROM trivia_games WHERE invite_token=? AND kind='challenge'").bind(invite[1]).first();if(!game)fail('This challenge could not be found.',404);
  let token=guestToken(request),player=await playerFor(env,game.id,user,token),headers={};
  if(method==='POST'&&invite[2]==='join'&&!player){
   if(game.group_mode&&game.closed_at||!game.group_mode&&game.completed_at)fail('This quiz is closed to new players.',409);if(game.invitee_id&&game.invitee_id!==user?.id)fail('Sign in to the account invited to this challenge.',403);
   const input=await body(request),name=displayName(input.name||JSON.parse(user?.profile||'{}').name||'Player');
   await budget(env,'challenge-join:'+await hash(request.headers.get('CF-Connecting-IP')||'unknown')+':'+localDay(),200,Date.now()+2*DAY,'Too many quiz joins from this connection today. Please try again tomorrow.');
   if(!user&&!token){token=randomToken();headers['Set-Cookie']=cookieName+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000'}
   if(game.group_mode&&(await env.DB.prepare('SELECT COUNT(*) n FROM quiz_participants WHERE game_id=?').bind(game.id).first()).n>=100)fail('This quiz already has 100 players.',409);
   await env.DB.prepare(`INSERT INTO ${playerTable(game)}(id,game_id,seat,user_id,guest_hash,name,joined_at) VALUES (?,?,'guest',?,?,?,?) ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(),game.id,user?.id||null,user?null:await hash(token),name,Date.now()).run();
   player=await playerFor(env,game.id,user,token);if(!player)fail('Someone has already joined this private challenge.',409);
  }else if(method==='POST'&&invite[2]==='verdict')return json(await verdict(env,game,player));
  else if(method==='POST'&&invite[2]==='answer')await answer(env,game,player,await body(request));
  else if(!(method==='GET'&&!invite[2])&&!(method==='POST'&&invite[2]==='join'&&player))fail('Not found.',404);
  game=await env.DB.prepare('SELECT * FROM trivia_games WHERE id=?').bind(game.id).first();player=await playerFor(env,game.id,user,token);return json({game:await summary(env,game,player,url.origin,user?.id,JSON.parse(user?.settings||'{}').units||'metric')},200,{'Cache-Control':'no-store',...headers});
 }
 if(path.startsWith('/api/challenges/'))fail('This challenge could not be found.',404);
 if(!user)fail('Sign in first.',401);
 if(method==='GET'&&path==='/api/games/quota'){const row=await env.DB.prepare('SELECT count,expires_at FROM budgets WHERE key=?').bind(`completed-games:${user.id}:${localDay()}`).first(),used=row&&row.expires_at>Date.now()?row.count:0;return json({limit:30,used,remaining:Math.max(0,30-used),day:localDay()},200,{'Cache-Control':'no-store'})}
 if(method==='GET'&&path==='/api/notifications'){
  const rows=await env.DB.prepare('SELECT n.id,n.game_id,n.created_at,n.read_at,n.kind,n.message,g.topic FROM challenge_notifications n JOIN trivia_games g ON g.id=n.game_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100').bind(user.id).all();
  return json({notifications:rows.results.map(n=>({id:n.id,gameId:n.game_id,type:n.kind==='invite'?'challenge_invite':'challenge_result',title:n.kind==='invite'?'You have a new challenge':n.kind==='score'?(n.message||'A quiz score is ready'):'Your challenge result is ready',topic:n.topic,createdAt:n.created_at,read:!!n.read_at})),unread:rows.results.filter(n=>!n.read_at).length});
 }
 const read=path.match(/^\/api\/notifications\/([a-f0-9-]{36})\/read$/);if(method==='POST'&&read){await env.DB.prepare('UPDATE challenge_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?').bind(Date.now(),read[1],user.id).run();return json({ok:true})}
 if(method==='GET'&&path==='/api/games'){
  const rows=await env.DB.prepare('SELECT g.* FROM trivia_games g WHERE EXISTS(SELECT 1 FROM trivia_players p WHERE p.game_id=g.id AND p.user_id=?) OR g.invitee_id=? OR EXISTS(SELECT 1 FROM quiz_participants p WHERE p.game_id=g.id AND p.user_id=?) OR EXISTS(SELECT 1 FROM quiz_invitations i WHERE i.game_id=g.id AND i.user_id=?) ORDER BY g.created_at DESC LIMIT 60').bind(user.id,user.id,user.id,user.id).all(),games=[];
  for(const game of rows.results)games.push(await summary(env,game,await playerFor(env,game.id,user,null),url.origin,user?.id,JSON.parse(user?.settings||'{}').units||'metric'));return json({games});
 }
 if(method==='POST'&&path==='/api/games'){
  const input=await body(request);if(!['solo','challenge'].includes(input.kind)||!['easy','medium','hard'].includes(input.difficulty)||!Number.isInteger(input.count)||input.count<1||input.count>20||(input.kind==='challenge'&&input.count<2)||! /^[a-f0-9-]{36}$/.test(input.requestId||''))fail('Choose a topic, difficulty and quiz length.');
  const previous=await env.DB.prepare('SELECT * FROM trivia_games WHERE creator_id=? AND request_id=?').bind(user.id,input.requestId).first();if(previous)return json({game:await summary(env,previous,await playerFor(env,previous.id,user,null),url.origin,user?.id,JSON.parse(user?.settings||'{}').units||'metric')});
  const lockKey='create-game:'+user.id,lock=await env.DB.prepare('INSERT INTO locks(key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<? RETURNING key').bind(lockKey,Date.now()+600000,Date.now()).first();if(!lock)fail('Your previous quiz is still being prepared.',409);
  const quotaKey=`completed-games:${user.id}:${localDay()}`;let reserved=false,created=false;
  try{
   const topic=(await approveTopic(env,user,input.topic)).topic;
   let invitee=null;if(input.friendId!==undefined){if(input.kind!=='challenge'||typeof input.friendId!=='string')fail('Choose a friend for this challenge.');const [low,high]=[user.id,input.friendId].sort();const friend=await env.DB.prepare('SELECT user_low FROM friendships WHERE user_low=? AND user_high=? AND accepted_at IS NOT NULL').bind(low,high).first();if(!friend)fail('Add and accept this friend first.',403);invitee=input.friendId}
   const friendIds=input.friendIds|| (invitee?[invitee]:[]);await validateFriendIds(env,user,friendIds);const group=input.kind==='challenge';
   await budget(env,`quiz-preparation:${user.id}:${Math.floor(Date.now()/3600000)}`,30,Date.now()+2*3600000,'You’ve started 30 quiz preparations this hour. Please try again next hour.');
   await budget(env,quotaKey,30,Date.now()+2*DAY,'Uh oh, you’re out of quizzes for today. Come again tomorrow! You can still play and share existing quizzes.');reserved=true;
   const count=input.count,answerCount=JSON.parse(user.settings).answerCount||4,{questions,vectors}=await triviaPack(env,user,topic,input.difficulty,count,answerCount),id=crypto.randomUUID(),now=Date.now(),token=input.kind==='challenge'?randomToken():null;
   const commands=[env.DB.prepare('INSERT INTO trivia_games(id,creator_id,request_id,kind,invite_token,topic,difficulty,question_count,created_at,invitee_id,group_mode,timer_seconds) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,user.id,input.requestId,input.kind,token,topic,input.difficulty,count,now,null,group?1:0,JSON.parse(user.settings).timerSeconds||0),env.DB.prepare(`INSERT INTO ${group?'quiz_participants':'trivia_players'}(id,game_id,seat,user_id,name,joined_at) VALUES (?,?,'host',?,?,?)`).bind(crypto.randomUUID(),id,user.id,JSON.parse(user.profile||'{}').name||'You',now)];
   for(let index=0;index<questions.length;index++){
    const q=questions[index],fingerprint=await hash(normalize(q.q)+':game:'+id),qid=crypto.randomUUID();
    commands.push(env.DB.prepare('INSERT INTO questions(id,day,fingerprint,concept,data,created_at) VALUES (?,?,?,?,?,?)').bind(qid,localDay()+':game:'+id+':'+index,fingerprint,q.concept,JSON.stringify(q),now));commands.push(env.DB.prepare('INSERT INTO question_embeddings(question_id,model,vector) VALUES (?,?,?)').bind(qid,EMBEDDING_MODEL,JSON.stringify(vectors[index])));
    commands.push(env.DB.prepare('INSERT INTO trivia_game_questions(game_id,position,question_id) VALUES (?,?,?)').bind(id,index,qid));
   }
   await env.DB.batch(commands);created=true;const game=await env.DB.prepare('SELECT * FROM trivia_games WHERE id=?').bind(id).first();if(group&&friendIds.length)await inviteFriends(env,game,user,friendIds);return json({game:await summary(env,game,await playerFor(env,id,user,null),url.origin,user?.id,JSON.parse(user?.settings||'{}').units||'metric')});
  }finally{try{if(reserved&&!created)await env.DB.prepare('UPDATE budgets SET count=MAX(0,count-1) WHERE key=?').bind(quotaKey).run()}finally{await env.DB.prepare('DELETE FROM locks WHERE key=?').bind(lockKey).run()}}
 }
 const match=path.match(/^\/api\/games\/([a-f0-9-]{36})(?:\/(answer|verdict|share|invite|close|reopen))?$/);if(match){
  let game=await env.DB.prepare('SELECT * FROM trivia_games WHERE id=?').bind(match[1]).first();if(!game)fail('Quiz not found.',404);let player=await playerFor(env,game.id,user,null);if(!player&&game.invitee_id!==user.id&&!await env.DB.prepare('SELECT user_id FROM quiz_invitations WHERE game_id=? AND user_id=?').bind(game.id,user.id).first())fail('This is a private game.',403);
  if(method==='POST'&&['share','invite','close','reopen'].includes(match[2])){if(game.creator_id!==user.id)fail('Only the host can manage invitations.',403);if(match[2]==='share')game=await shareRoom(env,game,user);if(match[2]==='invite'){if(!game.group_mode)game=await shareRoom(env,game,user);await inviteFriends(env,game,user,(await body(request)).friendIds)}if(match[2]==='reopen'){await env.DB.prepare('UPDATE trivia_games SET closed_at=NULL WHERE id=?').bind(game.id).run();game=await env.DB.prepare('SELECT * FROM trivia_games WHERE id=?').bind(game.id).first()}if(match[2]==='close'){await env.DB.prepare('UPDATE trivia_games SET closed_at=COALESCE(closed_at,?) WHERE id=?').bind(Date.now(),game.id).run();game=await env.DB.prepare('SELECT * FROM trivia_games WHERE id=?').bind(game.id).first()}player=await playerFor(env,game.id,user,null);return json({game:await summary(env,game,player,url.origin,user.id,JSON.parse(user.settings).units||'metric')})}
  if(method==='POST'&&match[2]==='verdict')return json(await verdict(env,game,player));
  if(method==='POST'&&match[2]==='answer')await answer(env,game,player,await body(request));else if(!(method==='GET'&&!match[2]))fail('Not found.',404);
  game=await env.DB.prepare('SELECT * FROM trivia_games WHERE id=?').bind(game.id).first();player=await playerFor(env,game.id,user,null);return json({game:await summary(env,game,player,url.origin,user?.id,JSON.parse(user?.settings||'{}').units||'metric')});
 }
 fail('Not found.',404);
}

async function verdict(env,game,player){
 if(!player||!(game.group_mode?player.completed_at:game.completed_at))fail('Finish the quiz before revealing the verdict.',403);
 if(!player.user_id)return {verdict:fallbackVerdict(player.score,game.question_count)};
 if(player.verdict)return {verdict:player.verdict};
 const key='verdict:'+player.id,now=Date.now();const lock=await env.DB.prepare('INSERT INTO locks(key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<? RETURNING key').bind(key,now+65000,now).first();if(!lock)return {verdict:fallbackVerdict(player.score,game.question_count)};
 try{const line=await scoreVerdict(env,player.score,game.question_count,game.topic);await env.DB.prepare(`UPDATE ${playerTable(game)} SET verdict=COALESCE(verdict,?) WHERE id=?`).bind(line,player.id).run();return {verdict:line}}finally{await env.DB.prepare('DELETE FROM locks WHERE key=?').bind(key).run()}
}
