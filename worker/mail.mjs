import { fail, hash } from './core.mjs';
export function emailReady(env){return !!(env.APP_URL&&((env.EMAIL_WEBHOOK_URL&&env.EMAIL_WEBHOOK_SECRET)||(env.RESEND_API_KEY&&env.EMAIL_FROM)))}
export async function sendEmail(env,{to,subject,text,idempotencyKey}){
 if(!emailReady(env))fail('Email delivery is not available yet. Please try again later.',503);
 let response;
 try{
  if(env.EMAIL_WEBHOOK_URL&&env.EMAIL_WEBHOOK_SECRET){
   if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.EMAIL_WEBHOOK_URL))fail('The email sender needs checking.',503);
   response=await fetch(env.EMAIL_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.EMAIL_WEBHOOK_SECRET,to,subject,text,idempotencyKey}),signal:AbortSignal.timeout(25000)});
   const result=await response.json();if(!response.ok||result.ok!==true)fail('The email could not be sent. Please try again later.',502);
  }else{
   response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject,text}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)fail('The email could not be sent. Please try again later.',502);
  }
 }catch(e){console.error('App email failed',response?.status||e.status||'network');if(e.status)throw e;fail('The email could not be sent. Please try again later.',502)}
}
export async function deliverWelcome(env,userId){
 if(!emailReady(env))return;
 const now=Date.now();
 const row=await env.DB.prepare('UPDATE email_outbox SET attempts=attempts+1,last_attempt_at=? WHERE user_id=? AND sent_at IS NULL AND attempts<8 AND (last_attempt_at IS NULL OR last_attempt_at<?) RETURNING email').bind(now,userId,now-600000).first();
 if(!row)return;
 try{
  const origin=new URL(env.APP_URL);if(origin.protocol!=='https:')fail('Invalid app address.',503);
  const text=`Welcome to Fancy Knowing!\n\nOne little question. Something new to know.\n\nChoose the subjects you love, take a guess, and ask a follow-up whenever your curiosity takes you further. Heart the discoveries you want to remember.\n\nOpen Fancy Knowing:\n${origin.origin}/\n\nIf you ever forget your password, tap Forgot password on the sign-in screen. We’ll email you a reset link.\n\nHappy wondering,\nFancy Knowing\n\nIf you didn’t create an account, you can ignore this email.`;
  await sendEmail(env,{to:row.email,subject:'Welcome to Fancy Knowing 💡',text,idempotencyKey:`fancy-knowing-welcome-${await hash(userId)}`});
  await env.DB.prepare('UPDATE email_outbox SET sent_at=? WHERE user_id=?').bind(Date.now(),userId).run();
 }catch(e){console.error('Welcome email deferred',e.status||500)}
}
export async function deliverPendingWelcomes(env){if(!emailReady(env))return;const rows=await env.DB.prepare('SELECT user_id FROM email_outbox WHERE sent_at IS NULL AND attempts<8 ORDER BY created_at LIMIT 10').all();for(const r of rows.results)await deliverWelcome(env,r.user_id)}
