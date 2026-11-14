import type { StructureWorkspace } from './contracts';

/** The consultation time can change without changing the authorized recorte. */
export function structureFingerprint(data: StructureWorkspace) {
  const { asOf: consultedAt, ...snapshot } = data;
  void consultedAt;
  return JSON.stringify(snapshot);
}

export async function structureDigest(fingerprint: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
