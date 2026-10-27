import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf,db;const sentEmails=[];let mailFails=false;
const origin='https://fancy-knowing.test';
async function call(path,{method='GET',body,cookie,originHeader=origin}={}){
 const response=await mf.dispatchFetch(origin+'/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{Origin:originHeader}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 return {response,status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
const triviaUrl='https://quiz.example.test/trivia';
function vectorFor(text){let seed=2166136261;for(const c of text)seed=Math.imul(seed^c.charCodeAt(0),16777619)>>>0;return Array.from({length:256},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296-.5})}
function embeddingResponse(body){return Response.json({data:body.input.map((text,index)=>({index,embedding:vectorFor(text)}))})}
const aiText=(value,urls=[])=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:typeof value==='string'?value:JSON.stringify(value),annotations:urls.map(url=>({type:'url_citation',url}))}]}]});
function generationMock(handler){return async(url,options)=>{
 const body=JSON.parse(options.body);
 if(String(url).endsWith('/embeddings'))return embeddingResponse(body);
 if(body.text?.format?.name==='trivia_quality')return aiText({accepted:true,reason:'A clear, unique answer.'});
 const response=await handler(url,options);if(!response.ok)return response;
 const data=await response.json();if(body.tools){for(const item of data.output||[])for(const content of item.content||[])(content.annotations||=[]).push({type:'url_citation',url:triviaUrl})}
 else if(body.text?.format?.name==='daily_question'){for(const item of data.output||[])for(const content of item.content||[]){const q=JSON.parse(content.text);content.text=JSON.stringify({...q,subtopic:q.concept,triviaSource:triviaUrl})}}
 return Response.json(data);
}}
let generatedNumber=0,generatedTopic='Science',generationCalls=0;
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:['index.mjs','core.mjs','ai.mjs','auth.mjs','profiles.mjs','mail.mjs','memory.mjs','discoveries.mjs','games.mjs','trivia.mjs'].map(f=>({type:'ESModule',path:new URL('../worker/'+f,import.meta.url).pathname})),compatibilityDate:'2026-10-26',d1Databases:['DB'],bindings:{SIGNUP_CODE:'private-test-code',OPENAI_API_KEY:'test-key',RESEND_API_KEY:'test-resend-key',EMAIL_FROM:'Fancy Knowing <onboarding@resend.dev>',APP_URL:origin},outboundService:async request=>{
  if(new URL(request.url).hostname==='api.resend.com'){if(mailFails)return Response.json({error:'sender not verified'},{status:403});sentEmails.push(await request.json());return Response.json({id:crypto.randomUUID()})}
  if(new URL(request.url).hostname==='api.openai.com'){const body=await request.json();
   if(new URL(request.url).pathname.endsWith('/embeddings'))return embeddingResponse(body);
   if(body.tools){generationCalls++;generatedNumber++;generatedTopic=JSON.parse(body.input).topic;return aiText('Fixture quiz and official factual evidence.',[triviaUrl,'https://facts.example.test/source'])}
   if(body.text?.format?.name==='trivia_pack_review')return aiText({accepted:true,reason:'Clear varied quiz.'});
   if(body.text?.format?.name==='trivia_pack'){const count=body.text.format.schema.properties.questions.minItems,options=body.text.format.schema.properties.questions.items.properties.options.minItems;return aiText({questions:Array.from({length:count},(_,i)=>({topic:generatedTopic,q:`Which archive specimen has catalogue ${generatedNumber}-${i}?`,options:Array.from({length:options},(_,n)=>`Archive specimen ${generatedNumber}-${i}-${n}`),correct:0,explanation:'The archive records this specimen.',source:'https://facts.example.test/source',triviaSource:triviaUrl,concept:`pack-${generatedNumber}-${i}`,subtopic:`archive-${i}`,aliases:[],follow:['Where is it?','Who named it?','How old is it?']}))})}
   if(body.text?.format?.name==='trivia_quality')return aiText({accepted:true,reason:'Clear fixture.'});
   if(body.text?.format?.name==='daily_question'){const count=body.text.format.schema.properties.options.minItems;return aiText({topic:generatedTopic,q:`Which specimen has catalogue number ${generatedNumber}?`,options:Array.from({length:count},(_,i)=>`Specimen ${generatedNumber}-${i}`),correct:0,explanation:`It is specimen ${generatedNumber}-0.`,source:'https://facts.example.test/source',triviaSource:triviaUrl,concept:'fixture-fact-'+generatedNumber,subtopic:'fixture-subject-'+generatedNumber,aliases:[],follow:['Where is it?','Who named it?','How old is it?']})}
   if(body.text?.format?.name==='learning_topic'){const text=JSON.parse(body.input).proposedTopic;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(text==='asdfghjkl'?{accepted:false,topic:'',reason:'Try a recognisable topic, such as marine biology.'}:{accepted:true,topic:'Marine biology focused on sharks',reason:'A valid learning topic.'})}]}]})}
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Its gills take oxygen out of the water.'}]}]})};
  return new Response('Unexpected outbound request',{status:500});
 }}));
 db=await mf.getD1Database('DB');const schema=(await Promise.all(['0001_initial.sql','0002_email_profiles.sql','0003_avatar.sql','0004_welcome_email.sql','0005_shared_questions.sql','0006_question_slots_memory.sql','0007_trivia_challenges.sql'].map(f=>readFile(new URL('../migrations/'+f,import.meta.url),'utf8')))).join('\n');
 await db.batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const q={topic:'Nature',q:'How many hearts does an octopus have?',options:['One','Two','Three','Four'],correct:2,explanation:'Three. Two serve its gills.',source:'https://www.nhm.ac.uk/',aliases:['3'],concept:'octopus-hearts',follow:['What do its gills do?','Why is its blood blue?','Do the hearts do the same job?']};
 await db.prepare('INSERT INTO questions(id,day,fingerprint,concept,data,created_at) VALUES (?,?,?,?,?,?)').bind('test-question',day,'test-fingerprint',q.concept,JSON.stringify(q),Date.now()).run();
});
after(async()=>{await mf?.dispose()});
test('full account, daily question, answers, chats and cross-account isolation',async()=>{
 assert.equal((await call('/today')).status,401);
 assert.equal((await call('/auth/signup',{method:'POST',body:{email:'nicole@example.com',password:'long-test-password',code:'wrong'}})).status,403);
 const first=await call('/auth/signup',{method:'POST',body:{email:'nicole@example.com',password:'long-test-password',code:'private-test-code'}});
 assert.equal(first.status,200);assert.ok(first.response.headers.get('set-cookie').includes('HttpOnly; Secure; SameSite=Strict'));const cookie=first.cookie;
 const second=await call('/auth/signup',{method:'POST',body:{email:'mum@example.com',password:'another-test-password',code:'private-test-code'}});assert.equal(second.status,200);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());for(const account of [first,second])await db.prepare('INSERT INTO daily_assignments(user_id,day,slot,question_id,subject,created_at) VALUES (?,?,0,?,?,?)').bind(account.data.user.id,day,'test-question','Nature',Date.now()).run();
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
 const relogin=await call('/auth/login',{method:'POST',body:{email:'NICOLE@EXAMPLE.COM',password:'long-test-password'}});assert.equal(relogin.status,200);
 assert.equal((await call('/auth/logout',{method:'POST',cookie,body:{}})).status,200);assert.equal((await call('/me',{cookie})).status,401);
 assert.equal((await call('/me',{cookie:relogin.cookie})).status,200);
});
test('daily generation requires a searched citation, validates structure and caches the result',async()=>{
 const {dailyQuestion}=await import('../worker/ai.mjs');const originalFetch=globalThis.fetch;let calls=0;
 const generated={topic:'Space',q:'Which planet is hottest?',options:['Mercury','Venus','Mars','Earth'],correct:1,explanation:'Venus traps heat in its thick atmosphere.',source:'https://science.nasa.gov/venus/facts/',aliases:[],concept:'venus-hottest-planet',follow:['Why is it so hot?','How hot is it?','Is it closest to the Sun?']};
 globalThis.fetch=generationMock(async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');const request=JSON.parse(options.body);assert.equal(request.store,false);calls++;
 const text=request.tools?'Venus is the hottest planet, because its atmosphere traps heat.':JSON.stringify(generated);
 if(request.tools)assert.equal(request.tool_choice,'required');else assert.equal(request.text.format.type,'json_schema');
 return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text,annotations:request.tools?[{type:'url_citation',url:generated.source}]:[]}]}]});
 });
 try{const row=await dailyQuestion({DB:db,OPENAI_API_KEY:'test-key'},'2099-01-01');assert.equal(JSON.parse(row.data).q,generated.q);assert.equal(calls,2);const cached=await dailyQuestion({DB:db,OPENAI_API_KEY:'test-key'},'2099-01-01');assert.equal(cached.id,row.id);assert.equal(calls,2)}finally{globalThis.fetch=originalFetch}
});
test('a failed AI request does not cache a question or leave a generation lock',async()=>{
 const {dailyQuestion}=await import('../worker/ai.mjs');const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({error:'invalid-key'},{status:401});
 try{await assert.rejects(()=>dailyQuestion({DB:db,OPENAI_API_KEY:'bad'},'2099-01-02'),/connection needs checking/);assert.equal(await db.prepare('SELECT id FROM questions WHERE day=?').bind('2099-01-02').first(),null);assert.equal(await db.prepare('SELECT key FROM locks WHERE key=?').bind('generate:2099-01-02').first(),null)}finally{globalThis.fetch=originalFetch}
});
async function login(email,password='long-test-password'){return call('/auth/login',{method:'POST',body:{email,password}})}
function mailToken(message,purpose){return new URL(message.text.match(/https:\/\/\S+/)[0]).searchParams.get(purpose)}
test('profile setup validates subjects, accepts a specific niche, rejects gibberish and retains today’s assignment',async()=>{
 const account=await login('nicole@example.com');const cookie=account.cookie;assert.equal(account.data.user.email,'nicole@example.com');
 const subjects=await call('/topics',{cookie});assert.ok(subjects.data.subjects.includes('Poetry'));assert.ok(subjects.data.subjects.includes('Maths'));
 assert.equal((await call('/profile',{method:'PUT',cookie,body:{name:'Nicole',interests:['Unchecked custom subject']}})).status,400);
 const invalid=await call('/topics',{method:'POST',cookie,body:{topic:'asdfghjkl'}});assert.equal(invalid.status,400);
 const niche=await call('/topics',{method:'POST',cookie,body:{topic:'marine biology focused on sharks'}});assert.equal(niche.status,200);assert.equal(niche.data.topic,'Marine biology focused on sharks');
 const profile=await call('/profile',{method:'PUT',cookie,body:{name:' Nicole ',interests:['Chemistry','Poetry',niche.data.topic]}});assert.equal(profile.status,200);assert.equal(profile.data.profile.name,'Nicole');assert.equal(profile.data.profile.onboardingComplete,true);
 assert.equal((await call('/me',{cookie})).data.user.profile.interests.length,3);
 const today=await call('/today',{cookie});assert.equal(today.data.question.id,'test-question');
 const mum=await login('mum@example.com','another-test-password');assert.equal((await call('/me',{cookie:mum.cookie})).data.user.profile.name,undefined);
 assert.equal((await call('/profile',{method:'PUT',cookie:mum.cookie,body:{name:'Mum',interests:[niche.data.topic]}})).status,400);
});
test('forgot/reset uses one-time expiring tokens, does not disclose unknown emails and revokes sessions',async()=>{
 const logged=await login('nicole@example.com');const cookie=logged.cookie;const count=sentEmails.length;
 const known=await call('/auth/forgot-password',{method:'POST',body:{email:'nicole@example.com'}});
 const unknown=await call('/auth/forgot-password',{method:'POST',body:{email:'nobody@example.com'}});
 assert.equal(known.status,200);assert.deepEqual(known.data,unknown.data);assert.equal(sentEmails.length,count+1);assert.equal(known.data.token,undefined);
 const token=mailToken(sentEmails.at(-1),'reset');assert.ok(token);const records=await db.prepare("SELECT token_hash FROM email_tokens WHERE purpose='reset'").all();assert.ok(records.results.every(r=>r.token_hash!==token));
 await call('/auth/forgot-password',{method:'POST',body:{email:'nicole@example.com'}});const otherToken=mailToken(sentEmails.at(-1),'reset');
 const reset=await call('/auth/reset-password',{method:'POST',body:{token,password:'x'}});assert.equal(reset.status,200);assert.equal((await call('/me',{cookie})).status,401);
 assert.equal((await call('/auth/reset-password',{method:'POST',body:{token,password:'y'}})).status,400);
 assert.equal((await call('/auth/reset-password',{method:'POST',body:{token:otherToken,password:'z'}})).status,400);
 assert.equal((await login('nicole@example.com')).status,401);assert.equal((await login('nicole@example.com','x')).status,200);
 await call('/auth/forgot-password',{method:'POST',body:{email:'mum@example.com'}});const expired=mailToken(sentEmails.at(-1),'reset');await db.prepare("UPDATE email_tokens SET expires_at=0 WHERE purpose='reset' AND email='mum@example.com'").run();assert.equal((await call('/auth/reset-password',{method:'POST',body:{token:expired,password:'x'}})).status,400);
 assert.equal((await login('mum@example.com','another-test-password')).status,200);
});
test('legacy accounts attach a confirmed email without losing identity or history',async()=>{
 const {passwordHash}=await import('../worker/core.mjs');const pw=await passwordHash('a','legacy-salt');await db.prepare('INSERT INTO users(id,username,password_hash,salt,settings,created_at) VALUES (?,?,?,?,?,?)').bind('legacy-id','oldname',pw,'legacy-salt','{}',Date.now()).run();
 const old=await call('/auth/login',{method:'POST',body:{username:'oldname',password:'a'}});assert.equal(old.status,200);const cookie=old.cookie;
 const denied=await call('/account/email',{method:'POST',cookie,body:{email:'legacy@example.com',password:'wrong'}});assert.equal(denied.status,403);
 const link=await call('/account/email',{method:'POST',cookie,body:{email:'legacy@example.com',password:'a'}});assert.equal(link.status,200);
 assert.equal((await call('/me',{cookie})).data.user.email,null);
 const token=mailToken(sentEmails.at(-1),'verify');const confirmed=await call('/auth/confirm-email',{method:'POST',body:{token}});assert.equal(confirmed.status,200);assert.equal((await call('/auth/confirm-email',{method:'POST',body:{token}})).status,400);
 const fresh=await login('legacy@example.com','a');assert.equal(fresh.status,200);assert.equal(fresh.data.user.id,'legacy-id');assert.equal(fresh.data.user.emailVerified,true);
 assert.equal((await call('/auth/login',{method:'POST',body:{username:'oldname',password:'a'}})).status,401);
});
test('provider failure removes the unused token and returns the same reset-request response',async()=>{
 const before=(await db.prepare("SELECT count(*) AS n FROM email_tokens WHERE email='mum@example.com'").first()).n;mailFails=true;
 try{const response=await call('/auth/forgot-password',{method:'POST',body:{email:'mum@example.com'}});assert.equal(response.status,200);assert.equal((await db.prepare("SELECT count(*) AS n FROM email_tokens WHERE email='mum@example.com'").first()).n,before)}finally{mailFails=false}
});
test('daily questions use a selected niche, cache by subject and do not include profile names',async()=>{
 const {dailyQuestion}=await import('../worker/ai.mjs');const originalFetch=globalThis.fetch;let calls=0;const topic='Marine biology focused on sharks';
 const generated={topic:'Marine biology',q:'What do shark gills extract from water?',options:['Oxygen','Sand','Salt','Light'],correct:0,explanation:'Gills take dissolved oxygen from the water.',source:'https://ocean.si.edu/ocean-life/sharks-rays',aliases:[],concept:'shark-gill-oxygen',follow:['How do gills work?','Do sharks have lungs?','What is dissolved oxygen?']};
 globalThis.fetch=generationMock(async(url,options)=>{const request=JSON.parse(options.body);calls++;if(request.tools)assert.ok(request.input.includes(topic));return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:request.tools?'Shark gills take oxygen from the water.':JSON.stringify(generated),annotations:request.tools?[{type:'url_citation',url:generated.source}]:[]}]}]})});
 try{const row=await dailyQuestion({DB:db,OPENAI_API_KEY:'test-key'},'2099-01-03',[topic]);assert.ok(row.day.startsWith('2099-01-03:'));assert.equal(JSON.parse(row.data).topic,'Marine biology');const again=await dailyQuestion({DB:db,OPENAI_API_KEY:'test-key'},'2099-01-03',[topic]);assert.equal(again.id,row.id);assert.equal(calls,2)}finally{globalThis.fetch=originalFetch}
});
test('design, frequency and question-count settings persist per account; avatars validate and stay private',async()=>{
 const account=await login('nicole@example.com','x'),cookie=account.cookie;
 const saved=await call('/settings',{method:'PUT',cookie,body:{font:'classic',fontSize:130,accentDark:'#d8ac47',backgroundDark:'#141414',dailyAmount:4,answerCount:10,notificationsEnabled:false}});assert.equal(saved.status,200);assert.equal(saved.data.settings.answerCount,10);assert.equal((await call('/me',{cookie})).data.user.settings.dailyAmount,4);
 assert.equal((await call('/today',{cookie})).data.question.options.length,4);
 const mum=await login('mum@example.com','another-test-password');assert.equal((await call('/me',{cookie:mum.cookie})).data.user.settings.answerCount,undefined);
 assert.equal((await call('/avatar',{method:'PUT',cookie,body:{avatar:'data:image/svg+xml;base64,PHN2Zz4='}})).status,400);
 assert.equal((await call('/avatar',{method:'PUT',cookie,body:{avatar:'data:image/jpeg;base64,YmFk'}})).status,400);
 const avatar='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1EAAAAASUVORK5CYII=';
 assert.equal((await call('/avatar',{method:'PUT',cookie,body:{avatar}})).status,200);assert.equal((await call('/me',{cookie})).data.user.avatar,avatar);assert.equal((await call('/me',{cookie:mum.cookie})).data.user.avatar,null);
 assert.equal((await call('/avatar',{method:'DELETE',cookie})).status,200);assert.equal((await call('/me',{cookie})).data.user.avatar,null);
});
test('AI generation requests the selected number of choices and API grading accepts the tenth choice',async()=>{
 const {dailyQuestion}=await import('../worker/ai.mjs');const originalFetch=globalThis.fetch;let count=2;
 globalThis.fetch=generationMock(async(url,options)=>{const request=JSON.parse(options.body);if(!request.tools){assert.equal(request.text.format.schema.properties.options.minItems,count);assert.equal(request.text.format.schema.properties.correct.maximum,count-1)}const q={topic:'Numbers',q:`Which option is number ${count}?`,options:Array.from({length:count},(_,i)=>String(i+1)),correct:count-1,explanation:`It is ${count}.`,source:'https://example.org/number',aliases:[],concept:`number-${count}-options`,follow:['Why?','How?','Where?']};return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:request.tools?'Evidence for the fact.':JSON.stringify(q),annotations:request.tools?[{type:'url_citation',url:q.source}]:[]}]}]})});
 try{for(count of [2,10]){const row=await dailyQuestion({DB:db,OPENAI_API_KEY:'test-key'},'2099-02-01',[],count);assert.equal(JSON.parse(row.data).options.length,count);if(count===10){const signed=await login('nicole@example.com','x');const answer=await call(`/questions/${row.id}/answer`,{method:'POST',cookie:signed.cookie,body:{choice:9,attemptId:crypto.randomUUID()}});assert.equal(answer.status,200);assert.equal(answer.data.question.attempt.correct,true)}}}finally{globalThis.fetch=originalFetch}
});
test('welcome emails are queued once per signup and delivered without resending on login',async()=>{
 const {deliverWelcome}=await import('../worker/mail.mjs');const originalFetch=globalThis.fetch;let sends=0;
 const row=await db.prepare("SELECT id,email FROM users WHERE email='legacy@example.com'").first();await db.prepare('INSERT INTO email_outbox(user_id,email,created_at) VALUES (?,?,?)').bind(row.id,row.email,Date.now()).run();
 globalThis.fetch=async(url,options)=>{sends++;const body=JSON.parse(options.body);assert.equal(body.to[0],row.email);assert.ok(body.subject.includes('Welcome'));assert.ok(body.text.includes('Forgot password'));return Response.json({id:'welcome-test'})};
 try{const env={DB:db,APP_URL:origin,RESEND_API_KEY:'test',EMAIL_FROM:'Fancy Knowing <onboarding@resend.dev>'};await deliverWelcome(env,row.id);await deliverWelcome(env,row.id);assert.equal(sends,1);assert.ok((await db.prepare('SELECT sent_at FROM email_outbox WHERE user_id=?').bind(row.id).first()).sent_at)}finally{globalThis.fetch=originalFetch}
});
test('Gmail bridge uses the protected server-only connection and rejects failed delivery',async()=>{
 const {sendEmail}=await import('../worker/mail.mjs');const originalFetch=globalThis.fetch;
 const env={APP_URL:origin,EMAIL_WEBHOOK_URL:'https://script.google.com/macros/s/test-deployment/exec',EMAIL_WEBHOOK_SECRET:'test-secret'};
 globalThis.fetch=async(url,options)=>{assert.equal(url,env.EMAIL_WEBHOOK_URL);const body=JSON.parse(options.body);assert.equal(body.secret,'test-secret');assert.equal(body.to,'mum@example.com');return Response.json({ok:true})};
 try{await sendEmail(env,{to:'mum@example.com',subject:'Fancy Knowing · Reset',text:'Test email',idempotencyKey:'test-key'});globalThis.fetch=async()=>Response.json({ok:false});await assert.rejects(()=>sendEmail(env,{to:'mum@example.com',subject:'Test',text:'Test',idempotencyKey:'test-key'}));await assert.rejects(()=>sendEmail({...env,EMAIL_WEBHOOK_URL:'https://wrong.example/exec'},{to:'mum@example.com',subject:'Test',text:'Test',idempotencyKey:'key'}))}finally{globalThis.fetch=originalFetch}
});

