import {hash,normalize,localDay,DAY,fail} from './core.mjs';
import {budget} from './ai.mjs';
import {triviaPack} from './trivia.mjs';
import {chooseSubject} from './discoveries.mjs';
import {EMBEDDING_MODEL} from './memory.mjs';
export async function profileKey(user){const p=JSON.parse(user.profile||'{}');return hash(JSON.stringify({topics:p.interests||[],everything:p.includeEverything!==false,choices:4}))}
export async function readyCount(env,user){return (await env.DB.prepare('SELECT COUNT(*) n FROM discovery_queue WHERE user_id=? AND profile_key=? AND consumed_at IS NULL').bind(user.id,await profileKey(user)).first()).n}
export async function nextReady(env,user){
 const row=await env.DB.prepare('UPDATE discovery_queue SET consumed_at=? WHERE user_id=? AND question_id=(SELECT question_id FROM discovery_queue WHERE user_id=? AND profile_key=? AND consumed_at IS NULL ORDER BY created_at,question_id LIMIT 1) AND consumed_at IS NULL RETURNING question_id').bind(Date.now(),user.id,user.id,await profileKey(user)).first();
 if(!row)fail('Your next questions are being prepared. Give them a moment, then try again.',503);return {questionId:row.question_id,readyCount:await readyCount(env,user)};
}
export async function preparedDaily(env,user,day,slot){return env.DB.prepare('SELECT q.* FROM daily_ready r JOIN questions q ON q.id=r.question_id WHERE r.user_id=? AND r.day=? AND r.slot=? AND r.profile_key=?').bind(user.id,day,slot,await profileKey(user)).first()}
export async function prepareReady(env,user){
 env={...env,AI_USAGE_USER_ID:user.id,AI_USAGE_ACTION:'prepared_discoveries',AI_USAGE_OPERATION:crypto.randomUUID()};
 const now=Date.now(),key='prepare:'+user.id,lock=await env.DB.prepare('INSERT INTO locks(key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<? RETURNING key').bind(key,now+600000,now).first();if(!lock)return {readyCount:await readyCount(env,user),preparing:true};
 try{
  const profile=JSON.parse(user.profile||'{}');if(!profile.onboardingComplete)return {readyCount:0};
  const settings=JSON.parse(user.settings),today=localDay(settings.timezone||'Europe/London'),profile_key=await profileKey(user),count=await readyCount(env,user),jobs=[];
  for(let i=count;i<8&&jobs.length<5;i++)jobs.push({kind:'extra'});
  for(let offset=0;offset<=3&&jobs.length<5;offset++){
   const day=new Date(Date.parse(today+'T12:00:00Z')+offset*DAY).toISOString().slice(0,10);
   for(let slot=0;slot<(settings.dailyAmount||1)&&jobs.length<5;slot++){
    const exists=await env.DB.prepare('SELECT question_id FROM daily_assignments WHERE user_id=? AND day=? AND slot=? UNION ALL SELECT question_id FROM daily_ready WHERE user_id=? AND day=? AND slot=? AND profile_key=? LIMIT 1').bind(user.id,day,slot,user.id,day,slot,profile_key).first();if(!exists)jobs.push({kind:'daily',day,slot});
   }
  }
  if(!jobs.length)return {readyCount:count,prepared:0};
  await budget(env,'ready:'+user.id+':'+today,30,now+2*DAY);
  const history=(await env.DB.prepare('SELECT subject FROM daily_assignments WHERE user_id=? UNION ALL SELECT json_extract(q.data,\'$.topic\') subject FROM discovery_queue r JOIN questions q ON q.id=r.question_id WHERE r.user_id=?').bind(user.id,user.id).all()).results;
  const topicPlan=jobs.map(()=>{const selection=chooseSubject(profile.interests||[],profile.includeEverything===true,history);history.push({subject:selection.topic});return selection.topic});
  const pack=await triviaPack(env,user,'General knowledge','medium',jobs.length,4,{topicPlan}),commands=[];
  for(let i=0;i<jobs.length;i++){
   const q=pack.questions[i],id=crypto.randomUUID();commands.push(env.DB.prepare('INSERT INTO questions(id,day,fingerprint,concept,data,created_at) VALUES (?,?,?,?,?,?)').bind(id,(jobs[i].day||today)+':ready:'+id,await hash(normalize(q.q)+':ready:'+id),q.concept,JSON.stringify(q),now+i));commands.push(env.DB.prepare('INSERT INTO question_embeddings(question_id,model,vector) VALUES (?,?,?)').bind(id,EMBEDDING_MODEL,JSON.stringify(pack.vectors[i])));
   const job=jobs[i];commands.push(job.kind==='extra'?env.DB.prepare('INSERT INTO discovery_queue(user_id,question_id,profile_key,created_at) VALUES (?,?,?,?)').bind(user.id,id,profile_key,now+i):env.DB.prepare('INSERT INTO daily_ready(user_id,day,slot,profile_key,question_id,created_at) VALUES (?,?,?,?,?,?)').bind(user.id,job.day,job.slot,profile_key,id,now+i));
  }
  await env.DB.batch(commands);return {readyCount:await readyCount(env,user),prepared:jobs.length};
 }finally{await env.DB.batch([env.DB.prepare('DELETE FROM locks WHERE key=?').bind(key),env.DB.prepare('INSERT INTO discovery_prep_state(user_id,checked_at) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET checked_at=excluded.checked_at').bind(user.id,Date.now())])}
}
