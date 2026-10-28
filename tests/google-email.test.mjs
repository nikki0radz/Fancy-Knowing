import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import crypto from 'node:crypto';
test('Google email script rejects strangers and duplicate requests without sending twice',()=>{
 const sent=[],cache=new Map(),secret='a-random-test-secret-at-least-32-characters';
 const context={ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(alg,s)=>[...crypto.createHash('sha256').update(s).digest()],base64EncodeWebSafe:data=>Buffer.from(data).toString('base64url')},PropertiesService:{getScriptProperties:()=>({getProperty:()=>secret})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},LockService:{getScriptLock:()=>({tryLock:()=>true,hasLock:()=>true,releaseLock:()=>{}})},MailApp:{getRemainingDailyQuota:()=>100,sendEmail:data=>sent.push(data)}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../google-email/Code.gs',import.meta.url),'utf8'),context);
 const request={to:'mum@example.com',subject:'Fancy Knowing · Welcome',text:'Hello',idempotencyKey:'test-key'};
 assert.equal(context.doPost({postData:{contents:JSON.stringify({...request,secret:'wrong'})}}).ok,false);assert.equal(sent.length,0);
 const valid={postData:{contents:JSON.stringify({...request,secret})}};assert.equal(context.doPost(valid).ok,true);assert.equal(context.doPost(valid).ok,true);assert.equal(sent.length,1);assert.equal(sent[0].name,'Fancy Knowing');
 assert.equal(context.doPost({postData:{contents:JSON.stringify({...request,secret,to:'mum@example.com,attacker@example.com'})}}).ok,false);
 assert.equal(sent[0].htmlBody,undefined);
 const styled={...request,secret,idempotencyKey:'styled-key',html:'<h1>Hello</h1>'};
 assert.equal(context.doPost({postData:{contents:JSON.stringify(styled)}}).ok,true);assert.equal(sent[1].htmlBody,styled.html);assert.equal(sent[1].body,'Hello');
 for(const html of [12,'x'.repeat(40001)])assert.equal(context.doPost({postData:{contents:JSON.stringify({...styled,idempotencyKey:'invalid',html})}}).ok,false);
 assert.equal(sent.length,2);
});
test('field guide keeps both email formats within sender limits and describes the bank as forthcoming',async()=>{
 const {welcomeMessage}=await import('../worker/welcome.mjs');const message=welcomeMessage('https://fancy-knowing.nikki0radz.workers.dev/');
 assert.match(message.html,/A little guide, from me to you/);assert.match(message.text,/Love from Nicole xx/);assert.match(message.text,/Once it’s ready/);assert.match(message.html,/href="https:\/\/fancy-knowing.nikki0radz.workers.dev\/"/);assert.match(message.text,/Forgot password/);assert.ok(message.text.length<12000);assert.ok(message.html.length<40000);assert.ok(JSON.stringify({...message,secret:'a'.repeat(64),to:'a@example.com',idempotencyKey:'welcome'}).length<20000);assert.throws(()=>welcomeMessage('http://example.com'));
});
