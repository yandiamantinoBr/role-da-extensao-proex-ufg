import type { BackendStores } from './store';
import type { Migration } from './d1';
import { assertOwnerInSnapshot, AUTOMATIC_BACKUP_LIMITS, BACKUP_LIMITS, MAX_AUTOMATIC_ENCRYPTED_BYTES, BackupError, backupPublicKey, createArchive, encryptArchive, encryptHybridArchive, validatePassword } from './backup-format.mjs';

/** Private server binding. Nothing from this object is exposed to the browser. */
export function completeBackupService(stores: BackendStores, migrations: Migration[], codeRevision: string | undefined) {
  let busy = false;
  async function authorize(userId: string) {
    const snapshot = await stores.backup.authoritySnapshot(BACKUP_LIMITS);
    if (!snapshot) throw new BackupError('backup_source');
    try { assertOwnerInSnapshot(snapshot.data, userId); }
    finally { snapshot.data.fill(0); }
  }
  return {
    limits: BACKUP_LIMITS,
    automaticLimits: { ...AUTOMATIC_BACKUP_LIMITS, encryptedBytes: MAX_AUTOMATIC_ENCRYPTED_BYTES },
    validatePublicKey: backupPublicKey,
    async createHybrid(userId: string, publicKeyPem: string): Promise<Uint8Array> {
      const recipient = backupPublicKey(publicKeyPem);
      if (busy) throw Object.assign(new BackupError('backup_source'), { code: 'backup_busy' });
      busy = true; let capture, archive, encrypted;
      try {
        await authorize(userId);
        capture = await stores.backup.capture(AUTOMATIC_BACKUP_LIMITS);
        archive = createArchive(capture, { migrations, codeRevision, ownerId: userId, formatVersion: 2 });
        encrypted = encryptHybridArchive(archive.bytes, recipient.publicKeyPem);
        if (encrypted.byteLength > MAX_AUTOMATIC_ENCRYPTED_BYTES) throw new BackupError('backup_limit');
        await authorize(userId);
        return encrypted;
      } catch (error) {
        encrypted?.fill(0);
        if (error instanceof BackupError) throw error;
        throw new BackupError((error as {code?: string})?.code === 'backup_limit' ? 'backup_limit' : 'backup_source');
      } finally {
        archive?.bytes.fill(0); capture?.snapshot.data.fill(0); for (const object of capture?.objects ?? []) object.data.fill(0); busy = false;
      }
    },
    async createEncrypted(userId: string, password: string): Promise<Uint8Array> {
      validatePassword(password);
      if (busy) throw Object.assign(new BackupError('backup_source'), { code: 'backup_busy' });
      busy = true;
      let capture, archive;
      try {
        // Fresh authority is checked against the remote committed SQLite, not a
        // cached actor or a client-supplied role, before capturing private objects.
        await authorize(userId);
        capture = await stores.backup.capture(BACKUP_LIMITS);
        archive = createArchive(capture, { migrations, codeRevision, ownerId: userId });
        const encrypted = await encryptArchive(archive.bytes, password);
        await authorize(userId); // revocation during capture/KDF suppresses output
        return encrypted;
      } catch (error) {
        if (error instanceof BackupError) throw error;
        const code = (error as { code?: string })?.code;
        throw new BackupError(code === 'backup_limit' ? code : 'backup_source');
      } finally {
        archive?.bytes.fill(0); capture?.snapshot.data.fill(0);
        for (const object of capture?.objects ?? []) object.data.fill(0);
        busy = false;
      }
    },
  };
}
