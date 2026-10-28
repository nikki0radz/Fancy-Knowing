import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf,db;const sentEmails=[],sentPush=[];let mailFails=false,quizFails=false;
const origin='https://fancy-knowing.test';
async function call(path,{method='GET',body,cookie,originHeader=origin,ip}={}){
 const response=await mf.dispatchFetch(origin+'/api'+path,{method,headers:{...(ip?{'CF-Connecting-IP':ip}:{}),...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{Origin:originHeader}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 return {response,status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
const triviaUrl='https://quiz.example.test/trivia';
function vectorFor(text){let seed=2166136261;for(const c of text)seed=Math.imul(seed^c.charCodeAt(0),16777619)>>>0;return Array.from({length:256},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296-.5})}
function embeddingResponse(body){return Response.json({data:body.input.map((text,index)=>({index,embedding:vectorFor(text)}))})}
const aiText=(value,urls=[])=>{if(value&&typeof value==='object'){if(value.options&&value.correctAnswer===undefined)value={...value,correctAnswer:value.options[value.correct]};if(value.questions)value={...value,questions:value.questions.map(q=>({...q,correctAnswer:q.correctAnswer??q.options[q.correct]}))}}return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:typeof value==='string'?value:JSON.stringify(value),annotations:urls.map(url=>({type:'url_citation',url}))}]}]})};
function verificationFixture(body){if(body.tools&&/^Independently (verify|fact-check)/.test(body.instructions||'')){const input=JSON.parse(body.input);return aiText('Independent primary-source verification.',[input.source||'https://facts.example.test/source',triviaUrl])}return null}
function generationMock(handler){return async(url,options)=>{
 const body=JSON.parse(options.body);const verified=verificationFixture(body);if(verified)return verified;
 if(String(url).endsWith('/embeddings'))return embeddingResponse(body);
 if(body.text?.format?.name==='trivia_quality')return aiText({accepted:true,correctAnswer:JSON.parse(body.input).candidate.correctAnswer,reason:'A clear, unique answer.'});
 const response=await handler(url,options);if(!response.ok)return response;
 const data=await response.json();if(body.tools){for(const item of data.output||[])for(const content of item.content||[])(content.annotations||=[]).push({type:'url_citation',url:triviaUrl})}
 else if(body.text?.format?.name==='daily_question'){for(const item of data.output||[])for(const content of item.content||[]){const q=JSON.parse(content.text);content.text=JSON.stringify({...q,correctAnswer:q.correctAnswer??q.options[q.correct],subtopic:q.concept,triviaSource:triviaUrl})}}
 return Response.json(data);
}}
let generatedNumber=0,generatedTopic='Science',generationCalls=0;
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:['index.mjs','core.mjs','ai.mjs','auth.mjs','profiles.mjs','mail.mjs','welcome.mjs','memory.mjs','discoveries.mjs','games.mjs','trivia.mjs','friends.mjs','quiz.mjs','ready.mjs','participants.mjs','rooms.mjs','ranking.mjs','push.mjs','web-push.vendor.mjs','admin.mjs','account.mjs','allowances.mjs','usage.mjs'].map(f=>({type:'ESModule',path:new URL('../worker/'+f,import.meta.url).pathname})),compatibilityDate:'2026-10-26',d1Databases:['DB'],bindings:{SIGNUP_CODE:'private-test-code',OPENAI_API_KEY:'test-key',RESEND_API_KEY:'test-resend-key',EMAIL_FROM:'Fancy Knowing <onboarding@resend.dev>',APP_URL:origin},outboundService:async request=>{
  if(new URL(request.url).hostname==='fcm.googleapis.com'){sentPush.push({headers:Object.fromEntries(request.headers),body:await request.arrayBuffer()});return new Response(null,{status:201})}
  if(new URL(request.url).hostname==='api.resend.com'){if(mailFails)return Response.json({error:'sender not verified'},{status:403});sentEmails.push(await request.json());return Response.json({id:crypto.randomUUID()})}
  if(new URL(request.url).hostname==='api.openai.com'){if(quizFails)return Response.json({error:'fixture unavailable'},{status:503});const body=await request.json();const verified=verificationFixture(body);if(verified)return verified;
   if(new URL(request.url).pathname.endsWith('/embeddings'))return embeddingResponse(body);
   if(body.tools){generationCalls++;generatedNumber++;generatedTopic=JSON.parse(body.input).topic;return aiText('Fixture quiz and official factual evidence.',[triviaUrl,'https://facts.example.test/source'])}
   if(['trivia_pack_review','trivia_pack_sensecheck'].includes(body.text?.format?.name))return aiText({checks:JSON.parse(body.input).questions.map(q=>({accepted:true,correctAnswer:q.correctAnswer,reason:'Independently checked.'}))});
   if(body.text?.format?.name==='trivia_pack'){const input=JSON.parse(body.input),count=body.text.format.schema.properties.questions.minItems;return aiText({questions:Array.from({length:count},(_,i)=>{const format=input.formats[i],size=format==='multiple_choice'?body.text.format.schema.properties.questions.items.anyOf[0].properties.options.minItems:2,options=format==='true_false'?['True','False']:Array.from({length:size},(_,n)=>`Archive specimen ${generatedNumber}-${i}-${n}`);return {format,topic:input.topicPlan?.[i]||generatedTopic,q:`Which archive specimen has catalogue ${generatedNumber}-${i}?`,options,correct:0,explanation:'The archive records this specimen.',source:'https://facts.example.test/source',triviaSource:triviaUrl,concept:`pack-${generatedNumber}-${i}`,subtopic:`archive-${i}`,aliases:[],follow:['Where is it?','Who named it?','How old is it?']}})})}
   if(body.text?.format?.name==='trivia_quality')return aiText({accepted:true,correctAnswer:JSON.parse(body.input).candidate.correctAnswer,reason:'Clear fixture.'});
   if(body.text?.format?.name==='daily_question'){const count=body.text.format.schema.properties.options.minItems,format=body.text.format.schema.properties.format?.enum?.[0]||'multiple_choice';return aiText({format,topic:generatedTopic,q:`Which specimen has catalogue number ${generatedNumber}?`,options:format==='true_false'?['True','False']:Array.from({length:count},(_,i)=>`Specimen ${generatedNumber}-${i}`),correct:0,explanation:`It is specimen ${generatedNumber}-0.`,source:'https://facts.example.test/source',triviaSource:triviaUrl,concept:'fixture-fact-'+generatedNumber,subtopic:'fixture-subject-'+generatedNumber,aliases:[],follow:['Where is it?','Who named it?','How old is it?']})}
   if(body.text?.format?.name==='learning_topic'){const text=JSON.parse(body.input).proposedTopic;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(text==='asdfghjkl'?{accepted:false,topic:'',reason:'Try a recognisable topic, such as marine biology.'}:{accepted:true,topic:'Marine biology focused on sharks',reason:'A valid learning topic.'})}]}]})}
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Its gills take oxygen out of the water.'}]}]})};
  return new Response('Unexpected outbound request',{status:500});
 }}));
 db=await mf.getD1Database('DB');const schema=(await Promise.all(['0001_initial.sql','0002_email_profiles.sql','0003_avatar.sql','0004_welcome_email.sql','0005_shared_questions.sql','0006_question_slots_memory.sql','0007_trivia_challenges.sql','0008_friends.sql','0009_correct_tungsten.sql','0010_quiz_reveal.sql','0011_ready_questions_and_groups.sql','0012_keep_requested_topic_label.sql','0013_profile_mail_friend_notifications.sql','0014_quiz_ranking.sql','0015_phone_push.sql','0016_optional_refreshers.sql','0017_quiz_lobbies.sql','0018_quiz_comments.sql','0019_quiz_reactions.sql','0020_admin_allowances_usage.sql','0021_walkthrough_and_suggestions.sql'].map(f=>readFile(new URL('../migrations/'+f,import.meta.url),'utf8')))).join('\n');
 await db.batch(schema.replace(/CREATE TRIGGER[\s\S]*?END;/g,m=>m.replaceAll(';','__SQL_SEMI__')).split(';').map(s=>s.replaceAll('__SQL_SEMI__',';').trim()).filter(Boolean).map(s=>db.prepare(s)));
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
 const scheduled=await call('/questions/test-question/save',{method:'POST',cookie,body:{saved:true,reviewDays:3}});assert.equal(scheduled.status,200);assert.ok(Math.abs(scheduled.data.saved.due-Date.now()-3*86400000)<3000);
 assert.equal((await call('/questions/test-question/save',{method:'POST',cookie,body:{saved:true,reviewDays:0}})).status,400);
 const noRefresher=await call('/questions/test-question/save',{method:'POST',cookie,body:{saved:true,reviewDays:null}});assert.equal(noRefresher.status,200);assert.equal(noRefresher.data.saved.due,null);assert.equal((await call('/library',{cookie})).data.questions[0].saved.due,null);
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
 const niche=await call('/topics',{method:'POST',cookie,body:{topic:'marine biology focused on sharks'}});assert.equal(niche.status,200);assert.equal(niche.data.topic,'marine biology focused on sharks');
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
 try{const row=await dailyQuestion({DB:db,OPENAI_API_KEY:'test-key'},'2099-01-03',[topic]);assert.ok(row.day.startsWith('2099-01-03:'));assert.equal(JSON.parse(row.data).topic,topic);const again=await dailyQuestion({DB:db,OPENAI_API_KEY:'test-key'},'2099-01-03',[topic]);assert.equal(again.id,row.id);assert.equal(calls,2)}finally{globalThis.fetch=originalFetch}
});
test('design, frequency and question-count settings persist per account; avatars validate and stay private',async()=>{
 const account=await login('nicole@example.com','x'),cookie=account.cookie;
 const saved=await call('/settings',{method:'PUT',cookie,body:{font:'classic',fontSize:130,accentDark:'#d8ac47',backgroundDark:'#141414',dailyAmount:4,answerCount:10,notificationsEnabled:false}});assert.equal(saved.status,200);assert.equal(saved.data.settings.answerCount,4);assert.equal((await call('/me',{cookie})).data.user.settings.dailyAmount,4);
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
 try{for(count of [2,10]){const row=await dailyQuestion({DB:db,OPENAI_API_KEY:'test-key'},'2099-02-01',[],count);assert.equal(JSON.parse(row.data).options.length,count);if(count===10){const signed=await login('nicole@example.com','x');const answer=await call(`/questions/${row.id}/answer`,{method:'POST',cookie:signed.cookie,body:{choice:JSON.parse(row.data).correct,attemptId:crypto.randomUUID()}});assert.equal(answer.status,200);assert.equal(answer.data.question.attempt.correct,true)}}}finally{globalThis.fetch=originalFetch}
});
test('welcome emails are queued once per signup and delivered without resending on login',async()=>{
 const {deliverWelcome}=await import('../worker/mail.mjs');const originalFetch=globalThis.fetch;let sends=0;
 const row=await db.prepare("SELECT id,email FROM users WHERE email='legacy@example.com'").first();await db.prepare('INSERT INTO email_outbox(user_id,email,created_at) VALUES (?,?,?)').bind(row.id,row.email,Date.now()).run();
 globalThis.fetch=async(url,options)=>{sends++;const body=JSON.parse(options.body);const verified=verificationFixture(body);if(verified)return verified;assert.equal(body.to[0],row.email);assert.ok(body.subject.includes('Welcome'));assert.ok(body.text.includes('Forgot password'));return Response.json({id:'welcome-test'})};
 try{const env={DB:db,APP_URL:origin,RESEND_API_KEY:'test',EMAIL_FROM:'Fancy Knowing <onboarding@resend.dev>'};await deliverWelcome(env,row.id);await deliverWelcome(env,row.id);assert.equal(sends,1);assert.ok((await db.prepare('SELECT sent_at FROM email_outbox WHERE user_id=?').bind(row.id).first()).sent_at)}finally{globalThis.fetch=originalFetch}
});
test('Gmail bridge uses the protected server-only connection and rejects failed delivery',async()=>{
 const {sendEmail}=await import('../worker/mail.mjs');const originalFetch=globalThis.fetch;
 const env={APP_URL:origin,EMAIL_WEBHOOK_URL:'https://script.google.com/macros/s/test-deployment/exec',EMAIL_WEBHOOK_SECRET:'test-secret'};
 globalThis.fetch=async(url,options)=>{assert.equal(url,env.EMAIL_WEBHOOK_URL);const body=JSON.parse(options.body);const verified=verificationFixture(body);if(verified)return verified;assert.equal(body.secret,'test-secret');assert.equal(body.to,'mum@example.com');return Response.json({ok:true})};
 try{await sendEmail(env,{to:'mum@example.com',subject:'Fancy Knowing · Reset',text:'Test email',idempotencyKey:'test-key'});globalThis.fetch=async()=>Response.json({ok:false});await assert.rejects(()=>sendEmail(env,{to:'mum@example.com',subject:'Test',text:'Test',idempotencyKey:'test-key'}));await assert.rejects(()=>sendEmail({...env,EMAIL_WEBHOOK_URL:'https://wrong.example/exec'},{to:'mum@example.com',subject:'Test',text:'Test',idempotencyKey:'key'}))}finally{globalThis.fetch=originalFetch}
});