test('shared guest questions hide answers until a guess and never expose accounts or conversations',async()=>{
 const owner=await login('nicole@example.com','x'),other=await login('mum@example.com','another-test-password');
 assert.equal((await call('/questions/test-question/share',{method:'POST',body:{}})).status,401);
 assert.equal((await call('/questions/test-question/share',{method:'POST',cookie:other.cookie,body:{}})).status,403);
 const shared=await call('/questions/test-question/share',{method:'POST',cookie:owner.cookie,body:{}});assert.equal(shared.status,200);
 const url=new URL(shared.data.url);assert.equal(url.origin,origin);const token=url.searchParams.get('share');assert.match(token,/^[a-f0-9]{64}$/);
 assert.equal((await call('/questions/test-question/share',{method:'POST',cookie:owner.cookie,body:{}})).data.url,shared.data.url);
 const guest=await call('/shared/'+token);assert.equal(guest.status,200);assert.deepEqual(Object.keys(guest.data.question).sort(),['options','q','topic']);assert.equal(guest.cookie,undefined);
 const before=(await db.prepare('SELECT COUNT(*) AS n FROM attempts').first()).n;
 const answer=await call(`/shared/${token}/answer`,{method:'POST',body:{choice:0}});assert.equal(answer.status,200);assert.equal(answer.data.question.correct,2);assert.equal(answer.data.question.attempt.correct,false);assert.ok(answer.data.question.explanation);assert.equal(answer.data.question.follow,undefined);assert.equal(answer.data.messages,undefined);assert.equal(answer.data.user,undefined);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM attempts').first()).n,before);
 assert.equal((await call(`/shared/${token}/answer`,{method:'POST',body:{choice:99}})).status,400);
 assert.equal((await call(`/shared/${token}/answer`,{method:'POST',body:{choice:2},originHeader:'https://evil.test'})).status,403);
 assert.equal((await call('/shared/'+'0'.repeat(64))).status,404);assert.equal((await call('/shared/not-a-token')).status,404);
 assert.equal((await call('/questions/test-question/chat')).status,401);
});
test('saved discoveries retain private chat history through unsaving, resaving and blind refreshers',async()=>{
 const owner=await login('nicole@example.com','x'),cookie=owner.cookie;
 const before=await call('/questions/test-question/chat',{cookie});assert.equal(before.data.messages.length,2);
 for(const saved of [false,true])assert.equal((await call('/questions/test-question/save',{method:'POST',cookie,body:{saved}})).status,200);
 const library=await call('/library',{cookie});const q=library.data.questions.find(q=>q.id==='test-question');assert.equal(q.chatCount,2);assert.ok(q.saved);
 const reopened=await call('/questions/test-question',{cookie});assert.ok(reopened.data.question.explanation);assert.equal((await call('/questions/test-question?blind=1',{cookie})).data.question.explanation,undefined);
 assert.deepEqual((await call('/questions/test-question/chat',{cookie})).data.messages,before.data.messages);
 const other=await login('mum@example.com','another-test-password');assert.equal((await call('/questions/test-question/chat',{cookie:other.cookie})).status,403);
});
test('random time windows and mixed interests persist and validate per account',async()=>{
 const account=await login('nicole@example.com','x'),cookie=account.cookie;
 const profile=await call('/profile',{method:'PUT',cookie,body:{name:'Nicole',interests:['Chemistry'],includeEverything:true}});assert.equal(profile.data.profile.includeEverything,true);
 assert.equal((await call('/profile',{method:'PUT',cookie,body:{name:'Nicole',interests:['Chemistry'],includeEverything:'yes'}})).status,400);
 assert.equal((await call('/settings',{method:'PUT',cookie,body:{notificationMode:'random',randomStart:'09:00',randomEnd:'17:00',dailyAmount:3,notificationsEnabled:true}})).status,200);
 assert.equal((await call('/me',{cookie})).data.user.settings.notificationMode,'random');assert.equal((await call('/me',{cookie})).data.user.profile.includeEverything,true);
 const schedule=await call('/notification-schedule',{cookie});assert.equal(schedule.status,200);assert.equal(schedule.data.deliveryAvailable,false);assert.equal(schedule.data.times.length,3);assert.deepEqual((await call('/notification-schedule',{cookie})).data,schedule.data);
 assert.ok(schedule.data.times.every(time=>time>='09:00'&&time<'17:00'));
 assert.equal((await call('/settings',{method:'PUT',cookie,body:{randomStart:'18:00'}})).status,400);assert.equal((await call('/me',{cookie})).data.user.settings.randomStart,'09:00');
 assert.equal((await call('/settings',{method:'PUT',cookie,body:{randomStart:'09:00',randomEnd:'09:01',dailyAmount:3}})).status,400);
 assert.equal((await call('/profile',{method:'PUT',cookie,body:{name:'Nicole',interests:[],includeEverything:false}})).data.profile.includeEverything,true);
});
test('each daily question slot is unique, cached and tied to its own notification link',async()=>{
 const account=await call('/auth/signup',{method:'POST',body:{email:'slots@example.test',password:'a',code:'private-test-code'}}),cookie=account.cookie;assert.equal(account.status,200);
 await call('/profile',{method:'PUT',cookie,body:{name:'Slots',interests:['Chemistry','History','Art'],includeEverything:false}});
 await call('/settings',{method:'PUT',cookie,body:{dailyAmount:3,notificationsEnabled:true}});
 const before=generationCalls,questions=[];
 for(let slot=0;slot<3;slot++){const result=await call('/today?slot='+slot,{cookie});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.slot,slot);assert.equal(result.data.count,3);assert.equal(result.data.slots.length,3);assert.equal(result.data.question.correct,undefined);questions.push(result.data.question)}
 assert.equal(new Set(questions.map(q=>q.id)).size,3);assert.deepEqual(questions.map(q=>q.topic),['Chemistry','History','Art']);assert.equal(generationCalls-before,3);
 assert.equal((await call('/today?slot=2',{cookie})).data.question.id,questions[2].id);assert.equal(generationCalls-before,3);
 const schedule=await call('/notification-schedule',{cookie});assert.equal(schedule.data.items.length,3);assert.deepEqual(schedule.data.items.map(item=>item.questionId),questions.map(q=>q.id));assert.equal(new Set(schedule.data.items.map(item=>item.url)).size,3);
 for(const item of schedule.data.items){const url=new URL(item.url);const reopened=await call('/today'+url.search,{cookie});assert.equal(reopened.data.question.id,questions[item.slot].id)}
 for(const slot of ['-1','10','1.5'])assert.equal((await call('/today?slot='+slot,{cookie})).status,400);assert.equal((await call('/today?slot=3',{cookie})).status,404);
 const oldDay='2020-01-02';await db.prepare('UPDATE daily_assignments SET day=? WHERE user_id=? AND slot=0').bind(oldDay,account.data.user.id).run();assert.equal((await call('/today?day='+oldDay+'&slot=0',{cookie})).data.question.id,questions[0].id);assert.equal((await call('/today?day=2020-01-03&slot=0',{cookie})).status,404);
 assert.equal(generationCalls-before,3);
});
test('question memory loads all historical assignments, including more than 120 unanswered discoveries',async()=>{
 const {loadMemory}=await import('../worker/memory.mjs');const account=await call('/auth/signup',{method:'POST',body:{email:'memory@example.test',password:'a',code:'private-test-code'}});const userId=account.data.user.id;
 const statements=[];for(let i=0;i<151;i++){
  const q={topic:'History',q:`Which historical object has index ${i}?`,options:['A','B'],correct:0,explanation:'Fixture.',aliases:[],concept:'history-memory-'+i,source:'https://example.org',follow:['Why?','How?','Where?']},id='old-memory-'+i;
  statements.push(db.prepare('INSERT INTO questions(id,day,fingerprint,concept,data,created_at) VALUES (?,?,?,?,?,?)').bind(id,'2000-memory-'+i,'memory-fp-'+i,q.concept,JSON.stringify(q),i));
  statements.push(db.prepare('INSERT INTO daily_assignments(user_id,day,slot,question_id,subject,created_at) VALUES (?,?,0,?,?,?)').bind(userId,'2000-memory-'+i,id,'History',i));
 }
 for(let i=0;i<statements.length;i+=80)await db.batch(statements.slice(i,i+80));
 const originalFetch=globalThis.fetch;let embeds=0;globalThis.fetch=async(url,options)=>{assert.ok(url.endsWith('/embeddings'));embeds++;return embeddingResponse(JSON.parse(options.body))};
 try{const memory=await loadMemory({DB:db,OPENAI_API_KEY:'test'},userId);assert.equal(memory.length,151);assert.ok(memory.find(q=>q.id==='old-memory-0'));assert.ok(memory.every(q=>q.vector.length===256));assert.equal(embeds,3);await loadMemory({DB:db,OPENAI_API_KEY:'test'},userId);assert.equal(embeds,3)}finally{globalThis.fetch=originalFetch}
});
test('lifetime facts and semantic paraphrases are rejected before a fresh candidate is assigned',async()=>{
 const {dailyQuestion}=await import('../worker/ai.mjs');const originalFetch=globalThis.fetch;let candidate=0,audits=0;
 const vector=index=>Array.from({length:256},(_,i)=>i===index?1:0);
 const memory=Array.from({length:151},(_,i)=>({q:'Previously learned fact '+i,options:['Old answer','No'],correct:0,concept:'prior-'+i,topic:'Nature',subtopic:'old-subject-'+i,vector:vector(0)}));
 const source='https://facts.example.test/memory';
 globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);if(url.endsWith('/embeddings'))return Response.json({data:[{index:0,embedding:vector(candidate===2?0:1)}]});
  if(body.tools){candidate++;return aiText('A quiz question and its factual verification.',[triviaUrl,source])}
  if(body.text?.format?.name==='trivia_quality'){audits++;return aiText({accepted:true,reason:'Fresh fact.'})}
  return aiText({topic:'Nature',q:'New wording '+candidate,options:['New answer '+candidate,'Wrong'],correct:0,explanation:'Fixture evidence.',concept:candidate===1?'prior-150':'fresh-'+candidate,subtopic:'candidate-subject-'+candidate,source,triviaSource:triviaUrl,aliases:[],follow:['Why?','How?','Where?']});
 };
 try{const row=await dailyQuestion({DB:db,OPENAI_API_KEY:'test'},'2099-04-01',[],2,false,{userId:'semantic-test',slot:0,topic:'Nature',memory});assert.equal(JSON.parse(row.data).concept,'fresh-3');assert.equal(candidate,3);assert.equal(audits,1)}finally{globalThis.fetch=originalFetch}
});
test('ambiguity review retries and never stores the rejected question',async()=>{
 const {dailyQuestion}=await import('../worker/ai.mjs');const originalFetch=globalThis.fetch;let candidate=0,audits=0;
 const source='https://facts.example.test/quality';
 globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);if(url.endsWith('/embeddings'))return embeddingResponse(body);
  if(body.tools){assert.match(body.instructions,/vowel LETTERS/);candidate++;return aiText('A quiz page and factual support for this fixture.',[triviaUrl,source])}
  if(body.text?.format?.name==='trivia_quality'){audits++;return aiText({accepted:candidate===2,reason:'The first question has more than one plausible answer.'})}
  return aiText({topic:'Languages',q:'Quality candidate '+candidate,options:['Answer','Distractor'],correct:0,explanation:'A brief factual explanation.',concept:'quality-test-'+candidate,subtopic:'quality-subject-'+candidate,source,triviaSource:triviaUrl,aliases:[],follow:['Why?','How?','Where?']});
 };
 try{const row=await dailyQuestion({DB:db,OPENAI_API_KEY:'test'},'2099-04-02',[],2);assert.equal(JSON.parse(row.data).concept,'quality-test-2');assert.equal(audits,2);assert.equal(await db.prepare('SELECT id FROM questions WHERE concept=?').bind('quality-test-1').first(),null)}finally{globalThis.fetch=originalFetch}
});
test('the slots migration preserves existing daily assignments and prevents duplicate slots',async()=>{
 const fresh=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-26',d1Databases:['DB']}));
 try{
  const migrationDb=await fresh.getD1Database('DB');
  const prior=(await Promise.all(['0001_initial.sql','0002_email_profiles.sql'].map(f=>readFile(new URL('../migrations/'+f,import.meta.url),'utf8')))).join('\n');await migrationDb.batch(prior.split(';').map(s=>s.trim()).filter(Boolean).map(sql=>migrationDb.prepare(sql)));
  await migrationDb.batch([migrationDb.prepare("INSERT INTO users(id,username,password_hash,salt,created_at) VALUES ('legacy','legacy','hash','salt',1)"),migrationDb.prepare("INSERT INTO questions(id,day,fingerprint,concept,data,created_at) VALUES ('legacy-q','2026-01-01','fp','concept',?,1)").bind(JSON.stringify({topic:'Biology'})),migrationDb.prepare("INSERT INTO daily_assignments(user_id,day,question_id) VALUES ('legacy','2026-01-01','legacy-q')")]);
  const migration=await readFile(new URL('../migrations/0006_question_slots_memory.sql',import.meta.url),'utf8');await migrationDb.batch(migration.split(';').map(s=>s.trim()).filter(Boolean).map(sql=>migrationDb.prepare(sql)));
  const row=await migrationDb.prepare('SELECT * FROM daily_assignments').first();assert.equal(row.question_id,'legacy-q');assert.equal(row.slot,0);assert.equal(row.subject,'Biology');
  await assert.rejects(()=>migrationDb.prepare("INSERT INTO daily_assignments(user_id,day,slot,question_id,subject,created_at) VALUES ('legacy','2026-01-02',1,'legacy-q','Biology',2)").run());
 }finally{await fresh.dispose()}
});
test('a failed memory check never serves an unchecked question or leaves its lock',async()=>{
 const {dailyQuestion}=await import('../worker/ai.mjs'),originalFetch=globalThis.fetch;const source='https://facts.example.test/failure';
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(url.endsWith('/embeddings'))return Response.json({error:'unavailable'},{status:503});if(body.tools)return aiText('Fixture quiz and evidence.',[triviaUrl,source]);return aiText({topic:'History',q:'Which fixture is it?',options:['One','Two'],correct:0,explanation:'Fixture.',concept:'unchecked-failure',subtopic:'failure-fixture',source,triviaSource:triviaUrl,aliases:[],follow:['Why?','How?','Where?']})};
 try{await assert.rejects(()=>dailyQuestion({DB:db,OPENAI_API_KEY:'test'},'2099-04-03',[],2),/memory connection/);assert.equal(await db.prepare("SELECT id FROM questions WHERE concept='unchecked-failure'").first(),null);assert.equal(await db.prepare('SELECT key FROM locks WHERE key=?').bind('generate:2099-04-03:answers-2').first(),null)}finally{globalThis.fetch=originalFetch}
});
test('reminder periods persist per account and schedule each daily question inside that period',async()=>{
 const owner=await login('nicole@example.com','x'),cookie=owner.cookie;
 const saved=await call('/settings',{method:'PUT',cookie,body:{notificationMode:'period',notificationPeriod:'evening',dailyAmount:3,notificationsEnabled:true}});assert.equal(saved.status,200);assert.equal(saved.data.settings.notificationPeriod,'evening');assert.equal((await call('/me',{cookie})).data.user.settings.notificationMode,'period');
 const schedule=await call('/notification-schedule',{cookie});assert.equal(schedule.data.items.length,3);assert.ok(schedule.data.times.every(time=>time>='18:00'&&time<'22:00'));assert.equal(new Set(schedule.data.items.map(item=>item.slot)).size,3);
 const other=await login('mum@example.com','another-test-password');assert.equal((await call('/me',{cookie:other.cookie})).data.user.settings.notificationPeriod,undefined);
 assert.equal((await call('/settings',{method:'PUT',cookie,body:{notificationPeriod:'bad'}})).status,400);
});
test('each question can have its own reminder, and unconfigured questions receive no automatic extra notification',async()=>{
 const account=await login('nicole@example.com','x'),cookie=account.cookie;
 const saved=await call('/settings',{method:'PUT',cookie,body:{dailyAmount:3,reminders:[{mode:'fixed',time:'09:00'},{mode:'period',period:'evening'}],notificationsEnabled:true}});assert.equal(saved.status,200);
 let schedule=await call('/notification-schedule',{cookie});assert.equal(schedule.data.configuredCount,2);assert.equal(schedule.data.questionCount,3);assert.equal(schedule.data.items.length,2);assert.equal(schedule.data.items[0].time,'09:00');assert.ok(schedule.data.items[1].time>='18:00'&&schedule.data.items[1].time<'22:00');assert.deepEqual(schedule.data.items.map(item=>item.slot),[0,1]);
 const before=(await call('/me',{cookie})).data.user.settings.reminders;
 await call('/settings',{method:'PUT',cookie,body:{notificationsEnabled:false}});const disabled=await call('/notification-schedule',{cookie});assert.equal(disabled.data.configuredCount,2);assert.deepEqual(disabled.data.times,[]);await call('/settings',{method:'PUT',cookie,body:{notificationsEnabled:true}});
 assert.equal((await call('/settings',{method:'PUT',cookie,body:{dailyAmount:1}})).status,400);assert.deepEqual((await call('/me',{cookie})).data.user.settings.reminders,before);
 assert.equal((await call('/settings',{method:'PUT',cookie,body:{dailyAmount:1,reminders:[{mode:'fixed',time:'10:00'}]}})).status,200);
 schedule=await call('/notification-schedule',{cookie});assert.deepEqual(schedule.data.times,['10:00']);assert.equal(schedule.data.questionCount,1);
 const other=await login('mum@example.com','another-test-password');assert.equal((await call('/me',{cookie:other.cookie})).data.user.settings.reminders,undefined);
});

