import {fail,normalize} from './core.mjs';
import {dailyQuestion} from './ai.mjs';
import {loadMemory} from './memory.mjs';
import {SUBJECTS} from './profiles.mjs';
export function chooseSubject(interests,includeEverything,history){
 const other=SUBJECTS.filter(topic=>!interests.some(interest=>normalize(interest).includes(normalize(topic))||normalize(topic).includes(normalize(interest))));
 const focused=interests.length>0&&(!includeEverything||history.length%3!==2);
 const pool=focused?interests:other.length?other:SUBJECTS;
 const counts=new Map(pool.map(topic=>[topic,0])),last=new Map(pool.map(topic=>[topic,-1]));
 history.forEach((item,index)=>{if(counts.has(item.subject)){counts.set(item.subject,counts.get(item.subject)+1);last.set(item.subject,index)}});
 const topic=[...pool].sort((a,b)=>counts.get(a)-counts.get(b)||last.get(a)-last.get(b)||pool.indexOf(a)-pool.indexOf(b))[0];
 return {topic,focused};
}
export async function assignedQuestion(env,userId,day,slot){return env.DB.prepare('SELECT q.* FROM daily_assignments a JOIN questions q ON q.id=a.question_id WHERE a.user_id=? AND a.day=? AND a.slot=?').bind(userId,day,slot).first()}
export async function assignDiscovery(env,user,day,slot){
 const existing=await assignedQuestion(env,user.id,day,slot);if(existing)return existing;
 const lockKey=`assign:${user.id}`,now=Date.now();
 const lock=await env.DB.prepare('INSERT INTO locks(key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<? RETURNING key').bind(lockKey,now+300000,now).first();
 if(!lock)fail('Another discovery is being prepared. Try again in a moment.',503);
 try{
  const check=await assignedQuestion(env,user.id,day,slot);if(check)return check;
  const settings=JSON.parse(user.settings),profile=JSON.parse(user.profile||'{}');
  const history=await env.DB.prepare('SELECT subject FROM daily_assignments WHERE user_id=? ORDER BY created_at,day,slot').bind(user.id).all();
  const selection=chooseSubject(profile.interests||[],profile.includeEverything===true,history.results);
  const memory=await loadMemory(env,user.id);
  const row=await dailyQuestion(env,day,profile.interests||[],settings.answerCount||4,profile.includeEverything===true,{userId:user.id,slot,topic:selection.topic,memory});
  await env.DB.prepare('INSERT INTO daily_assignments(user_id,day,slot,question_id,subject,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,day,slot) DO NOTHING').bind(user.id,day,slot,row.id,selection.topic,Date.now()).run();
  return await assignedQuestion(env,user.id,day,slot);
 }finally{await env.DB.prepare('DELETE FROM locks WHERE key=?').bind(lockKey).run()}
}
export async function daySlots(env,userId,day,count){
 const rows=await env.DB.prepare(`SELECT a.slot,a.question_id,a.subject,EXISTS(SELECT 1 FROM attempts t WHERE t.user_id=a.user_id AND t.question_id=a.question_id) AS answered FROM daily_assignments a WHERE a.user_id=? AND a.day=? ORDER BY a.slot`).bind(userId,day).all();
 return Array.from({length:count},(_,slot)=>{const item=rows.results.find(row=>row.slot===slot);return {slot,id:item?.question_id||null,topic:item?.subject||null,answered:!!item?.answered}});
}
