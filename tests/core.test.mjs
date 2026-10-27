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
test('subject selection balances a long history and keeps the two-to-one mixed preference',async()=>{
 const {chooseSubject}=await import('../worker/discoveries.mjs');
 const interests=['Chemistry','Art','History'],history=[];
 for(let i=0;i<90;i++){const selected=chooseSubject(interests,false,history);history.push({subject:selected.topic})}
 for(const topic of interests)assert.equal(history.filter(q=>q.subject===topic).length,30);
 const mixed=[];for(let i=0;i<90;i++){const selected=chooseSubject(interests,true,mixed);mixed.push({subject:selected.topic})}
 assert.equal(mixed.filter(q=>interests.includes(q.subject)).length,60);
 for(const topic of interests)assert.equal(mixed.filter(q=>q.subject===topic).length,20);
 const generic=[];for(let i=0;i<48;i++)generic.push({subject:chooseSubject([],true,generic).topic});assert.equal(new Set(generic.map(q=>q.subject)).size,24);assert.ok([...new Set(generic.map(q=>q.subject))].every(topic=>generic.filter(q=>q.subject===topic).length===2));
});
test('answer aliases cannot make a second option correct',()=>{
 const q={topic:'Science',q:'Which element?',options:['Oxygen','Gold','Iron','Helium'],correct:0,explanation:'Oxygen.',concept:'oxygen-fact',aliases:['Gold'],follow:['Why?','Where?','How?'],source:'https://example.org'};assert.throws(()=>validateQuestion(q,[q.source]),/overlap/);
});
test('day-period reminders choose distinct random times inside the selected period',async()=>{
 const {DAY_PERIODS,notificationTimes}=await import('../worker/core.mjs');
 for(const [notificationPeriod,[start,end]] of Object.entries(DAY_PERIODS)){
  const settings={notificationMode:'period',notificationPeriod,dailyAmount:10};assert.equal(validateSettings(settings).notificationPeriod,notificationPeriod);
  const times=await notificationTimes(settings,'2026-10-27','period-user');assert.equal(times.length,10);assert.equal(new Set(times).size,10);
  assert.ok(times.every(time=>{const [h,m]=time.split(':').map(Number),minute=h*60+m;return minute>=start&&minute<end}));
  assert.deepEqual(await notificationTimes(settings,'2026-10-27','period-user'),times);
 }
 assert.throws(()=>validateSettings({notificationPeriod:'sometime'}));assert.equal(validateSettings({notificationMode:'period'}).notificationMode,'period');
});
test('individual reminder rows support mixed modes, partial schedules and distinct times',async()=>{
 const {notificationTimes,validateNotificationWindow}=await import('../worker/core.mjs');
 const reminders=[{mode:'fixed',time:'09:00'},{mode:'period',period:'evening'},{mode:'random',start:'12:00',end:'14:00'}];
 const settings={dailyAmount:4,reminders:validateSettings({reminders}).reminders};validateNotificationWindow(settings);
 const times=await notificationTimes(settings,'2026-10-27','individual-user');assert.equal(times.length,3);assert.equal(times[0],'09:00');assert.ok(times[1]>='18:00'&&times[1]<'22:00');assert.ok(times[2]>='12:00'&&times[2]<'14:00');assert.deepEqual(await notificationTimes(settings,'2026-10-27','individual-user'),times);
 for(const invalid of [Array.from({length:11},()=>({mode:'fixed'})),[{mode:'unknown'}],[{mode:'fixed',time:'99:00'}],[{mode:'period',period:'lunch'}],[{mode:'random',start:'17:00',end:'09:00'}],[{mode:'fixed',time:'09:00'},{mode:'fixed',time:'09:00'}]])assert.throws(()=>validateSettings({reminders:invalid}));
 assert.throws(()=>validateNotificationWindow({...settings,dailyAmount:1}));
 const overlapping={dailyAmount:3,reminders:validateSettings({reminders:[{mode:'random',start:'09:00',end:'09:03'},{mode:'fixed',time:'09:00'},{mode:'random',start:'09:00',end:'09:03'}]}).reminders};
 assert.equal(new Set(await notificationTimes(overlapping,'2026-10-27','overlap-user')).size,3);
});