test('shared guest questions hide answers until a guess and never expose accounts or conversations',async()=>{
 const owner=await login('nicole@example.com','x'),other=await login('mum@example.com','another-test-password');
 assert.equal((await call('/questions/test-question/share',{method:'POST',body:{}})).status,401);
 assert.equal((await call('/questions/test-question/share',{method:'POST',cookie:other.cookie,body:{}})).status,403);
 const shared=await call('/questions/test-question/share',{method:'POST',cookie:owner.cookie,body:{}});assert.equal(shared.status,200);
 const url=new URL(shared.data.url);assert.equal(url.origin,origin);const token=url.searchParams.get('share');assert.match(token,/^[a-f0-9]{64}$/);
 assert.equal((await call('/questions/test-question/share',{method:'POST',cookie:owner.cookie,body:{}})).data.url,shared.data.url);
 const guest=await call('/shared/'+token);assert.equal(guest.status,200);assert.deepEqual(Object.keys(guest.data.question).sort(),['format','options','q','topic']);assert.equal(guest.cookie,undefined);
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
  const body=JSON.parse(options.body);const verified=verificationFixture(body);if(verified)return verified;if(url.endsWith('/embeddings'))return Response.json({data:[{index:0,embedding:vector(candidate===2?0:1)}]});
  if(body.tools){candidate++;return aiText('A quiz question and its factual verification.',[triviaUrl,source])}
  if(body.text?.format?.name==='trivia_quality'){audits++;return aiText({accepted:true,correctAnswer:JSON.parse(body.input).candidate.correctAnswer,reason:'Fresh fact.'})}
  return aiText({topic:'Nature',q:'New wording '+candidate,options:['New answer '+candidate,'Wrong'],correct:0,explanation:'Fixture evidence.',concept:candidate===1?'prior-150':'fresh-'+candidate,subtopic:'candidate-subject-'+candidate,source,triviaSource:triviaUrl,aliases:[],follow:['Why?','How?','Where?']});
 };
 try{const row=await dailyQuestion({DB:db,OPENAI_API_KEY:'test'},'2099-04-01',[],2,false,{userId:'semantic-test',slot:0,topic:'Nature',memory,format:'multiple_choice'});assert.equal(JSON.parse(row.data).concept,'fresh-3');assert.equal(candidate,3);assert.equal(audits,1)}finally{globalThis.fetch=originalFetch}
});
test('ambiguity review retries and never stores the rejected question',async()=>{
 const {dailyQuestion}=await import('../worker/ai.mjs');const originalFetch=globalThis.fetch;let candidate=0,audits=0;
 const source='https://facts.example.test/quality';
 globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);const verified=verificationFixture(body);if(verified)return verified;if(url.endsWith('/embeddings'))return embeddingResponse(body);
  if(body.tools){assert.match(body.instructions,/vowel LETTERS/);candidate++;return aiText('A quiz page and factual support for this fixture.',[triviaUrl,source])}
  if(body.text?.format?.name==='trivia_quality'){audits++;return aiText({accepted:candidate===2,correctAnswer:JSON.parse(body.input).candidate.correctAnswer,reason:'The first question has more than one plausible answer.'})}
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
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);const verified=verificationFixture(body);if(verified)return verified;if(url.endsWith('/embeddings'))return Response.json({error:'unavailable'},{status:503});if(body.tools)return aiText('Fixture quiz and evidence.',[triviaUrl,source]);return aiText({topic:'History',q:'Which fixture is it?',options:['One','Two'],correct:0,explanation:'Fixture.',concept:'unchecked-failure',subtopic:'failure-fixture',source,triviaSource:triviaUrl,aliases:[],follow:['Why?','How?','Where?']})};
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
test('legacy two-player challenge preserves answers, guest identity, privacy and persistent result badges',async()=>{
 const host=await call('/auth/signup',{method:'POST',body:{email:'challenge-host@example.com',password:'x',code:'private-test-code'}}),cookie=host.cookie;challengeTestCookie=cookie;
 const before=generationCalls,home=await call('/home',{cookie});assert.equal(home.status,200);assert.equal(home.data.slots.length,1);assert.equal(generationCalls,before);
 assert.equal((await call('/games',{method:'POST',body:{}})).status,401);
 const body={kind:'challenge',topic:'History',difficulty:'easy',count:5,requestId:crypto.randomUUID()};
 const created=await call('/games',{cookie,method:'POST',body});assert.equal(created.status,200,JSON.stringify(created.data));const game=created.data.game,id=game.id;
 await db.batch([db.prepare('INSERT INTO trivia_players(id,game_id,seat,user_id,guest_hash,name,joined_at,completed_at,score,verdict,question_started_at) SELECT id,game_id,seat,user_id,guest_hash,name,joined_at,completed_at,score,verdict,question_started_at FROM quiz_participants WHERE game_id=?').bind(id),db.prepare('DELETE FROM quiz_participants WHERE game_id=?').bind(id),db.prepare('UPDATE trivia_games SET group_mode=0 WHERE id=?').bind(id)]);
 assert.equal(game.question.options.length,game.question.format==='multiple_choice'?4:2);assert.equal(game.question.correct,undefined);assert.equal(game.review,undefined);
 assert.equal((await call('/games',{cookie,method:'POST',body})).data.game.id,id);
 const token=new URL(game.inviteUrl).searchParams.get('challenge'),path='/challenges/'+token;
 const outsider=await call(path);assert.equal(outsider.data.game.question,undefined);assert.equal(outsider.data.game.canJoin,true);
 const sameHost=await call(path+'/join',{cookie,method:'POST',body:{name:'Host'}});assert.equal(sameHost.data.game.players.length,1);
 const joined=await call(path+'/join',{method:'POST',body:{name:'A friend'}});assert.equal(joined.status,200);const guestCookie=joined.cookie;assert.ok(guestCookie);
 assert.deepEqual(joined.data.game.question,game.question);
 assert.equal((await call(path+'/join',{method:'POST',body:{name:'An intruder'}})).status,409);
 assert.equal((await call('/games/'+id,{cookie:(await call('/auth/login',{method:'POST',body:{email:'mum@example.com',password:'another-test-password'}})).cookie})).status,403);
 assert.equal((await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position:2,choice:0}})).status,409);
 for(let position=0;position<5;position++){const correct=(await gameKey(id,position)).correct;const r=await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position,choice:correct}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.game.review,undefined);assert.ok(r.data.game.players.every(p=>p.score===undefined))}
 assert.equal((await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position:0,choice:((await gameKey(id,0)).correct+1)%(await gameKey(id,0)).options.length}})).status,409);
 assert.equal((await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position:0,choice:(await gameKey(id,0)).correct}})).status,200);
 assert.equal((await call('/notifications',{cookie})).data.unread,0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM attempts WHERE user_id=?').bind(host.data.user.id).first()).n,0);
 let finished;for(let position=0;position<5;position++)finished=await call(path+'/answer',{cookie:guestCookie,method:'POST',body:{position,choice:((await gameKey(id,position)).correct+1)%(await gameKey(id,position)).options.length}});
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
 const result=await call('/games/'+response.data.game.id+'/answer',{cookie,method:'POST',body:{position:0,choice:(await gameKey(response.data.game.id,0)).correct}});assert.equal(result.data.game.complete,true);const id=result.data.game.review[0].id;
 assert.equal((await call('/questions/'+id,{cookie})).data.question.attempt.correct,true);
 assert.equal((await call('/questions/'+id+'/save',{cookie,method:'POST',body:{saved:true}})).status,200);
});

