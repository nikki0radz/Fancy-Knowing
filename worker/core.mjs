const encoder = new TextEncoder();
export const DAY = 86400000;
export const SESSION_DAYS = 90;
export function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
export function normalize(value) { return String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
export function username(value) {
 if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(value)) fail('Use 3–40 letters, numbers, dots, dashes or underscores for your username.');
 return value.toLowerCase();
}
export function password(value) { if (typeof value !== 'string' || value.length < 12 || value.length > 200) fail('Use a password between 12 and 200 characters.'); return value; }
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
 if ('timezone' in value) { try { new Intl.DateTimeFormat('en-GB', {timeZone:value.timezone}).format(); } catch { fail('Invalid time zone.'); } output.timezone = String(value.timezone); }
 return output;
}
export function localDay(timezone = 'Europe/London', date = new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
export function validateQuestion(q, citedUrls) {
 if (!q || typeof q !== 'object') fail('The question could not be checked. Try again.', 502);
 for(const k of ['topic','q','explanation','concept','source']) if(typeof q[k] !== 'string' || !q[k].trim() || q[k].length > (k==='explanation'?600:300)) fail('The question could not be checked. Try again.',502);
 if (!Array.isArray(q.options) || q.options.length!==4 || q.options.some(o=>typeof o!=='string'||!o.trim()||o.length>100) || new Set(q.options.map(normalize)).size!==4 || !Number.isInteger(q.correct)||q.correct<0||q.correct>3) fail('The question could not be checked. Try again.',502);
 if(!Array.isArray(q.aliases)||q.aliases.some(a=>typeof a!=='string'||a.length>100)||q.aliases.length>10)fail('Invalid answer aliases.',502);
 if(!Array.isArray(q.follow)||q.follow.length!==3||q.follow.some(f=>typeof f!=='string'||!f.trim()||f.length>120)||new Set(q.follow.map(normalize)).size!==3)fail('Invalid follow-up questions.',502);
 if (!citedUrls.includes(q.source) || !q.source.startsWith('https://')) fail('The source could not be checked. Try again.',502);
 return q;
}
export function grade(q, body) {
 if (typeof body.typed === 'string') {
 const typed = body.typed.trim(); if(!typed || typed.length>150)fail('Type a short answer.');
 return {typed, choice:null, correct:[q.options[q.correct],...(q.aliases||[])].some(s=>normalize(s)===normalize(typed))};
 }
 if(!Number.isInteger(body.choice)||body.choice<0||body.choice>3)fail('Choose an answer.');
 return {typed:null,choice:body.choice,correct:body.choice===q.correct};
}
export function responseText(data) { return (data.output||[]).filter(i=>i.type==='message').flatMap(i=>i.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('\n'); }
export function citations(data) { return [...new Set((data.output||[]).flatMap(i=>i.content||[]).flatMap(c=>c.annotations||[]).filter(a=>a.type==='url_citation').map(a=>a.url).filter(u=>typeof u==='string'&&u.startsWith('https://')))]; }
