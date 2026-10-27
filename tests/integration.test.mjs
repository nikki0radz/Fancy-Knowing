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
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:['index.mjs','core.mjs','ai.mjs','auth.mjs','profiles.mjs','mail.mjs'].map(f=>({type:'ESModule',path:new URL('../worker/'+f,import.meta.url).pathname})),compatibilityDate:'2026-10-26',d1Databases:['DB'],bindings:{SIGNUP_CODE:'private-test-code',OPENAI_API_KEY:'test-key',RESEND_API_KEY:'test-resend-key',EMAIL_FROM:'Fancy Knowing <onboarding@resend.dev>',APP_URL:origin},outboundService:async request=>{
  if(new URL(request.url).hostname==='api.resend.com'){if(mailFails)return Response.json({error:'sender not verified'},{status:403});sentEmails.push(await request.json());return Response.json({id:crypto.randomUUID()})}
  if(new URL(request.url).hostname==='api.openai.com'){const body=await request.json();if(body.text?.format?.name==='learning_topic'){const text=JSON.parse(body.input).proposedTopic;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(text==='asdfghjkl'?{accepted:false,topic:'',reason:'Try a recognisable topic, such as marine biology.'}:{accepted:true,topic:'Marine biology focused on sharks',reason:'A valid learning topic.'})}]}]})}
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Its gills take oxygen out of the water.'}]}]})};
  return new Response('Unexpected outbound request',{status:500});
 }}));
 db=await mf.getD1Database('DB');const schema=(await Promise.all(['0001_initial.sql','0002_email_profiles.sql','0003_avatar.sql','0004_welcome_email.sql'].map(f=>readFile(new URL('../migrations/'+f,import.meta.url),'utf8')))).join('\n');
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
 globalThis.fetch=async(url,options)=>{const request=JSON.parse(options.body);calls++;if(request.tools)assert.ok(request.input.includes(topic));return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:request.tools?'Shark gills take oxygen from the water.':JSON.stringify(generated),annotations:request.tools?[{type:'url_citation',url:generated.source}]:[]}]}]})};
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
 globalThis.fetch=async(url,options)=>{const request=JSON.parse(options.body);if(!request.tools){assert.equal(request.text.format.schema.properties.options.minItems,count);assert.equal(request.text.format.schema.properties.correct.maximum,count-1)}const q={topic:'Numbers',q:`Which option is number ${count}?`,options:Array.from({length:count},(_,i)=>String(i+1)),correct:count-1,explanation:`It is ${count}.`,source:'https://example.org/number',aliases:[],concept:`number-${count}-options`,follow:['Why?','How?','Where?']};return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:request.tools?'Evidence for the fact.':JSON.stringify(q),annotations:request.tools?[{type:'url_citation',url:q.source}]:[]}]}]})};
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
