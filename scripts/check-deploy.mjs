import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const id = config.d1_databases[0].database_id;
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
 console.error('Create fancy-knowing-db in Cloudflare D1, then replace REPLACE_WITH_D1_DATABASE_ID in wrangler.jsonc with its Database ID.');
 process.exit(1);
}
console.log('Fancy Knowing database configuration is ready.');
