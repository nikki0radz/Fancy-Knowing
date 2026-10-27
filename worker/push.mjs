import {fail,hash,DAY,localDay} from './core.mjs';
import {budget} from './ai.mjs';
import {json} from './auth.mjs';
import {buildPushPayload} from './web-push.vendor.mjs';
export const PUSH_EVENTS=['friendRequests','friendAccepted','challengeInvites','quizResults'];
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function bytes(value){if(typeof value!=='string'||value.length>150||!/^[A-Za-z0-9_-]+={0,2}$/.test(value))fail('Reconnect this device to phone alerts.');try{return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0))}catch{fail('Reconnect this device to phone alerts.')}}
export function validPushEndpoint(value){try{const u=new URL(value);return value.length<2000&&u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(u.hostname)||u.hostname.endsWith('.notify.windows.com'))}catch{return false}}
export async function pushKeys(env){
 let stored=await env.DB.prepare('SELECT * FROM push_keys WHERE id=1').first();if(stored)return {publicKey:stored.public_key,privateKey:stored.private_key};
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),publicKey=b64(await crypto.subtle.exportKey('raw',pair.publicKey)),privateKey=(await crypto.subtle.exportKey('jwk',pair.privateKey)).d;
 await env.DB.prepare('INSERT INTO push_keys(id,public_key,private_key) VALUES (1,?,?) ON CONFLICT(id) DO NOTHING').bind(publicKey,privateKey).run();stored=await env.DB.prepare('SELECT * FROM push_keys WHERE id=1').first();return {publicKey:stored.public_key,privateKey:stored.private_key};
}
export async function pushApi(request,env,user,body){
 const path=new URL(request.url).pathname,method=request.method;
 if(method==='GET'&&path==='/api/push/key')return json({publicKey:(await pushKeys(env)).publicKey},200,{'Cache-Control':'no-store'});
 if(method==='POST'&&path==='/api/push/subscribe'){
  const input=await body(request),s=input.subscription;if(!s||typeof s.endpoint!=='string'||!validPushEndpoint(s.endpoint))fail('This browser’s push service is not supported yet.');
  const key=bytes(s.keys?.p256dh),auth=bytes(s.keys?.auth);if(key.length!==65||key[0]!==4||auth.length!==16)fail('Reconnect this device to phone alerts.');try{await crypto.subtle.importKey('raw',key,{name:'ECDH',namedCurve:'P-256'},false,[])}catch{fail('Reconnect this device to phone alerts.')}
  await budget(env,`push-sub:${user.id}:${localDay()}`,20,Date.now()+2*DAY);
  const id=await hash(s.endpoint),count=await env.DB.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=? AND id<>?').bind(user.id,id).first();if(count.n>=5)fail('You can connect up to five devices to phone alerts.');
  await env.DB.prepare('INSERT INTO push_subscriptions(id,user_id,endpoint,subscription,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,subscription=excluded.subscription,last_error=NULL').bind(id,user.id,s.endpoint,JSON.stringify({endpoint:s.endpoint,expirationTime:null,keys:{p256dh:b64(key),auth:b64(auth)}}),Date.now()).run();return json({connected:true});
 }
 if(method==='POST'&&path==='/api/push/status'){
  const input=await body(request),endpoint=typeof input.endpoint==='string'?input.endpoint:'',row=endpoint?await env.DB.prepare('SELECT id,last_success_at,last_error FROM push_subscriptions WHERE id=? AND user_id=?').bind(await hash(endpoint),user.id).first():null,count=await env.DB.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=?').bind(user.id).first();return json({connected:!!row,devices:count.n,lastSuccessAt:row?.last_success_at||null,lastError:row?.last_error||null},200,{'Cache-Control':'no-store'});
 }
 if(method==='POST'&&path==='/api/push/test'){
  const input=await body(request),id=await hash(typeof input.endpoint==='string'?input.endpoint:'');if(!await env.DB.prepare('SELECT id FROM push_subscriptions WHERE id=? AND user_id=?').bind(id,user.id).first())fail('Connect this device first.',409);
  if(!JSON.parse(user.settings).phoneAlerts)fail('Turn on phone alerts first.');await budget(env,`push-test:${user.id}:${Math.floor(Date.now()/3600000)}`,3,Date.now()+2*3600000);
  await env.DB.prepare('INSERT INTO push_outbox(id,user_id,category,payload,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),user.id,'test',JSON.stringify({title:'Fancy Knowing 💡',body:'Your phone alerts are connected.',url:'/?inbox=1',target:id}),Date.now()).run();return json({queued:true});
 }
 if(method==='DELETE'&&path==='/api/push/subscribe'){const input=await body(request);if(typeof input.endpoint==='string')await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=? AND user_id=?').bind(await hash(input.endpoint),user.id).run();return json({ok:true})}
 fail('Not found.',404);
}
export async function deliverPushOutbox(env){
 const now=Date.now();await env.DB.prepare("UPDATE push_outbox SET finished_at=? WHERE finished_at IS NULL AND EXISTS(SELECT 1 FROM users u WHERE u.id=push_outbox.user_id AND (COALESCE(json_extract(u.settings,'$.phoneAlerts'),0)<>1 OR (push_outbox.category<>'test' AND json_extract(u.settings,'$.pushEvents.'||push_outbox.category)=0)))").bind(now).run();const pending=(await env.DB.prepare('SELECT p.*,u.settings FROM push_outbox p JOIN users u ON u.id=p.user_id WHERE p.finished_at IS NULL AND p.attempts<4 AND p.created_at>? AND (p.last_attempt_at IS NULL OR p.last_attempt_at<?) ORDER BY p.created_at LIMIT 3').bind(now-DAY,now-120000).all()).results;if(!pending.length)return;
 const lock=await env.DB.prepare('INSERT INTO locks(key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<? RETURNING key').bind('push-delivery',now+60000,now).first();if(!lock)return;
 try{await Promise.all(pending.map(async event=>{
  const settings=JSON.parse(event.settings),payload=JSON.parse(event.payload);if(settings.phoneAlerts!==true||event.category!=='test'&&settings.pushEvents?.[event.category]===false){await env.DB.prepare('UPDATE push_outbox SET finished_at=? WHERE id=?').bind(now,event.id).run();return}
  await env.DB.prepare('UPDATE push_outbox SET attempts=attempts+1,last_attempt_at=? WHERE id=?').bind(now,event.id).run();
  const subscriptions=(await env.DB.prepare('SELECT * FROM push_subscriptions WHERE user_id=?').bind(event.user_id).all()).results.filter(s=>!payload.target||s.id===payload.target),keys=subscriptions.length?await pushKeys(env):null;let failed=false;
  await Promise.all(subscriptions.map(async sub=>{
   if(await env.DB.prepare('SELECT event_id FROM push_receipts WHERE event_id=? AND subscription_id=?').bind(event.id,sub.id).first())return;
   try{if(!validPushEndpoint(sub.endpoint))throw Error('invalid_endpoint');const url=new URL(env.APP_URL||'https://fancy-knowing.nikki0radz.workers.dev');const message={title:payload.title,body:payload.body,url:payload.url,tag:'fk-'+event.id},request=await buildPushPayload({data:message,options:{ttl:86400,urgency:'normal'}},JSON.parse(sub.subscription),{...keys,subject:url.origin});
    const response=await fetch(sub.endpoint,{...request,redirect:'manual',signal:AbortSignal.timeout(8000)});if(response.status===404||response.status===410){await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(sub.id).run();return}if(!response.ok)throw Error('push_'+response.status);
    await env.DB.batch([env.DB.prepare('INSERT INTO push_receipts(event_id,subscription_id) VALUES (?,?) ON CONFLICT DO NOTHING').bind(event.id,sub.id),env.DB.prepare('UPDATE push_subscriptions SET last_success_at=?,last_error=NULL WHERE id=?').bind(Date.now(),sub.id)]);
   }catch(e){failed=true;const reason=/^push_\d{3}$/.test(e.message)?e.message:'connection';await env.DB.prepare('UPDATE push_subscriptions SET last_error=? WHERE id=?').bind(reason,sub.id).run();}
  }));await env.DB.prepare('UPDATE push_outbox SET finished_at=?,last_error=? WHERE id=?').bind(failed?null:Date.now(),failed?'delivery_failed':null,event.id).run();
 }));await env.DB.prepare('DELETE FROM push_outbox WHERE created_at<?').bind(now-7*DAY).run();}finally{await env.DB.prepare('DELETE FROM locks WHERE key=?').bind('push-delivery').run()}
}