test('notification slots are stable when another reminder is deleted and all reminders may be removed',async()=>{
 const {notificationTimes,validateNotificationWindow}=await import('../worker/core.mjs');
 const reminders=validateSettings({reminders:[{slot:0,mode:'fixed',time:'09:00'},{slot:2,mode:'fixed',time:'18:00'}]}).reminders;assert.deepEqual(reminders.map(row=>row.slot),[0,2]);validateNotificationWindow({dailyAmount:3,reminders});
 assert.deepEqual(await notificationTimes({dailyAmount:3,reminders:[reminders[1]]},'2026-10-27','slot-owner'),['18:00']);assert.deepEqual(validateSettings({reminders:[]}).reminders,[]);assert.deepEqual(await notificationTimes({dailyAmount:3,reminders:[]},'2026-10-27','slot-owner'),[]);
 for(const rows of [[{slot:1,mode:'fixed'},{slot:1,mode:'period'}],[{slot:-1,mode:'fixed'}],[{slot:10,mode:'fixed'}]])assert.throws(()=>validateSettings({reminders:rows}));
 assert.throws(()=>validateNotificationWindow({dailyAmount:2,reminders}));
});

test('day-part windows default to 8am, validate custom ranges and affect scheduled times',async()=>{
 const {DAY_PERIODS,notificationTimes}=await import('../worker/core.mjs');assert.equal(DAY_PERIODS.morning[0],480);
 assert.doesNotThrow(()=>validateSettings({reminders:[{mode:'period',period:'night',time:'09:00',start:'22:00',end:'24:00'}]}));
 const patch=validateSettings({periodWindows:{afternoon:{start:'15:00',end:'16:00'},night:{start:'23:00',end:'24:00'}}});
 for(const period of ['afternoon','night']){const settings={dailyAmount:2,...patch,reminders:[{slot:0,mode:'period',time:'09:00',period},{slot:1,mode:'period',time:'09:00',period}]};const times=await notificationTimes(settings,'2026-10-27','account');assert.equal(times.length,2);assert.notEqual(times[0],times[1]);for(const t of times)assert.ok(t>=(period==='night'?'23:00':'15:00')&&t<(period==='night'?'24:00':'16:00'))}
 assert.throws(()=>validateSettings({periodWindows:{morning:{start:'12:00',end:'08:00'}}}));assert.throws(()=>validateSettings({periodWindows:{night:{start:'23:59',end:'24:00'}}}));assert.throws(()=>validateSettings({periodWindows:{nonsense:{start:'08:00',end:'12:00'}}}));
});
test('a mismatched generated answer index is rejected even when every option is valid',async()=>{
 const {validateAnswerKey}=await import('../worker/core.mjs');const q={options:['Iron','Tungsten','Gold','Lead'],correct:2,correctAnswer:'Tungsten'};
 assert.throws(()=>validateAnswerKey(q),/answer text/);assert.doesNotThrow(()=>validateAnswerKey({...q,correct:1}));
});

test('answer shuffling preserves the answer and distributes its position',async()=>{
 const {shuffleAnswers,validateFormat,formatUnits,displayQuestion}=await import('../worker/quiz.mjs');const q={q:'How much?',options:['10 kg','2 kg','3 kg','4 kg'],correct:0,correctAnswer:'10 kg',format:'multiple_choice'},positions=new Set();
 for(let i=0;i<100;i++){const shuffled=shuffleAnswers(q);positions.add(shuffled.correct);assert.equal(shuffled.options[shuffled.correct],'10 kg');assert.deepEqual(new Set(shuffled.options),new Set(q.options))}assert.equal(positions.size,4);assert.equal(q.correct,0);
 assert.equal(validateFormat({format:'true_false',options:['False','True']},10),2);assert.throws(()=>validateFormat({format:'true_false',options:['Yes','No']},10));assert.equal(validateFormat({format:'this_or_that',options:['Pokémon','Dinosaur']},10),2);
 assert.equal(formatUnits('100 °C'),'100 °C');assert.match(formatUnits('100 °C and 10 kg','imperial'),/212 °F \(100 °C\).*22.05 lb \(10 kg\)/);assert.match(formatUnits('273.15 K','imperial'),/32 °F/);assert.match(formatUnits('2 litres','imperial'),/3.52 UK pt/);
 const converted=displayQuestion(q,'imperial');assert.equal(converted.correct,0);assert.ok(converted.options[0].includes('22.05 lb'));assert.equal(q.options[0],'10 kg');assert.deepEqual(validateSettings({units:'imperial'}),{units:'imperial'});assert.throws(()=>validateSettings({units:'other'}));
});

