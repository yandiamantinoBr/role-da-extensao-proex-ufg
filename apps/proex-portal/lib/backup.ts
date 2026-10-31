import { env } from 'cloudflare:workers';
export type CompleteBackupBinding = { limits: { totalBytes: number; sqliteBytes: number; objectBytes: number; objects: number }; createEncrypted(userId: string, password: string): Promise<Uint8Array> };
export function completeBackupBinding(): CompleteBackupBinding | null {
  const binding = (env as unknown as { PROEX_BACKUP?: CompleteBackupBinding }).PROEX_BACKUP;
  return binding && typeof binding.createEncrypted === 'function' ? binding : null;
}
