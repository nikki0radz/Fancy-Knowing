import {hash} from './core.mjs';
// One uncached external call per HTTP request; replay completed calls on the next step.
// API usage is recorded only by the real call, never by a replay.
export async function quizJobCall(env,kind,input,perform){
 const job=env.AI_JOB;if(!job)return perform();
 const position=job.callIndex++,key=await hash(JSON.stringify(input)),row=job.calls?job.calls.get(position):await env.DB.prepare('SELECT kind,request_hash,data FROM quiz_job_calls WHERE job_id=? AND position=?').bind(job.id,position).first();
 if(row){if(row.kind!==kind||row.request_hash!==key){const error=new Error('Quiz preparation changed while it was running. Start a fresh quiz.');error.status=409;throw error}return JSON.parse(row.data)}
 if(job.state.background&&(Date.now()>job.state.deadline||position>=120)){const error=new Error('Extended quiz research could not finish. Your quiz credit has been returned.');error.status=503;error.quizPermanent=true;throw error}
 const result=await perform();
 job.state.label=kind==='embeddings'?'Checking for repeated questions…':input.text?.format?.name==='learning_topic'?'Topic checked. Finding fresh facts…':input.text?.format?.name==='trivia_pack'?'Questions drafted. Checking the facts…':input.text?.format?.name==='trivia_pack_verification'?'Facts checked. Putting your quiz together…':/Independently fact-check/.test(input.instructions||'')?'Independent sources checked…':'Research gathered. Preparing the questions…';
 job.state.completedCalls=position+1;
 await env.DB.batch([env.DB.prepare('INSERT INTO quiz_job_calls(job_id,position,kind,request_hash,data) VALUES (?,?,?,?,?)').bind(job.id,position,kind,key,JSON.stringify(result)),env.DB.prepare('UPDATE quiz_jobs SET state=?,updated_at=? WHERE id=?').bind(JSON.stringify(job.state),Date.now(),job.id)]);
 job.paused=true;const pause=new Error('Quiz checkpoint saved');pause.quizPaused=true;throw pause;
}
