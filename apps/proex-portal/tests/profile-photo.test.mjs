import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
let source = ts.transpileModule(readFileSync(new URL('../components/portal/profile-panel.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
for (const dependency of ['react', 'react/jsx-runtime', 'lucide-react']) {
  const url = pathToFileURL(require.resolve(dependency)).href;
  source = source.replaceAll(`from '${dependency}'`, `from ${JSON.stringify(url)}`).replaceAll(`from "${dependency}"`, `from ${JSON.stringify(url)}`);
}
const identityPanel = `data:text/javascript;base64,${Buffer.from('export default function IdentityPanel(){return null;}').toString('base64')}`;
source = source.replaceAll("from './account-identity-panel'", `from ${JSON.stringify(identityPanel)}`).replaceAll('from "./account-identity-panel"', `from ${JSON.stringify(identityPanel)}`);
const { prepareProfilePhoto } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

// Mock only browser capabilities. PNG encoding/inspection below uses actual image bytes.
function environment(t, options = {}) {
  const previous = new Map(), calls = { bitmapClosed: 0, imageLoads: [], draw: [], dataUrl: 0, offscreen: 0 };
  const set = (name, value) => { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); };
  t.after(() => { for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const dimensions = { width: options.width ?? 1600, height: options.height ?? 900 };
  function encoded(canvas) { return PNG.sync.write({ width: canvas.width, height: canvas.height, data: Buffer.alloc(canvas.width * canvas.height * 4) }); }
  function context() { return { drawImage(_image, _x, _y, width, height) { calls.draw.push({ width, height }); } }; }
  function canvas() {
    return {
      width: 0, height: 0,
      getContext() { return options.noCanvasContext ? null : context(); },
      toBlob(callback) {
        if (options.blobThrows) throw new Error('internal_native_export_failure');
        callback(options.blobNull ? null : new Blob([encoded(this)], { type: 'image/png' }));
      },
      toDataURL() { calls.dataUrl++; if (options.dataUrlThrows) throw new Error('internal_native_data_url_failure'); return `data:image/png;base64,${encoded(this).toString('base64')}`; },
    };
  }
  set('window', { setTimeout, clearTimeout });
  set('createImageBitmap', options.noBitmap ? undefined : async () => {
    if (options.bitmapRejects) throw new Error('internal_bitmap_unavailable');
    return { ...dimensions, close() { calls.bitmapClosed++; } };
  });
  set('URL', { createObjectURL() { if (options.blockBlobUrl) throw new Error('internal_blob_url_restricted'); return 'blob:test-photo'; }, revokeObjectURL() {} });
  set('FileReader', class {
    readAsDataURL(file) { void file.arrayBuffer().then(bytes => { this.result = `data:${file.type || 'image/jpeg'};base64,${Buffer.from(bytes).toString('base64')}`; this.onload?.(); }); }
    abort() { this.onabort?.(); }
  });
  set('document', { createElement(tag) {
    if (tag === 'canvas') return canvas();
    assert.equal(tag, 'img');
    return {
      naturalWidth: dimensions.width, naturalHeight: dimensions.height, removeAttribute() {},
      set src(value) { calls.imageLoads.push(value.startsWith('data:') ? 'data' : 'blob'); queueMicrotask(() => options.imageRejects ? this.onerror?.() : this.onload?.()); },
    };
  } });
  set('OffscreenCanvas', options.offscreen ? class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return context(); }
    async convertToBlob() { calls.offscreen++; return new Blob([encoded(this)], { type: 'image/png' }); }
  } : undefined);
  return calls;
}
const photo = (type = 'image/jpeg', name = 'photo.jpg') => new File([new Uint8Array([255, 216, 255, 217])], name, { type });

test('bitmap preparation keeps the aspect ratio, produces a bounded PNG and closes decoded pixels', async t => {
  const calls = environment(t);
  const result = await prepareProfilePhoto(photo());
  const decoded = PNG.sync.read(Buffer.from(await result.arrayBuffer()));
  assert.equal(result.type, 'image/png'); assert.ok(result.size <= 2 * 1024 * 1024);
  assert.equal(decoded.width, 512); assert.equal(decoded.height, 288);
  assert.equal(calls.bitmapClosed, 1); assert.deepEqual(calls.draw, [{ width: 512, height: 288 }]);
});

test('an embedded browser with blocked blob URLs uses FileReader and a document image', async t => {
  const calls = environment(t, { noBitmap: true, blockBlobUrl: true, width: 640, height: 480 });
  const result = await prepareProfilePhoto(photo('', 'camera-photo.jpg'));
  assert.deepEqual(calls.imageLoads, ['data']);
  const decoded = PNG.sync.read(Buffer.from(await result.arrayBuffer()));
  assert.equal(decoded.width, 512); assert.equal(decoded.height, 384);
});

test('a partially implemented bitmap decoder falls back to a normal image', async t => {
  const calls = environment(t, { bitmapRejects: true, width: 80, height: 60 });
  const result = await prepareProfilePhoto(photo('image/png', 'photo.png'));
  assert.deepEqual(calls.imageLoads, ['blob']);
  assert.equal(PNG.sync.read(Buffer.from(await result.arrayBuffer())).width, 80);
});

for (const mode of ['blobNull', 'blobThrows']) {
  test(`canvas ${mode} uses the PNG data-URL exporter`, async t => {
    const calls = environment(t, { [mode]: true });
    const result = await prepareProfilePhoto(photo());
    assert.equal(calls.dataUrl, 1); assert.equal(result.type, 'image/png');
    assert.equal(PNG.sync.read(Buffer.from(await result.arrayBuffer())).width, 512);
  });
}

test('an unavailable HTML canvas uses an offscreen canvas when supported', async t => {
  const calls = environment(t, { noCanvasContext: true, offscreen: true, width: 96, height: 64 });
  const result = await prepareProfilePhoto(photo());
  assert.equal(calls.offscreen, 1);
  const decoded = PNG.sync.read(Buffer.from(await result.arrayBuffer()));
  assert.equal(decoded.width, 96); assert.equal(decoded.height, 64);
});

test('unrecoverable decode/export errors are actionable and omit internal exceptions', async t => {
  environment(t, { blobThrows: true, dataUrlThrows: true });
  await assert.rejects(prepareProfilePhoto(photo()), error => error.message.includes('não conseguiu convertê-la') && !error.message.includes('internal_'));
});

test('empty, oversized and non-photo files are rejected before decoding', async t => {
  const calls = environment(t);
  for (const file of [new File([], 'empty.png', { type: 'image/png' }), new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }), new File(['<svg/>'], 'vector.svg', { type: 'image/svg+xml' }), new File(['pdf'], 'file.pdf', { type: 'application/pdf' })]) {
    await assert.rejects(prepareProfilePhoto(file));
  }
  assert.equal(calls.draw.length, 0);
});
