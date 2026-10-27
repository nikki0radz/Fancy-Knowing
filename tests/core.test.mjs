import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize,grade,passwordHash,equal,validateSettings,validateQuestion,citations,localDay } from '../worker/core.mjs';
test('typed answers allow aliases and accents, not unrelated guesses',()=>{
 const q={options:['Oganesson','Uranium','Osmium','Plutonium'],correct:0,aliases:['Og']};
 assert.equal(grade(q,{typed:' OG '}).correct,true);assert.equal(grade(q,{typed:'uranium'}).correct,false);assert.equal(grade(q,{choice:0}).correct,true);assert.throws(()=>grade(q,{choice:9}));
 assert.equal(normalize('  Café! '),'café');
});
test('passwords use salted hashes and comparison rejects altered values',async()=>{
 const a=await passwordHash('a long password','salt-one'),b=await passwordHash('a long password','salt-two');
 assert.notEqual(a,b);assert.ok(equal(a,await passwordHash('a long password','salt-one')));assert.ok(!equal(a,a.slice(1)));assert.ok(!equal(undefined,a));
});
test('settings reject unsafe themes, invalid times and timezones',()=>{
 assert.deepEqual(validateSettings({theme:'light',time:'08:30',timezone:'Europe/London',extra:'ignored'}),{theme:'light',time:'08:30',timezone:'Europe/London'});
 for(const settings of [{time:'25:00'},{theme:'<script>'},{timezone:'Not/A/Zone'}])assert.throws(()=>validateSettings(settings));
 assert.equal(localDay('Europe/London',new Date('2026-07-01T23:30:00Z')),'2026-07-02');
});
test('questions require four distinct choices, three prompts and an observed citation',()=>{
 const q={topic:'Science',q:'Which element?',options:['A','B','C','D'],correct:1,explanation:'A brief explanation.',concept:'test-concept',aliases:[],follow:['Why?','Where?','How?'],source:'https://example.org/source'};
 assert.equal(validateQuestion(q,[q.source]),q);assert.throws(()=>validateQuestion(q,[]));assert.throws(()=>validateQuestion({...q,options:['A','A','C','D']},[q.source]));
 assert.deepEqual(citations({output:[{content:[{annotations:[{type:'url_citation',url:q.source},{type:'url_citation',url:'javascript:bad'}]}]}]}),[q.source]);
});
test('email addresses normalise case; simple passwords remain allowed',async()=>{
 const {email}=await import('../worker/auth.mjs');const {password}=await import('../worker/core.mjs');
 assert.equal(email(' Nicole+trivia@Example.COM '),'nicole+trivia@example.com');
 for(const value of ['not-an-email','a@b','a b@example.com','a..b@example.com',null])assert.throws(()=>email(value));
 assert.equal(password('a'),'a');assert.throws(()=>password(''));
});
test('design and notification preferences validate ranges and reject CSS injection',()=>{
 const settings={font:'handwritten',fontSize:125,accentDark:'#d8ac47',backgroundDark:'#101426',answerCount:10,dailyAmount:3,notificationsEnabled:false};assert.deepEqual(validateSettings(settings),settings);
 for(const input of [{font:'unknown'},{fontSize:900},{accentDark:'red;display:none'},{dailyAmount:0},{dailyAmount:11},{answerCount:1},{answerCount:11},{notificationsEnabled:'yes'}])assert.throws(()=>validateSettings(input));
});
test('question marking supports 2 through 10 choices and rejects mismatched generated counts',()=>{
 const base={topic:'Numbers',q:'Which number is ten?',explanation:'Ten is 10.',concept:'ten',source:'https://example.org',aliases:[],follow:['Why?','How?','Where?']};
 for(const n of [2,10]){const q={...base,options:Array.from({length:n},(_,i)=>String(i)),correct:n-1};assert.equal(validateQuestion(q,[q.source],n),q);assert.equal(grade(q,{choice:n-1}).correct,true);assert.throws(()=>grade(q,{choice:n}));assert.throws(()=>validateQuestion(q,[q.source],n===2?10:2))}
});

test('random schedules stay within the window, spread notifications, and remain stable for the day',async()=>{
 const {notificationTimes,validateNotificationWindow}=await import('../worker/core.mjs');
 const settings={notificationMode:'random',randomStart:'08:00',randomEnd:'21:00',dailyAmount:10};
 const times=await notificationTimes(settings,'2026-10-27','user-one');assert.equal(times.length,10);assert.equal(new Set(times).size,10);assert.deepEqual([...times].sort(),times);assert.ok(times.every(t=>t>='08:00'&&t<'21:00'));
 assert.deepEqual(await notificationTimes(settings,'2026-10-27','user-one'),times);assert.notDeepEqual(await notificationTimes(settings,'2026-10-28','user-one'),times);assert.notDeepEqual(await notificationTimes(settings,'2026-10-27','user-two'),times);
 assert.deepEqual(await notificationTimes({...settings,notificationsEnabled:false},'2026-10-27','user-one'),[]);
 assert.deepEqual(await notificationTimes({time:'08:30',dailyAmount:1},'2026-10-27','user-one'),['08:30']);
 for(const invalid of [{notificationMode:'chaos'},{randomStart:'25:00'},{randomEnd:'hello'}])assert.throws(()=>validateSettings(invalid));
 assert.throws(()=>validateNotificationWindow({randomStart:'21:00',randomEnd:'08:00'}));
});
test('everything mixed with selected topics favours them two days in three without starving topics',async()=>{
 const {topicForDay}=await import('../worker/ai.mjs');
 const interests=['Chemistry','Poetry','History','Marine biology focused on sharks'];const selected=[],explored=[];
 for(let i=0;i<30;i++){
  const day=new Date(Date.UTC(2026,10,1+i)).toISOString().slice(0,10),mixed=topicForDay(day,interests,true);
  (mixed.focused?selected:explored).push(mixed.topic);
  assert.ok(interests.includes(topicForDay(day,interests,false).topic));assert.equal(topicForDay(day,[],true).focused,false);
 }
 assert.equal(selected.length,20);assert.equal(explored.length,10);assert.deepEqual(new Set(selected),new Set(interests));assert.ok(explored.every(t=>!interests.some(i=>i.toLowerCase().includes(t.toLowerCase()))));assert.ok(new Set(explored).size>3);
});