test('permanent friend usernames, accepted friendships and account-directed challenges',async()=>{
 const signup=async (label,ip)=>{const account=await call('/auth/signup',{method:'POST',ip,body:{email:label+'@example.test',password:'x',code:'private-test-code'}});assert.equal(account.status,200,JSON.stringify(account.data));return account};
 const host=await signup('friends-a','192.0.2.1'),friend=await signup('friends-b','192.0.2.2'),outsider=await signup('friends-c','192.0.2.3'),h=host.cookie,f=friend.cookie,o=outsider.cookie;
 assert.match(host.data.user.username,/^[A-Z][a-z]+[A-Z][a-z]+\d{2,4}$/);assert.notEqual(host.data.user.username,friend.data.user.username);
 const renamed=await call('/profile',{cookie:h,method:'PUT',body:{name:'Changed name',interests:['History'],includeEverything:false,username:'changed'}});assert.equal(renamed.status,200);assert.equal((await call('/me',{cookie:h})).data.user.username,host.data.user.username);
 assert.equal((await call('/friends',{method:'POST',body:{username:friend.data.user.username}})).status,401);
 assert.equal((await call('/friends',{cookie:h,method:'POST',body:{username:host.data.user.username}})).status,400);
 assert.equal((await call('/friends',{cookie:h,method:'POST',body:{username:'unknown-username-1234'}})).status,404);
 assert.equal((await call('/friends',{cookie:h,method:'POST',body:{username:friend.data.user.username}})).status,200);
 assert.equal((await call('/friends',{cookie:h})).data.friends[0].status,'outgoing');assert.equal((await call('/friends',{cookie:f})).data.friends[0].status,'incoming');assert.equal((await call('/friends',{cookie:o})).data.friends.length,0);
 assert.equal((await call('/friends/'+friend.data.user.id+'/accept',{cookie:h,method:'POST',body:{}})).status,404);
 assert.equal((await call('/friends/'+host.data.user.id+'/accept',{cookie:f,method:'POST',body:{}})).status,200);
 const friends=(await call('/friends',{cookie:f})).data.friends;assert.equal(friends[0].status,'accepted');assert.equal(friends[0].email,undefined);
 const settings=await call('/settings',{cookie:h,method:'PUT',body:{periodWindows:{afternoon:{start:'15:00',end:'17:00'}}}});assert.equal(settings.status,200);assert.equal((await call('/me',{cookie:f})).data.user.settings.periodWindows,undefined);
 const bad=await call('/games',{cookie:h,method:'POST',body:{kind:'challenge',topic:'History',difficulty:'medium',count:5,friendId:outsider.data.user.id,requestId:crypto.randomUUID()}});assert.equal(bad.status,403);
 const created=await call('/games',{cookie:h,method:'POST',body:{kind:'challenge',topic:'History',difficulty:'medium',count:5,friendId:friend.data.user.id,requestId:crypto.randomUUID()}});assert.equal(created.status,200,JSON.stringify(created.data));const game=created.data.game,id=game.id,path='/challenges/'+new URL(game.inviteUrl).searchParams.get('challenge');
 const invite=(await call('/games',{cookie:f})).data.games[0];assert.equal(invite.id,id);assert.equal(invite.joined,false);assert.ok(invite.joinToken);assert.equal(invite.canJoin,true);
 assert.equal((await call('/games/'+id,{cookie:o})).status,403);assert.equal((await call(path)).data.game.canJoin,true);
 let notices=(await call('/notifications',{cookie:f})).data;assert.equal(notices.unread,1);assert.equal(notices.notifications[0].type,'challenge_invite');const nid=notices.notifications[0].id;
 await call('/notifications/'+nid+'/read',{cookie:o,method:'POST',body:{}});assert.equal((await call('/notifications',{cookie:f})).data.unread,1);
 await call('/notifications/'+nid+'/read',{cookie:f,method:'POST',body:{}});assert.equal((await call('/notifications',{cookie:f})).data.unread,0);
 assert.equal((await call(path+'/join',{cookie:f,method:'POST',body:{name:'Friend'}})).status,200);
 for(const cookie of [h,f])for(let position=0;position<5;position++)assert.equal((await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position,choice:0}})).status,200);
 notices=(await call('/notifications',{cookie:f})).data;assert.equal(notices.unread,1);assert.equal(notices.notifications[0].type,'challenge_result');assert.equal(notices.notifications[0].id,nid);
 await call('/notifications/'+nid+'/read',{cookie:f,method:'POST',body:{}});await call('/games/'+id+'/answer',{cookie:h,method:'POST',body:{position:4,choice:0}});assert.equal((await call('/notifications',{cookie:f})).data.unread,0);
 assert.equal((await call('/friends/'+friend.data.user.id,{cookie:h,method:'DELETE',body:{}})).status,200);assert.equal((await call('/friends',{cookie:f})).data.friends.length,0);
});
test('the reported Tungsten question and its historical grading are corrected together',async()=>{
 const fix=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-26',d1Databases:['FIX']}));
 try{const database=await fix.getD1Database('FIX');for(const file of ['0001_initial.sql','0002_email_profiles.sql','0003_avatar.sql','0004_welcome_email.sql','0005_shared_questions.sql','0006_question_slots_memory.sql','0007_trivia_challenges.sql']){const sql=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');await database.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>database.prepare(s)))}
 await database.prepare("INSERT INTO users(id,username,password_hash,salt,created_at) VALUES ('fix-user','fix','x','x',1)").run();
 const q={q:'Which element has the highest boiling point of 5933.2 Kelvin?',options:['Iron','Tungsten','Gold','Lead'],correct:2,explanation:'Tungsten has the highest boiling point among all elements.',aliases:[]};
 await database.prepare('INSERT INTO questions(id,day,fingerprint,concept,data,created_at) VALUES (?,?,?,?,?,?)').bind('fix-q','2026-10-27','fix','fix',JSON.stringify(q),1).run();
 for(const [id,choice,correct]of [['tungsten',1,0],['gold',2,1]])await database.prepare('INSERT INTO attempts(id,user_id,question_id,choice,correct,created_at) VALUES (?,?,?,?,?,?)').bind(id,'fix-user','fix-q',choice,correct,1).run();
 const sql=await readFile(new URL('../migrations/0009_correct_tungsten.sql',import.meta.url),'utf8');await database.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>database.prepare(s)));
 const corrected=JSON.parse((await database.prepare("SELECT data FROM questions WHERE id='fix-q'").first()).data);assert.equal(corrected.correct,1);assert.equal(corrected.correctAnswer,'Tungsten');assert.ok(!corrected.q.includes('5933.2'));assert.equal((await database.prepare("SELECT correct FROM attempts WHERE id='tungsten'").first()).correct,1);assert.equal((await database.prepare("SELECT correct FROM attempts WHERE id='gold'").first()).correct,0);
 assert.equal(JSON.parse((await database.prepare("SELECT previous_data FROM corrected_question_keys WHERE question_id='fix-q'").first()).previous_data).correct,2);
 }finally{await fix.dispose()}
});

test('generation retries both a mismatched index and an editor answer disagreement',async()=>{
 const {dailyQuestion}=await import('../worker/ai.mjs'),previousFetch=globalThis.fetch;let candidate=0,audits=0;
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);const verified=verificationFixture(body);if(verified)return verified;if(url.endsWith('/embeddings'))return embeddingResponse(body);if(body.tools){candidate++;return aiText('A quiz page and verified evidence.',[triviaUrl,'https://facts.example.test/answer-check'])}if(body.text?.format?.name==='trivia_quality'){audits++;return aiText({accepted:true,reason:'Fixture',correctAnswer:candidate===2?'Gold':'Tungsten'})}return aiText({topic:'Chemistry',q:'Answer key candidate '+candidate,options:['Iron','Tungsten','Gold','Lead'],correct:candidate===1?2:1,correctAnswer:'Tungsten',explanation:'The answer is Tungsten.',concept:'key-check-'+candidate,subtopic:'key-subject-'+candidate,source:'https://facts.example.test/answer-check',triviaSource:triviaUrl,aliases:[],follow:['Why?','How?','Where?']})};
 try{const row=await dailyQuestion({DB:db,OPENAI_API_KEY:'test'},'2099-05-01',[],4);assert.equal(candidate,3);assert.equal(audits,2);assert.equal(JSON.parse(row.data).options[JSON.parse(row.data).correct],'Tungsten');assert.equal(await db.prepare("SELECT id FROM questions WHERE concept='key-check-1' OR concept='key-check-2'").first(),null)}finally{globalThis.fetch=previousFetch}
});

async function gameKey(id,position){return JSON.parse((await db.prepare('SELECT q.data FROM trivia_game_questions g JOIN questions q ON q.id=g.question_id WHERE g.game_id=? AND g.position=?').bind(id,position).first()).data)}

test('variable quiz lengths, mixed formats, metric defaults and cached AI verdicts',async()=>{
 const cookie=challengeTestCookie;
 const approved=await call('/topics',{cookie,method:'POST',body:{topic:'General knowledge'}});assert.equal(approved.data.topic,'General knowledge');
 for(const count of [2,20]){
  const created=await call('/games',{cookie,method:'POST',body:{kind:'solo',topic:'General knowledge',difficulty:'medium',count,requestId:crypto.randomUUID()}});assert.equal(created.status,200,JSON.stringify(created.data));const id=created.data.game.id;
  const rows=(await db.prepare('SELECT q.data FROM trivia_game_questions g JOIN questions q ON q.id=g.question_id WHERE g.game_id=? ORDER BY g.position').bind(id).all()).results.map(r=>JSON.parse(r.data));assert.equal(rows.length,count);assert.ok(rows.some(q=>q.format==='true_false'));assert.ok(rows.every(q=>q.format!=='this_or_that'));if(count===20)assert.equal(rows.filter(q=>q.format==='multiple_choice').length,16);
  for(const q of rows){assert.equal(q.options.length,q.format==='multiple_choice'?4:2);assert.equal(q.correctAnswer,q.options[q.correct])}
  assert.equal((await call('/games/'+id+'/verdict',{cookie,method:'POST',body:{}})).status,403);
  for(let position=0;position<count;position++)assert.equal((await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position,choice:rows[position].correct}})).status,200);
  const result=(await call('/games/'+id,{cookie})).data.game;assert.equal(result.players.find(p=>p.self).score,count);assert.equal(result.review.length,count);assert.ok(result.fallbackVerdict);
  const verdict=await call('/games/'+id+'/verdict',{cookie,method:'POST',body:{}});assert.equal(verdict.status,200);assert.equal(typeof verdict.data.verdict,'string');assert.equal((await call('/games/'+id+'/verdict',{cookie,method:'POST',body:{}})).data.verdict,verdict.data.verdict);
 }
 for(const count of [0,21,2.5])assert.equal((await call('/games',{cookie,method:'POST',body:{kind:'solo',topic:'History',difficulty:'easy',count,requestId:crypto.randomUUID()}})).status,400);
 assert.equal((await call('/settings',{cookie,method:'PUT',body:{units:'imperial'}})).status,200);
 const q={topic:'Chemistry',format:'multiple_choice',q:'What temperature is 100 °C in this fixture?',options:['100 °C','20 °C','50 °C','0 °C'],correct:0,explanation:'The fixture is 100 °C.',source:'https://example.test',aliases:[],follow:['Why?','How?','Where?']};await db.prepare('INSERT INTO questions(id,day,fingerprint,concept,data,created_at) VALUES (?,?,?,?,?,?)').bind('units-q','units-test','units-fp','units-test',JSON.stringify(q),Date.now()).run();
 const imperial=await call('/questions/units-q',{cookie});assert.ok(imperial.data.question.q.includes('212 °F'));assert.equal(imperial.data.question.correct,undefined);
 const answer=await call('/questions/units-q/answer',{cookie,method:'POST',body:{typed:'212 °F',attemptId:crypto.randomUUID()}});assert.equal(answer.data.question.attempt.correct,true);assert.ok(answer.data.question.explanation.includes('212 °F'));
 const source=JSON.parse((await db.prepare("SELECT data FROM questions WHERE id='units-q'").first()).data);assert.equal(source.q,q.q);
 const topics=await call('/quiz-topics',{cookie});assert.equal(topics.data.topics[0],'General knowledge');assert.ok(topics.data.topics.includes('History'));assert.ok(!topics.data.topics.includes('Mixed topics'));
});

test('quiz retries retain verified questions and replace only rejected formats',async()=>{
 const {triviaPack}=await import('../worker/trivia.mjs'),previousFetch=globalThis.fetch;let round=0,factChecks=0,senseChecks=0;
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(url.endsWith('/embeddings'))return embeddingResponse(body);if(body.tools){if(body.instructions.startsWith('Research'))round++;return aiText('Independently sourced facts.',[triviaUrl,'https://facts.example.test/partial'])}
 if(body.text?.format?.name==='trivia_pack'){const input=JSON.parse(body.input);return aiText({questions:input.formats.map((format,i)=>({format,topic:'History',q:'Verified retry fixture '+round+'-'+i,options:format==='true_false'?['True','False']:Array.from({length:format==='multiple_choice'?4:2},(_,j)=>'Option '+j),correct:0,explanation:'A verified fixture.',concept:'partial-'+round+'-'+i,subtopic:'retry-subject-'+round+'-'+i,source:'https://facts.example.test/partial',triviaSource:triviaUrl,aliases:[],follow:['Why?','How?','Where?']}))})}
 const input=JSON.parse(body.input),fact=body.text?.format?.name==='trivia_pack_review';if(fact)factChecks++;else senseChecks++;return aiText({checks:input.questions.map(q=>({accepted:!(fact&&q.concept==='partial-1-1'),correctAnswer:q.correctAnswer,reason:'Only the first true/false item needs replacement.'}))});
 };
 try{const pack=await triviaPack({DB:db,OPENAI_API_KEY:'test'},{id:'partial-new-user'},'History','medium',3,4);assert.equal(round,2);assert.equal(factChecks,2);assert.equal(senseChecks,2);assert.equal(pack.questions.length,3);assert.ok(pack.questions.some(q=>q.concept==='partial-1-0'));assert.ok(pack.questions.some(q=>q.concept==='partial-1-2'));assert.ok(!pack.questions.some(q=>q.concept==='partial-1-1'));assert.deepEqual(new Set(pack.questions.map(q=>q.format)),new Set(['multiple_choice','true_false']))}finally{globalThis.fetch=previousFetch}
});

