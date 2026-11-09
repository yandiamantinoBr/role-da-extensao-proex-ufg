import { createHash } from 'node:crypto';
import { BackupError } from './backup-format.mjs';

// Carrega um pacote .proexbackup já validado num Postgres NOVO E VAZIO (esquema
// "proex"), para a migração entre contas (por exemplo, para o Supabase da PROEX).
// Nunca sobrescreve: se o destino já tiver banco ou anexos, recusa sem gravar nada.
const sha = data => createHash('sha256').update(data).digest('hex');
const refuse = (code, message) => { throw Object.assign(new BackupError('backup_invalid'), { code, message }); };

/** Plano puro (sem rede): o que seria gravado e o que não pode ser. */
export function planPostgresImport(archive) {
  const version = archive.manifest.source.snapshotVersion;
  if (!Number.isSafeInteger(version) || version < 1) refuse('backup_import_version', 'Versão do banco no pacote é inválida.');
  const objects = [], skipped = [];
  for (const object of archive.objects) {
    // Em instalações em disco o pacote guarda só o identificador SHA-256 do caminho.
    // Sem o caminho original o Postgres não consegue servir o arquivo; registre e avise.
    if (typeof object.key === 'string' && object.key) objects.push({ key: object.key, contentType: object.contentType, size: object.data.byteLength, sha256: sha(object.data), data: object.data });
    else skipped.push(object.storageId);
  }
  return { version, snapshotBytes: archive.snapshot.byteLength, snapshotSha256: sha(archive.snapshot), objects, skippedWithoutKey: skipped };
}

/**
 * `target` é um adaptador pequeno (ver postgresTarget em scripts/import-backup-to-postgres.mjs):
 *   transaction(fn), counts(), insertSnapshot(version, bytes), insertObject(row), readback().
 */
export async function importArchive(archive, target) {
  const plan = planPostgresImport(archive);
  return await target.transaction(async tx => {
    const found = await tx.counts();
    if (found.snapshots !== 0 || found.objects !== 0) refuse('backup_import_not_empty', 'O destino já contém banco ou anexos. A importação só funciona em um projeto novo e vazio.');
    await tx.insertSnapshot(plan.version, archive.snapshot);
    for (const object of plan.objects) await tx.insertObject(object);
    // Releitura dentro da mesma transação: se algo divergir, nada é confirmado.
    const back = await tx.readback();
    if (back.version !== plan.version || back.snapshotSha256 !== plan.snapshotSha256) refuse('backup_import_verify', 'A releitura do banco gravado não confere com o pacote. Nada foi confirmado.');
    const stored = new Map(back.objects.map(item => [item.key, item]));
    if (stored.size !== plan.objects.length) refuse('backup_import_verify', 'A quantidade de anexos gravados não confere com o pacote. Nada foi confirmado.');
    for (const object of plan.objects) {
      const item = stored.get(object.key);
      if (!item || item.sha256 !== object.sha256 || item.size !== object.size) refuse('backup_import_verify', 'Um anexo gravado não confere com o pacote. Nada foi confirmado.');
    }
    return { imported: true, snapshotVersion: plan.version, snapshotBytes: plan.snapshotBytes, objects: plan.objects.length, objectBytes: plan.objects.reduce((sum, item) => sum + item.size, 0), skippedWithoutKey: plan.skippedWithoutKey.length };
  });
}
