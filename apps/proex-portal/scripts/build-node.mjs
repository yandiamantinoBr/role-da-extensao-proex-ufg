// Build do alvo Node (Vercel, VPS, servidor da UFG): mesmo app, sem o runtime Cloudflare.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-framework.mjs', import.meta.url)), 'build'], {
  stdio: 'inherit', env: { ...process.env, PROEX_TARGET: 'node' },
});
process.exit(result.status ?? 1);