test('prepared discoveries follow profile interests, consume atomically, and prepare future days',async()=>{
 const account=await call('/auth/signup',{method:'POST',ip:'192.0.2.20',body:{email:'ready@example.test',password:'x',code:'private-test-code'}}),cookie=account.cookie,id=account.data.user.id;
 await call('/profile',{method:'PUT',cookie,body:{name:'Ready',interests:['History','Chemistry'],includeEverything:false}});
 assert.equal((await call('/home',{cookie})).data.readyCount,0);
 for(let pass=0;pass<3;pass++){const prep=await call('/discoveries/prepare',{method:'POST',cookie,body:{}});assert.equal(prep.status,200,JSON.stringify(prep.data))}
 const reserve=await call('/home',{cookie});assert.equal(reserve.data.readyCount,8);
 const future=await db.prepare('SELECT COUNT(DISTINCT day) n FROM daily_ready WHERE user_id=?').bind(id).first();assert.equal(future.n,4);
 const before=generationCalls,results=await Promise.all([call('/discoveries/next',{method:'POST',cookie,body:{}}),call('/discoveries/next',{method:'POST',cookie,body:{}})]);assert.ok(results.every(r=>r.status===200));assert.notEqual(results[0].data.questionId,results[1].data.questionId);assert.equal(generationCalls,before);
 for(const result of results){const question=(await call('/questions/'+result.data.questionId,{cookie})).data.question;assert.ok(['History','Chemistry'].includes(question.topic));assert.equal(question.correct,undefined)}
 const daily=await call('/today',{cookie});assert.equal(daily.status,200);assert.equal(generationCalls,before);
 const niche=await call('/topics',{cookie,method:'POST',body:{topic:'shark species'}});assert.equal(niche.data.topic,'shark species');await call('/profile',{cookie,method:'PUT',body:{name:'Ready',interests:['shark species'],includeEverything:false}});assert.equal((await call('/home',{cookie})).data.readyCount,0);assert.equal((await call('/discoveries/next',{cookie,method:'POST',body:{}})).status,503);
 const stats=await call('/my-profile',{cookie});assert.equal(stats.status,200);assert.match(stats.data.user.username,/^[A-Z][a-z]+[A-Z][a-z]+\d{2,4}$/);assert.equal(stats.data.stats.discoveries,0);assert.equal((await call('/my-profile')).status,401);
});
test('one quiz accepts multiple guests and friends, reports their scores and restricts guest AI access',async()=>{
 const make=async(label,ip)=>{const r=await call('/auth/signup',{method:'POST',ip,body:{email:label+'@example.test',password:'x',code:'private-test-code'}});assert.equal(r.status,200);return r};
 const host=await make('room-host','192.0.2.30'),friendA=await make('room-friend-a','192.0.2.31'),friendB=await make('room-friend-b','192.0.2.32'),h=host.cookie;
 for(const friend of [friendA,friendB]){await call('/friends',{cookie:h,method:'POST',body:{username:friend.data.user.username.toLowerCase()}});await call('/friends/'+host.data.user.id+'/accept',{cookie:friend.cookie,method:'POST',body:{}})}
 const created=await call('/games',{cookie:h,method:'POST',body:{kind:'challenge',topic:'History',difficulty:'easy',count:2,friendIds:[friendA.data.user.id,friendB.data.user.id],requestId:crypto.randomUUID()}});assert.equal(created.status,200,JSON.stringify(created.data));const g=created.data.game,id=g.id,path='/challenges/'+new URL(g.inviteUrl).searchParams.get('challenge');assert.equal(g.group,true);
 for(const friend of [friendA,friendB]){assert.ok((await call('/games',{cookie:friend.cookie})).data.games.some(g=>g.id===id));assert.equal((await call('/games/'+id,{cookie:friend.cookie})).status,200);assert.equal((await call(path+'/join',{cookie:friend.cookie,method:'POST',body:{name:'Friend'}})).status,200)}
 const guests=[];for(const name of ['Alex','Sam','Taylor']){const joined=await call(path+'/join',{method:'POST',body:{name}});assert.equal(joined.status,200,JSON.stringify(joined.data));guests.push(joined.cookie)}
 for(const cookie of [h,...guests])for(let position=0;position<2;position++){const answer=await gameKey(id,position),r=await call(cookie===h?'/games/'+id+'/answer':path+'/answer',{cookie,method:'POST',body:{position,choice:answer.correct}});assert.equal(r.status,200,JSON.stringify(r.data))}
 const board=(await call('/games/'+id,{cookie:h})).data.game;assert.equal(board.players.length,6);assert.equal(board.complete,true);assert.equal(board.roomComplete,false);assert.equal(board.players.filter(p=>p.score===2).length,4);
 const guestCookie=guests[0],questionId=board.review[0].id;
 assert.equal((await call('/questions/'+questionId+'/chat',{cookie:guestCookie,method:'POST',body:{message:'Why?'}})).status,401);assert.equal((await call('/questions/'+questionId+'/save',{cookie:guestCookie,method:'POST',body:{saved:true}})).status,401);
 const callsBefore=generationCalls;const verdict=await call(path+'/verdict',{cookie:guestCookie,method:'POST',body:{}});assert.equal(verdict.status,200);assert.equal(generationCalls,callsBefore);
 assert.equal((await call('/games/'+id+'/close',{cookie:friendA.cookie,method:'POST',body:{}})).status,403);assert.equal((await call('/games/'+id+'/close',{cookie:h,method:'POST',body:{}})).status,200);assert.equal((await call(path+'/join',{method:'POST',body:{name:'Too late'}})).status,409);
 const notices=(await call('/notifications',{cookie:h})).data;assert.ok(notices.notifications.some(n=>n.gameId===id&&n.title.includes('beat you')||n.title.includes('still ahead')||n.title.includes('matched your')||n.title.includes('completed your challenge')));
});
test('a solo quiz becomes shareable without losing its saved answers, and timers survive refresh',async()=>{
 const host=await call('/auth/signup',{method:'POST',ip:'192.0.2.40',body:{email:'timer-host@example.test',password:'x',code:'private-test-code'}}),cookie=host.cookie;
 await call('/settings',{cookie,method:'PUT',body:{timerSeconds:10}});
 const created=await call('/games',{cookie,method:'POST',body:{kind:'solo',topic:'History',difficulty:'medium',count:2,requestId:crypto.randomUUID()}});assert.equal(created.status,200,JSON.stringify(created.data));const id=created.data.game.id,deadline=created.data.game.deadline;assert.ok(deadline>Date.now());assert.equal((await call('/games/'+id,{cookie})).data.game.deadline,deadline);
 await db.prepare('UPDATE trivia_players SET question_started_at=? WHERE game_id=?').bind(Date.now()-11000,id).run();
 const late=await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position:0,choice:(await gameKey(id,0)).correct}});assert.equal(late.status,200);assert.equal((await db.prepare('SELECT choice FROM trivia_answers a JOIN trivia_players p ON p.id=a.player_id WHERE p.game_id=? AND position=0').bind(id).first()).choice,-1);
 const shared=await call('/games/'+id+'/share',{cookie,method:'POST',body:{}});assert.equal(shared.status,200,JSON.stringify(shared.data));assert.equal(shared.data.game.group,true);assert.equal(shared.data.game.answered,1);assert.ok(shared.data.game.inviteUrl);
 assert.equal((await call('/games/'+id+'/share',{cookie,method:'POST',body:{}})).data.game.inviteUrl,shared.data.game.inviteUrl);
 const result=await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position:1,choice:(await gameKey(id,1)).correct}});assert.equal(result.status,200);assert.equal(result.data.game.complete,true);assert.equal(result.data.game.players.find(p=>p.self).score,1);assert.equal(result.data.game.review[0].choice,-1);
});

