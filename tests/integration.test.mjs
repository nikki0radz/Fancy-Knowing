import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf,db;
const origin='https://fancy-knowing.test';
async function call(path,{method='GET',body,cookie,originHeader=origin}={}){
 const response=await mf.dispatchFetch(origin+'/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{Origin:originHeader}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 return {response,status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:['index.mjs','core.mjs','ai.mjs'].map(f=>({type:'ESModule',path:new URL('../worker/'+f,import.meta.url).pathname})),compatibilityDate:'2026-10-26',d1Databases:['DB'],bindings:{SIGNUP_CODE:'private-test-code',OPENAI_API_KEY:'test-key'},outboundService:async request=>{
  if(new URL(request.url).hostname==='api.openai.com')return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Its gills take oxygen out of the water.'}]}]});
  return new Response('Unexpected outbound request',{status:500});
 }}));
 db=await mf.getD1Database('DB');const schema=await readFile(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8');
 await db.batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const q={topic:'Nature',q:'How many hearts does an octopus have?',options:['One','Two','Three','Four'],correct:2,explanation:'Three. Two serve its gills.',source:'https://www.nhm.ac.uk/',aliases:['3'],concept:'octopus-hearts',follow:['What do its gills do?','Why is its blood blue?','Do the hearts do the same job?']};
 await db.prepare('INSERT INTO questions(id,day,fingerprint,concept,data,created_at) VALUES (?,?,?,?,?,?)').bind('test-question',day,'test-fingerprint',q.concept,JSON.stringify(q),Date.now()).run();
});
after(async()=>{await mf?.dispose()});
test('full account, daily question, answers, chats and cross-account isolation',async()=>{
 assert.equal((await call('/today')).status,401);
 assert.equal((await call('/auth/signup',{method:'POST',body:{username:'nicole',password:'long-test-password',code:'wrong'}})).status,403);
 const first=await call('/auth/signup',{method:'POST',body:{username:'nicole',password:'long-test-password',code:'private-test-code'}});
 assert.equal(first.status,200);assert.ok(first.response.headers.get('set-cookie').includes('HttpOnly; Secure; SameSite=Strict'));const cookie=first.cookie;
 const second=await call('/auth/signup',{method:'POST',body:{username:'mum',password:'another-test-password',code:'private-test-code'}});assert.equal(second.status,200);
 const daily=await call('/today',{cookie});assert.equal(daily.status,200);assert.equal(daily.data.question.correct,undefined);assert.equal(daily.data.question.explanation,undefined);
 const answerBody={typed:'3',attemptId:crypto.randomUUID()};
 const answered=await call('/questions/test-question/answer',{method:'POST',cookie,body:answerBody});assert.equal(answered.status,200);assert.equal(answered.data.question.attempt.correct,true);
 await call('/questions/test-question/answer',{method:'POST',cookie,body:answerBody});
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM attempts').first()).n,1);
 const saved=await call('/questions/test-question/save',{method:'POST',cookie,body:{saved:true}});assert.equal(saved.status,200);assert.ok(saved.data.saved.due>Date.now());
 const chat=await call('/questions/test-question/chat',{method:'POST',cookie,body:{message:'What do its gills do?'}});assert.equal(chat.status,200);assert.ok(chat.data.reply.includes('oxygen'));
 const ownLibrary=await call('/library',{cookie});assert.equal(ownLibrary.data.questions.length,1);assert.ok(ownLibrary.data.questions[0].saved);
 assert.equal((await call('/questions/test-question?blind=1',{cookie})).data.question.correct,undefined);
 const otherLibrary=await call('/library',{cookie:second.cookie});assert.equal(otherLibrary.data.questions.length,0);
 assert.equal((await call('/questions/test-question/chat',{cookie:second.cookie})).status,403);
 assert.equal((await call('/today',{cookie:second.cookie})).data.question.correct,undefined);
 const settings=await call('/settings',{method:'PUT',cookie,body:{theme:'light',time:'09:15'}});assert.equal(settings.data.settings.time,'09:15');
 assert.equal((await call('/me',{cookie:second.cookie})).data.user.settings.time,'08:00');
 const csrf=await call('/settings',{method:'PUT',cookie,originHeader:'https://evil.test',body:{theme:'dark'}});assert.equal(csrf.status,403);
 const relogin=await call('/auth/login',{method:'POST',body:{username:'NICOLE',password:'long-test-password'}});assert.equal(relogin.status,200);
 assert.equal((await call('/auth/logout',{method:'POST',cookie,body:{}})).status,200);assert.equal((await call('/me',{cookie})).status,401);
 assert.equal((await call('/me',{cookie:relogin.cookie})).status,200);
});
test('daily generation requires a searched citation, validates structure and caches the result',async()=>{
 const {dailyQuestion}=await import('../worker/ai.mjs');const originalFetch=globalThis.fetch;let calls=0;
 const generated={topic:'Space',q:'Which planet is hottest?',options:['Mercury','Venus','Mars','Earth'],correct:1,explanation:'Venus traps heat in its thick atmosphere.',source:'https://science.nasa.gov/venus/facts/',aliases:[],concept:'venus-hottest-planet',follow:['Why is it so hot?','How hot is it?','Is it closest to the Sun?']};
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');const request=JSON.parse(options.body);assert.equal(request.store,false);calls++;
 const text=request.tools?'Venus is the hottest planet, because its atmosphere traps heat.':JSON.stringify(generated);
 if(request.tools)assert.equal(request.tool_choice,'required');else assert.equal(request.text.format.type,'json_schema');
 return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text,annotations:request.tools?[{type:'url_citation',url:generated.source}]:[]}]}]});
 };
 try{const row=await dailyQuestion({DB:db,OPENAI_API_KEY:'test-key'},'2099-01-01');assert.equal(JSON.parse(row.data).q,generated.q);assert.equal(calls,2);const cached=await dailyQuestion({DB:db,OPENAI_API_KEY:'test-key'},'2099-01-01');assert.equal(cached.id,row.id);assert.equal(calls,2)}finally{globalThis.fetch=originalFetch}
});
test('a failed AI request does not cache a question or leave a generation lock',async()=>{
 const {dailyQuestion}=await import('../worker/ai.mjs');const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({error:'invalid-key'},{status:401});
 try{await assert.rejects(()=>dailyQuestion({DB:db,OPENAI_API_KEY:'bad'},'2099-01-02'),/connection needs checking/);assert.equal(await db.prepare('SELECT id FROM questions WHERE day=?').bind('2099-01-02').first(),null);assert.equal(await db.prepare('SELECT key FROM locks WHERE key=?').bind('generate:2099-01-02').first(),null)}finally{globalThis.fetch=originalFetch}
});
