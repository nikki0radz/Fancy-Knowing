const encoder = new TextEncoder();
export const DAY = 86400000;
export const SESSION_DAYS = 90;
export function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
export function normalize(value) { return String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
export function username(value) {
 if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(value)) fail('Use 3–40 letters, numbers, dots, dashes or underscores for your username.');
 return value.toLowerCase();
}
export function password(value) { if (typeof value !== 'string' || value.length < 1 || value.length > 200) fail('Enter a password (up to 200 characters).'); return value; }
export function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join(''); }
export async function hash(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), n => n.toString(16).padStart(2, '0')).join(''); }
export async function passwordHash(value, salt) {
 const key = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, ['deriveBits']);
 const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000 }, key, 256);
 return Array.from(new Uint8Array(bits), n => n.toString(16).padStart(2, '0')).join('');
}
export function equal(a, b) { if (typeof a !== 'string' || typeof b !== 'string') return false; const n = Math.max(a.length, b.length); let v = a.length ^ b.length; for(let i=0;i<n;i++)v |= (a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0); return v === 0; }
export function validateSettings(value) {
 if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid settings.');
 const output = {};
 if ('theme' in value) { if (!['light','dark'].includes(value.theme)) fail('Invalid theme.'); output.theme = value.theme; }
 if ('time' in value) { if (typeof value.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) fail('Invalid reminder time.'); output.time = value.time; }
 if('notificationMode' in value){if(!['fixed','random','period'].includes(value.notificationMode))fail('Choose whenever, a set time or part of the day.');output.notificationMode=value.notificationMode}
 if('notificationPeriod' in value){if(!Object.hasOwn(DAY_PERIODS,value.notificationPeriod))fail('Choose an available part of the day.');output.notificationPeriod=value.notificationPeriod}
 for(const key of ['randomStart','randomEnd'])if(key in value){if(typeof value[key]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value[key]))fail('Choose a valid notification window.');output[key]=value[key]}
 if ('timezone' in value) { try { new Intl.DateTimeFormat('en-GB', {timeZone:value.timezone}).format(); } catch { fail('Invalid time zone.'); } output.timezone = String(value.timezone); }
 for(const key of ['accentDark','accentLight','backgroundDark','backgroundLight'])if(key in value){if(typeof value[key]!=='string'||!/^#[a-f0-9]{6}$/i.test(value[key]))fail('Choose a valid colour.');output[key]=value[key].toLowerCase()}
 if('font' in value){if(!['clean','typewriter','classic','script','gothic','handwritten'].includes(value.font))fail('Choose an available font.');output.font=value.font}
 for(const [key,min,max] of [['fontSize',75,160],['dailyAmount',1,10],['answerCount',2,10]])if(key in value){if(!Number.isInteger(value[key])||value[key]<min||value[key]>max)fail('Invalid '+key+' setting.');output[key]=value[key]}
 if('reminders' in value)output.reminders=validateReminders(value.reminders);
 if('notificationsEnabled' in value){if(typeof value.notificationsEnabled!=='boolean')fail('Invalid notification setting.');output.notificationsEnabled=value.notificationsEnabled}
 return output;
}
export function validateNotificationWindow(settings){if(Array.isArray(settings.reminders)){const reminders=validateReminders(settings.reminders);if(reminders.length>(settings.dailyAmount||1))fail('Add no more reminders than your daily questions.');return settings}if(!['random','period'].includes(settings.notificationMode)&&1440-timeMinutes(settings.time||'08:00')<(settings.dailyAmount||1))fail('Choose an earlier first time to fit all your daily notifications.');if((settings.randomStart||'08:00')>=(settings.randomEnd||'21:00'))fail('The end of the random window must be later than its start.');if(timeMinutes(settings.randomEnd||'21:00')-timeMinutes(settings.randomStart||'08:00')<(settings.dailyAmount||1))fail('Make the random window at least as many minutes as your daily notifications.');return settings}
const timeMinutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
export const DAY_PERIODS={morning:[360,720],midday:[720,840],afternoon:[840,1080],evening:[1080,1320],night:[1320,1440]};
export function validateReminders(value){
 if(!Array.isArray(value)||!value.length||value.length>10)fail('Choose between 1 and 10 notification times.');
 const validTime=time=>typeof time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time);
 const fixed=new Set();
 return value.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||!['fixed','random','period'].includes(item.mode))fail('Choose a valid reminder type.');
  const row={mode:item.mode,time:item.time??'09:00',start:item.start??'08:00',end:item.end??'21:00',period:item.period??'morning'};
  if(![row.time,row.start,row.end].every(validTime)||!Object.hasOwn(DAY_PERIODS,row.period))fail('Choose valid notification times.');
  if(row.mode==='random'&&(row.start>=row.end||timeMinutes(row.end)-timeMinutes(row.start)<value.length))fail('Choose a wider random time window, with the end later than the start.');
  if(row.mode==='fixed'){if(fixed.has(row.time))fail('Choose a different time for each question.');fixed.add(row.time)}
  return row;
 });
}
async function individualNotificationTimes(settings,day,seed){
 const rows=settings.reminders.slice(0,settings.dailyAmount||1),used=new Set(rows.filter(row=>row.mode==='fixed').map(row=>timeMinutes(row.time))),result=[];
 for(let index=0;index<rows.length;index++){
  const row=rows[index];let minute=timeMinutes(row.time);
  if(row.mode!=='fixed'){
   const [start,end]=row.mode==='period'?DAY_PERIODS[row.period]:[timeMinutes(row.start),timeMinutes(row.end)],width=end-start;
   minute=start+parseInt((await hash(`${seed}:${day}:${index}:reminder`)).slice(0,8),16)%width;
   let tries=0;while(used.has(minute)&&tries++<width)minute=start+(minute-start+1)%width;
   if(used.has(minute))fail('These reminder windows overlap too closely. Choose a wider window.');used.add(minute);
  }
  result.push(String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0'));
 }
 return result;
}
export async function notificationTimes(settings,day,seed){
 if(settings.notificationsEnabled===false)return [];
 if(Array.isArray(settings.reminders))return individualNotificationTimes(settings,day,seed);
 const count=settings.dailyAmount||1,period=settings.notificationMode==='period'?(DAY_PERIODS[settings.notificationPeriod]||DAY_PERIODS.morning):null,random=settings.notificationMode==='random'||!!period;
 const start=period?period[0]:timeMinutes(settings.notificationMode==='random'?(settings.randomStart||'08:00'):(settings.time||'08:00'));
 const end=period?period[1]:settings.notificationMode==='random'?timeMinutes(settings.randomEnd||'21:00'):1440;
 const slots=Math.min(count,end-start),result=[];
 for(let i=0;i<slots;i++){
  const low=start+Math.floor((end-start)*i/slots),high=start+Math.floor((end-start)*(i+1)/slots);
  const minute=random?low+parseInt((await hash(`${seed}:${day}:${i}`)).slice(0,8),16)%(high-low):low;
  result.push(String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0'));
 }
 return result;
}
export function localDay(timezone = 'Europe/London', date = new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
export function validateQuestion(q, citedUrls, expectedCount) {
 if (!q || typeof q !== 'object') fail('The question could not be checked. Try again.', 502);
 for(const k of ['topic','q','explanation','concept','source']) if(typeof q[k] !== 'string' || !q[k].trim() || q[k].length > (k==='explanation'?600:300)) fail('The question could not be checked. Try again.',502);
 if (!Array.isArray(q.options) || q.options.length<2 || q.options.length>10 || (expectedCount!==undefined&&q.options.length!==expectedCount) || q.options.some(o=>typeof o!=='string'||!o.trim()||o.length>100) || new Set(q.options.map(normalize)).size!==q.options.length || !Number.isInteger(q.correct)||q.correct<0||q.correct>=q.options.length) fail('The question could not be checked. Try again.',502);
 if(!Array.isArray(q.aliases)||q.aliases.some(a=>typeof a!=='string'||a.length>100)||q.aliases.length>10)fail('Invalid answer aliases.',502);
 if(!Array.isArray(q.follow)||q.follow.length!==3||q.follow.some(f=>typeof f!=='string'||!f.trim()||f.length>120)||new Set(q.follow.map(normalize)).size!==3)fail('Invalid follow-up questions.',502);
 if(q.aliases.some(alias=>q.options.some((option,index)=>index!==q.correct&&normalize(option)===normalize(alias))))fail('The answer options overlap.',502);
 if (!citedUrls.includes(q.source) || !q.source.startsWith('https://')) fail('The source could not be checked. Try again.',502);
 return q;
}
export function grade(q, body) {
 if (typeof body.typed === 'string') {
 const typed = body.typed.trim(); if(!typed || typed.length>150)fail('Type a short answer.');
 return {typed, choice:null, correct:[q.options[q.correct],...(q.aliases||[])].some(s=>normalize(s)===normalize(typed))};
 }
 if(!Number.isInteger(body.choice)||body.choice<0||body.choice>=q.options.length)fail('Choose an answer.');
 return {typed:null,choice:body.choice,correct:body.choice===q.correct};
}
export function responseText(data) { return (data.output||[]).filter(i=>i.type==='message').flatMap(i=>i.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('\n'); }
export function citations(data) { return [...new Set((data.output||[]).flatMap(i=>i.content||[]).flatMap(c=>c.annotations||[]).filter(a=>a.type==='url_citation').map(a=>a.url).filter(u=>typeof u==='string'&&u.startsWith('https://')))]; }
