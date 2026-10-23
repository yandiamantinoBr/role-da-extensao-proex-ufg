#!/usr/bin/env node
// Implanta o portal numa conta Cloudflare própria (Workers + D1 + R2), sem depender
// do ChatGPT Sites. Idempotente: cria banco e bucket se não existirem, aplica as
// migrações pendentes, publica o Worker já compilado e atualiza os segredos.
//
// Pré-requisito: `pnpm build` (gera dist/server/wrangler.json).
// Ambiente obrigatório: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PROEX_PUBLIC_URL.
// Segredos opcionais (enviados quando presentes): BETTER_AUTH_SECRET, OWNER_EMAIL, SETUP_TOKEN.
// Nomes opcionais: PROEX_WORKER_NAME, PROEX_D1_NAME, PROEX_R2_BUCKET.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const env = process.env;
const worker = env.PROEX_WORKER_NAME || 'proex-gestao';
const d1Name = env.PROEX_D1_NAME || 'proex-gestao';
const bucketName = env.PROEX_R2_BUCKET || 'proex-gestao-arquivos';
const dryRun = process.argv.includes('--dry-run');

for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'PROEX_PUBLIC_URL']) {
  if (!env[name] && !dryRun) { console.error(`Defina ${name}.`); process.exit(2); }
}
const publicUrl = env.PROEX_PUBLIC_URL ? new URL(env.PROEX_PUBLIC_URL).origin : 'https://example.invalid';
const built = join(root, 'dist/server/wrangler.json');
if (!existsSync(built)) { console.error('Rode `pnpm build` antes do deploy.'); process.exit(2); }

const wrangler = (args, options = {}) => {
  console.log(`$ wrangler ${args.join(' ')}`);
  if (dryRun) return '';
  return execFileSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], { cwd: root, encoding: 'utf8', stdio: [options.input ? 'pipe' : 'inherit', options.capture ? 'pipe' : 'inherit', 'inherit'], input: options.input });
};
const json = text => { const start = text.search(/[[{]/); return JSON.parse(text.slice(start)); };

// 1. Banco D1 (SQLite gerenciado).
let databaseId = env.PROEX_D1_DATABASE_ID;
if (!databaseId && !dryRun) {
  const list = json(wrangler(['d1', 'list', '--json'], { capture: true }));
  databaseId = list.find(db => db.name === d1Name)?.uuid;
  if (!databaseId) {
    wrangler(['d1', 'create', d1Name]);
    databaseId = json(wrangler(['d1', 'list', '--json'], { capture: true })).find(db => db.name === d1Name)?.uuid;
  }
  if (!databaseId) throw new Error(`Não foi possível localizar o banco ${d1Name}.`);
}
databaseId ||= '00000000-0000-4000-8000-000000000000';

// 2. Bucket R2 para fotos e termos. Sem R2 o portal funciona, mas anexos ficam indisponíveis.
let withBucket = true;
if (!dryRun) {
  try {
    const buckets = wrangler(['r2', 'bucket', 'list'], { capture: true });
    if (!buckets.includes(bucketName)) wrangler(['r2', 'bucket', 'create', bucketName]);
  } catch {
    withBucket = false;
    console.warn('::warning::R2 indisponível nesta conta (ative o R2 no painel da Cloudflare). Publicando sem anexos.');
  }
}

// 3. Migrações (somente as pendentes; histórico em d1_migrations).
const deployDir = join(root, '.deploy');
mkdirSync(deployDir, { recursive: true });
const migrationConfig = join(deployDir, 'wrangler.migrations.json');
writeFileSync(migrationConfig, JSON.stringify({
  name: worker, compatibility_date: '2026-05-15',
  d1_databases: [{ binding: 'DB', database_name: d1Name, database_id: databaseId, migrations_dir: '../drizzle' }],
}, null, 2));
wrangler(['d1', 'migrations', 'apply', d1Name, '--remote', '-c', migrationConfig]);

// 4. Worker compilado com os recursos reais e a marca de hospedagem própria.
const config = JSON.parse(readFileSync(built, 'utf8'));
Object.assign(config, {
  name: worker, topLevelName: worker,
  d1_databases: [{ binding: 'DB', database_name: d1Name, database_id: databaseId }],
  r2_buckets: withBucket ? [{ binding: 'BUCKET', bucket_name: bucketName }] : [],
  // PROEX_STANDALONE descarta cabeçalhos de identidade do Sites (ver worker/index.ts).
  vars: { ...config.vars, PROEX_STANDALONE: '1', BETTER_AUTH_URL: publicUrl },
});
writeFileSync(built, JSON.stringify(config));
wrangler(['deploy', '--config', built]);

// 5. Segredos. Valores nunca aparecem no log.
const secrets = Object.fromEntries(['BETTER_AUTH_SECRET', 'OWNER_EMAIL', 'SETUP_TOKEN'].filter(name => env[name]).map(name => [name, env[name]]));
if (Object.keys(secrets).length) wrangler(['secret', 'bulk', '--name', worker], { input: JSON.stringify(secrets) });
console.log(`Portal publicado: ${publicUrl}`);