test('username and topic migrations preserve old lookup names, friendships and question history',async()=>{
 const instance=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-26',d1Databases:['MIGRATE']}));
 try{const database=await instance.getD1Database('MIGRATE');
  for(const file of ['0001_initial.sql','0002_email_profiles.sql','0003_avatar.sql','0004_welcome_email.sql','0005_shared_questions.sql','0006_question_slots_memory.sql','0007_trivia_challenges.sql','0008_friends.sql','0009_correct_tungsten.sql','0010_quiz_reveal.sql']){const sql=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');await database.batch(sql.replace(/CREATE TRIGGER[\s\S]*?END;/g,m=>m.replaceAll(';','__SQL_SEMI__')).split(';').map(s=>s.replaceAll('__SQL_SEMI__',';').trim()).filter(Boolean).map(sql=>database.prepare(sql)))}
  const profile=JSON.stringify({name:'Nicole',interests:['Marine biology focused on shark species'],onboardingComplete:true});
  await database.batch([database.prepare("INSERT INTO users(id,username,friend_username,password_hash,salt,settings,profile,created_at) VALUES ('one','internal-one','curious-otter-aabbcc','x','x','{}',?,1)").bind(profile),database.prepare("INSERT INTO users(id,username,friend_username,password_hash,salt,settings,profile,created_at) VALUES ('two','internal-two','silent-robin-ddeeff','x','x','{}','{}',2)"),database.prepare("INSERT INTO friendships(user_low,user_high,requested_by,created_at,accepted_at) VALUES ('one','two','one',1,2)"),database.prepare("INSERT INTO approved_topics(user_id,topic,created_at) VALUES ('one','Marine biology focused on shark species',1)"),database.prepare('INSERT INTO questions(id,day,fingerprint,concept,data,created_at) VALUES (?,?,?,?,?,?)').bind('label-q','label-day','label-fp','label-fact',JSON.stringify({topic:'Marine biology focused on shark species',q:'Fixture question',options:['One','Two'],correct:0}),1)]);
  await database.batch([database.prepare("UPDATE users SET email=id||'@migration.test'"),database.prepare("INSERT INTO users(id,username,email,friend_username,password_hash,salt,settings,profile,created_at) VALUES ('three','internal-three','three@migration.test','third-user','x','x','{}','{}',3)"),database.prepare("INSERT INTO email_outbox(user_id,email,created_at,sent_at,attempts) VALUES ('one','one@migration.test',1,123,1)"),database.prepare("INSERT INTO email_outbox(user_id,email,created_at,attempts,last_attempt_at) VALUES ('three','old-address@migration.test',1,8,999)"),database.prepare("INSERT INTO friendships(user_low,user_high,requested_by,created_at) VALUES ('three','two','two',3)")]);
  for(const file of ['0011_ready_questions_and_groups.sql','0012_keep_requested_topic_label.sql','0013_profile_mail_friend_notifications.sql','0014_quiz_ranking.sql','0015_phone_push.sql','0016_optional_refreshers.sql','0017_quiz_lobbies.sql','0018_quiz_comments.sql','0019_quiz_reactions.sql','0020_admin_allowances_usage.sql','0021_walkthrough_and_suggestions.sql']){const sql=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');await database.batch(sql.replace(/CREATE TRIGGER[\s\S]*?END;/g,m=>m.replaceAll(';','__SQL_SEMI__')).split(';').map(s=>s.replaceAll('__SQL_SEMI__',';').trim()).filter(Boolean).map(sql=>database.prepare(sql)))}
  const user=await database.prepare("SELECT * FROM users WHERE id='one'").first();assert.match(user.friend_username,/^[A-Z][a-z]+[A-Z][a-z]+\d+$/);assert.deepEqual(JSON.parse(user.profile).interests,['shark species']);assert.equal((await database.prepare("SELECT user_id FROM friend_username_aliases WHERE alias='CURIOUS-OTTER-AABBCC'").first()).user_id,'one');assert.equal((await database.prepare('SELECT COUNT(*) n FROM friendships').first()).n,2);assert.equal((await database.prepare("SELECT sent_at FROM email_outbox WHERE user_id='one'").first()).sent_at,123);assert.equal((await database.prepare("SELECT email FROM email_outbox WHERE user_id='two'").first()).email,'two@migration.test');const revived=await database.prepare("SELECT * FROM email_outbox WHERE user_id='three'").first();assert.equal(revived.attempts,0);assert.equal(revived.last_attempt_at,null);assert.equal(revived.email,'three@migration.test');const incoming=await database.prepare("SELECT * FROM friend_notifications WHERE user_id='three'").first();assert.equal(incoming.actor_id,'two');assert.equal(incoming.kind,'request');assert.equal(JSON.parse((await database.prepare("SELECT data FROM questions WHERE id='label-q'").first()).data).topic,'shark species');
 }finally{await instance.dispose()}
});


test('quiz limits count successful creations, refund failures, and preserve replay and lock safety',async()=>{
 const account=await call('/auth/signup',{method:'POST',ip:'192.0.2.77',body:{email:'quota@example.test',password:'x',code:'private-test-code'}}),cookie=account.cookie,id=account.data.user.id;
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),key=`completed-games:${id}:${day}`;
 await db.prepare('INSERT INTO budgets(key,count,expires_at) VALUES (?,12,?)').bind(`games:${id}:${day}`,Date.now()+86400000).run();
 const input={kind:'challenge',topic:'History',difficulty:'easy',count:2,requestId:crypto.randomUUID()};
 quizFails=true;try{assert.equal((await call('/games',{cookie,method:'POST',body:input})).status,502)}finally{quizFails=false}
 assert.equal((await db.prepare('SELECT count FROM budgets WHERE key=?').bind(key).first()).count,0);
 assert.equal(await db.prepare('SELECT key FROM locks WHERE key=?').bind('create-game:'+id).first(),null);
 const result=await call('/games',{cookie,method:'POST',body:input});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal((await db.prepare('SELECT count FROM budgets WHERE key=?').bind(key).first()).count,1);
 await db.prepare('UPDATE budgets SET count=30 WHERE key=?').bind(key).run();
 assert.equal((await call('/games',{cookie,method:'POST',body:input})).data.game.id,result.data.game.id);
 const limited=await call('/games',{cookie,method:'POST',body:{...input,requestId:crypto.randomUUID()}});assert.equal(limited.status,429);assert.match(limited.data.error,/out of quizzes for today/);const allowance=await call('/games/quota',{cookie});assert.equal(allowance.data.remaining,0);assert.equal(allowance.data.limit,30);assert.equal((await call('/games/quota')).status,401);
 assert.equal((await call('/games/'+result.data.game.id+'/share',{cookie,method:'POST',body:{}})).status,200);
 await db.prepare('UPDATE budgets SET expires_at=0 WHERE key=?').bind(key).run();
 assert.equal((await call('/games',{cookie,method:'POST',body:{...input,requestId:crypto.randomUUID()}})).status,200);
 assert.equal((await db.prepare('SELECT count FROM budgets WHERE key=?').bind(key).first()).count,1);assert.equal((await call('/games/quota',{cookie})).data.remaining,29);
});

test('testing mode bypasses quiz quotas while preserving private access and preparation locks',async()=>{
 const {gamesApi}=await import('../worker/games.mjs');
 const account=await call('/auth/signup',{method:'POST',ip:'192.0.2.78',body:{email:'unlimited@example.test',password:'x',code:'private-test-code'}}),id=account.data.user.id,user=await db.prepare('SELECT * FROM users WHERE id=?').bind(id).first(),env={DB:db,QUIZ_LIMITS_ENABLED:'false'},input={kind:'solo',topic:'History',difficulty:'easy',count:2,requestId:crypto.randomUUID()};
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),keys=[`completed-games:${id}:${day}`,`quiz-preparation:${id}:${Math.floor(Date.now()/3600000)}`];
 for(const key of keys)await db.prepare('INSERT INTO budgets(key,count,expires_at) VALUES (?,30,?)').bind(key,Date.now()+86400000).run();
 const status=await gamesApi(new Request(origin+'/api/games/quota'),env,user,async()=>({}));assert.deepEqual((await status.json()).remaining,null);
 await assert.rejects(()=>gamesApi(new Request(origin+'/api/games',{method:'POST'}),env,user,async()=>input),/AI key/);
 for(const key of keys)assert.equal((await db.prepare('SELECT count FROM budgets WHERE key=?').bind(key).first()).count,30);
 assert.equal(await db.prepare('SELECT key FROM locks WHERE key=?').bind('create-game:'+id).first(),null);
 await assert.rejects(()=>gamesApi(new Request(origin+'/api/games/quota'),env,null,async()=>({})),/Sign in first/);
 const deploy=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));assert.equal(deploy.vars.QUIZ_LIMITS_ENABLED,'true');
});


test('dashboard counts today’s distinct answers and quiz participation, with real generation allowance',async()=>{
 const account=await call('/auth/signup',{method:'POST',ip:'192.0.2.79',body:{email:'dashboard@example.test',password:'x',code:'private-test-code'}}),cookie=account.cookie,id=account.data.user.id,now=Date.now(),old=now-3*86400000;
 await call('/profile',{cookie,method:'PUT',body:{name:'Dashboard',interests:['History'],includeEverything:false}});
 for(const [suffix,time] of [['a',now],['b',now],['old',old]])await db.prepare('INSERT INTO attempts(id,user_id,question_id,choice,correct,created_at) VALUES (?,?,?,?,?,?)').bind('dashboard-'+suffix,id,'test-question',0,1,time).run();
 const make=kind=>call('/games',{cookie,method:'POST',body:{kind,topic:'History',difficulty:'easy',count:2,requestId:crypto.randomUUID()}});
 const solo=await make('solo'),group=await make('challenge');assert.equal(solo.status,200);assert.equal(group.status,200);
 await db.prepare('UPDATE trivia_players SET joined_at=?,completed_at=? WHERE game_id=?').bind(old,now,solo.data.game.id).run();
 const home=await call('/home',{cookie});assert.deepEqual(home.data.stats,{questionsToday:1,quizzesToday:2});assert.equal(home.data.quizAllowance.remaining,28);assert.equal(home.data.quizAllowance.limited,true);
 await db.prepare('UPDATE trivia_players SET completed_at=? WHERE game_id=?').bind(old,solo.data.game.id).run();assert.equal((await call('/home',{cookie})).data.stats.quizzesToday,1);
 const friend=await call('/auth/signup',{method:'POST',ip:'192.0.2.80',body:{email:'dashboard-friend@example.test',password:'x',code:'private-test-code'}}),friendCookie=friend.cookie;
 await call('/friends',{cookie,method:'POST',body:{username:friend.data.user.username}});const requests=await call('/friends',{cookie:friendCookie}),pending=requests.data.friends.find(f=>f.id===id);
 assert.ok(pending);assert.equal((await call('/friends/'+id+'/accept',{cookie:friendCookie,method:'POST',body:{}})).status,200);
 await call('/games/'+group.data.game.id+'/invite',{cookie,method:'POST',body:{friendIds:[friend.data.user.id]}});
 const notices=(await call('/notifications',{cookie:friendCookie})).data;assert.ok(notices.notifications.some(n=>n.title==='Dashboard just invited you to a challenge'));
});

test('friend requests and acceptances have private persistent notifications and withdrawn requests disappear',async()=>{
 const make=async(label,ip)=>call('/auth/signup',{method:'POST',ip,body:{email:label+'@example.test',password:'x',code:'private-test-code'}}),a=await make('social-notify-a','192.0.2.81'),b=await make('social-notify-b','192.0.2.82'),c=await make('social-notify-c','192.0.2.83');
 await call('/friends',{cookie:a.cookie,method:'POST',body:{username:b.data.user.username}});await call('/friends',{cookie:a.cookie,method:'POST',body:{username:b.data.user.username}});
 let box=(await call('/notifications',{cookie:b.cookie})).data;assert.equal(box.notifications.length,1);assert.equal(box.notifications[0].type,'friend_request');assert.equal(box.notifications[0].friendId,a.data.user.id);assert.equal(box.unread,1);const notice=box.notifications[0].id;
 await call('/notifications/'+notice+'/read',{cookie:c.cookie,method:'POST',body:{}});assert.equal((await call('/notifications',{cookie:b.cookie})).data.unread,1);
 await call('/notifications/'+notice+'/read',{cookie:b.cookie,method:'POST',body:{}});assert.equal((await call('/notifications',{cookie:b.cookie})).data.unread,0);
 await call('/friends/'+a.data.user.id+'/accept',{cookie:b.cookie,method:'POST',body:{}});await call('/friends/'+a.data.user.id+'/accept',{cookie:b.cookie,method:'POST',body:{}});
 box=(await call('/notifications',{cookie:a.cookie})).data;assert.equal(box.notifications.length,1);assert.equal(box.notifications[0].type,'friend_accepted');assert.equal((await call('/notifications',{cookie:b.cookie})).data.notifications.length,0);
 await call('/friends',{cookie:c.cookie,method:'POST',body:{username:b.data.user.username}});assert.equal((await call('/notifications',{cookie:b.cookie})).data.unread,1);await call('/friends/'+b.data.user.id,{cookie:c.cookie,method:'DELETE',body:{}});assert.equal((await call('/notifications',{cookie:b.cookie})).data.unread,0);
});

test('welcome sender failures are visible privately and retry retains idempotency until a successful send',async()=>{
 const {deliverWelcome,welcomeStatus,retryWelcome}=await import('../worker/mail.mjs'),original=globalThis.fetch,account=await call('/auth/signup',{method:'POST',ip:'192.0.2.84',body:{email:'welcome-retry@example.test',password:'x',code:'private-test-code'}}),user=await db.prepare('SELECT * FROM users WHERE id=?').bind(account.data.user.id).first();
 const env={DB:db,APP_URL:origin,EMAIL_WEBHOOK_URL:'https://script.google.com/macros/s/test/exec',EMAIL_WEBHOOK_SECRET:'test-secret'},keys=[];
 await db.prepare('UPDATE email_outbox SET sent_at=NULL,attempts=0,last_attempt_at=NULL WHERE user_id=?').bind(user.id).run();
 globalThis.fetch=async(url,options)=>{keys.push(JSON.parse(options.body).idempotencyKey);return new Response('<html>Sign in to Google</html>',{headers:{'Content-Type':'text/html'}})};
 try{await deliverWelcome(env,user.id);let status=await welcomeStatus(env,user);assert.equal(status.state,'failed');assert.match(status.reason,/Google did not return/);
 await db.prepare('UPDATE email_outbox SET last_attempt_at=0 WHERE user_id=?').bind(user.id).run();globalThis.fetch=async(url,options)=>{keys.push(JSON.parse(options.body).idempotencyKey);return Response.json({ok:true})};status=await retryWelcome(env,user);assert.equal(status.state,'sent');assert.equal(keys[0],keys[1]);await assert.rejects(()=>retryWelcome(env,user),/wait a minute/);
 assert.equal((await call('/account/welcome-email')).status,401);assert.equal((await call('/account/welcome-email',{cookie:account.cookie})).data.state,'sent');
 }finally{globalThis.fetch=original}
});

