import {fail,DAY,localDay} from './core.mjs';
import {json} from './auth.mjs';
import {budget} from './ai.mjs';
import {isAdmin,quizAllowance,londonDayBounds} from './allowances.mjs';
export function notice(env,userId,type,title,detail,kind,resourceId,key,condition='1',bindings=[]){
 return env.DB.prepare(`INSERT INTO app_notifications(id,user_id,type,title,body,resource_kind,resource_id,dedupe_key,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${condition} AND EXISTS(SELECT 1 FROM users WHERE id=?) ON CONFLICT(dedupe_key) DO NOTHING`).bind(crypto.randomUUID(),userId,type,title,detail,kind,resourceId,key,Date.now(),...bindings,userId);
}
export async function allowanceApi(request,env,user,body){
 const path=new URL(request.url).pathname,method=request.method,day=localDay();
 if(path==='/api/quiz-requests'){
  if(method==='POST'){
   const input=await body(request),amount=input.amount??5,note=input.note??'';
   if(!Number.isInteger(amount)||amount<1||amount>20||typeof note!=='string'||note.length>500)fail('Ask for 1–20 quizzes and a note up to 500 characters.');
   const existing=await env.DB.prepare("SELECT id FROM quiz_requests WHERE user_id=? AND day=? AND status='pending'").bind(user.id,day).first();
   if(!existing){
    await budget(env,`extra-quiz-requests:${user.id}:${day}`,10,Date.now()+2*DAY,'You’ve sent enough requests for today.');
    const id=crypto.randomUUID(),now=Date.now(),name=JSON.parse(user.profile||'{}').name||user.friend_username||'A curious person';
    const commands=[env.DB.prepare("INSERT INTO quiz_requests(id,user_id,day,amount,note,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING").bind(id,user.id,day,amount,note.trim(),now)];
    if(note.trim())commands.push(env.DB.prepare("INSERT INTO request_messages(id,owner_id,kind,request_id,sender_id,sender_name,text,created_at) SELECT ?,?,'quiz',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quiz_requests WHERE id=?)").bind(id,user.id,id,user.id,name,note.trim(),now,id));
    if(env.ADMIN_USER_ID)commands.push(notice(env,env.ADMIN_USER_ID,'admin_request',name+' asks for '+amount+' more AI quizzes',note.trim()||'A little more curiosity, please.','quiz',id,'request:'+id,'EXISTS(SELECT 1 FROM quiz_requests WHERE id=?)',[id]));
    await env.DB.batch(commands);
   }
  }else if(method!=='GET')fail('Not found.',404);
  const requests=(await env.DB.prepare('SELECT id,day,amount,note,status,granted_amount,reply,created_at,reviewed_at FROM quiz_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user.id).all()).results;
  return json({allowance:await quizAllowance(env,user),requests,grants:(await env.DB.prepare("SELECT g.id,g.day,g.amount,g.note,g.created_at,COALESCE(json_extract(u.profile,'$.name'),'Nicole') sender FROM quiz_grants g LEFT JOIN users u ON u.id=g.granted_by WHERE g.user_id=? ORDER BY g.created_at DESC LIMIT 100").bind(user.id).all()).results,topics:(await env.DB.prepare('SELECT id,topic,note,status,reply,created_at FROM topic_suggestions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user.id).all()).results,adminConfigured:!!env.ADMIN_USER_ID},200,{'Cache-Control':'no-store'});
 }
 const thread=path.match(/^\/api\/request-threads\/(quiz|topic)\/([a-f0-9-]{36})$/);
 if(thread){
  const kind=thread[1],id=thread[2],table=kind==='quiz'?'quiz_requests':'topic_suggestions',row=await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();
  if(!row||row.user_id!==user.id&&!isAdmin(env,user))fail('Request not found.',404);
  if(method==='POST'){
   const input=await body(request),text=typeof input.text==='string'?input.text.trim():'';
   if(!text||text.length>500||!/^[a-f0-9-]{36}$/.test(input.id||''))fail('Write a note up to 500 characters.');
   const old=await env.DB.prepare('SELECT sender_id,request_id FROM request_messages WHERE id=?').bind(input.id).first();
   if(old&&(old.sender_id!==user.id||old.request_id!==id))fail('Please try your message again.',409);
   if(!old){await budget(env,`request-chat:${user.id}:${day}`,60,Date.now()+2*DAY);const name=JSON.parse(user.profile||'{}').name||user.friend_username||'Player',recipient=isAdmin(env,user)&&row.user_id!==user.id?row.user_id:env.ADMIN_USER_ID;
    const commands=[env.DB.prepare('INSERT INTO request_messages(id,owner_id,kind,request_id,sender_id,sender_name,text,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(input.id,row.user_id,kind,id,user.id,name,text,Date.now())];
    if(recipient)commands.push(notice(env,recipient,isAdmin(env,user)?'request_reply':'admin_request',name+' replied to your '+(kind==='quiz'?'extra-quiz request':'topic suggestion'),text,kind,id,'message:'+input.id));await env.DB.batch(commands);
   }
  }else if(method!=='GET')fail('Not found.',404);
  const messages=(await env.DB.prepare('SELECT id,sender_id,sender_name,text,created_at FROM request_messages WHERE owner_id=? AND kind=? AND request_id=? ORDER BY created_at DESC,id DESC LIMIT 200').bind(row.user_id,kind,id).all()).results.reverse();
  return json({request:row,messages,admin:isAdmin(env,user)},200,{'Cache-Control':'no-store'});
 }
 if(!isAdmin(env,user))fail('This area is only for the app administrator.',403);
 if(method==='GET'&&path==='/api/admin'){
  const bounds=londonDayBounds(),since=Date.now()-30*DAY;
  const totals=await env.DB.prepare('SELECT COUNT(*) quizzes,COALESCE(SUM(manual=0 AND bank=0),0) generated,COALESCE(SUM(manual=1),0) handmade,COALESCE(SUM(manual=0 AND bank=0 AND created_at>=?),0) generatedToday FROM trivia_games').bind(bounds.start).first();
  const requests=(await env.DB.prepare("SELECT r.*,u.friend_username,COALESCE(json_extract(u.profile,'$.name'),u.friend_username) name FROM quiz_requests r JOIN users u ON u.id=r.user_id ORDER BY CASE WHEN r.status='pending' AND r.day=? THEN 0 ELSE 1 END,r.created_at DESC LIMIT 100").bind(day).all()).results;
  const accounts=(await env.DB.prepare("SELECT id,friend_username,COALESCE(json_extract(profile,'$.name'),friend_username) name FROM users ORDER BY created_at DESC LIMIT 200").all()).results;
  const usage=(await env.DB.prepare('SELECT feature,model,endpoint,COUNT(*) calls,COUNT(DISTINCT operation_id) operations,COALESCE(SUM(input_tokens),0) inputTokens,COALESCE(SUM(output_tokens),0) outputTokens,COALESCE(SUM(cached_tokens),0) cachedTokens,COALESCE(SUM(search_calls),0) searchCalls,SUM(input_tokens IS NULL) unknownTokens,SUM(search_calls>0 AND search_measured=0) estimatedSearchRecords,SUM(status>=400 OR status=0) failedCalls FROM ai_usage WHERE created_at>=? GROUP BY feature,model,endpoint ORDER BY calls DESC').bind(since).all()).results;
  const tracking=await env.DB.prepare('SELECT MIN(created_at) startedAt,COUNT(*) calls FROM ai_usage').first();
  return json({day,totals,requests,accounts,usage,tracking,since,allowance:await quizAllowance(env,user)},200,{'Cache-Control':'no-store'});
 }
 const review=path.match(/^\/api\/admin\/requests\/([a-f0-9-]{36})$/);
 if(method==='POST'&&review){
  const input=await body(request);if(!['approve','deny'].includes(input.decision))fail('Approve or decline this request.');
  const row=await env.DB.prepare('SELECT * FROM quiz_requests WHERE id=?').bind(review[1]).first();if(!row)fail('Request not found.',404);
  if(row.status!=='pending')return json({ok:true,status:row.status});
  const amount=input.amount??row.amount,note=input.note??'';
  if(!Number.isInteger(amount)||amount<1||amount>20||typeof note!=='string'||note.length>500)fail('Choose 1–20 quizzes and a short reply.');
  const now=Date.now(),commands=[],name=JSON.parse(user.profile||'{}').name||'Nicole',approved=input.decision==='approve',text=note.trim()||(approved?'Use them wisely. Or spectacularly unwisely.':'Not this time — your next daily allowance is on its way.');
  if(approved)commands.push(env.DB.prepare("INSERT INTO quiz_grants(id,user_id,day,amount,granted_by,created_at,note) SELECT id,user_id,?,?,?, ?,? FROM quiz_requests WHERE id=? AND status='pending' ON CONFLICT(id) DO NOTHING").bind(day,amount,user.id,now,text,row.id));
  commands.push(env.DB.prepare("INSERT INTO request_messages(id,owner_id,kind,request_id,sender_id,sender_name,text,created_at) SELECT ?,?,'quiz',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quiz_requests WHERE id=? AND status='pending') ON CONFLICT(id) DO NOTHING").bind('review:'+row.id,row.user_id,row.id,user.id,name,text,now,row.id));
  commands.push(notice(env,row.user_id,'allowance_update',approved?name+' has gifted you '+amount+' AI quiz '+(amount===1?'credit':'credits'):'Your extra-quiz request has a reply',text+(approved?' · Available today, until midnight UK time.':''),'quiz',row.id,'review:'+row.id,"EXISTS(SELECT 1 FROM quiz_requests WHERE id=? AND status='pending')",[row.id]));
  commands.push(env.DB.prepare("UPDATE quiz_requests SET status=?,reviewed_at=?,reviewed_by=?,granted_amount=?,reply=? WHERE id=? AND status='pending'").bind(approved?'approved':'denied',now,user.id,approved?amount:0,text,row.id));await env.DB.batch(commands);
  return json({ok:true,status:(await env.DB.prepare('SELECT status FROM quiz_requests WHERE id=?').bind(row.id).first()).status});
 }
 if(method==='POST'&&path==='/api/admin/grants'){
  const input=await body(request);if(typeof input.userId!=='string'||!Number.isInteger(input.amount)||input.amount<1||input.amount>20||!/^[a-f0-9-]{36}$/.test(input.id||''))fail('Choose an account and 1–20 extra quizzes.');
  if(!await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(input.userId).first())fail('Account not found.',404);
  const existing=await env.DB.prepare('SELECT user_id,amount,day FROM quiz_grants WHERE id=?').bind(input.id).first();if(existing&&(existing.user_id!==input.userId||existing.amount!==input.amount||existing.day!==day))fail('This grant was already used.',409);
  const note=input.note??'';if(typeof note!=='string'||note.length>500)fail('Keep your gift note under 500 characters.');
  const name=JSON.parse(user.profile||'{}').name||'Nicole';
  await env.DB.batch([notice(env,input.userId,'allowance_update',name+' has gifted you '+input.amount+' AI quiz credits', (note.trim()||'Use them wisely!')+' · Available today, until midnight UK time.','gift',input.id,'gift:'+input.id),env.DB.prepare('INSERT INTO quiz_grants(id,user_id,day,amount,granted_by,created_at,note) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(input.id,input.userId,day,input.amount,user.id,Date.now(),note.trim())]);
  return json({ok:true,allowance:await quizAllowance(env,{id:input.userId})});
 }
 fail('Not found.',404);
}