test('editing and deleting notification rows keeps their original question slot and permits deleting the last row',async()=>{
 const owner=await login('nicole@example.com','x'),cookie=owner.cookie;
 const rows=[{slot:0,mode:'fixed',time:'09:00'},{slot:2,mode:'fixed',time:'18:00'}];
 assert.equal((await call('/settings',{method:'PUT',cookie,body:{dailyAmount:3,reminders:rows,notificationsEnabled:true}})).status,200);
 let schedule=await call('/notification-schedule',{cookie});assert.deepEqual(schedule.data.items.map(item=>item.slot),[0,2]);assert.ok(schedule.data.items[1].url.endsWith('&slot=2'));
 assert.equal((await call('/settings',{method:'PUT',cookie,body:{reminders:[{...rows[1],time:'19:00'}]}})).status,200);
 schedule=await call('/notification-schedule',{cookie});assert.equal(schedule.data.items.length,1);assert.equal(schedule.data.items[0].slot,2);assert.equal(schedule.data.items[0].time,'19:00');assert.ok(schedule.data.items[0].url.endsWith('&slot=2'));
 assert.equal((await call('/settings',{method:'PUT',cookie,body:{reminders:[]}})).status,200);schedule=await call('/notification-schedule',{cookie});assert.equal(schedule.data.configuredCount,0);assert.deepEqual(schedule.data.items,[]);assert.deepEqual((await call('/me',{cookie})).data.user.settings.reminders,[]);
});