test('tied scores use recorded time, result alerts describe the outcome, and closed quizzes freeze entries and answers',async()=>{
 const make=async(label,ip)=>call('/auth/signup',{method:'POST',ip,body:{email:label+'@example.test',password:'x',code:'private-test-code'}}),host=await make('race-host','192.0.2.90'),friend=await make('race-friend','192.0.2.91'),h=host.cookie,f=friend.cookie;
 const created=await call('/games',{cookie:h,method:'POST',body:{kind:'challenge',topic:'History',difficulty:'easy',count:2,requestId:crypto.randomUUID()}}),id=created.data.game.id,path='/challenges/'+new URL(created.data.game.inviteUrl).searchParams.get('challenge');
 await call(path+'/join',{cookie:f,method:'POST',body:{name:'Fast Friend'}});
 for(const [cookie,elapsed] of [[h,10000],[f,3000]])for(let position=0;position<2;position++){await db.prepare('UPDATE quiz_participants SET question_started_at=? WHERE game_id=? AND user_id=?').bind(Date.now()-elapsed,id,cookie===h?host.data.user.id:friend.data.user.id).run();const r=await call(cookie===h?'/games/'+id+'/answer':path+'/answer',{cookie,method:'POST',body:{position,choice:(await gameKey(id,position)).correct}});assert.equal(r.status,200,JSON.stringify(r.data))}
 const result=(await call('/games/'+id,{cookie:h})).data.game;assert.equal(result.authorName,created.data.game.hostName);assert.equal(result.authorIsYou,true);const visitor=(await call('/games/'+id,{cookie:f})).data.game;assert.equal(visitor.authorName,result.authorName);assert.equal(visitor.authorIsYou,false);assert.equal(result.winner,'Fast Friend');assert.equal(result.draw,false);assert.equal(result.players.find(p=>p.self).rank,2);assert.ok(result.players.every(p=>Number.isFinite(p.elapsedMs)));
 assert.ok((await call('/notifications',{cookie:h})).data.notifications.some(n=>n.gameId===id&&n.title.includes('beat you')&&n.title.includes('faster time')));
 await call('/games/'+id+'/close',{cookie:h,method:'POST',body:{}});assert.equal((await call('/games/'+id,{cookie:f})).data.game.won,true);assert.equal((await call(path+'/join',{method:'POST',body:{name:'Late'}})).status,409);
 await call('/games/'+id+'/reopen',{cookie:h,method:'POST',body:{}});const guest=await call(path+'/join',{method:'POST',body:{name:'Paused'}});const before=(await call(path,{cookie:guest.cookie})).data.game;assert.ok(before.question);await call('/games/'+id+'/close',{cookie:h,method:'POST',body:{}});assert.equal((await call(path+'/answer',{cookie:guest.cookie,method:'POST',body:{position:0,choice:0}})).status,409);assert.equal((await call(path,{cookie:guest.cookie})).data.game.question,undefined);
 await db.prepare('UPDATE trivia_games SET closed_at=? WHERE id=?').bind(Date.now()-60000,id).run();const prior=await db.prepare("SELECT question_started_at FROM quiz_participants WHERE game_id=? AND name='Paused'").bind(id).first();await call('/games/'+id+'/reopen',{cookie:h,method:'POST',body:{}});const resumed=await db.prepare("SELECT question_started_at FROM quiz_participants WHERE game_id=? AND name='Paused'").bind(id).first();assert.ok(resumed.question_started_at-prior.question_started_at>=60000);
});

test('background phone alerts encrypt delivery, honour each opt-out, isolate subscriptions, and avoid duplicate sends',async()=>{
 const categories=(await db.prepare('SELECT DISTINCT category FROM push_outbox').all()).results.map(r=>r.category);for(const category of ['friendRequests','friendAccepted','challengeInvites','quizResults'])assert.ok(categories.includes(category));
 const {deliverPushOutbox}=await import('../worker/push.mjs'),make=async(label,ip)=>call('/auth/signup',{method:'POST',ip,body:{email:label+'@example.test',password:'x',code:'private-test-code'}}),a=await make('push-a','192.0.2.92'),b=await make('push-b','192.0.2.93'),c=await make('push-c','192.0.2.94'),cookie=b.cookie;
 assert.equal((await call('/push/key')).status,401);const pub=await call('/push/key',{cookie});assert.equal(typeof pub.data.publicKey,'string');assert.equal(pub.data.privateKey,undefined);
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),encode=buffer=>Buffer.from(buffer).toString('base64url'),endpoint='https://fcm.googleapis.com/wp/test-device-'+crypto.randomUUID(),subscription={endpoint,keys:{p256dh:encode(await crypto.subtle.exportKey('raw',pair.publicKey)),auth:encode(crypto.getRandomValues(new Uint8Array(16)))}};
 assert.equal((await call('/push/subscribe',{cookie,method:'POST',body:{subscription:{...subscription,endpoint:'https://localhost/push'}}})).status,400);assert.equal((await call('/push/subscribe',{cookie,method:'POST',body:{subscription}})).status,200);
 await call('/settings',{cookie,method:'PUT',body:{phoneAlerts:true,pushEvents:{friendRequests:true,friendAccepted:true,challengeInvites:true,quizResults:true}}});
 const originalFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.ok(String(url).startsWith('https://fcm.googleapis.com/'));const data=new Uint8Array(options.body);sentPush.push({headers:Object.fromEntries(new Headers(options.headers)),body:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)});return new Response(null,{status:201})};try{
 const before=sentPush.length;await call('/friends',{cookie:a.cookie,method:'POST',body:{username:b.data.user.username}});for(let i=0;i<30&&sentPush.length<=before;i++){await deliverPushOutbox({DB:db,APP_URL:origin});await new Promise(r=>setTimeout(r,10))}assert.ok(sentPush.length>before);const sent=sentPush.at(-1);assert.equal(sent.headers['content-encoding'],'aes128gcm');assert.match(sent.headers.authorization,/^vapid t=/);assert.equal(sent.body.byteLength,4096);assert.ok(!new TextDecoder().decode(sent.body).includes('friend request'));
 const after=sentPush.length;await deliverPushOutbox({DB:db,APP_URL:origin});assert.equal(sentPush.length,after);
 await call('/settings',{cookie,method:'PUT',body:{pushEvents:{friendRequests:false}}});const prefs=(await call('/settings',{cookie,method:'PUT',body:{pushEvents:{quizResults:false}}})).data.settings;assert.equal(prefs.pushEvents.friendRequests,false);assert.equal(prefs.pushEvents.friendAccepted,true);await call('/friends',{cookie:c.cookie,method:'POST',body:{username:b.data.user.username}});await deliverPushOutbox({DB:db,APP_URL:origin});assert.equal(sentPush.length,after);
 assert.equal((await call('/push/status',{cookie:a.cookie,method:'POST',body:{endpoint}})).data.connected,false);await call('/push/subscribe',{cookie:a.cookie,method:'DELETE',body:{endpoint}});assert.equal((await call('/push/status',{cookie,method:'POST',body:{endpoint}})).data.connected,true);
 await call('/push/subscribe',{cookie,method:'DELETE',body:{endpoint}});assert.equal((await call('/push/status',{cookie,method:'POST',body:{endpoint}})).data.connected,false);
 }finally{globalThis.fetch=originalFetch}
});

test('lobbies with per-quiz timers do not expose questions or start clocks until explicit Start',async()=>{
 const account=await call('/auth/signup',{method:'POST',ip:'192.0.2.111',body:{email:'lobby-timer@example.test',password:'x',code:'private-test-code'}}),cookie=account.cookie;
 await call('/settings',{cookie,method:'PUT',body:{timerSeconds:90}});
 const created=await call('/games',{cookie,method:'POST',body:{kind:'solo',topic:'History',difficulty:'easy',count:2,lobby:true,timerSeconds:20,requestId:crypto.randomUUID()}});assert.equal(created.status,200,JSON.stringify(created.data));const id=created.data.game.id;
 assert.equal(created.data.game.lobby,true);assert.equal(created.data.game.question,undefined);assert.equal(created.data.game.timerSeconds,20);
 await call('/games',{cookie});await call('/games/'+id,{cookie});let player=await db.prepare('SELECT * FROM trivia_players WHERE game_id=?').bind(id).first();assert.equal(player.question_started_at,null);assert.equal(player.started_at,null);
 assert.equal((await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position:0,choice:0}})).status,409);
 const start=await call('/games/'+id+'/start',{cookie,method:'POST',body:{}});assert.equal(start.data.game.lobby,false);assert.ok(start.data.game.question);assert.ok(start.data.game.deadline>Date.now());
 player=await db.prepare('SELECT * FROM trivia_players WHERE game_id=?').bind(id).first();await call('/games/'+id+'/start',{cookie,method:'POST',body:{}});assert.equal((await db.prepare('SELECT started_at FROM trivia_players WHERE game_id=?').bind(id).first()).started_at,player.started_at);
 assert.equal((await call('/me',{cookie})).data.user.settings.timerSeconds,90);
});

test('handmade challenges bypass AI quotas, keep personal facts out of AI memory, and support guest lobbies',async()=>{
 const host=await call('/auth/signup',{method:'POST',ip:'192.0.2.112',body:{email:'handmade-host@example.test',password:'x',code:'private-test-code'}}),cookie=host.cookie;
 const key=`completed-games:${host.data.user.id}:${new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}`;await db.prepare('INSERT INTO budgets(key,count,expires_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires_at=excluded.expires_at').bind(key,30,Date.now()+86400000).run();
 const before=generationCalls,input={kind:'challenge',topic:'How well do you know me?',difficulty:'medium',timerSeconds:0,lobby:true,requestId:crypto.randomUUID(),questions:[{q:'Which colour do I love?',options:['Purple','Green','Blue','Pink'],correct:0},{q:'True or false: I own a pet dragon.',format:'true_false',options:['True','False'],correct:1}]};
 const made=await call('/games',{cookie,method:'POST',body:input});assert.equal(made.status,200,JSON.stringify(made.data));const g=made.data.game,id=g.id,path='/challenges/'+new URL(g.inviteUrl).searchParams.get('challenge');assert.equal(g.manual,true);assert.equal(g.lobby,true);assert.equal(g.timerSeconds,0);assert.equal(generationCalls,before);assert.equal((await db.prepare('SELECT count FROM budgets WHERE key=?').bind(key).first()).count,30);
 const replay=await call('/games',{cookie,method:'POST',body:input});assert.equal(replay.data.game.id,id);
 const joined=await call(path+'/join',{method:'POST',body:{name:'Guest Partner'}});assert.equal(joined.data.game.lobby,true);assert.equal(joined.data.game.question,undefined);const guest=joined.cookie;
 await call('/games/'+id+'/start',{cookie,method:'POST',body:{}});await call(path+'/start',{cookie:guest,method:'POST',body:{}});
 for(let position=0;position<2;position++){const correct=(await gameKey(id,position)).correct;assert.equal((await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position,choice:correct}})).status,200);assert.equal((await call(path+'/answer',{cookie:guest,method:'POST',body:{position,choice:correct}})).status,200)}
 const result=(await call(path,{cookie:guest})).data.game;assert.equal(result.complete,true);assert.equal(result.players.find(p=>p.self).score,2);assert.equal((await call(path+'/verdict',{cookie:guest,method:'POST',body:{}})).status,200);
 const qid=(await db.prepare('SELECT question_id FROM trivia_game_questions WHERE game_id=? LIMIT 1').bind(id).first()).question_id;assert.equal((await db.prepare('SELECT COUNT(*) n FROM question_embeddings WHERE question_id=?').bind(qid).first()).n,0);
 const {loadMemory}=await import('../worker/memory.mjs');assert.deepEqual(await loadMemory({DB:db},host.data.user.id),[]);
 assert.equal((await call('/questions/'+qid+'/chat',{cookie,method:'POST',body:{message:'Tell me about my partner'}})).status,403);
 const outsider=await call('/auth/signup',{method:'POST',ip:'192.0.2.113',body:{email:'handmade-outsider@example.test',password:'x',code:'private-test-code'}});assert.equal((await call('/questions/'+qid,{cookie:outsider.cookie})).status,403);
 assert.equal(generationCalls,before);
});

