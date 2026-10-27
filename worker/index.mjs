import { fail, username, password, passwordHash, randomToken, hash, equal, DAY, SESSION_DAYS, validateSettings, localDay, grade } from './core.mjs';
import { budget, dailyQuestion, chatReply } from './ai.mjs';
const COOKIE='__Host-fancy-session';
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const sessionCookie=(token,age=SESSION_DAYS*86400)=>`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
async function body(request) {
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail('Use JSON for this request.',415);
 const reader=request.body?.getReader();if(!reader)fail('Missing request body.');let size=0,chunks=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16000){await reader.cancel();fail('This request is too large.',413)}chunks.push(value)}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length}try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))fail('Invalid request.');return value}catch{fail('Invalid request.',400)}
}
function tokenFrom(request){return request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||''}
async function userFor(request,env){const token=tokenFrom(request);if(!/^[a-f0-9]{64}$/.test(token))fail('Please sign in.',401);const row=await env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(token),Date.now()).first();if(!row)fail('Please sign in again.',401);return row}
const publicUser=u=>({id:u.id,username:u.username,settings:JSON.parse(u.settings)});
async function questionFor(env,id){if(typeof id!=='string'||id.length>80)fail('Invalid question.');const row=await env.DB.prepare('SELECT * FROM questions WHERE id=?').bind(id).first();if(!row)fail('Question not found.',404);return row}
async function latest(env,userId,questionId){return env.DB.prepare('SELECT * FROM attempts WHERE user_id=? AND question_id=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(userId,questionId).first()}
function reveal(row,attempt=null,blind=false){const q=JSON.parse(row.data);return {id:row.id,day:row.day,topic:q.topic,q:q.q,options:q.options,...(attempt&&!blind?{correct:q.correct,explanation:q.explanation,source:q.source,follow:q.follow,attempt:{id:attempt.id,choice:attempt.choice,typed:attempt.typed,correct:!!attempt.correct,at:attempt.created_at}}:{})}}
async function signin(request,env,path){
 if(!env.SIGNUP_CODE)fail('Account setup is not finished in Cloudflare yet.',503);
 const input=await body(request);const name=username(input.username),pass=password(input.password);
 const ip=request.headers.get('CF-Connecting-IP')||'local';const bucket=Math.floor(Date.now()/3600000);
 await budget(env,`auth-ip:${await hash(ip)}:${bucket}`,30,Date.now()+2*3600000);
 await budget(env,`auth-name:${await hash(name)}:${bucket}`,15,Date.now()+2*3600000);
 let user;
 if(path==='/api/auth/signup'){
  if(typeof input.code!=='string'||input.code.length>200||!equal(await hash(input.code),await hash(env.SIGNUP_CODE)))fail('The invitation code is incorrect.',403);
  const salt=randomToken(),pw=await passwordHash(pass,salt);const id=crypto.randomUUID();
  const settings=JSON.stringify({theme:'dark',time:'08:00',timezone:'Europe/London'});
  try{await env.DB.prepare('INSERT INTO users(id,username,password_hash,salt,settings,created_at) VALUES (?,?,?,?,?,?)').bind(id,name,pw,salt,settings,Date.now()).run()}catch(e){if(String(e).includes('UNIQUE'))fail('That username is already taken.',409);throw e}
  user={id,username:name,settings};
 }else{
  user=await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(name).first();
  const calculated=await passwordHash(pass,user?.salt||'dummy-salt-for-invalid-login');
  if(!user||!equal(calculated,user.password_hash))fail('Username or password is incorrect.',401);
 }
 const token=randomToken();await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await hash(token),user.id,Date.now()+SESSION_DAYS*DAY).run();
 return json({user:publicUser(user)},200,{'Set-Cookie':sessionCookie(token)});
}
async function api(request,env){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(method==='GET'&&path==='/api/health')return json({app:'fancy-knowing',database:!!env.DB,ai:!!env.OPENAI_API_KEY,accounts:!!env.SIGNUP_CODE});
 if(!env.DB)fail('The DB database binding is missing in Cloudflare.',503);
 if(!['GET','POST','PUT','DELETE'].includes(method))fail('Method not allowed.',405);
 if(method!=='GET'){
  const origin=request.headers.get('Origin');if(origin!==url.origin)fail('Open the app at its Cloudflare address before signing in.',403);
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')fail('Cross-site request blocked.',403);
 }
 if(method==='POST'&&['/api/auth/signup','/api/auth/login'].includes(path))return signin(request,env,path);
 const user=await userFor(request,env);
 if(method==='POST'&&path==='/api/auth/logout'){
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(tokenFrom(request))).run();return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});
 }
 if(method==='GET'&&path==='/api/me')return json({user:publicUser(user)});
 if(method==='PUT'&&path==='/api/settings'){
  const settings={...JSON.parse(user.settings),...validateSettings(await body(request))};await env.DB.prepare('UPDATE users SET settings=? WHERE id=?').bind(JSON.stringify(settings),user.id).run();return json({settings});
 }
 if(method==='GET'&&path==='/api/today'){
  const timezone=JSON.parse(user.settings).timezone||'Europe/London',row=await dailyQuestion(env,localDay(timezone));
  const attempt=await latest(env,user.id,row.id);const saved=await env.DB.prepare('SELECT due_at FROM saved WHERE user_id=? AND question_id=?').bind(user.id,row.id).first();
  return json({question:reveal(row,attempt),saved:saved?{due:saved.due_at}:null});
 }
 if(method==='GET'&&path==='/api/library'){
  const rows=await env.DB.prepare('SELECT q.*,s.due_at,s.saved_at FROM questions q LEFT JOIN saved s ON s.question_id=q.id AND s.user_id=? WHERE s.user_id=? OR EXISTS(SELECT 1 FROM attempts a WHERE a.question_id=q.id AND a.user_id=?) ORDER BY q.created_at DESC LIMIT 300').bind(user.id,user.id,user.id).all();
  const questions=[];for(const row of rows.results)questions.push({...reveal(row,await latest(env,user.id,row.id)),saved:row.due_at?{due:row.due_at}:null});
  return json({questions});
 }
 const match=path.match(/^\/api\/questions\/([^/]+)(?:\/(answer|save|chat))?$/);
 if(match){
  const row=await questionFor(env,match[1]),q=JSON.parse(row.data),action=match[2];
  if(method==='GET'&&!action)return json({question:reveal(row,await latest(env,user.id,row.id),url.searchParams.get('blind')==='1')});
  if(method==='POST'&&action==='answer'){
   const input=await body(request),result=grade(q,input),now=Date.now();
   if(typeof input.attemptId!=='string'||! /^[a-f0-9-]{36}$/.test(input.attemptId))fail('Missing answer identifier.');
   const previous=await env.DB.prepare('SELECT * FROM attempts WHERE id=?').bind(input.attemptId).first();
   if(previous){if(previous.user_id!==user.id||previous.question_id!==row.id)fail('Invalid answer identifier.',409);return json({question:reveal(row,previous)})}
   await budget(env,`attempts:${user.id}:${localDay()}`,150,now+2*DAY);
   await env.DB.batch([
    env.DB.prepare('INSERT INTO attempts(id,user_id,question_id,choice,typed,correct,created_at) VALUES (?,?,?,?,?,?,?)').bind(input.attemptId,user.id,row.id,result.choice,result.typed,result.correct?1:0,now),
    env.DB.prepare('UPDATE saved SET due_at=? WHERE user_id=? AND question_id=?').bind(now+(result.correct?14:7)*DAY,user.id,row.id)
   ]);
   return json({question:reveal(row,{id:input.attemptId,choice:result.choice,typed:result.typed,correct:result.correct?1:0,created_at:now})});
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
     const reply=await chatReply(env,q,history.results,message.trim());
     await env.DB.batch([env.DB.prepare('INSERT INTO chats(user_id,question_id,role,content,created_at) VALUES (?,?,?,?,?)').bind(user.id,row.id,'user',message.trim(),Date.now()),env.DB.prepare('INSERT INTO chats(user_id,question_id,role,content,created_at) VALUES (?,?,?,?,?)').bind(user.id,row.id,'assistant',reply,Date.now())]);
     return json({reply});
    }finally{await env.DB.prepare('DELETE FROM locks WHERE key=?').bind(key).run()}
   }
  }
 }
 fail('Not found.',404);
}
export default {
 async fetch(request,env){
  try{
   if(new URL(request.url).pathname.startsWith('/api/'))return await api(request,env);
   if(!env.ASSETS)return new Response('Fancy Knowing assets are not built yet.',{status:503});
   const response=await env.ASSETS.fetch(request),headers=new Headers(response.headers);
   headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('X-Frame-Options','DENY');
   headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
   headers.set('Cache-Control','no-cache');return new Response(response.body,{status:response.status,headers});
  }catch(e){const status=e.status||500;if(status>=500)console.error('Fancy Knowing request failed',status,e.status?e.message:'Unexpected server error');return json({error:e.status?e.message:'Something went wrong. Please try again.'},status,status===503?{'Retry-After':'15'}:{})}
 },
 async scheduled(event,env,ctx){
  ctx.waitUntil((async()=>{
   if(!env.DB||!env.OPENAI_API_KEY)return;
   await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()),env.DB.prepare('DELETE FROM budgets WHERE expires_at<?').bind(Date.now()),env.DB.prepare('DELETE FROM locks WHERE expires_at<?').bind(Date.now())]);
   for(const offset of [0,1])try{await dailyQuestion(env,localDay('Europe/London',new Date(Date.now()+offset*DAY)))}catch(e){console.error('Scheduled question failed',e.status||500)}
  })());
 }
};