let challengeTestCookie;
test('asynchronous challenge preserves answers, guest identity, privacy and persistent result badges',async()=>{
 const host=await call('/auth/signup',{method:'POST',body:{email:'challenge-host@example.com',password:'x',code:'private-test-code'}}),cookie=host.cookie;challengeTestCookie=cookie;
 const before=generationCalls,home=await call('/home',{cookie});assert.equal(home.status,200);assert.equal(home.data.slots.length,1);assert.equal(generationCalls,before);
 assert.equal((await call('/games',{method:'POST',body:{}})).status,401);
 const body={kind:'challenge',topic:'History',difficulty:'easy',count:5,requestId:crypto.randomUUID()};
 const created=await call('/games',{cookie,method:'POST',body});assert.equal(created.status,200,JSON.stringify(created.data));const game=created.data.game,id=game.id;
 assert.equal(game.question.options.length,4);assert.equal(game.question.correct,undefined);assert.equal(game.review,undefined);
 assert.equal((await call('/games',{cookie,method:'POST',body})).data.game.id,id);
 const token=new URL(game.inviteUrl).searchParams.get('challenge'),path='/challenges/'+token;
 const outsider=await call(path);assert.equal(outsider.data.game.question,undefined);assert.equal(outsider.data.game.canJoin,true);
 const sameHost=await call(path+'/join',{cookie,method:'POST',body:{name:'Host'}});assert.equal(sameHost.data.game.players.length,1);
 const joined=await call(path+'/join',{method:'POST',body:{name:'A friend'}});assert.equal(joined.status,200);const guestCookie=joined.cookie;assert.ok(guestCookie);
 assert.deepEqual(joined.data.game.question,game.question);
 assert.equal((await call(path+'/join',{method:'POST',body:{name:'An intruder'}})).status,409);
 assert.equal((await call('/games/'+id,{cookie:(await call('/auth/login',{method:'POST',body:{email:'mum@example.com',password:'another-test-password'}})).cookie})).status,403);
 assert.equal((await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position:2,choice:0}})).status,409);
 for(let position=0;position<5;position++){const r=await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position,choice:0}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.game.review,undefined);assert.ok(r.data.game.players.every(p=>p.score===undefined))}
 assert.equal((await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position:0,choice:1}})).status,409);
 assert.equal((await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position:0,choice:0}})).status,200);
 assert.equal((await call('/notifications',{cookie})).data.unread,0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM attempts WHERE user_id=?').bind(host.data.user.id).first()).n,0);
 let finished;for(let position=0;position<5;position++)finished=await call(path+'/answer',{cookie:guestCookie,method:'POST',body:{position,choice:1}});
 assert.equal(finished.status,200);assert.equal(finished.data.game.complete,true);assert.equal(finished.data.game.review.length,5);
 const result=await call('/games/'+id,{cookie});assert.equal(result.data.game.players.find(p=>p.self).score,5);assert.equal(result.data.game.draw,false);
 const anonymous=await call(path);assert.equal(anonymous.data.game.review,undefined);assert.ok(anonymous.data.game.players.every(p=>p.score===undefined));
 let notices=await call('/notifications',{cookie});assert.equal(notices.data.unread,1);assert.equal(notices.data.notifications[0].gameId,id);
 await call(path+'/answer',{cookie:guestCookie,method:'POST',body:{position:4,choice:1}});assert.equal((await call('/notifications',{cookie})).data.unread,1);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM attempts WHERE user_id=?').bind(host.data.user.id).first()).n,5);
 await call('/notifications/'+notices.data.notifications[0].id+'/read',{cookie,method:'POST',body:{}});assert.equal((await call('/notifications',{cookie})).data.unread,0);
 assert.equal((await call('/games',{cookie})).data.games.length,1);
});
test('single extra question reveals a result and saves a normal discovery',async()=>{
 const cookie=challengeTestCookie;
 const response=await call('/games',{cookie,method:'POST',body:{kind:'solo',topic:'History',difficulty:'hard',count:1,requestId:crypto.randomUUID()}});assert.equal(response.status,200,JSON.stringify(response.data));
 const result=await call('/games/'+response.data.game.id+'/answer',{cookie,method:'POST',body:{position:0,choice:0}});assert.equal(result.data.game.complete,true);const id=result.data.game.review[0].id;
 assert.equal((await call('/questions/'+id,{cookie})).data.question.correct,0);
 assert.equal((await call('/questions/'+id+'/save',{cookie,method:'POST',body:{saved:true}})).status,200);
});
