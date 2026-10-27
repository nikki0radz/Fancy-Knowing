import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('public', { recursive: true });
for (const f of ['index.html', 'app.js', 'design.js', 'play.js', 'quiz-ui.js', 'quiz.css', 'social.js', 'play.css', 'sw.js']) await copyFile(f, `public/${f}`);
await cp('fonts', 'public/fonts', {recursive:true});
await cp('assets', 'public/assets', {recursive:true});
console.log('Built Fancy Knowing assets.');
