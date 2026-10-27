// Deploy this as a Google Apps Script Web app: execute as Me, access Anyone.
// Set FANCY_KNOWING_SECRET in Project Settings > Script Properties first.
function reply_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function equal_(a,b) {
  const first=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(a));
  const second=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(b));
  let different=0;for(let i=0;i<first.length;i++)different|=first[i]^second[i];return different===0;
}
function doPost(e) {
  let lock;
  try {
    if(!e||!e.postData||e.postData.contents.length>20000)return reply_({ok:false});
    const input=JSON.parse(e.postData.contents);
    const secret=PropertiesService.getScriptProperties().getProperty('FANCY_KNOWING_SECRET');
    if(!secret||secret.length<32||typeof input.secret!=='string'||!equal_(input.secret,secret))return reply_({ok:false});
    if(typeof input.to!=='string'||input.to.length>254||! /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(input.to))return reply_({ok:false});
    if(typeof input.subject!=='string'||input.subject.length>200||/[\r\n]/.test(input.subject)||!input.subject.includes('Fancy Knowing'))return reply_({ok:false});
    if(typeof input.text!=='string'||input.text.length>12000||typeof input.idempotencyKey!=='string'||input.idempotencyKey.length>200)return reply_({ok:false});
    lock=LockService.getScriptLock();if(!lock.tryLock(10000))return reply_({ok:false});
    const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,input.idempotencyKey);
    const cacheKey='mail-'+Utilities.base64EncodeWebSafe(digest),cache=CacheService.getScriptCache();
    if(cache.get(cacheKey))return reply_({ok:true});
    if(MailApp.getRemainingDailyQuota()<1)return reply_({ok:false});
    MailApp.sendEmail({to:input.to,subject:input.subject,body:input.text,name:'Fancy Knowing'});
    cache.put(cacheKey,'sent',21600);
    return reply_({ok:true});
  }catch(error){return reply_({ok:false})}
  finally{if(lock&&lock.hasLock())lock.releaseLock()}
}
function doGet() { return reply_({service:'Fancy Knowing email',ready:true}); }
function authoriseSending() { return MailApp.getRemainingDailyQuota(); }
