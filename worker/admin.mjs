import {fail,DAY,localDay} from './core.mjs';
import {json} from './auth.mjs';
import {budget} from './ai.mjs';
import {isAdmin,quizAllowance,londonDayBounds} from './allowances.mjs';
export async function allowanceApi(request,env,user,body){
 const path=new URL(request.url).pathname,method=request.method,day=localDay();
 if(path==='/api/quiz-requests'){
  if(method==='POST'){
   const allowance=await quizAllowance(env,user);if(!allowance.limited||allowance.remaining>0)fail('Use your current quiz allowance before requesting more.',409);
   const existing=await env.DB.prepare("SELECT id FROM quiz_requests WHERE user_id=? AND day=? AND status='pending'").bind(user.id,day).first();
   if(!existing){await budget(env,`extra-quiz-requests:${user.id}:${day}`,10,Date.now()+2*DAY,'You’ve sent enough requests for today.');await env.DB.prepare("INSERT INTO quiz_requests(id,user_id,day,amount,created_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING").bind(crypto.randomUUID(),user.id,day,5,Date.now()).run()}
  }else if(method!=='GET')fail('Not found.',404);
  const requests=(await env.DB.prepare('SELECT id,day,amount,status,created_at,reviewed_at FROM quiz_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 5').bind(user.id).all()).results;
  return json({allowance:await quizAllowance(env,user),requests,adminConfigured:!!env.ADMIN_USER_ID},200,{'Cache-Control':'no-store'});
 }
 if(!isAdmin(env,user))fail('This area is only for the app administrator.',403);
 if(method==='GET'&&path==='/api/admin'){
  const bounds=londonDayBounds(),since=Date.now()-30*DAY;
  const totals=await env.DB.prepare('SELECT COUNT(*) quizzes,COALESCE(SUM(manual=0),0) generated,COALESCE(SUM(manual=1),0) handmade,COALESCE(SUM(manual=0 AND created_at>=?),0) generatedToday FROM trivia_games').bind(bounds.start).first();
  const requests=(await env.DB.prepare("SELECT r.*,u.friend_username,COALESCE(json_extract(u.profile,'$.name'),u.friend_username) name FROM quiz_requests r JOIN users u ON u.id=r.user_id ORDER BY CASE WHEN r.status='pending' AND r.day=? THEN 0 ELSE 1 END,r.created_at DESC LIMIT 100").bind(day).all()).results;
  const accounts=(await env.DB.prepare("SELECT id,friend_username,COALESCE(json_extract(profile,'$.name'),friend_username) name FROM users ORDER BY created_at DESC LIMIT 200").all()).results;
  const usage=(await env.DB.prepare('SELECT feature,model,endpoint,COUNT(*) calls,COUNT(DISTINCT operation_id) operations,COALESCE(SUM(input_tokens),0) inputTokens,COALESCE(SUM(output_tokens),0) outputTokens,COALESCE(SUM(cached_tokens),0) cachedTokens,COALESCE(SUM(search_calls),0) searchCalls,SUM(input_tokens IS NULL) unknownTokens,SUM(search_calls>0 AND search_measured=0) estimatedSearchRecords,SUM(status>=400 OR status=0) failedCalls FROM ai_usage WHERE created_at>=? GROUP BY feature,model,endpoint ORDER BY calls DESC').bind(since).all()).results;
  const tracking=await env.DB.prepare('SELECT MIN(created_at) startedAt,COUNT(*) calls FROM ai_usage').first();
  return json({day,totals,requests,accounts,usage,tracking,since,allowance:await quizAllowance(env,user)},200,{'Cache-Control':'no-store'});
 }
 const review=path.match(/^\/api\/admin\/requests\/([a-f0-9-]{36})$/);
 if(method==='POST'&&review){
  const input=await body(request);if(!['approve','deny'].includes(input.decision))fail('Approve or decline this request.');
  const row=await env.DB.prepare('SELECT * FROM quiz_requests WHERE id=?').bind(review[1]).first();if(!row)fail('Request not found.',404);if(row.day!==day)fail('That request was for a previous day.',409);
  if(row.status!=='pending')return json({ok:true,status:row.status});
  const now=Date.now(),commands=[];
  if(input.decision==='approve')commands.push(env.DB.prepare("INSERT INTO quiz_grants(id,user_id,day,amount,granted_by,created_at) SELECT id,user_id,day,amount,?,? FROM quiz_requests WHERE id=? AND status='pending' ON CONFLICT(id) DO NOTHING").bind(user.id,now,row.id));
  commands.push(env.DB.prepare("UPDATE quiz_requests SET status=?,reviewed_at=?,reviewed_by=? WHERE id=? AND status='pending'").bind(input.decision==='approve'?'approved':'denied',now,user.id,row.id));await env.DB.batch(commands);
  return json({ok:true,status:(await env.DB.prepare('SELECT status FROM quiz_requests WHERE id=?').bind(row.id).first()).status});
 }
 if(method==='POST'&&path==='/api/admin/grants'){
  const input=await body(request);if(typeof input.userId!=='string'||!Number.isInteger(input.amount)||input.amount<1||input.amount>20||!/^[a-f0-9-]{36}$/.test(input.id||''))fail('Choose an account and 1–20 extra quizzes.');
  if(!await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(input.userId).first())fail('Account not found.',404);
  const existing=await env.DB.prepare('SELECT user_id,amount,day FROM quiz_grants WHERE id=?').bind(input.id).first();if(existing&&(existing.user_id!==input.userId||existing.amount!==input.amount||existing.day!==day))fail('This grant was already used.',409);
  await env.DB.prepare('INSERT INTO quiz_grants(id,user_id,day,amount,granted_by,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(input.id,input.userId,day,input.amount,user.id,Date.now()).run();
  return json({ok:true,allowance:await quizAllowance(env,{id:input.userId})});
 }
 fail('Not found.',404);
}
