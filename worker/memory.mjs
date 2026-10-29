import {quizJobCall} from './ai-job-cache.mjs';
import {recordAIUsage} from './usage.mjs';
import {fail,normalize} from './core.mjs';
export const EMBEDDING_MODEL='text-embedding-3-small';
export const EMBEDDING_SIZE=256;
export function memoryText(q){return `${q.q}\nAnswer: ${q.options[q.correct]}\nFact: ${q.concept}\nSubject: ${q.subtopic||q.topic}`}
export function cosine(a,b){if(a.length!==b.length)return 0;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}return aa&&bb?dot/Math.sqrt(aa*bb):0}
export async function embed(env,texts){
 if(env.AI_JOB)return quizJobCall(env,'embeddings',{texts},()=>embed({...env,AI_JOB:null},texts));
 if(!env.OPENAI_API_KEY)fail('The AI key has not been added to Cloudflare yet.',503);
 let response;try{response=await fetch('https://api.openai.com/v1/embeddings',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:EMBEDDING_MODEL,dimensions:EMBEDDING_SIZE,input:texts,encoding_format:'float'}),signal:AbortSignal.timeout(env.AI_REQUEST_TIMEOUT?90000:30000)})}catch{await recordAIUsage(env,{model:EMBEDDING_MODEL,endpoint:'embeddings',status:0});fail('The question memory check took too long. Try again.',504)}
 if(!response.ok){await recordAIUsage(env,{model:EMBEDDING_MODEL,endpoint:'embeddings',status:response.status});fail('The question memory connection needs checking. Try again shortly.',502)}
 const data=await response.json(),items=data.data;await recordAIUsage(env,{data,model:data.model||EMBEDDING_MODEL,endpoint:'embeddings',status:response.status,requestId:response.headers.get('x-request-id')||undefined});
 if(!Array.isArray(items)||items.length!==texts.length)fail('The question memory could not be checked.',502);
 const vectors=Array(texts.length);for(const item of items){if(!Number.isInteger(item.index)||item.index<0||item.index>=texts.length||vectors[item.index]||!Array.isArray(item.embedding)||item.embedding.length!==EMBEDDING_SIZE||item.embedding.some(n=>typeof n!=='number'||!Number.isFinite(n))||!item.embedding.some(n=>n!==0))fail('The question memory could not be checked.',502);vectors[item.index]=item.embedding}
 return vectors;
}
export async function loadMemory(env,userId){
 // Every assigned, attempted or saved question remains eligible: no rolling-history cutoff.
 const rows=await env.DB.prepare(`SELECT q.*,e.vector,e.model,
 COALESCE((SELECT MAX(a.created_at) FROM daily_assignments a WHERE a.user_id=? AND a.question_id=q.id),q.created_at) AS seen_at
 FROM questions q LEFT JOIN question_embeddings e ON e.question_id=q.id
 WHERE json_extract(q.data,'$.origin') IS NOT 'manual' AND (EXISTS(SELECT 1 FROM daily_assignments a WHERE a.user_id=? AND a.question_id=q.id)
 OR EXISTS(SELECT 1 FROM attempts a WHERE a.user_id=? AND a.question_id=q.id)
 OR EXISTS(SELECT 1 FROM saved s WHERE s.user_id=? AND s.question_id=q.id)
 OR EXISTS(SELECT 1 FROM trivia_game_questions g JOIN trivia_players p ON p.game_id=g.game_id WHERE p.user_id=? AND g.question_id=q.id)
 OR EXISTS(SELECT 1 FROM discovery_queue r WHERE r.user_id=? AND r.question_id=q.id)
 OR EXISTS(SELECT 1 FROM daily_ready r WHERE r.user_id=? AND r.question_id=q.id)
 OR EXISTS(SELECT 1 FROM trivia_game_questions g JOIN quiz_participants p ON p.game_id=g.game_id WHERE p.user_id=? AND g.question_id=q.id)
 ) ORDER BY seen_at DESC,q.id DESC`).bind(userId,userId,userId,userId,userId,userId,userId,userId).all();
 let selected=rows.results;if(env.AI_JOB){const state=env.AI_JOB.state;if(!state.memoryIds)state.memoryIds=selected.map(q=>q.id);const byId=new Map(selected.map(q=>[q.id,q]));selected=state.memoryIds.map(id=>byId.get(id)).filter(Boolean)}
 const records=selected.map(row=>({id:row.id,...JSON.parse(row.data),seenAt:row.seen_at,vector:row.model===EMBEDDING_MODEL&&row.vector?JSON.parse(row.vector):null}));
 const missing=records.filter(q=>!q.vector);
 for(let start=0;start<missing.length;start+=64){
  const batch=missing.slice(start,start+64),vectors=await embed(env,batch.map(memoryText));
  await env.DB.batch(batch.map((q,i)=>env.DB.prepare('INSERT INTO question_embeddings(question_id,model,vector) VALUES (?,?,?) ON CONFLICT(question_id) DO UPDATE SET model=excluded.model,vector=excluded.vector').bind(q.id,EMBEDDING_MODEL,JSON.stringify(vectors[i]))));batch.forEach((q,i)=>q.vector=vectors[i]);if(env.AI_MEMORY_WARM_ONCE&&start+batch.length<missing.length){const pause=new Error('Question memory prepared');pause.quizMemoryWarmed=true;throw pause}
 }
 return records;
}
export function nearQuestions(q,vector,memory){return memory.map(old=>({old,score:cosine(vector,old.vector)})).sort((a,b)=>b.score-a.score).slice(0,16)}
const factStop=new Set('a an the is are was were what which who where when how of in on to for and or does do did has have can shark sharks true false'.split(' '));
function factTokens(text){return new Set(normalize(text||'').split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>2&&!factStop.has(w)))}
function overlap(a,b){let shared=0;for(const word of a)if(b.has(word))shared++;return shared/Math.max(1,Math.min(a.size,b.size))}
export function repeatedFact(q,memory){return !!repeatedFactMatch(q,memory)}
export function repeatedFactMatch(q,memory){return memory.find(old=>{
 if(normalize(old.q)===normalize(q.q)||(q.concept&&old.concept&&normalize(old.concept)===normalize(q.concept)))return true;
 const concept=factTokens(q.concept),prior=factTokens(old.concept),answer=normalize(q.options?.[q.correct]||''),oldAnswer=normalize(old.options?.[old.correct]||'');
 const numbers=text=>(String(text||'').match(/\d+(?:[.-]\d+)*/g)||[]).join('|');
 if(numbers(q.concept+' '+q.q)!==numbers(old.concept+' '+old.q))return false;
 return concept.size>=3&&prior.size>=3&&overlap(concept,prior)>=.8 || !['true','false'].includes(answer)&&answer.length>3&&answer===oldAnswer&&overlap(factTokens(q.q),factTokens(old.q))>=.75;
})}
export function briefMemory(q){return {question:q.q,answer:q.options[q.correct],concept:q.concept,subtopic:q.subtopic||q.topic}}
