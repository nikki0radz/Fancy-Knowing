import { fail, hash, DAY, randomToken, validateSettings, validateNotificationWindow, notificationTimes, localDay, grade } from './core.mjs';
import { budget, chatReply } from './ai.mjs';
import { json, sessionCookie, tokenFrom, userFor, publicUser, signin, forgotPassword, resetPassword, requestEmailChange, confirmEmail, mailReady } from './auth.mjs';
import {assignDiscovery,assignedQuestion,daySlots} from './discoveries.mjs';
import {displayQuestion,formatUnits} from './quiz.mjs';
import {friendsApi} from './friends.mjs';
import {gamesApi} from './games.mjs';
import { deliverPendingWelcomes } from './mail.mjs';
import { SUBJECTS, approveTopic, updateProfile } from './profiles.mjs';
async function body(request,limit=16000) {
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail('Use JSON for this request.',415);
 const reader=request.body?.getReader();if(!reader)fail('Missing request body.');let size=0,chunks=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail('This request is too large.',413)}chunks.push(value)}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length}try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))fail('Invalid request.');return value}catch{fail('Invalid request.',400)}
}
async function questionFor(env,id){if(typeof id!=='string'||id.length>80)fail('Invalid question.');const row=await env.DB.prepare('SELECT * FROM questions WHERE id=?').bind(id).first();if(!row)fail('Question not found.',404);return row}
async function latest(env,userId,questionId){return env.DB.prepare('SELECT * FROM attempts WHERE user_id=? AND question_id=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(userId,questionId).first()}
function reveal(row,attempt=null,blind=false,units='metric'){const q=displayQuestion(JSON.parse(row.data),units);return {id:row.id,day:row.day.slice(0,10),topic:q.topic,format:q.format||'multiple_choice',q:q.q,options:q.options,...(attempt&&!blind?{correct:q.correct,explanation:q.explanation,source:q.source,follow:q.follow,attempt:{id:attempt.id,choice:attempt.choice,typed:attempt.typed,correct:!!attempt.correct,at:attempt.created_at}}:{})}}
async function databaseStatus(env){
 if(!env.DB)return {databaseReady:false,databaseIssue:'binding_missing'};
 try{
  const tables=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const names=new Set(tables.results.map(r=>r.name));
  const required=['users','sessions','questions','attempts','saved','chats','budgets','locks','email_tokens','approved_topics','daily_assignments','email_outbox','shared_questions','question_embeddings','trivia_games','trivia_game_questions','trivia_players','trivia_answers','challenge_notifications','friendships','corrected_question_keys'];
  const missingTables=required.filter(name=>!names.has(name));
  if(missingTables.length)return {databaseReady:false,databaseIssue:'migrations_missing',missingTables};
  const columns=await env.DB.prepare('PRAGMA table_info(users)').all();
  const fields=new Set(columns.results.map(r=>r.name));
  const missingColumns=['email','email_verified_at','profile','avatar','friend_username'].filter(name=>!fields.has(name));
  if(missingColumns.length)return {databaseReady:false,databaseIssue:'migrations_missing',missingColumns};
  const assignments=await env.DB.prepare('PRAGMA table_info(daily_assignments)').all();if(!assignments.results.some(c=>c.name==='slot'))return {databaseReady:false,databaseIssue:'migrations_missing',missingColumns:['daily_assignments.slot']};
  const players=await env.DB.prepare('PRAGMA table_info(trivia_players)').all();if(!players.results.some(c=>c.name==='verdict'))return {databaseReady:false,databaseIssue:'migrations_missing',missingColumns:['trivia_players.verdict']};
  return {databaseReady:true};
 }catch{return {databaseReady:false,databaseIssue:'database_unavailable'}}
}
async function api(request,env,ctx){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(method==='GET'&&path==='/api/health')return json({app:'fancy-knowing',version:'0.4.1',database:!!env.DB,ai:!!env.OPENAI_API_KEY,accounts:!!env.SIGNUP_CODE,email:mailReady(env),...await databaseStatus(env)});
 if(!env.DB)fail('The DB database binding is missing in Cloudflare.',503);
 if(!['GET','POST','PUT','DELETE'].includes(method))fail('Method not allowed.',405);
 if(method!=='GET'){
  const origin=request.headers.get('Origin');if(origin!==url.origin)fail('Open the app at its Cloudflare address before signing in.',403);
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')fail('Cross-site request blocked.',403);
 }
 if(method==='POST'&&['/api/auth/signup','/api/auth/login'].includes(path))return signin(request,env,path,await body(request),ctx);
 if(method==='POST'&&path==='/api/auth/forgot-password')return forgotPassword(request,env,await body(request));
 if(method==='POST'&&path==='/api/auth/reset-password')return resetPassword(request,env,await body(request));
 if(method==='POST'&&path==='/api/auth/confirm-email')return confirmEmail(env,await body(request));
 const guest=path.match(/^\/api\/shared\/([a-f0-9]{64})(?:\/(answer))?$/);
 if(guest){
  const row=await env.DB.prepare('SELECT q.* FROM shared_questions s JOIN questions q ON q.id=s.question_id WHERE s.token=?').bind(guest[1]).first();
  if(!row)fail('This shared question could not be found.',404);
  const q=JSON.parse(row.data),question={topic:q.topic,format:q.format||'multiple_choice',q:q.q,options:q.options};
  if(method==='GET'&&!guest[2])return json({question},200,{'Cache-Control':'no-store'});
  if(method==='POST'&&guest[2]==='answer'){
   const result=grade(q,await body(request));
   return json({question:{...question,correct:q.correct,explanation:q.explanation,attempt:{choice:result.choice,typed:result.typed,correct:result.correct}}},200,{'Cache-Control':'no-store'});
  }
  fail('Method not allowed.',405);
 }
 if(path.startsWith('/api/shared/'))fail('This shared question could not be found.',404);
 if(path.startsWith('/api/challenges/')){let visitor=null;try{visitor=await userFor(request,env)}catch(e){if(e.status!==401)throw e}return gamesApi(request,env,visitor,body)}
 const user=await userFor(request,env);
 if(path==='/api/friends'||path.startsWith('/api/friends/'))return friendsApi(request,env,user,body);
 if(path==='/api/games'||path.startsWith('/api/games/')||path==='/api/notifications'||path.startsWith('/api/notifications/'))return gamesApi(request,env,user,body);
 if(method==='GET'&&path==='/api/home'){const settings=JSON.parse(user.settings),day=localDay(settings.timezone||'Europe/London');return json({day,count:settings.dailyAmount||1,slots:await daySlots(env,user.id,day,settings.dailyAmount||1)})}
 if(method==='POST'&&path==='/api/auth/logout'){
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(tokenFrom(request))).run();return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});
 }
 if(method==='GET'&&path==='/api/me')return json({user:publicUser(user)});
 if(method==='POST'&&path==='/api/account/email')return requestEmailChange(request,env,user,await body(request));
 if(method==='GET'&&path==='/api/quiz-topics'){
  const uses=await env.DB.prepare('SELECT topic,COUNT(*) AS uses FROM trivia_games WHERE creator_id=? GROUP BY topic ORDER BY uses DESC').bind(user.id).all();const profile=JSON.parse(user.profile||'{}');const custom=await env.DB.prepare('SELECT topic FROM approved_topics WHERE user_id=?').bind(user.id).all();
  const scores=new Map(uses.results.map(r=>[r.topic,r.uses]));const all=[...new Set(['General knowledge',...uses.results.map(r=>r.topic==='Mixed topics'?'General knowledge':r.topic),...(profile.interests||[]),...SUBJECTS,...custom.results.map(r=>r.topic)])];const rest=all.filter(t=>t!=='General knowledge').sort((a,b)=>(scores.get(b)||0)-(scores.get(a)||0));return json({topics:['General knowledge',...rest]});
 }
 if(method==='GET'&&path==='/api/topics'){const custom=await env.DB.prepare('SELECT topic FROM approved_topics WHERE user_id=? ORDER BY created_at').bind(user.id).all();return json({subjects:SUBJECTS,custom:custom.results.map(r=>r.topic)})}
 if(method==='POST'&&path==='/api/topics')return json(await approveTopic(env,user,(await body(request)).topic));
 if(method==='PUT'&&path==='/api/profile')return json(await updateProfile(env,user,await body(request)));
 if((method==='PUT'||method==='DELETE')&&path==='/api/avatar'){
  let avatar=null;
  if(method==='PUT'){
   const input=await body(request,100000);avatar=input.avatar;
   if(typeof avatar!=='string'||avatar.length>70000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar))fail('Choose a small JPG, PNG or WebP image.');
   let bytes;try{bytes=Uint8Array.from(atob(avatar.split(',')[1]),c=>c.charCodeAt(0))}catch{fail('That image could not be read.')}
   const mime=avatar.slice(11,avatar.indexOf(';'));
   const valid=mime==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='png'?[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b):String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
   if(!valid||bytes.length>50000)fail('That image could not be read. Try another picture.');
  }
  await env.DB.prepare('UPDATE users SET avatar=? WHERE id=?').bind(avatar,user.id).run();return json({avatar});
 }
 if(method==='PUT'&&path==='/api/settings'){
  const settings=validateNotificationWindow({...JSON.parse(user.settings),...validateSettings(await body(request))});await env.DB.prepare('UPDATE users SET settings=? WHERE id=?').bind(JSON.stringify(settings),user.id).run();return json({settings});
 }
 if(method==='GET'&&path==='/api/notification-schedule'){
  const settings=JSON.parse(user.settings),timezone=settings.timezone||'Europe/London',day=localDay(timezone);
  const times=await notificationTimes(settings,day,user.id),slots=await daySlots(env,user.id,day,settings.dailyAmount||1);
  return json({day,timezone,times,configuredCount:Array.isArray(settings.reminders)?settings.reminders.length:(settings.dailyAmount||1),questionCount:settings.dailyAmount||1,items:times.map((time,index)=>{const slot=settings.reminders?.[index]?.slot??index;return {time,slot,questionId:slots[slot]?.id||null,url:url.origin+'/?day='+day+'&slot='+slot}}),deliveryAvailable:false});
 }
 if(method==='GET'&&path==='/api/today'){
  const settings=JSON.parse(user.settings),today=localDay(settings.timezone||'Europe/London'),day=url.searchParams.get('day')||today;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))fail('Choose a valid discovery day.');
  const value=url.searchParams.get('slot')||'0';if(!/^[0-9]$/.test(value))fail('Choose an available question.');const slot=Number(value);
  let count=settings.dailyAmount||1,row;
  if(day===today){if(slot>=count)fail('This question is outside your daily amount.',404);row=await assignDiscovery(env,user,day,slot)}
  else{row=await assignedQuestion(env,user.id,day,slot);if(!row)fail('That discovery is not available.',404);const max=await env.DB.prepare('SELECT MAX(slot) AS slot FROM daily_assignments WHERE user_id=? AND day=?').bind(user.id,day).first();count=max.slot+1}
  const attempt=await latest(env,user.id,row.id),saved=await env.DB.prepare('SELECT due_at FROM saved WHERE user_id=? AND question_id=?').bind(user.id,row.id).first();
  return json({question:reveal(row,attempt,false,settings.units),saved:saved?{due:saved.due_at}:null,day,slot,count,slots:await daySlots(env,user.id,day,count)});
 }
 if(method==='GET'&&path==='/api/library'){
  const rows=await env.DB.prepare('SELECT q.*,s.due_at,s.saved_at,(SELECT COUNT(*) FROM chats c WHERE c.user_id=? AND c.question_id=q.id) AS chat_count FROM questions q LEFT JOIN saved s ON s.question_id=q.id AND s.user_id=? WHERE s.user_id=? OR EXISTS(SELECT 1 FROM attempts a WHERE a.question_id=q.id AND a.user_id=?) ORDER BY q.created_at DESC LIMIT 300').bind(user.id,user.id,user.id,user.id).all();
  const questions=[];for(const row of rows.results)questions.push({...reveal(row,await latest(env,user.id,row.id),false,JSON.parse(user.settings).units),chatCount:row.chat_count,saved:row.due_at?{due:row.due_at}:null});
  return json({questions});
 }
 const match=path.match(/^\/api\/questions\/([^/]+)(?:\/(answer|save|chat|share))?$/);
 if(match){
  const row=await questionFor(env,match[1]),q=JSON.parse(row.data),action=match[2];
  if(method==='GET'&&!action)return json({question:reveal(row,await latest(env,user.id,row.id),url.searchParams.get('blind')==='1',JSON.parse(user.settings).units)});
  if(method==='POST'&&action==='share'){
   if(!await latest(env,user.id,row.id))fail('Take a guess before sharing this question.',403);
   await env.DB.prepare('INSERT INTO shared_questions(token,question_id,created_at) VALUES (?,?,?) ON CONFLICT(question_id) DO NOTHING').bind(randomToken(),row.id,Date.now()).run();
   const shared=await env.DB.prepare('SELECT token FROM shared_questions WHERE question_id=?').bind(row.id).first();
   return json({url:url.origin+'/?share='+shared.token});
  }
  if(method==='POST'&&action==='answer'){
   const input=await body(request),result=grade(q,input),now=Date.now();if(result.typed&&JSON.parse(user.settings).units==='imperial'){const shown=formatUnits(q.options[q.correct],'imperial');if([shown,shown.replace(/\s*\([^)]*\)/g,'')].some(s=>s.trim().toLowerCase()===result.typed.toLowerCase()))result.correct=true}
   if(typeof input.attemptId!=='string'||! /^[a-f0-9-]{36}$/.test(input.attemptId))fail('Missing answer identifier.');
   const previous=await env.DB.prepare('SELECT * FROM attempts WHERE id=?').bind(input.attemptId).first();
   if(previous){if(previous.user_id!==user.id||previous.question_id!==row.id)fail('Invalid answer identifier.',409);return json({question:reveal(row,previous,false,JSON.parse(user.settings).units)})}
   await budget(env,`attempts:${user.id}:${localDay()}`,150,now+2*DAY);
   await env.DB.batch([
    env.DB.prepare('INSERT INTO attempts(id,user_id,question_id,choice,typed,correct,created_at) VALUES (?,?,?,?,?,?,?)').bind(input.attemptId,user.id,row.id,result.choice,result.typed,result.correct?1:0,now),
    env.DB.prepare('UPDATE saved SET due_at=? WHERE user_id=? AND question_id=?').bind(now+(result.correct?14:7)*DAY,user.id,row.id)
   ]);
   return json({question:reveal(row,{id:input.attemptId,choice:result.choice,typed:result.typed,correct:result.correct?1:0,created_at:now},false,JSON.parse(user.settings).units)});
  }
  if(method==='POST'&&action==='save'){
   const input=await body(request);if(typeof input.saved!=='boolean')fail('Invalid save request.');
   if(input.saved){await env.DB.prepare('INSERT INTO saved(user_id,question_id,due_at,saved_at) VALUES (?,?,?,?) ON CONFLICT(user_id,question_id) DO NOTHING').bind(user.id,row.id,Date.now()+7*DAY,Date.now()).run()}else await env.DB.prepare('DELETE FROM saved WHERE user_id=? AND question_id=?').bind(user.id,row.id).run();
   const saved=await env.DB.prepare('SELECT due_at FROM saved WHERE user_id=? AND question_id=?').bind(user.id,row.id).first();return json({saved:saved?{due:saved.due_at}:null});
  }
  if(action==='chat'){
   if(!await latest(env,user.id,row.id))fail('Take a guess before diving deeper.',403);
   if(method==='GET'){const messages=await env.DB.prepare('SELECT role,content FROM (SELECT id,role,content FROM chats WHERE user_id=? AND question_id=? ORDER BY id DESC LIMIT 100) ORDER BY id').bind(user.id,row.id).all();return json({messages:messages.results})}
   if(method==='POST'){
    const input=await body(request),message=input.message;if(typeof message!=='string'||!message.trim()||message.length>1500)fail('Ask a question of up to 1,500 characters.');
    await budget(env,`chat:${user.id}:${localDay()}`,40,Date.now()+2*DAY);
    const key=`chat:${user.id}:${row.id}`,lock=await env.DB.prepare('INSERT INTO locks(key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<? RETURNING key').bind(key,Date.now()+65000,Date.now()).first();if(!lock)fail('Your previous reply is still being prepared.',409);
    try{
     const history=await env.DB.prepare('SELECT role,content FROM (SELECT id,role,content FROM chats WHERE user_id=? AND question_id=? ORDER BY id DESC LIMIT 16) ORDER BY id').bind(user.id,row.id).all();
     const reply=await chatReply(env,q,history.results,message.trim(),JSON.parse(user.settings).units);
     await env.DB.batch([env.DB.prepare('INSERT INTO chats(user_id,question_id,role,content,created_at) VALUES (?,?,?,?,?)').bind(user.id,row.id,'user',message.trim(),Date.now()),env.DB.prepare('INSERT INTO chats(user_id,question_id,role,content,created_at) VALUES (?,?,?,?,?)').bind(user.id,row.id,'assistant',reply,Date.now())]);
     return json({reply});
    }finally{await env.DB.prepare('DELETE FROM locks WHERE key=?').bind(key).run()}
   }
  }
 }
 fail('Not found.',404);
}
export default {
 async fetch(request,env,ctx){
  try{
   if(new URL(request.url).pathname.startsWith('/api/'))return await api(request,env,ctx);
   if(!env.ASSETS)return new Response('Fancy Knowing assets are not built yet.',{status:503});
   const response=await env.ASSETS.fetch(request),headers=new Headers(response.headers);
   headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('X-Frame-Options','DENY');
   headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
   headers.set('Cache-Control','no-cache');return new Response(response.body,{status:response.status,headers});
  }catch(e){const status=e.status||500;if(status>=500)console.error('Fancy Knowing request failed',status,e.status?e.message:'Unexpected server error');return json({error:e.status?e.message:'Something went wrong. Please try again.'},status,status===503?{'Retry-After':'15'}:{})}
 },
 async scheduled(event,env,ctx){
  ctx.waitUntil((async()=>{
   if(!env.DB)return;
   await deliverPendingWelcomes(env);
   if(!env.OPENAI_API_KEY)return;
   await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()),env.DB.prepare('DELETE FROM budgets WHERE expires_at<?').bind(Date.now()),env.DB.prepare('DELETE FROM locks WHERE expires_at<?').bind(Date.now()),env.DB.prepare('DELETE FROM email_tokens WHERE expires_at<? OR used_at IS NOT NULL').bind(Date.now())]);
   const users=await env.DB.prepare('SELECT * FROM users ORDER BY created_at LIMIT 20').all();let prepared=0;
   for(const user of users.results){
    const settings=JSON.parse(user.settings),day=localDay(settings.timezone||'Europe/London'),slots=await daySlots(env,user.id,day,settings.dailyAmount||1),pending=slots.find(item=>!item.id);if(!pending)continue;
    try{await assignDiscovery(env,user,day,pending.slot)}catch(e){console.error('Scheduled question failed',e.status||500)}
    if(++prepared>=5)break;
   }
  })());
 }
};
