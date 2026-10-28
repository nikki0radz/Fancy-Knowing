import {localDay,DAY} from './core.mjs';
export const isAdmin=(env,user)=>!!user?.id&&typeof env.ADMIN_USER_ID==='string'&&env.ADMIN_USER_ID.trim()===user.id;
export const quizLimit=env=>Number.isInteger(Number(env.QUIZ_DAILY_LIMIT))&&Number(env.QUIZ_DAILY_LIMIT)>0?Number(env.QUIZ_DAILY_LIMIT):30;
export function londonDayBounds(day=localDay()){
 const target=Date.parse(day+'T00:00:00Z');
 function midnight(utc){let value=utc;for(let i=0;i<3;i++){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));const represented=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);value+=utc-represented}return value}
 return {start:midnight(target),end:midnight(target+DAY)};
}
export async function quizAllowance(env,user){
 const day=localDay();if(env.QUIZ_LIMITS_ENABLED==='false')return {limited:false,limit:null,remaining:null,day};
 const now=Date.now(),key=`completed-games:${user.id}:${day}`,bounds=londonDayBounds(day);
 // Backfill today's successful creations too, including those made while the testing limit was off.
 let row=await env.DB.prepare('SELECT count,expires_at FROM budgets WHERE key=?').bind(key).first();
 if(!row){await env.DB.prepare('INSERT INTO budgets(key,count,expires_at) SELECT ?,COUNT(*),? FROM trivia_games WHERE creator_id=? AND manual=0 AND created_at>=? AND created_at<? ON CONFLICT(key) DO NOTHING').bind(key,bounds.end+DAY,user.id,bounds.start,bounds.end).run();row=await env.DB.prepare('SELECT count,expires_at FROM budgets WHERE key=?').bind(key).first()}
 const used=row&&row.expires_at>now?row.count:0;
 const bonus=(await env.DB.prepare('SELECT COALESCE(SUM(amount),0) n FROM quiz_grants WHERE user_id=? AND day=?').bind(user.id,day).first()).n,baseLimit=quizLimit(env),limit=baseLimit+bonus;
 return {limited:true,baseLimit,bonus,limit,used,remaining:Math.max(0,limit-used),day};
}
