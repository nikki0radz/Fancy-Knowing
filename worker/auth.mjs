import {isAdmin} from './allowances.mjs';
import { fail, username, password, passwordHash, randomToken, hash, equal, DAY, SESSION_DAYS, randomFriendUsername } from './core.mjs';
import { budget } from './ai.mjs';
import { emailReady, sendEmail, deliverWelcome } from './mail.mjs';
import { recoveryMessage } from './welcome.mjs';
export const COOKIE='__Host-fancy-session';
export const sessionCookie=(token,age=SESSION_DAYS*86400)=>`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
export const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export function tokenFrom(request){return request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||''}
export async function userFor(request,env){const token=tokenFrom(request);if(!/^[a-f0-9]{64}$/.test(token))fail('Please sign in.',401);const row=await env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(token),Date.now()).first();if(!row)fail('Please sign in again.',401);return row}
export const publicUser=(u,env={})=>({id:u.id,walkthrough:u.walkthrough||'done',isAdmin:isAdmin(env,u),avatar:u.avatar||null,username:u.friend_username||null,email:u.email||null,emailVerified:!!u.email_verified_at,legacyUsername:u.email?null:u.username,profile:JSON.parse(u.profile||'{}'),settings:JSON.parse(u.settings)});
export function email(value){if(typeof value!=='string')fail('Enter your email address.');const address=value.trim().toLowerCase();if(address.length>254||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(address)||address.startsWith('.')||address.includes('..'))fail('Enter a valid email address.');return address}
export function mailReady(env){return emailReady(env)}
function appOrigin(env){let url;try{url=new URL(env.APP_URL)}catch{fail('Password recovery is not available yet. Please try again later.',503)}if(url.protocol!=='https:'||url.username||url.password)fail('Password recovery is not available yet. Please try again later.',503);return url.origin}
async function sendLink(env,to,token,purpose){
 if(!mailReady(env))fail('Email delivery is not available yet. Please try again later.',503);
 const url=new URL(appOrigin(env));url.searchParams.set(purpose==='reset'?'reset':'verify',token);
 const action=purpose==='reset'?'Reset your password':'Confirm your email';
 const text=`${action} for Fancy Knowing\n\n${url.href}\n\nThis link works once and expires in 20 minutes. If you did not request it, you can ignore this email. Your password and account will stay unchanged.`;
 await sendEmail(env,{to,...(purpose==='reset'?recoveryMessage(url.href):{subject:`Fancy Knowing · ${action}`,text}),idempotencyKey:`fancy-knowing-${purpose}-${await hash(token)}`});
}
async function emailBudget(env,request,address){const now=Date.now(),slot=Math.floor(now/3600000),ip=await hash(request.headers.get('CF-Connecting-IP')||'local');await budget(env,`email-ip:${ip}:${slot}`,20,now+2*3600000);await budget(env,`email-address:${await hash(address)}:${slot}`,5,now+2*3600000)}
async function createLink(env,user,address,purpose){
 const token=randomToken(),tokenHash=await hash(token),now=Date.now();await env.DB.prepare('INSERT INTO email_tokens(token_hash,user_id,email,purpose,expires_at,created_at) VALUES (?,?,?,?,?,?)').bind(tokenHash,user.id,address,purpose,now+20*60000,now).run();
 try{await sendLink(env,address,token,purpose)}catch(e){await env.DB.prepare('DELETE FROM email_tokens WHERE token_hash=?').bind(tokenHash).run();throw e}
}
export async function signin(request,env,path,input,ctx){
 if(!env.SIGNUP_CODE)fail('Account setup is not finished in Cloudflare yet.',503);
 const signup=path==='/api/auth/signup',address=input.email!==undefined?email(input.email):null;
 if(signup&&!address)fail('Enter your email address.');
 const legacy=!address?username(input.username):null,pass=password(input.password),key=address||legacy;
 const ip=request.headers.get('CF-Connecting-IP')||'local',bucket=Math.floor(Date.now()/3600000);
 await budget(env,`auth-ip:${await hash(ip)}:${bucket}`,30,Date.now()+2*3600000);
 await budget(env,`auth-name:${await hash(key)}:${bucket}`,15,Date.now()+2*3600000);
 let user;
 if(signup){
  if(typeof input.code!=='string'||input.code.length>200||!equal(await hash(input.code),await hash(env.SIGNUP_CODE)))fail('The invitation code is incorrect.',403);
  const salt=randomToken(),pw=await passwordHash(pass,salt),id=crypto.randomUUID(),internalUsername=`email-${id}`;let friendUsername=randomFriendUsername();for(let retry=0;retry<10&&await env.DB.prepare('SELECT id FROM users WHERE friend_username=? COLLATE NOCASE').bind(friendUsername).first();retry++)friendUsername=randomFriendUsername();
  const settings=JSON.stringify({theme:'dark',time:'08:00',timezone:'Europe/London'});
  try{await env.DB.batch([env.DB.prepare('INSERT INTO users(id,username,email,password_hash,salt,settings,profile,created_at,friend_username) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,internalUsername,address,pw,salt,settings,'{}',Date.now(),friendUsername),env.DB.prepare('INSERT INTO email_outbox(user_id,email,created_at) VALUES (?,?,?)').bind(id,address,Date.now())])}catch(e){if(String(e).includes('UNIQUE'))fail('That email is already registered. Sign in or use Forgot password.',409);throw e}
  user={id,walkthrough:'welcome',username:internalUsername,friend_username:friendUsername,email:address,settings,profile:'{}'};
 }else{
  user=address?await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(address).first():await env.DB.prepare('SELECT * FROM users WHERE username=? AND email IS NULL').bind(legacy).first();
  const calculated=await passwordHash(pass,user?.salt||'dummy-salt-for-invalid-login');
  if(!user||!equal(calculated,user.password_hash))fail(address?'Email or password is incorrect.':'Username or password is incorrect.',401);
 }
 const token=randomToken();await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await hash(token),user.id,Date.now()+SESSION_DAYS*DAY).run();
 if(signup&&ctx?.waitUntil)ctx.waitUntil(deliverWelcome(env,user.id));
 return json({user:publicUser(user,env)},200,{'Set-Cookie':sessionCookie(token)});
}
export async function forgotPassword(request,env,input){
 if(!mailReady(env))fail('Password recovery is not available yet. Please try again later.',503);
 const address=email(input.email);await emailBudget(env,request,address);
 const user=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(address).first();
 const message='If an account uses that email, we’ll send a reset link. Check your inbox and spam folder.';
 // Always send the same public response. Never return a token or reveal account existence.
 if(user)try{await createLink(env,user,address,'reset')}catch(e){console.error('Password reset email failed',e.status||500)}
 return json({message});
}
function linkToken(value){if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value))fail('This link is invalid or has expired. Request a new one.');return value}
export async function resetPassword(request,env,input){
 await budget(env,`reset-ip:${await hash(request.headers.get('CF-Connecting-IP')||'local')}:${Math.floor(Date.now()/3600000)}`,30,Date.now()+2*3600000);
 const tokenHash=await hash(linkToken(input.token)),pass=password(input.password),now=Date.now(),salt=randomToken(),pw=await passwordHash(pass,salt);
 const valid="SELECT user_id FROM email_tokens WHERE token_hash=? AND purpose='reset' AND expires_at>? AND used_at IS NULL";
 const results=await env.DB.batch([
  env.DB.prepare(`UPDATE users SET password_hash=?,salt=?,email_verified_at=? WHERE id=(${valid})`).bind(pw,salt,now,tokenHash,now),
  env.DB.prepare(`DELETE FROM sessions WHERE user_id=(${valid})`).bind(tokenHash,now),
  env.DB.prepare(`UPDATE email_tokens SET used_at=? WHERE user_id=(${valid})`).bind(now,tokenHash,now)
 ]);
 if(results[0].meta.changes!==1)fail('This link is invalid or has expired. Request a new one.');
 return json({message:'Password changed. Sign in with your email and new password.'},200,{'Set-Cookie':sessionCookie('',0)});
}
export async function requestEmailChange(request,env,user,input){
 if(!mailReady(env))fail('Email confirmation is not available yet. Please try again later.',503);
 const address=email(input.email),pass=password(input.password);if(!equal(await passwordHash(pass,user.salt),user.password_hash))fail('Your current password is incorrect.',403);
 await emailBudget(env,request,address);const existing=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(address).first();if(existing&&existing.id!==user.id)fail('That email is already in use.',409);
 await createLink(env,user,address,'link');return json({message:'Check your inbox to confirm this email. Your existing account and history will stay together.'});
}
export async function confirmEmail(env,input){
 const tokenHash=await hash(linkToken(input.token)),now=Date.now();const valid="SELECT user_id FROM email_tokens WHERE token_hash=? AND purpose='link' AND expires_at>? AND used_at IS NULL";
 let results;try{results=await env.DB.batch([
  env.DB.prepare(`UPDATE users SET email=(SELECT email FROM email_tokens WHERE token_hash=?),email_verified_at=? WHERE id=(${valid})`).bind(tokenHash,now,tokenHash,now),
  env.DB.prepare(`UPDATE email_tokens SET used_at=? WHERE user_id=(${valid})`).bind(now,tokenHash,now)
 ])}catch(e){if(String(e).includes('UNIQUE'))fail('That email is already in use. Request a link for a different email.',409);throw e}
 if(results[0].meta.changes!==1)fail('This link is invalid or has expired. Request a new one.');return json({message:'Email confirmed. You can now sign in with your email address.'});
}
