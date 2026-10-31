#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEncryptedBackup, rejectConfiguredRuntime, restoreEncryptedBackup } from '../platform-node/backup-restore.mjs';
import { backupArguments, localMigrations, readBackupPassword } from './backup-cli-input.mjs';
export async function restoreMain(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log('Uso: node scripts/restore-backup.mjs --input arquivo.proexbackup [--dry-run] [--destination pasta-temporaria-nova]\nA frase é lida sem eco no terminal ou por stdin, nunca por flag. Não lê .env, não conecta provedores e não inicia servidor.\nO destino deve ser novo, diretamente na pasta temporária, com prefixo proex-isolated-restore-. Sem --destination, o nome é gerado.'); return; }
  const options = backupArguments(args, ['--input', '--dry-run', '--destination']);
  if (!options['--input']) throw new Error('Informe um arquivo local .proexbackup com --input.');
  rejectConfiguredRuntime(process.env);
  const encrypted = readEncryptedBackup(options['--input']);
  let password = await readBackupPassword();
  try { console.log(JSON.stringify(await restoreEncryptedBackup(encrypted, password, { dryRun: options['--dry-run'] === true, destination: options['--destination'], migrations: localMigrations() }))); }
  finally { password = ''; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) restoreMain().catch(error => { console.error(error?.code?.startsWith('backup_') ? error.message : 'Não foi possível validar ou restaurar o backup. Consulte --help.'); process.exitCode = 1; });
