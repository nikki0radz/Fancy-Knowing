import {fail,normalize} from './core.mjs';
export const EMBEDDING_MODEL='text-embedding-3-small';
export const EMBEDDING_SIZE=256;
export function memoryText(q){return `${q.q}\nAnswer: ${q.options[q.correct]}\nFact: ${q.concept}\nSubject: ${q.subtopic||q.topic}`}
export function cosine(a,b){if(a.length!==b.length)return 0;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}return aa&&bb?dot/Math.sqrt(aa*bb):0}
export async function embed(env,texts){
 if(!env.OPENAI_API_KEY)fail('The AI key has not been added to Cloudflare yet.',503);
 let response;try{response=await fetch('https://api.openai.com/v1/embeddings',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:EMBEDDING_MODEL,dimensions:EMBEDDING_SIZE,input:texts,encoding_format:'float'}),signal:AbortSignal.timeout(30000)})}catch{fail('The question memory check took too long. Try again.',504)}
 if(!response.ok)fail('The question memory connection needs checking. Try again shortly.',502);
 const data=await response.json(),items=data.data;
 if(!Array.isArray(items)||items.length!==texts.length)fail('The question memory could not be checked.',502);
 const vectors=Array(texts.length);for(const item of items){if(!Number.isInteger(item.index)||item.index<0||item.index>=texts.length||vectors[item.index]||!Array.isArray(item.embedding)||item.embedding.length!==EMBEDDING_SIZE||item.embedding.some(n=>typeof n!=='number'||!Number.isFinite(n))||!item.embedding.some(n=>n!==0))fail('The question memory could not be checked.',502);vectors[item.index]=item.embedding}
 return vectors;
}
export async function loadMemory(env,userId){
 // Every assigned, attempted or saved question remains eligible: no rolling-history cutoff.
 const rows=await env.DB.prepare(`SELECT q.*,e.vector,e.model,
 COALESCE((SELECT MAX(a.created_at) FROM daily_assignments a WHERE a.user_id=? AND a.question_id=q.id),q.created_at) AS seen_at
 FROM questions q LEFT JOIN question_embeddings e ON e.question_id=q.id
 WHERE EXISTS(SELECT 1 FROM daily_assignments a WHERE a.user_id=? AND a.question_id=q.id)
 OR EXISTS(SELECT 1 FROM attempts a WHERE a.user_id=? AND a.question_id=q.id)
 OR EXISTS(SELECT 1 FROM saved s WHERE s.user_id=? AND s.question_id=q.id)
 ORDER BY seen_at DESC,q.id DESC`).bind(userId,userId,userId,userId).all();
 const records=rows.results.map(row=>({id:row.id,...JSON.parse(row.data),seenAt:row.seen_at,vector:row.model===EMBEDDING_MODEL&&row.vector?JSON.parse(row.vector):null}));
 const missing=records.filter(q=>!q.vector);
 for(let start=0;start<missing.length;start+=64){
  const batch=missing.slice(start,start+64),vectors=await embed(env,batch.map(memoryText));
  await env.DB.batch(batch.map((q,i)=>env.DB.prepare('INSERT INTO question_embeddings(question_id,model,vector) VALUES (?,?,?) ON CONFLICT(question_id) DO UPDATE SET model=excluded.model,vector=excluded.vector').bind(q.id,EMBEDDING_MODEL,JSON.stringify(vectors[i]))));batch.forEach((q,i)=>q.vector=vectors[i]);
 }
 return records;
}
export function nearQuestions(q,vector,memory){return memory.map(old=>({old,score:cosine(vector,old.vector)})).sort((a,b)=>b.score-a.score).slice(0,16)}
export function repeatedFact(q,memory){return memory.some(old=>normalize(old.q)===normalize(q.q)||normalize(old.concept)===normalize(q.concept))}
export function briefMemory(q){return {question:q.q,answer:q.options[q.correct],concept:q.concept,subtopic:q.subtopic||q.topic}}
