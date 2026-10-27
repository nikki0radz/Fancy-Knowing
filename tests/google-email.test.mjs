import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import crypto from 'node:crypto';
test('Google email script rejects strangers and duplicate requests without sending twice',()=>{
 const sent=[],cache=new Map(),secret='a-random-test-secret-at-least-32-characters';
 const context={ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(alg,s)=>[...crypto.createHash('sha256').update(s).digest()],base64EncodeWebSafe:data=>Buffer.from(data).toString('base64url')},PropertiesService:{getScriptProperties:()=>({getProperty:()=>secret})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},LockService:{getScriptLock:()=>({tryLock:()=>true,hasLock:()=>true,releaseLock:()=>{}})},MailApp:{getRemainingDailyQuota:()=>100,sendEmail:data=>sent.push(data)}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../google-email/Code.gs',import.meta.url),'utf8'),context);
 const request={to:'mum@example.com',subject:'Fancy Knowing · Welcome',text:'Hello',idempotencyKey:'test-key'};
 assert.equal(context.doPost({postData:{contents:JSON.stringify({...request,secret:'wrong'})}}).ok,false);assert.equal(sent.length,0);
 const valid={postData:{contents:JSON.stringify({...request,secret})}};assert.equal(context.doPost(valid).ok,true);assert.equal(context.doPost(valid).ok,true);assert.equal(sent.length,1);assert.equal(sent[0].name,'Fancy Knowing');
 assert.equal(context.doPost({postData:{contents:JSON.stringify({...request,secret,to:'mum@example.com,attacker@example.com'})}}).ok,false);
});