test('quiz discussion is shared only with finishers, supports guests, retries and host moderation',async()=>{
 const signup=(label,ip)=>call('/auth/signup',{method:'POST',ip,body:{email:label+'@example.test',password:'x',code:'private-test-code'}});
 const host=await signup('comments-host','192.0.2.121'),other=await signup('comments-other','192.0.2.122'),cookie=host.cookie;
 const made=await call('/games',{cookie,method:'POST',body:{kind:'challenge',topic:'How well do you know me?',difficulty:'easy',requestId:crypto.randomUUID(),questions:[{q:'What is my favourite colour?',options:['Pink','Green','Blue','Yellow'],correct:0}]}});
 assert.equal(made.status,200);const id=made.data.game.id,path='/games/'+id+'/comments',invite='/challenges/'+new URL(made.data.game.inviteUrl).searchParams.get('challenge');
 assert.equal((await call(path,{cookie})).status,403);assert.equal((await call(invite+'/comments')).status,403);
 const guest=await call(invite+'/join',{method:'POST',body:{name:'Mum'}}),guest2=await call(invite+'/join',{method:'POST',body:{name:'Another guest'}});
 await call('/games/'+id+'/start',{cookie,method:'POST',body:{}});const correct=(await gameKey(id,0)).correct;await call('/games/'+id+'/answer',{cookie,method:'POST',body:{position:0,choice:correct}});
 const comment={id:crypto.randomUUID(),text:'  That last one! <script>alert(1)</script>  '};const posted=await call(path,{cookie,method:'POST',body:comment});assert.equal(posted.status,200);assert.equal(posted.data.comments.length,1);assert.equal(posted.data.comments[0].text,comment.text.trim());assert.equal(posted.data.comments[0].mine,true);assert.equal(posted.data.comments[0].author_key,undefined);
 assert.equal((await call(path,{cookie,method:'POST',body:comment})).data.comments.length,1);
 assert.equal((await call(invite+'/comments',{cookie:guest.cookie})).status,403);assert.equal((await call(path,{cookie:other.cookie})).status,403);
 await call(invite+'/start',{cookie:guest.cookie,method:'POST',body:{}});await call(invite+'/answer',{cookie:guest.cookie,method:'POST',body:{position:0,choice:correct}});
 const read=await call(invite+'/comments',{cookie:guest.cookie});assert.equal(read.data.comments[0].mine,false);assert.equal(read.data.comments[0].canDelete,false);assert.equal(read.response.headers.get('Cache-Control'),'no-store');
 const own={id:crypto.randomUUID(),text:'Almost got it!'};assert.equal((await call(invite+'/comments',{cookie:guest.cookie,method:'POST',body:own})).data.comments.length,2);
 assert.equal((await call(invite+'/comments',{cookie:guest.cookie,method:'DELETE',body:{id:comment.id}})).data.comments.length,2);
 assert.equal((await call(invite+'/comments',{cookie:guest.cookie,method:'POST',body:comment})).status,409);
 assert.equal((await call(invite+'/comments',{cookie:guest.cookie,method:'POST',body:{id:crypto.randomUUID(),text:' '.repeat(5)}})).status,400);
 assert.equal((await call(path,{cookie,method:'POST',body:{id:crypto.randomUUID(),text:'x'.repeat(501)}})).status,400);
 assert.equal((await call(path,{cookie,method:'POST',originHeader:'https://evil.test',body:{id:crypto.randomUUID(),text:'No'}})).status,403);
 await call('/games/'+id+'/close',{cookie,method:'POST',body:{}});assert.equal((await call(path,{cookie,method:'DELETE',body:{id:own.id}})).data.comments.length,1);
 assert.equal((await call(path,{cookie,method:'POST',body:{id:crypto.randomUUID(),text:'Thanks for playing!'}})).data.comments.length,2);
 assert.equal((await call(invite+'/comments',{cookie:guest2.cookie})).status,403);
 assert.equal((await call(path,{cookie,method:'DELETE',body:{id:comment.id}})).data.comments.length,1);
});

test('quiz reactions are private to finishers, count each player once and allow changing or clearing',async()=>{
 const host=await call('/auth/signup',{method:'POST',ip:'192.0.2.125',body:{email:'reactions-host@example.test',password:'x',code:'private-test-code'}}),cookie=host.cookie;
 const made=await call('/games',{cookie,method:'POST',body:{kind:'challenge',topic:'A tiny reaction quiz',difficulty:'easy',requestId:crypto.randomUUID(),questions:[{q:'Which letter comes first?',options:['A','B','C','D'],correct:0}]}});assert.equal(made.status,200);
 const id=made.data.game.id,path='/games/'+id+'/comments',invite='/challenges/'+new URL(made.data.game.inviteUrl).searchParams.get('challenge'),put=(route,who,reaction)=>call(route,{cookie:who,method:'PUT',body:{reaction}});
 assert.equal((await put(path,cookie,'😂')).status,403);
 const guest=await call(invite+'/join',{method:'POST',body:{name:'Mum'}});assert.equal((await put(invite+'/comments',guest.cookie,'😂')).status,403);
 for(const [route,who] of [['/games/'+id,cookie],[invite,guest.cookie]]){await call(route+'/start',{cookie:who,method:'POST',body:{}});await call(route+'/answer',{cookie:who,method:'POST',body:{position:0,choice:(await gameKey(id,0)).correct}})}
 let r=await put(path,cookie,'😂');assert.equal(r.status,200);assert.deepEqual(r.data.reactions,[{emoji:'😂',count:1,mine:true}]);
 await put(path,cookie,'😂');r=await put(invite+'/comments',guest.cookie,'😂');assert.deepEqual(r.data.reactions,[{emoji:'😂',count:2,mine:true}]);
 assert.equal((await put(path,cookie,'🦈')).status,400);assert.equal((await put(path,cookie,undefined)).status,400);
 await put(invite+'/comments',guest.cookie,'🤯');r=await call(path,{cookie});assert.equal(r.data.reactions.find(x=>x.emoji==='😂').count,1);assert.equal(r.data.reactions.find(x=>x.emoji==='🤯').mine,false);
 await call('/games/'+id+'/close',{cookie,method:'POST',body:{}});r=await put(path,cookie,null);assert.deepEqual(r.data.reactions,[{emoji:'🤯',count:1,mine:false}]);
 assert.equal((await call(invite+'/comments')).status,403);assert.equal((await call(path,{cookie,method:'PUT',originHeader:'https://evil.test',body:{reaction:'😂'}})).status,403);
 assert.equal(JSON.stringify(r.data).includes('author_key'),false);
});

test('admin top-ups require a configured account ID, are idempotent, private and expire by UK day',async()=>{
 const {allowanceApi}=await import('../worker/admin.mjs'),{quizAllowance,londonDayBounds}=await import('../worker/allowances.mjs'),{gamesApi}=await import('../worker/games.mjs');
 const make=(label,ip)=>call('/auth/signup',{method:'POST',ip,body:{email:label+'@example.test',password:'x',code:'private-test-code',isAdmin:true}}),a=await make('admin-owner','192.0.2.130'),b=await make('admin-mum','192.0.2.131'),c=await make('admin-other','192.0.2.132');
 const owner=await db.prepare('SELECT * FROM users WHERE id=?').bind(a.data.user.id).first(),mum=await db.prepare('SELECT * FROM users WHERE id=?').bind(b.data.user.id).first(),other=await db.prepare('SELECT * FROM users WHERE id=?').bind(c.data.user.id).first(),env={DB:db,ADMIN_USER_ID:owner.id,QUIZ_DAILY_LIMIT:'1'},day=localDayForTest();
 async function direct(path,who,method='GET',input={}){return (await allowanceApi(new Request(origin+'/api'+path,{method}),env,who,async()=>input)).json()}
 assert.equal(a.data.user.isAdmin,false);assert.equal((await call('/admin',{cookie:a.cookie})).status,403);await assert.rejects(()=>direct('/admin',mum),e=>e.status===403);await assert.rejects(()=>direct('/admin/grants',other,'POST',{userId:other.id,amount:20,id:crypto.randomUUID()}),e=>e.status===403);
 const manual=await call('/games',{cookie:b.cookie,method:'POST',body:{kind:'challenge',topic:'Quota fixture',difficulty:'easy',requestId:crypto.randomUUID(),questions:[{q:'Which letter comes first?',options:['A','B','C','D'],correct:0}]}});assert.equal(manual.status,200);
 await db.prepare('UPDATE trivia_games SET manual=0 WHERE id=?').bind(manual.data.game.id).run();const first=await quizAllowance(env,mum);assert.equal(first.used,1);assert.equal(first.remaining,0);
 await assert.rejects(()=>gamesApi(new Request(origin+'/api/games',{method:'POST'}),env,mum,async()=>({kind:'solo',topic:'Unseen custom topic',difficulty:'easy',count:2,requestId:crypto.randomUUID()})),e=>e.status===429); // Stops before any AI topic check.
 let own=await direct('/quiz-requests',mum,'POST');const id=own.requests[0].id;assert.equal(own.requests[0].amount,5);await direct('/quiz-requests',mum,'POST');assert.equal((await direct('/quiz-requests',mum)).requests.length,1);assert.equal((await direct('/quiz-requests',other)).requests.length,0);
 await Promise.all([direct('/admin/requests/'+id,owner,'POST',{decision:'approve'}),direct('/admin/requests/'+id,owner,'POST',{decision:'approve'})]);let q=await quizAllowance(env,mum);assert.equal(q.bonus,5);assert.equal(q.remaining,5);assert.equal((await db.prepare('SELECT COUNT(*) n FROM quiz_grants WHERE id=?').bind(id).first()).n,1);
 const extra={id:crypto.randomUUID(),userId:mum.id,amount:5};await direct('/admin/grants',owner,'POST',extra);await direct('/admin/grants',owner,'POST',extra);assert.equal((await quizAllowance(env,mum)).bonus,10);
 await assert.rejects(()=>direct('/admin/grants',owner,'POST',{...extra,userId:other.id}),e=>e.status===409);
 const request=crypto.randomUUID();await db.prepare('INSERT INTO quiz_requests(id,user_id,day,amount,created_at) VALUES (?,?,?,?,?)').bind(request,other.id,day,5,Date.now()).run();await direct('/admin/requests/'+request,owner,'POST',{decision:'deny'});await direct('/admin/requests/'+request,owner,'POST',{decision:'approve'});assert.equal((await quizAllowance(env,other)).bonus,0);
 await db.prepare('UPDATE quiz_grants SET day=? WHERE user_id=?').bind('2020-01-01',mum.id).run();assert.equal((await quizAllowance(env,mum)).bonus,0);
 await assert.rejects(()=>direct('/admin/requests/'+id,owner,'POST',{decision:'anything'}),e=>e.status===400);
 const {publicUser}=await import('../worker/auth.mjs');assert.equal(publicUser(owner,env).isAdmin,true);assert.equal(publicUser(mum,env).isAdmin,false);assert.equal(publicUser(owner,{ADMIN_USER_ID:mum.id}).isAdmin,false);
 const panel=await direct('/admin',owner);assert.ok(panel.totals.generated>=1);assert.ok(panel.accounts.some(x=>x.id===mum.id));assert.equal(JSON.stringify(panel).includes('password_hash'),false);
 const spring=londonDayBounds('2026-03-29'),autumn=londonDayBounds('2026-10-25');assert.equal(spring.end-spring.start,23*3600000);assert.equal(autumn.end-autumn.start,25*3600000);
});
function localDayForTest(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}

