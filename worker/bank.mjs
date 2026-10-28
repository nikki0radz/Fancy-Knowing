import {fail,normalize,hash} from './core.mjs';
import {json} from './auth.mjs';
import {isAdmin} from './allowances.mjs';
export async function bankSubjects(env,user){
 const rows=(await env.DB.prepare('SELECT DISTINCT category,collection FROM curated_questions WHERE enabled=1 AND (scope_user_id IS NULL OR scope_user_id=?)').bind(user.id).all()).results;
 return rows.length?[...new Set(['General knowledge',...rows.flatMap(r=>[r.category,r.collection]).filter(Boolean)])]:[];
}
function matches(row,topic){const t=normalize(topic);return t==='general knowledge'||[row.category,row.collection,row.topic,...JSON.parse(row.tags)].some(s=>normalize(s)===t)}
function shuffled(items){const copy=[...items];for(let i=copy.length-1;i>0;i--){const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);const j=bytes[0]%(i+1);[copy[i],copy[j]]=[copy[j],copy[i]]}return copy}
export async function bankPack(env,user,topic,difficulty,count,participants=[],exclude=[]){
 const rows=(await env.DB.prepare('SELECT * FROM curated_questions WHERE enabled=1 AND (scope_user_id IS NULL OR scope_user_id=?)').bind(user.id).all()).results.filter(r=>matches(r,topic));
 if(!rows.length)return null;
 const seen=new Set(exclude),owners=[...new Set([user.id,...participants])];
 for(const owner of owners){
  const used=(await env.DB.prepare(`SELECT q.concept FROM questions q WHERE EXISTS(SELECT 1 FROM attempts a WHERE a.question_id=q.id AND a.user_id=?) OR EXISTS(SELECT 1 FROM daily_assignments a WHERE a.question_id=q.id AND a.user_id=?) OR EXISTS(SELECT 1 FROM discovery_queue a WHERE a.question_id=q.id AND a.user_id=?) OR EXISTS(SELECT 1 FROM daily_ready a WHERE a.question_id=q.id AND a.user_id=?) OR EXISTS(SELECT 1 FROM trivia_game_questions t JOIN trivia_games g ON g.id=t.game_id WHERE t.question_id=q.id AND (g.creator_id=? OR EXISTS(SELECT 1 FROM quiz_invitations i WHERE i.game_id=g.id AND i.user_id=?) OR EXISTS(SELECT 1 FROM quiz_participants p WHERE p.game_id=g.id AND p.user_id=?) OR EXISTS(SELECT 1 FROM trivia_players p WHERE p.game_id=g.id AND p.user_id=?)))`).bind(owner,owner,owner,owner,owner,owner,owner,owner).all()).results;
  used.forEach(r=>seen.add(r.concept));
 }
 const candidates=shuffled(rows.filter(r=>!difficulty||r.difficulty===difficulty)),selected=[];
 for(const r of candidates){const q=JSON.parse(r.data);if(seen.has(q.concept))continue;seen.add(q.concept);const original=q.options.map((text,i)=>({text,correct:i===q.correct})),options=shuffled(original);selected.push({...q,options:options.map(o=>o.text),correct:options.findIndex(o=>o.correct),bankId:r.id,bankVersion:r.version});if(selected.length===count)break}
 if(selected.length<count)fail('There aren’t enough fresh '+(difficulty?difficulty+' ':'')+'questions in this part of the bank. Try fewer questions, another difficulty or a broader subject. No AI credit was used.',409);
 return {questions:selected,vectors:[],bank:true};
}
export async function bankApi(request,env,user,body){
 if(!isAdmin(env,user))fail('Only the app administrator can manage the question bank.',403);
 if(request.method==='GET'){
  const counts=(await env.DB.prepare("SELECT category,collection,scope_user_id,COUNT(*) total,SUM(enabled) ready FROM curated_questions GROUP BY category,collection,scope_user_id ORDER BY category,collection").all()).results;
  const accounts=(await env.DB.prepare("SELECT id,friend_username,COALESCE(json_extract(profile,'$.name'),friend_username) name FROM users ORDER BY created_at DESC LIMIT 500").all()).results;
  return json({counts,accounts});
 }
 if(request.method!=='POST')fail('Not found.',404);
 const input=await body(request,250000),scope=input.userId||null,collection=typeof input.collection==='string'?input.collection.trim():'';
 if(scope&&!await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(scope).first())fail('Choose an existing account.');
 if(collection.length>120||!Array.isArray(input.rows)||input.rows.length<1||input.rows.length>50)fail('Import up to 50 questions per batch.');
 const commands=[],ids=new Set();
 for(const row of input.rows){
  if(typeof row.id!=='string'||! /^[A-Za-z0-9_-]{1,80}$/.test(row.id)||ids.has(row.id))fail('Every question needs a unique, stable Question ID.');ids.add(row.id);
  const id=(scope||'everyone')+':'+row.id;
  if(row.enabled===false){commands.push(env.DB.prepare('UPDATE curated_questions SET enabled=0,updated_at=? WHERE id=?').bind(Date.now(),id));continue}
  if(!row.q||typeof row.q!=='string'||row.q.length>500||!Array.isArray(row.options)||![2,4].includes(row.options.length)||row.options.some(o=>typeof o!=='string'||!o.trim()||o.length>150)||new Set(row.options.map(normalize)).size!==row.options.length||!Number.isInteger(row.correct)||row.correct<0||row.correct>=row.options.length)fail('Check the question and its distinct answers: four for multiple choice, two for true/false.');
  const format=row.format||'multiple_choice';if(format!=='multiple_choice'&&format!=='true_false'||format==='multiple_choice'&&row.options.length!==4||format==='true_false'&&(row.options.length!==2||!row.options.every(o=>['true','false'].includes(o.toLowerCase()))))fail('Use multiple choice or true/false.');
  if(!['easy','medium','hard'].includes(row.difficulty)||typeof row.category!=='string'||!row.category.trim()||row.category.length>120||typeof row.topic!=='string'||row.topic.length>120||typeof row.factId!=='string'||!row.factId.trim()||row.factId.length>180||typeof row.explanation!=='string'||!row.explanation.trim()||row.explanation.length>1500)fail('Ready questions need a category, difficulty, Fact ID and short explanation.');
  let source;try{source=new URL(row.source);if(!['http:','https:'].includes(source.protocol)||source.username||source.password)throw 0}catch{fail('Ready questions need a valid source link.')}
  if(!Array.isArray(row.tags)||row.tags.length>40||row.tags.some(t=>typeof t!=='string'||t.length>120))fail('Use up to 40 short tags.');
  const q={...(scope?{bankScopeUser:scope}:{}),format,topic:collection||row.category.trim(),q:row.q.trim(),options:row.options.map(o=>o.trim()),correct:row.correct,explanation:row.explanation.trim(),source:source.href,concept:'bank:'+normalize(row.factId),aliases:[],follow:['Can you explain that a little more?','Why is that?','Can you give me an example?'],origin:'bank'},data=JSON.stringify(q),version=await hash(data);
  commands.push(env.DB.prepare('INSERT INTO curated_questions(id,source_id,scope_user_id,fact_id,category,collection,topic,difficulty,tags,data,version,enabled,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET fact_id=excluded.fact_id,category=excluded.category,collection=excluded.collection,topic=excluded.topic,difficulty=excluded.difficulty,tags=excluded.tags,data=excluded.data,version=excluded.version,enabled=1,updated_at=excluded.updated_at').bind(id,row.id,scope,row.factId,row.category.trim(),collection,row.topic, row.difficulty,JSON.stringify(row.tags),data,version,Date.now()));
 }
 // Existing assigned questions and completed quizzes keep their original snapshots.
 if(scope){commands.push(env.DB.prepare('DELETE FROM discovery_queue WHERE user_id=? AND consumed_at IS NULL').bind(scope),env.DB.prepare('DELETE FROM daily_ready WHERE user_id=?').bind(scope))}else commands.push(env.DB.prepare('DELETE FROM discovery_queue WHERE consumed_at IS NULL'),env.DB.prepare('DELETE FROM daily_ready'));
 await env.DB.batch(commands);return json({ok:true,processed:input.rows.length});
}
