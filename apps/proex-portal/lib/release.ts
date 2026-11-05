/** Only public build identifiers may leave this boundary. Never return environment objects. */
export function portalRelease(): string {
  const sha = typeof process !== 'undefined' ? process.env.VERCEL_GIT_COMMIT_SHA : undefined;
  return `2026.11.05${sha && /^[a-f0-9]{40}$/i.test(sha) ? ` · ${sha.slice(0, 7)}` : ' · desenvolvimento'}`;
}
