import {fail,hash,randomToken,DAY,localDay,normalize} from './core.mjs';
import {budget} from './ai.mjs';
import {triviaPack} from './trivia.mjs';
import {approveTopic,displayName} from './profiles.mjs';
import {json} from './auth.mjs';
import {EMBEDDING_MODEL} from './memory.mjs';
const cookieName='fk_trivia_guest';
function guestToken(request){const token=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);return /^[a-f0-9]{64}$/.test(token||'')?token:null}
async function playerFor(env,gameId,user,token){const guest=token?await hash(token):'';return env.DB.prepare('SELECT * FROM trivia_players WHERE game_id=? AND (user_id=? OR guest_hash=?)').bind(gameId,user?.id||'',guest).first()}
async function gameQuestions(env,id){const rows=await env.DB.prepare('SELECT q.*,g.position FROM trivia_game_questions g JOIN questions q ON q.id=g.question_id WHERE g.game_id=? ORDER BY g.position').bind(id).all();return rows.results.map(row=>({id:row.id,position:row.position,...JSON.parse(row.data)}))}
async function summary(env,game,player=null,origin=''){
 const players=(await env.DB.prepare('SELECT id,name,seat,user_id,completed_at,score FROM trivia_players WHERE game_id=? ORDER BY seat DESC').bind(game.id).all()).results;
 const answered=player?(await env.DB.prepare('SELECT COUNT(*) AS n FROM trivia_answers WHERE player_id=?').bind(player.id).first()).n:0;
 const complete=!!game.completed_at,host=players.find(p=>p.seat==='host');
 const value={id:game.id,kind:game.kind,topic:game.topic,difficulty:game.difficulty,count:game.question_count,createdAt:game.created_at,complete,hostName:host?.name||'A friend',joined:!!player,canJoin:game.kind==='challenge'&&!player&&!players.some(p=>p.seat==='guest')&&!complete,waiting:!!player?.completed_at&&!complete,answered,playerName:player?.name||null,players:players.map(p=>({name:p.name,self:p.id===player?.id,finished:!!p.completed_at,...(complete&&player?{score:p.score}:{})}))};
 if(player?.seat==='host'&&game.kind==='challenge')value.inviteUrl=origin+'/?challenge='+game.invite_token;
 if(player&&!player.completed_at){const questions=await gameQuestions(env,game.id),q=questions[answered];if(q)value.question={position:answered,q:q.q,options:q.options}}
 if(complete&&player){const questions=await gameQuestions(env,game.id),answers=(await env.DB.prepare('SELECT position,choice FROM trivia_answers WHERE player_id=? ORDER BY position').bind(player.id).all()).results;
  value.review=questions.map(q=>({id:q.id,position:q.position,q:q.q,options:q.options,correct:q.correct,explanation:q.explanation,source:q.source,choice:answers.find(a=>a.position===q.position)?.choice}));
  const high=Math.max(...players.map(p=>p.score)),winners=players.filter(p=>p.score===high);value.draw=players.length>1&&winners.length>1;value.winner=value.draw?null:winners[0]?.name;
 }
 return value;
}
async function finishGame(env,game){
 const players=(await env.DB.prepare('SELECT * FROM trivia_players WHERE game_id=?').bind(game.id).all()).results;
 if(players.length!==(game.kind==='challenge'?2:1)||players.some(p=>!p.completed_at))return;
 const now=Date.now(),commands=[env.DB.prepare('UPDATE trivia_games SET completed_at=COALESCE(completed_at,?) WHERE id=?').bind(now,game.id)];
 for(const player of players)if(player.user_id){
  if(game.kind==='challenge')commands.push(env.DB.prepare('INSERT INTO challenge_notifications(id,user_id,game_id,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,game_id) DO NOTHING').bind(crypto.randomUUID(),player.user_id,game.id,now));
  const answers=(await env.DB.prepare('SELECT a.*,g.question_id FROM trivia_answers a JOIN trivia_game_questions g ON g.game_id=? AND g.position=a.position WHERE a.player_id=?').bind(game.id,player.id).all()).results;
  for(const a of answers)commands.push(env.DB.prepare('INSERT INTO attempts(id,user_id,question_id,choice,typed,correct,created_at) VALUES (?,?,?,?,NULL,?,?) ON CONFLICT(id) DO NOTHING').bind('game:'+game.id+':'+player.id+':'+a.position,player.user_id,a.question_id,a.choice,a.correct,now));
 }
 await env.DB.batch(commands);
}
async function answer(env,game,player,input){
 if(!player)fail('Join this challenge first.',403);
 if(!Number.isInteger(input.position)||input.position<0||input.position>=game.question_count||!Number.isInteger(input.choice))fail('Choose a valid answer.');
 const questions=await gameQuestions(env,game.id),q=questions[input.position];if(input.choice<0||input.choice>=q.options.length)fail('Choose a valid answer.');
 const key='game-answer:'+player.id,lock=await env.DB.prepare('INSERT INTO locks(key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<? RETURNING key').bind(key,Date.now()+30000,Date.now()).first();if(!lock)fail('Your previous answer is still saving.',409);
 try{
  const old=await env.DB.prepare('SELECT choice FROM trivia_answers WHERE player_id=? AND position=?').bind(player.id,input.position).first();
  if(old){if(old.choice!==input.choice)fail('This answer has already been saved.',409);await finishGame(env,game);return}
  const count=(await env.DB.prepare('SELECT COUNT(*) AS n FROM trivia_answers WHERE player_id=?').bind(player.id).first()).n;
  if(player.completed_at||input.position!==count)fail('Answer the current question first.',409);
  await env.DB.prepare('INSERT INTO trivia_answers(player_id,position,choice,correct) VALUES (?,?,?,?)').bind(player.id,input.position,input.choice,input.choice===q.correct?1:0).run();
  if(count+1===game.question_count){await env.DB.prepare('UPDATE trivia_players SET completed_at=?,score=(SELECT SUM(correct) FROM trivia_answers WHERE player_id=?) WHERE id=? AND completed_at IS NULL').bind(Date.now(),player.id,player.id).run();await finishGame(env,game)}
 }finally{await env.DB.prepare('DELETE FROM locks WHERE key=?').bind(key).run()}
}
export async function gamesApi(request,env,user,body){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 const invite=path.match(/^\/api\/challenges\/([a-f0-9]{64})(?:\/(join|answer))?$/);
 if(invite){
  let game=await env.DB.prepare("SELECT * FROM trivia_games WHERE invite_token=? AND kind='challenge'").bind(invite[1]).first();if(!game)fail('This challenge could not be found.',404);
  let token=guestToken(request),player=await playerFor(env,game.id,user,token),headers={};
  if(method==='POST'&&invite[2]==='join'&&!player){
   if(game.completed_at)fail('This challenge has already finished.',409);
   const input=await body(request),name=displayName(input.name||JSON.parse(user?.profile||'{}').name||'Player');
   await budget(env,'challenge-join:'+await hash(request.headers.get('CF-Connecting-IP')||'unknown'),60,Date.now()+DAY);
   if(!user&&!token){token=randomToken();headers['Set-Cookie']=cookieName+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000'}
   await env.DB.prepare("INSERT INTO trivia_players(id,game_id,seat,user_id,guest_hash,name,joined_at) VALUES (?,?,'guest',?,?,?,?) ON CONFLICT(game_id,seat) DO NOTHING").bind(crypto.randomUUID(),game.id,user?.id||null,user?null:await hash(token),name,Date.now()).run();
   player=await playerFor(env,game.id,user,token);if(!player)fail('Someone has already joined this private challenge.',409);
  }else if(method==='POST'&&invite[2]==='answer')await answer(env,game,player,await body(request));
  else if(!(method==='GET'&&!invite[2])&&!(method==='POST'&&invite[2]==='join'&&player))fail('Not found.',404);
  game=await env.DB.prepare('SELECT * FROM trivia_games WHERE id=?').bind(game.id).first();player=await playerFor(env,game.id,user,token);return json({game:await summary(env,game,player,url.origin)},200,{'Cache-Control':'no-store',...headers});
 }
 if(path.startsWith('/api/challenges/'))fail('This challenge could not be found.',404);
 if(!user)fail('Sign in first.',401);
 if(method==='GET'&&path==='/api/notifications'){
  const rows=await env.DB.prepare('SELECT n.id,n.game_id,n.created_at,n.read_at,g.topic FROM challenge_notifications n JOIN trivia_games g ON g.id=n.game_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100').bind(user.id).all();
  return json({notifications:rows.results.map(n=>({id:n.id,gameId:n.game_id,title:'Your challenge result is ready',topic:n.topic,createdAt:n.created_at,read:!!n.read_at})),unread:rows.results.filter(n=>!n.read_at).length});
 }
 const read=path.match(/^\/api\/notifications\/([a-f0-9-]{36})\/read$/);if(method==='POST'&&read){await env.DB.prepare('UPDATE challenge_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?').bind(Date.now(),read[1],user.id).run();return json({ok:true})}
 if(method==='GET'&&path==='/api/games'){
  const rows=await env.DB.prepare('SELECT g.* FROM trivia_games g WHERE EXISTS(SELECT 1 FROM trivia_players p WHERE p.game_id=g.id AND p.user_id=?) ORDER BY g.created_at DESC LIMIT 60').bind(user.id).all(),games=[];
  for(const game of rows.results)games.push(await summary(env,game,await playerFor(env,game.id,user,null),url.origin));return json({games});
 }
 if(method==='POST'&&path==='/api/games'){
  const input=await body(request);if(!['solo','challenge'].includes(input.kind)||!['easy','medium','hard'].includes(input.difficulty)||![1,5,10].includes(input.count)||(input.kind==='challenge'&&input.count===1)||! /^[a-f0-9-]{36}$/.test(input.requestId||''))fail('Choose a topic, difficulty and quiz length.');
  const previous=await env.DB.prepare('SELECT * FROM trivia_games WHERE creator_id=? AND request_id=?').bind(user.id,input.requestId).first();if(previous)return json({game:await summary(env,previous,await playerFor(env,previous.id,user,null),url.origin)});
  await budget(env,`games:${user.id}:${localDay()}`,12,Date.now()+2*DAY);
  const lockKey='create-game:'+user.id,lock=await env.DB.prepare('INSERT INTO locks(key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<? RETURNING key').bind(lockKey,Date.now()+240000,Date.now()).first();if(!lock)fail('Your previous quiz is still being prepared.',409);
  try{
   const topic=input.topic==='Mixed topics'?'Mixed topics':(await approveTopic(env,user,input.topic)).topic;
   const count=input.count,answerCount=JSON.parse(user.settings).answerCount||4,{questions,vectors}=await triviaPack(env,user,topic,input.difficulty,count,answerCount),id=crypto.randomUUID(),now=Date.now(),token=input.kind==='challenge'?randomToken():null;
   const commands=[env.DB.prepare('INSERT INTO trivia_games(id,creator_id,request_id,kind,invite_token,topic,difficulty,question_count,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,user.id,input.requestId,input.kind,token,topic,input.difficulty,count,now),env.DB.prepare("INSERT INTO trivia_players(id,game_id,seat,user_id,name,joined_at) VALUES (?,?,'host',?,?,?)").bind(crypto.randomUUID(),id,user.id,JSON.parse(user.profile||'{}').name||'You',now)];
   for(let index=0;index<questions.length;index++){
    const q=questions[index],fingerprint=await hash(normalize(q.q)),existing=await env.DB.prepare('SELECT id FROM questions WHERE fingerprint=?').bind(fingerprint).first(),qid=existing?.id||crypto.randomUUID();
    if(!existing){commands.push(env.DB.prepare('INSERT INTO questions(id,day,fingerprint,concept,data,created_at) VALUES (?,?,?,?,?,?)').bind(qid,localDay()+':game:'+id+':'+index,fingerprint,q.concept,JSON.stringify(q),now));commands.push(env.DB.prepare('INSERT INTO question_embeddings(question_id,model,vector) VALUES (?,?,?)').bind(qid,EMBEDDING_MODEL,JSON.stringify(vectors[index])))}
    commands.push(env.DB.prepare('INSERT INTO trivia_game_questions(game_id,position,question_id) VALUES (?,?,?)').bind(id,index,qid));
   }
   await env.DB.batch(commands);const game=await env.DB.prepare('SELECT * FROM trivia_games WHERE id=?').bind(id).first();return json({game:await summary(env,game,await playerFor(env,id,user,null),url.origin)});
  }finally{await env.DB.prepare('DELETE FROM locks WHERE key=?').bind(lockKey).run()}
 }
 const match=path.match(/^\/api\/games\/([a-f0-9-]{36})(?:\/(answer))?$/);if(match){
  let game=await env.DB.prepare('SELECT * FROM trivia_games WHERE id=?').bind(match[1]).first();if(!game)fail('Quiz not found.',404);let player=await playerFor(env,game.id,user,null);if(!player)fail('This is a private game.',403);
  if(method==='POST'&&match[2]==='answer')await answer(env,game,player,await body(request));else if(!(method==='GET'&&!match[2]))fail('Not found.',404);
  game=await env.DB.prepare('SELECT * FROM trivia_games WHERE id=?').bind(game.id).first();player=await playerFor(env,game.id,user,null);return json({game:await summary(env,game,player,url.origin)});
 }
 fail('Not found.',404);
}