test('new usernames use CamelCase words and digits, and optional timers validate',async()=>{
 const {randomFriendUsername}=await import('../worker/core.mjs');const handles=new Set();for(let i=0;i<100;i++){const name=randomFriendUsername();assert.match(name,/^[A-Z][a-z]+[A-Z][a-z]+\d{2,4}$/);handles.add(name)}assert.ok(handles.size>95);assert.deepEqual(validateSettings({timerSeconds:30}),{timerSeconds:30});assert.deepEqual(validateSettings({timerSeconds:0}),{timerSeconds:0});for(const value of [-1,5,121,'30'])assert.throws(()=>validateSettings({timerSeconds:value}));
});

test('avatar crop stays covered and zoom preserves the chosen focal point',async()=>{
 await import('../avatar.js');const crop=globalThis.FancyAvatar;
 const wide={width:1200,height:600,zoom:1,x:999,y:-999},fit=crop.clamp(wide);assert.equal(fit.x,160);assert.equal(fit.y,0);
 const tall=crop.clamp({width:600,height:1200,zoom:1,x:999,y:-999});assert.equal(tall.x,0);assert.equal(tall.y,-160);
 const base={width:800,height:800,zoom:2,x:20,y:30},point={x:190,y:180},zoomed=crop.zoomAt(base,3,point);assert.equal(zoomed.x,15);assert.equal(zoomed.y,35);assert.equal(zoomed.zoom,3);
 const reset=crop.zoomAt(zoomed,.1);assert.equal(reset.zoom,1);assert.equal(reset.x,0);assert.equal(reset.y,0);
 for(const zoom of [1,1.3,2,4,10]){const state=crop.zoomAt({...wide,x:200,y:50},zoom),scale=320/Math.min(state.width,state.height)*state.zoom;assert.ok(Math.abs(state.x)<=(state.width*scale-320)/2);assert.ok(Math.abs(state.y)<=(state.height*scale-320)/2);assert.ok(state.zoom<=4)}
});

test('leaderboards rank score first, then time, and keep exact or unrecorded ties honest',async()=>{
 const {rankPlayers,resultNotice}=await import('../worker/ranking.mjs');const rows=[{id:'slow',name:'Sam',score:8,elapsed_ms:50000,completed_at:1},{id:'fast',name:'Nikki',score:8,elapsed_ms:30000,completed_at:1},{id:'low',name:'Mum',score:7,elapsed_ms:10000,completed_at:1},{id:'playing',score:null}];
 const ranked=rankPlayers(rows);assert.deepEqual(ranked.map(p=>p.id),['fast','slow','low']);assert.deepEqual(ranked.map(p=>p.rank),[1,2,3]);assert.match(resultNotice(rows[1],rows[0],10),/beat you.*faster time/);assert.match(resultNotice(rows[0],rows[1],10),/still ahead/);
 assert.deepEqual(rankPlayers([rows[0],{...rows[1],elapsed_ms:50000}]).map(p=>p.rank),[1,1]);assert.deepEqual(rankPlayers([rows[0],{...rows[1],elapsed_ms:null}]).map(p=>p.rank),[1,1]);
});
test('phone notification preferences validate each event and push endpoints reject arbitrary hosts',async()=>{
 const {validPushEndpoint}=await import('../worker/push.mjs');assert.ok(validPushEndpoint('https://fcm.googleapis.com/wp/abc'));for(const endpoint of ['http://fcm.googleapis.com/a','https://localhost/push','https://fcm.googleapis.com.evil.test/a','https://fcm.googleapis.com:8443/a','https://name@fcm.googleapis.com/a'])assert.equal(validPushEndpoint(endpoint),false);
 assert.deepEqual(validateSettings({phoneAlerts:true,pushEvents:{friendRequests:false,friendAccepted:true,quizResults:false}}),{phoneAlerts:true,pushEvents:{friendRequests:false,friendAccepted:true,quizResults:false}});assert.throws(()=>validateSettings({pushEvents:{madeUp:true}}));assert.throws(()=>validateSettings({pushEvents:{quizResults:1}}));
});
