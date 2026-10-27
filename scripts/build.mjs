import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public', { recursive: true });
for (const f of ['index.html', 'app.js']) await copyFile(f, `public/${f}`);
console.log('Built Fancy Knowing assets.');
