/** Common outbound text boundary. Never log a matching value. */
export function containsCredential(value: string): boolean {
  return /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:api[_ -]?key|authorization|password|senha|secret|access[_ -]?token|DATABASE_URL|SETUP_TOKEN)\s*[:=]|\b(?:sk[-_]|gsk_|pne_|px[spm]_|Bearer\s)[A-Za-z0-9_-]{15,}/i.test(value);
}
