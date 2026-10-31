#!/usr/bin/env node
// Offline, local-disk export. This intentionally accepts no provider URL/token,
// loads no environment file, and never writes the decrypted archive to disk.
import { lstatSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileStores } from '../platform-node/store.ts';
import { BACKUP_LIMITS, createArchive, encryptArchive, validatePassword } from '../platform-node/backup-format.mjs';
import { backupArguments, localMigrations, readBackupPassword } from './backup-cli-input.mjs';
export async function createMain(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log('Uso: node scripts/create-backup.mjs --local-data pasta-de-dados --output arquivo-novo.proexbackup\nSomente disco local; não aceita URL de banco e não carrega .env. Pare os escritores locais antes de capturar.\nFrase de proteção por entrada oculta no terminal ou stdin, nunca por flag. O arquivo de saída deve ser novo.'); return; }
  const options = backupArguments(args, ['--local-data', '--output']);
  const source = options['--local-data'], output = options['--output'];
  if (typeof source !== 'string' || typeof output !== 'string' || /^[a-z][a-z0-9+.-]*:\/\//i.test(source) || /^[/\\]{2}/.test(source) || /^[a-z][a-z0-9+.-]*:\/\//i.test(output) || /^[/\\]{2}/.test(output) || !/\.proexbackup$/i.test(output)) throw new Error('Informe somente uma pasta local e um arquivo novo .proexbackup.');
  const info = lstatSync(source); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('A origem precisa ser uma pasta local existente.');
  let password = await readBackupPassword(), capture, archive;
  try {
    validatePassword(password);
    capture = await fileStores(source).backup.capture(BACKUP_LIMITS);
    archive = createArchive(capture, { migrations: localMigrations() });
    const encrypted = await encryptArchive(archive.bytes, password);
    writeFileSync(output, encrypted, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ encrypted: true, formatVersion: 1, snapshotVersion: capture.snapshot.version, objects: capture.objects.length, bytes: encrypted.byteLength }));
  } finally { password = ''; archive?.bytes.fill(0); capture?.snapshot.data.fill(0); for (const object of capture?.objects ?? []) object.data.fill(0); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) createMain().catch(error => { console.error(error?.code?.startsWith('backup_') ? error.message : 'Não foi possível gerar o backup criptografado. Consulte --help.'); process.exitCode = 1; });
