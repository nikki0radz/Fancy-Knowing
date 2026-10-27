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
