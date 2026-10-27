import { fail, hash } from './core.mjs';
export function emailReady(env){return !!(env.APP_URL&&((env.EMAIL_WEBHOOK_URL&&env.EMAIL_WEBHOOK_SECRET)||(env.RESEND_API_KEY&&env.EMAIL_FROM)))}
function deliveryFailure(code,status=502){const error=new Error('The email could not be sent. Please try again later.');error.status=status;error.deliveryCode=code;throw error}
export async function sendEmail(env,{to,subject,text,idempotencyKey}){
 if(!emailReady(env))fail('Email delivery is not available yet. Please try again later.',503);
 let response;
 try{
  if(env.EMAIL_WEBHOOK_URL&&env.EMAIL_WEBHOOK_SECRET){
   if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.EMAIL_WEBHOOK_URL))deliveryFailure('sender_url',503);
   response=await fetch(env.EMAIL_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.EMAIL_WEBHOOK_SECRET,to,subject,text,idempotencyKey}),signal:AbortSignal.timeout(25000)});
   if(!response.ok)deliveryFailure(response.status===401||response.status===403?'gmail_access':'gmail_http');let result;try{result=await response.json()}catch{deliveryFailure('gmail_response')}if(result.ok!==true)deliveryFailure('gmail_rejected');
  }else{
   response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject,text}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)deliveryFailure(response.status===401||response.status===403?'resend_access':'resend_rejected');
  }
 }catch(e){console.error('App email failed',response?.status||e.status||'network');if(e.status)throw e;deliveryFailure('connection')}
}
export async function deliverWelcome(env,userId){
 if(!emailReady(env))return;
 const now=Date.now();
 const row=await env.DB.prepare('UPDATE email_outbox SET attempts=attempts+1,last_attempt_at=? WHERE user_id=? AND sent_at IS NULL AND attempts<8 AND (last_attempt_at IS NULL OR last_attempt_at<?) RETURNING email,delivery_key').bind(now,userId,now-600000).first();
 if(!row)return;
 try{
  const origin=new URL(env.APP_URL);if(origin.protocol!=='https:')fail('Invalid app address.',503);
  const text=`Welcome to Fancy Knowing!\n\nOne little question. Something new to know.\n\nChoose the subjects you love, take a guess, and ask a follow-up whenever your curiosity takes you further. Heart the discoveries you want to remember.\n\nOpen Fancy Knowing:\n${origin.origin}/\n\nIf you ever forget your password, tap Forgot password on the sign-in screen. We’ll email you a reset link.\n\nHappy wondering,\nFancy Knowing\n\nIf you didn’t create an account, you can ignore this email.`;
  await sendEmail(env,{to:row.email,subject:'Welcome to Fancy Knowing 💡',text,idempotencyKey:row.delivery_key||`fancy-knowing-welcome-${await hash(userId)}`});
  await env.DB.prepare('UPDATE email_outbox SET sent_at=?,last_error=NULL WHERE user_id=?').bind(Date.now(),userId).run();
 }catch(e){await env.DB.prepare('UPDATE email_outbox SET last_error=? WHERE user_id=? AND sent_at IS NULL').bind(e.deliveryCode||'connection',userId).run();console.error('Welcome email deferred',e.deliveryCode||e.status||500)}
}
export async function deliverPendingWelcomes(env){if(!emailReady(env))return;const rows=await env.DB.prepare('SELECT user_id FROM email_outbox WHERE sent_at IS NULL AND attempts<8 ORDER BY created_at LIMIT 10').all();for(const r of rows.results)await deliverWelcome(env,r.user_id)}

export async function welcomeStatus(env,user){
 const row=await env.DB.prepare('SELECT sent_at,attempts,last_error,last_attempt_at FROM email_outbox WHERE user_id=?').bind(user.id).first();
 const reasons={sender_url:'The Gmail web app URL needs checking in Cloudflare.',gmail_access:'Google refused access to the email sender. Check the web app access and authorisation.',gmail_response:'Google did not return the expected response. Check the Apps Script deployment and authorisation.',gmail_rejected:'The Gmail sender rejected the message. Check its shared secret, authorisation and daily sending allowance.',gmail_http:'The Gmail sender could not be reached.',resend_access:'Resend refused access. Check the API key and verified sender.',resend_rejected:'Resend rejected this message. Check the sender setup.',connection:'The email connection failed or timed out.'};
 return {configured:emailReady(env),provider:env.EMAIL_WEBHOOK_URL?'Gmail':'Resend',state:row?.sent_at?'sent':row?.last_error?'failed':'pending',sentAt:row?.sent_at||null,attempts:row?.attempts||0,reason:row?.last_error?reasons[row.last_error]||reasons.connection:null};
}
export async function retryWelcome(env,user){
 if(!user.email)fail('Add an email address to your account first.');
 if(!emailReady(env))fail('Email delivery is not available yet. Please check the sender setup.',503);
 const now=Date.now();
 // A per-account claim prevents repeated clicks from queuing multiple resends.
 const claim=await env.DB.prepare('INSERT INTO locks(key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<? RETURNING key').bind('welcome-retry:'+user.id,now+60000,now).first();if(!claim)fail('Please wait a minute before trying this email again.',429);
 await env.DB.prepare('INSERT INTO email_outbox(user_id,email,created_at) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING').bind(user.id,user.email,now).run();
 const row=await env.DB.prepare('SELECT sent_at,last_attempt_at FROM email_outbox WHERE user_id=?').bind(user.id).first();
 if(row?.last_attempt_at>now-30000)fail('Please wait 30 seconds after the last email attempt before retrying.',409);
 await env.DB.prepare('UPDATE email_outbox SET email=?,attempts=0,last_attempt_at=NULL,last_error=NULL,delivery_key=CASE WHEN sent_at IS NOT NULL THEN ? ELSE delivery_key END,sent_at=NULL WHERE user_id=?').bind(user.email,'fancy-knowing-welcome-retry-'+crypto.randomUUID(),user.id).run();
 await deliverWelcome(env,user.id);return welcomeStatus(env,user);
}
