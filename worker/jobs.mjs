import {validateFriendIds} from './rooms.mjs';
import {fail,DAY,localDay,validateSettings} from './core.mjs';
import {json} from './auth.mjs';
import {gamesApi,quizAllowance} from './games.mjs';
import {bankPack} from './bank.mjs';
import {loadMemory} from './memory.mjs';
import {approveTopic} from './profiles.mjs';
import {randomInt} from './quiz.mjs';
export async function expireQuizJobs(env,userId=null){
 const rows=(await env.DB.prepare("SELECT id,user_id,state FROM quiz_jobs WHERE status='preparing' AND updated_at<?"+(userId?' AND user_id=?':'')).bind(Date.now()-30*60000,...(userId?[userId]:[])).all()).results;
 for(const row of rows){const state=JSON.parse(row.state),commands=[];if(state.quotaReserved)commands.push(env.DB.prepare("UPDATE budgets SET count=MAX(0,count-1) WHERE key=? AND EXISTS(SELECT 1 FROM quiz_jobs WHERE id=? AND status='preparing')").bind(state.quotaKey,row.id));commands.push(env.DB.prepare("UPDATE quiz_jobs SET status='failed',error=?,updated_at=? WHERE id=? AND status='preparing'").bind('This preparation expired. Start a fresh quiz; its reserved credit has been returned.',Date.now(),row.id));await env.DB.batch(commands)}
 await env.DB.prepare("DELETE FROM quiz_jobs WHERE status<>'preparing' AND updated_at<?").bind(Date.now()-DAY).run();
}
function status(row){const state=JSON.parse(row.state);return {job:{id:row.id,status:row.status,setup:JSON.parse(row.input),label:state.label||'Getting your quiz ready…',completedCalls:state.completedCalls||0,error:row.error||null}}}
export async function quizJobsApi(request,env,user,body){
 const path=new URL(request.url).pathname;await expireQuizJobs(env,user.id);
 if(path==='/api/quiz-jobs'&&request.method==='POST'){
  const input=await body(request,100000);
  if(!['solo','challenge'].includes(input.kind)||!['easy','medium','hard'].includes(input.difficulty)||!Number.isInteger(input.count)||input.count<1||input.count>20||typeof input.topic!=='string'||!input.topic.trim()||input.topic.length>120||!/^[a-f0-9-]{36}$/.test(input.requestId||''))fail('Choose a topic, difficulty and quiz length.');
  await validateFriendIds(env,user,input.friendIds||[]);validateSettings({timerSeconds:input.timerSeconds??0});if(input.kind==='challenge'&&input.questions===undefined&&input.count<2)fail('Choose at least two questions for a challenge.');
  const previous=await env.DB.prepare('SELECT id FROM trivia_games WHERE creator_id=? AND request_id=?').bind(user.id,input.requestId).first();
  if(input.questions!==undefined||previous||await bankPack(env,user,input.topic,input.difficulty,input.count))return gamesApi(new Request(new URL('/api/games',request.url),{method:'POST'}),env,user,async()=>input);
  const active=await env.DB.prepare("SELECT * FROM quiz_jobs WHERE user_id=? AND status='preparing'").bind(user.id).first();if(active)return json(status(active));
  const allowance=await quizAllowance(env,user);if(allowance.limited&&allowance.remaining===0)fail('You’re out of AI quiz credits for today. Ask Nicole for more, or try a question-bank subject.',429);
  const old=await env.DB.prepare('SELECT * FROM quiz_jobs WHERE user_id=? AND request_id=?').bind(user.id,input.requestId).first();if(old)return json(status(old));
  const plan=Array.from({length:input.count},(_,i)=>input.count===1?(randomInt(5)===0?'true_false':'multiple_choice'):i%5===1?'true_false':'multiple_choice');for(let i=plan.length-1;i>0;i--){const j=randomInt(i+1);[plan[i],plan[j]]=[plan[j],plan[i]]}
  const id=crypto.randomUUID(),now=Date.now(),state={plan,day:localDay(),label:'Checking your quiz setup…'};
  await env.DB.prepare("INSERT INTO quiz_jobs(id,user_id,request_id,input,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING").bind(id,user.id,input.requestId,JSON.stringify(input),JSON.stringify(state),now,now).run();
  return json(status(await env.DB.prepare("SELECT * FROM quiz_jobs WHERE user_id=? AND status='preparing'").bind(user.id).first()));
 }
 const match=path.match(/^\/api\/quiz-jobs\/([a-f0-9-]{36})(?:\/(advance))?$/);if(!match)fail('Quiz preparation not found.',404);
 let row=await env.DB.prepare('SELECT * FROM quiz_jobs WHERE id=? AND user_id=?').bind(match[1],user.id).first();if(!row)fail('Quiz preparation not found.',404);
 if(row.status==='ready'){const response=await gamesApi(new Request(new URL('/api/games/'+row.game_id,request.url)),env,user,body);return response}
 if(request.method==='GET'&&!match[2]||row.status==='failed')return json(status(row));
 if(request.method!=='POST'||match[2]!=='advance')fail('Not found.',404);
 const lockKey='quiz-job:'+row.id,now=Date.now(),lock=await env.DB.prepare('INSERT INTO locks(key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<? RETURNING key').bind(lockKey,now+120000,now).first();if(!lock)return json({...status(row),busy:true});
 const cachedCalls=(await env.DB.prepare('SELECT position,kind,request_hash,data FROM quiz_job_calls WHERE job_id=?').bind(row.id).all()).results;
 const state=JSON.parse(row.state),job={id:row.id,state,callIndex:0,paused:false,calls:new Map(cachedCalls.map(c=>[c.position,c]))},aiEnv={...env,AI_JOB:job,AI_USAGE_USER_ID:user.id,AI_USAGE_ACTION:'quiz',AI_USAGE_OPERATION:row.request_id};
 try{
  const input=JSON.parse(row.input);if(state.day!==localDay())fail('A new daily allowance has started. Start a fresh quiz; your earlier reserved credit has been returned.',409);
  if(!state.memoryReady){
   try{const records=await loadMemory({...aiEnv,AI_JOB:null,AI_MEMORY_WARM_ONCE:true},user.id);state.memoryIds=records.map(q=>q.id);state.memoryReady=true;state.label='Question history checked. Checking your topic…'}catch(e){if(!e.quizMemoryWarmed)throw e;state.label='Checking your earlier questions…'}
   await env.DB.prepare('UPDATE quiz_jobs SET state=?,updated_at=? WHERE id=?').bind(JSON.stringify(state),Date.now(),row.id).run();return json(status({...row,state:JSON.stringify(state)}));
  }
  if(!state.topicApproved){input.topic=(await approveTopic({...aiEnv,AI_JOB:null},user,input.topic)).topic;state.topicApproved=true;state.label='Topic checked. Finding fresh facts…';await env.DB.prepare('UPDATE quiz_jobs SET input=?,state=?,updated_at=? WHERE id=?').bind(JSON.stringify(input),JSON.stringify(state),Date.now(),row.id).run();return json(status({...row,state:JSON.stringify(state)}))}
  const result=await gamesApi(new Request(new URL('/api/games',request.url),{method:'POST'}),aiEnv,user,async()=>input),data=await result.json();
  await env.DB.prepare("UPDATE quiz_jobs SET status='ready',game_id=?,state=?,updated_at=? WHERE id=?").bind(data.game.id,JSON.stringify(state),Date.now(),row.id).run();await env.DB.prepare('DELETE FROM quiz_job_calls WHERE job_id=?').bind(row.id).run();return json(data);
 }catch(e){
  if(e.quizPaused)return json(status({...row,state:JSON.stringify(state)}));
  const commands=[];if(state.quotaReserved)commands.push(env.DB.prepare('UPDATE budgets SET count=MAX(0,count-1) WHERE key=?').bind(state.quotaKey));state.quotaReserved=false;
  const message=e.status?e.message:'Quiz preparation stopped unexpectedly. Your reserved credit has been returned. Please try again.';
  commands.push(env.DB.prepare("UPDATE quiz_jobs SET status='failed',state=?,error=?,updated_at=? WHERE id=?").bind(JSON.stringify(state),message,Date.now(),row.id));await env.DB.batch(commands);if(!e.status)console.error('Quiz job failed',{id:row.id,error:String(e.message).slice(0,300)});return json(status({...row,status:'failed',state:JSON.stringify(state),error:message}));
 }finally{await env.DB.prepare('DELETE FROM locks WHERE key=?').bind(lockKey).run()}
}
