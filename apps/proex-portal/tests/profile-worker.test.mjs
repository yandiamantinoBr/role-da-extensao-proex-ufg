import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url), wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
// Use the workerd and bundler versions pinned by the application's Wrangler dependency.
const { build } = await import(pathToFileURL(wranglerRequire.resolve('esbuild')).href);
const { Miniflare } = await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);

test('workerd normalizes a real prepared PNG with bounded pixels and strips identifying metadata', { timeout: 30000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const profile = fileURLToPath(new URL('../lib/profile.ts', import.meta.url));
  const builtins = ['stream', 'util', 'zlib', 'assert', 'buffer'];
  const banner = `${builtins.map(name => `import __${name} from 'node:${name}';`).join('\n')}
    const require = name => { const builtins = {${builtins.map(name => `${name}:__${name}`).join(',')}}; if (!(name in builtins)) throw new Error('Unexpected builtin'); return builtins[name]; };`;
  const result = await build({
    absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022',
    banner: { js: banner },
    stdin: { resolveDir: root, contents: `import { normalizeAvatarPng } from ${JSON.stringify(profile)};
      export default { async fetch(request) {
        try { const output = await normalizeAvatarPng(new Uint8Array(await request.arrayBuffer()));
          return new Response(output, {headers:{'Content-Type':'image/png'}});
        } catch(error) { return Response.json({code:error.code,message:error.message},{status:error.status||500}); }
      }};` },
  });
  const worker = new Miniflare({ modules: true, script: result.outputFiles[0].text, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], cf: false });
  t.after(() => worker.dispose());
  const original = PNG.sync.write({ width: 48, height: 32, data: Buffer.alloc(48 * 32 * 4, 75) });
  const identifyingText = Buffer.from('Author\0private-profile@example.test'), chunk = Buffer.alloc(identifyingText.length + 12);
  chunk.writeUInt32BE(identifyingText.length, 0); chunk.write('tEXt', 4); identifyingText.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  const input = Buffer.concat([original.subarray(0, 33), chunk, original.subarray(33)]);
  const response = await worker.dispatchFetch('http://avatar.test/', { method: 'POST', body: input });
  assert.equal(response.status, 200, await response.clone().text());
  const normalized = Buffer.from(await response.arrayBuffer()), decoded = PNG.sync.read(normalized);
  assert.equal(decoded.width, 48); assert.equal(decoded.height, 32);
  assert.equal(normalized.includes(Buffer.from('private-profile@example.test')), false);
  const oversized = new Uint8Array(original); new DataView(oversized.buffer).setUint32(16, 100000);
  const denied = await worker.dispatchFetch('http://avatar.test/', { method: 'POST', body: oversized });
  assert.equal(denied.status, 400); assert.equal((await denied.json()).code, 'avatar_dimensions');
});