test('AI usage records tokens, feature and searches without prompts, and marks failed or unknown usage',async()=>{
 const {openai}=await import('../worker/ai.mjs'),{recordAIUsage}=await import('../worker/usage.mjs'),original=globalThis.fetch,env={DB:db,OPENAI_API_KEY:'fixture',AI_USAGE_ACTION:'dive_deeper',AI_USAGE_USER_ID:'usage-fixture',AI_USAGE_OPERATION:'usage-test-operation'};
 globalThis.fetch=async()=>Response.json({status:'completed',model:'gpt-4.1-mini',usage:{input_tokens:120,output_tokens:30,input_tokens_details:{cached_tokens:40}},tool_usage:{web_search:{num_requests:2}},output:[{type:'message',content:[{type:'output_text',text:'A private reply that must never be logged.'}]}]},{headers:{'x-request-id':'usage-fixture-request'}});
 try{await openai(env,{input:'Private question should never be logged.'});let row=await db.prepare('SELECT * FROM ai_usage WHERE id=?').bind('usage-fixture-request').first();assert.equal(row.input_tokens,120);assert.equal(row.cached_tokens,40);assert.equal(row.output_tokens,30);assert.equal(row.search_calls,2);assert.equal(row.search_measured,1);assert.equal(row.feature,'dive_deeper');assert.equal(row.operation_id,'usage-test-operation');assert.equal(JSON.stringify(row).includes('private'),false);
  globalThis.fetch=async()=>new Response('error',{status:503});await assert.rejects(()=>openai(env,{input:'test'}),e=>e.status===502);row=await db.prepare('SELECT * FROM ai_usage WHERE operation_id=? AND status=503').bind(env.AI_USAGE_OPERATION).first();assert.equal(row.input_tokens,null);
  await recordAIUsage(env,{model:'text-embedding-3-small',endpoint:'embeddings',status:200,data:{usage:{total_tokens:12}},requestId:'usage-embedding-test'});row=await db.prepare('SELECT * FROM ai_usage WHERE id=?').bind('usage-embedding-test').first();assert.equal(row.input_tokens,12);assert.equal(row.output_tokens,0);
 }finally{globalThis.fetch=original}
});

test('personal journal uses private first answers, a seven-day window and distinct completed quizzes',async()=>{
 const account=await call('/auth/signup',{method:'POST',ip:'192.0.2.165',body:{email:'journal@example.test',password:'x',code:'private-test-code'}});assert.equal(account.status,200);const id=account.data.user.id,cookie=account.cookie,now=Date.now(),day=86400000,commands=[];
 const questions=[];for(let i=0;i<13;i++){const topic=i<7?'Nature':i<12?'History':'Space',qid='journal-question-'+i;questions.push(qid);commands.push(db.prepare('INSERT INTO questions(id,day,fingerprint,concept,data,created_at) VALUES (?,?,?,?,?,?)').bind(qid,qid,qid,qid,JSON.stringify({topic,q:'Journal fixture '+i,options:['A','B','C','D'],correct:0}),now));commands.push(db.prepare('INSERT INTO attempts(id,user_id,question_id,correct,created_at) VALUES (?,?,?,?,?)').bind('journal-answer-'+i,id,qid,i<6||i===7||i===12?1:0,i===0?now-8*day:now-10000));}
 await db.batch(commands);await db.prepare('INSERT INTO attempts(id,user_id,question_id,correct,created_at) VALUES (?,?,?,?,?)').bind('journal-refresher',id,questions[0],0,now).run();
 const other=await db.prepare("SELECT id FROM users WHERE email='nicole@example.com'").first();await db.prepare('INSERT INTO attempts(id,user_id,question_id,correct,created_at) VALUES (?,?,?,?,?)').bind('journal-other-user',other.id,questions[1],0,now).run();
 await db.prepare('INSERT INTO trivia_games(id,creator_id,request_id,kind,topic,difficulty,question_count,created_at) VALUES (?,?,?,?,?,?,?,?)').bind('journal-game',id,'journal-request','challenge','History','easy',2,now).run();
 await db.prepare('INSERT INTO trivia_players(id,game_id,seat,user_id,name,joined_at,completed_at) VALUES (?,?,?,?,?,?,?)').bind('journal-legacy-player','journal-game','host',id,'Journal',now,now).run();await db.prepare('INSERT INTO quiz_participants(id,game_id,seat,user_id,name,joined_at,completed_at) VALUES (?,?,?,?,?,?,?)').bind('journal-new-player','journal-game','host',id,'Journal',now,now).run();
 const response=await call('/my-profile',{cookie});assert.equal(response.status,200);const j=response.data.journal;assert.equal(j.answered,13);assert.equal(j.correct,8);assert.equal(j.accuracy,62);assert.equal(j.totalWeek,12);assert.equal(j.averagePerDay,1.7);assert.equal(j.week.length,7);assert.equal(j.strengths[0].topic,'Nature');assert.equal(j.strengths[0].answered,7);assert.equal(j.practice[0].topic,'History');assert.ok(![...j.strengths,...j.practice].some(t=>t.topic==='Space'));assert.equal(response.data.stats.quizzes,1);assert.equal((await call('/my-profile')).status,401);
 const blank=await call('/auth/signup',{method:'POST',ip:'192.0.2.166',body:{email:'journal-blank@example.test',password:'x',code:'private-test-code'}});const empty=(await call('/my-profile',{cookie:blank.cookie})).data.journal;assert.equal(empty.answered,0);assert.equal(empty.averagePerDay,0);assert.equal(empty.strengths.length,0);assert.equal(empty.practice.length,0);
});

test('first-run guide is account-scoped and topic suggestions are private, durable and idempotent',async()=>{
 const a=await call('/auth/signup',{method:'POST',ip:'198.51.100.201',body:{email:'tour-first@example.com',password:'a',code:'private-test-code'}});
 const b=await call('/auth/signup',{method:'POST',ip:'198.51.100.201',body:{email:'tour-other@example.com',password:'b',code:'private-test-code'}});
 assert.equal(a.data.user.walkthrough,'welcome');
 assert.equal((await call('/account/walkthrough',{method:'PUT',cookie:a.cookie,body:{step:'question'}})).status,200);
 assert.equal((await call('/me',{cookie:a.cookie})).data.user.walkthrough,'question');
 assert.equal((await call('/me',{cookie:b.cookie})).data.user.walkthrough,'welcome');
 assert.equal((await call('/account/walkthrough',{method:'PUT',cookie:a.cookie,body:{step:'nonsense'}})).status,400);
 assert.equal((await call('/account/walkthrough',{method:'PUT',body:{step:'done'}})).status,401);
 const id=crypto.randomUUID(),body={id,topic:'Species of birds',note:'British garden birds please'};
 for(let i=0;i<2;i++)assert.equal((await call('/topic-suggestions',{method:'POST',cookie:a.cookie,body})).status,200);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM topic_suggestions WHERE id=?').bind(id).first()).n,1);
 assert.equal((await call('/topic-suggestions',{method:'POST',cookie:b.cookie,body})).status,409);
 assert.equal((await call('/topic-suggestions',{cookie:a.cookie})).status,403);
 assert.equal((await call('/topic-suggestions',{method:'PUT',cookie:a.cookie,body:{id}})).status,403);
 assert.equal((await call('/topic-suggestions',{method:'POST',cookie:a.cookie,body:{id:crypto.randomUUID(),topic:'x'}})).status,400);
 const {accountApi}=await import('../worker/account.mjs');const env={DB:db,ADMIN_USER_ID:b.data.user.id};
 const response=await accountApi(new Request(origin+'/api/topic-suggestions'),env,b.data.user,async()=>({}));
 assert.ok((await response.json()).suggestions.some(s=>s.id===id&&s.note===body.note));
 await accountApi(new Request(origin+'/api/topic-suggestions',{method:'PUT'}),env,b.data.user,async()=>({id}));
 assert.equal((await db.prepare('SELECT status FROM topic_suggestions WHERE id=?').bind(id).first()).status,'reviewed');
});

test('account deletion verifies password, removes dependent quiz data, revokes sessions and frees the email',async()=>{
 const email='delete-and-recreate@example.com',password='simple';
 const a=await call('/auth/signup',{method:'POST',ip:'198.51.100.202',body:{email,password,code:'private-test-code'}}),cookie=a.cookie,id=a.data.user.id;
 const b=await call('/auth/signup',{method:'POST',ip:'198.51.100.201',body:{email:'delete-survivor@example.com',password:'b',code:'private-test-code'}}),other=b.data.user.id;
 const now=Date.now();
 for(const [game,creator] of [['delete-owned',id],['delete-other',other]]){
  await db.prepare('INSERT INTO trivia_games(id,creator_id,request_id,kind,topic,difficulty,question_count,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(game,creator,crypto.randomUUID(),'challenge','Birds','easy',1,now).run();
  await db.prepare('INSERT INTO trivia_game_questions(game_id,position,question_id) VALUES (?,0,?)').bind(game,'test-question').run();
 }
 for(const [player,game,owner] of [['delete-host','delete-owned',id],['delete-guest','delete-owned',other],['delete-visitor','delete-other',id]]){
  await db.prepare('INSERT INTO quiz_participants(id,game_id,seat,user_id,name,joined_at) VALUES (?,?,?,?,?,?)').bind(player,game,player==='delete-host'?'host':'guest',owner,'Name',now).run();
  await db.prepare('INSERT INTO quiz_responses(player_id,position,choice,correct) VALUES (?,0,0,0)').bind(player).run();
 }
 await db.prepare('INSERT INTO quiz_comments(id,game_id,author_key,name,text,created_at) VALUES (?,?,?,?,?,?)').bind('delete-comment','delete-other',id,'Name','Hello',now).run();
 await db.prepare("INSERT INTO quiz_reactions(game_id,author_key,emoji,created_at) VALUES (?,?,?,?)").bind('delete-owned',other,'🔥',now).run();
 await db.prepare('INSERT INTO quiz_invitations(game_id,user_id,created_at) VALUES (?,?,?)').bind('delete-owned',other,now).run();
 await db.prepare('UPDATE trivia_games SET invitee_id=? WHERE id=?').bind(id,'delete-other').run();
 const [low,high]=[id,other].sort();await db.prepare('INSERT INTO friendships(user_low,user_high,requested_by,created_at) VALUES (?,?,?,?)').bind(low,high,id,now).run();
 await db.prepare('INSERT INTO friend_username_aliases(alias,user_id) VALUES (?,?)').bind('DeleteAlias',id).run();
 await db.prepare('INSERT INTO discovery_queue(user_id,question_id,profile_key,created_at) VALUES (?,?,?,?)').bind(id,'test-question','test',now).run();
 await db.prepare('INSERT INTO daily_ready(user_id,day,slot,profile_key,question_id,created_at) VALUES (?,?,0,?,?,?)').bind(id,'2099-01-01','test','test-question',now).run();
 await db.prepare('INSERT INTO discovery_prep_state(user_id,checked_at) VALUES (?,?)').bind(id,now).run();
 await db.prepare('INSERT INTO quiz_grants(id,user_id,day,amount,granted_by,created_at) VALUES (?,?,?,5,?,?)').bind(crypto.randomUUID(),other,'2099-01-01',id,now).run();
 assert.equal((await call('/account',{method:'DELETE',cookie,body:{password:'wrong',confirm:'DELETE'}})).status,403);
 assert.equal((await call('/account',{method:'DELETE',cookie,body:{password}})).status,400);
 assert.equal((await call('/me',{cookie})).status,200);
 const deleted=await call('/account',{method:'DELETE',cookie,body:{password,confirm:'DELETE'}});assert.equal(deleted.status,200,JSON.stringify(deleted.data));
 assert.equal((await call('/me',{cookie})).status,401);assert.equal((await call('/me',{cookie:b.cookie})).status,200);
 assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind(id).first(),null);
 assert.equal(await db.prepare('SELECT id FROM trivia_games WHERE id=?').bind('delete-owned').first(),null);
 assert.equal((await db.prepare('SELECT invitee_id FROM trivia_games WHERE id=?').bind('delete-other').first()).invitee_id,null);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM quiz_participants WHERE user_id=?').bind(id).first()).n,0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM quiz_comments WHERE author_key=?').bind(id).first()).n,0);
 assert.equal((await call('/auth/signup',{method:'POST',ip:'198.51.100.202',body:{email,password,code:'private-test-code'}})).status,200);
});
