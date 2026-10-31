import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackupError, decryptArchive, MAX_ENCRYPTED_BYTES, sha256, validateArchive } from './backup-format.mjs';

export const RESTORE_PREFIX = 'proex-isolated-restore-';
const badDestination = () => { throw Object.assign(new Error('A restauração exige uma pasta nova e isolada, diretamente na pasta temporária local.'), { code: 'backup_destination' }); };
const localPath = value => typeof value === 'string' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^[/\\]{2}/.test(value) && !value.includes('\0');
export function restoreDestination(destination) {
  const root = realpathSync(tmpdir()), target = destination ?? join(root, RESTORE_PREFIX + randomUUID());
  if (!localPath(target) || !isAbsolute(target)) badDestination();
  const absolute = resolve(target), same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!same(dirname(absolute), root) || !basename(absolute).startsWith(RESTORE_PREFIX) || basename(absolute).length > 120 || existsSync(absolute)) badDestination();
  return absolute;
}
export function readEncryptedBackup(file) {
  if (!localPath(file) || !/\.proexbackup$/i.test(file)) throw new BackupError('backup_invalid');
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_ENCRYPTED_BYTES) throw new BackupError('backup_invalid');
  return readFileSync(file);
}
export function rejectConfiguredRuntime(environment) {
  // Check presence only: no credential values are read, printed or reused.
  if (['PROEX_DATABASE_URL', 'DATABASE_URL', 'PROEX_DATA_DIR', 'VERCEL'].some(name => Object.prototype.hasOwnProperty.call(environment, name))) {
    throw Object.assign(new Error('Abra um terminal isolado, sem configuração de banco ou hospedagem, para validar a restauração.'), { code: 'backup_destination' });
  }
}
export async function restoreEncryptedBackup(encrypted, password, { dryRun = false, destination, migrations = [] } = {}) {
  const target = restoreDestination(destination);
  const clear = await decryptArchive(encrypted, password);
  try {
    const archive = validateArchive(clear, { migrations });
    const unknownMigrations = archive.manifest.sqlite.migrations.filter(applied => !migrations.some(local => local.name === applied.name) || applied.sha256 === null).length;
    const report = { formatVersion: 1, verified: true, dryRun, snapshotVersion: archive.manifest.source.snapshotVersion,
      objects: archive.objects.length, objectBytes: archive.manifest.totalObjectBytes, sqliteBytes: archive.manifest.sqlite.uncompressedSize,
      migrations: archive.manifest.sqlite.migrations.length, unknownMigrations, codeRevision: archive.manifest.source.codeRevision };
    if (dryRun) return report;
    // Exclusive creation prevents overwrites, including symlink/existing-target
    // races. No production URL, database connection, or automatic server start.
    mkdirSync(target, { mode: 0o700 });
    const marker = join(target, 'ISOLATED-RESTORE.json');
    writeFileSync(marker, JSON.stringify({ kind: 'proex-isolated-restore', ready: false, network: 'disabled-by-design', mustNotPublish: true }), { flag: 'wx', mode: 0o600 });
    const data = join(target, 'data'); mkdirSync(data, { mode: 0o700 }); mkdirSync(join(data, 'objects'), { mode: 0o700 });
    writeFileSync(join(data, 'portal.sqlite.gz'), archive.snapshot, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(data, 'version'), String(report.snapshotVersion), { flag: 'wx', mode: 0o600 });
    for (const object of archive.objects) {
      const path = join(data, 'objects', object.storageId);
      writeFileSync(path, object.data, { flag: 'wx', mode: 0o600 });
      writeFileSync(`${path}.type`, object.contentType, { flag: 'wx', mode: 0o600 });
      if (sha256(readFileSync(path)) !== sha256(object.data)) throw new BackupError('backup_objects');
    }
    if (sha256(readFileSync(join(data, 'portal.sqlite.gz'))) !== archive.manifest.sqlite.sha256) throw new BackupError('backup_sqlite');
    writeFileSync(join(target, 'recovery-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    writeFileSync(join(target, 'README.txt'), 'RESTAURAÇÃO ISOLADA PROEX\n\nEsta pasta contém dados privados descriptografados. Não publique, não compartilhe e não a use como destino de produção.\nA ferramenta não inicia servidor nem usa credenciais de provedor. A pasta data é compatível com o adaptador de disco do portal.\nPara um ensaio de aplicação, use somente loopback, segredos locais novos e a revisão de código registrada. Não reutilize credenciais de produção.\nMigrações desconhecidas exigem a revisão de código correspondente antes de iniciar uma cópia da aplicação.\n', { flag: 'wx', mode: 0o600 });
    writeFileSync(marker, JSON.stringify({ kind: 'proex-isolated-restore', ready: true, network: 'disabled-by-design', mustNotPublish: true, ...report }, null, 2), { mode: 0o600 });
    return { ...report, directory: target };
  } finally { clear.fill(0); }
}
