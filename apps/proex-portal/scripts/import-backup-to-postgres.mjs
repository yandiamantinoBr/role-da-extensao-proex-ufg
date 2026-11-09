#!/usr/bin/env node
// Importa um pacote .proexbackup num Postgres/Supabase NOVO e VAZIO (esquema "proex").
// Passo da migração para contas da PROEX: docs/MIGRACAO-PARA-PROEX.md.
//   Sem --apply: só valida o pacote e mostra o plano (nenhuma conexão é aberta).
//   Com --apply: exige PROEX_TARGET_DATABASE_URL no ambiente (endereço do destino, com senha,
//   nunca por argumento). Recusa destino com banco ou anexos; confere tudo antes de confirmar.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEncryptedBackup, rejectConfiguredRuntime } from '../platform-node/backup-restore.mjs';
import { decryptArchive, decryptHybridArchive, isHybridBackup, validateArchive } from '../platform-node/backup-format.mjs';
import { importArchive, planPostgresImport } from '../platform-node/backup-import.mjs';
import { backupArguments, localMigrations, readBackupPassword, readBackupPrivateKey } from './backup-cli-input.mjs';

const usage = 'Uso: node scripts/import-backup-to-postgres.mjs --input arquivo.proexbackup [--apply]\nSem --apply apenas valida e mostra o plano. Com --apply defina PROEX_TARGET_DATABASE_URL (destino novo e vazio). Formato 1 pede a frase; formato 2, a chave privada (entrada oculta ou stdin).';

/** Adaptador real sobre o cliente `postgres` (o mesmo usado pelo portal). */
export async function postgresTarget(url) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 15 });
  const ddl = readFileSync(new URL('../supabase/proex-storage.sql', import.meta.url), 'utf8');
  return {
    async transaction(work) {
      return await sql.begin(async tx => {
        await tx.unsafe(ddl);
        return await work({
          async counts() {
            const [a] = await tx`select count(*)::int as n from proex.sqlite_snapshot`, [b] = await tx`select count(*)::int as n from proex.objects`;
            return { snapshots: a.n, objects: b.n };
          },
          async insertSnapshot(version, bytes) { await tx`insert into proex.sqlite_snapshot (id, version, data) values (1, ${version}, ${Buffer.from(bytes)})`; },
          async insertObject(o) { await tx`insert into proex.objects (key, content_type, size, data) values (${o.key}, ${o.contentType}, ${o.size}, ${Buffer.from(o.data)})`; },
          async readback() {
            const [s] = await tx`select version::int as version, encode(sha256(data), 'hex') as sha from proex.sqlite_snapshot where id = 1`;
            const rows = await tx`select key, size, encode(sha256(data), 'hex') as sha from proex.objects`;
            return { version: s.version, snapshotSha256: s.sha, objects: rows.map(r => ({ key: r.key, size: r.size, sha256: r.sha })) };
          },
        });
      });
    },
    async close() { await sql.end({ timeout: 5 }); },
  };
}

export async function importMain(args = process.argv.slice(2), { environment = process.env, connect = postgresTarget, readSecret } = {}) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return null; }
  const apply = args.filter(item => item === '--apply').length === 1;
  if (args.filter(item => item === '--apply').length > 1) throw new Error('Opção inválida; consulte --help.');
  const options = backupArguments(args.filter(item => item !== '--apply'), ['--input']);
  if (!options['--input']) throw new Error('Informe um arquivo local .proexbackup com --input.');
  rejectConfiguredRuntime(environment);
  if (apply && !environment.PROEX_TARGET_DATABASE_URL) throw new Error('Defina PROEX_TARGET_DATABASE_URL (destino novo) no ambiente para usar --apply.');
  const encrypted = readEncryptedBackup(options['--input']);
  const hybrid = isHybridBackup(encrypted);
  let secret = await (readSecret ?? (hybrid ? readBackupPrivateKey : readBackupPassword))();
  let clear;
  try {
    clear = hybrid ? decryptHybridArchive(encrypted, secret) : await decryptArchive(encrypted, secret);
    const archive = validateArchive(clear, { migrations: localMigrations() });
    const plan = planPostgresImport(archive);
    const report = { verified: true, apply, snapshotVersion: plan.version, objects: plan.objects.length, skippedWithoutKey: plan.skippedWithoutKey.length };
    if (!apply) return report;
    const target = await connect(environment.PROEX_TARGET_DATABASE_URL);
    try { return { ...report, ...(await importArchive(archive, target)) }; }
    finally { await target.close?.(); }
  } finally { secret = ''; clear?.fill(0); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  importMain().then(report => { if (report) console.log(JSON.stringify(report)); }).catch(error => {
    console.error(error?.code?.startsWith('backup_') ? error.message : (error?.message ?? 'Não foi possível importar o pacote.'));
    process.exitCode = 1;
  });
}
