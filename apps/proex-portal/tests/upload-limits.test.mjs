import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../lib/upload-limits.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { uploadErrorMessage, UPLOAD_LIMIT_MESSAGE, MAX_UPLOAD_BODY_BYTES } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('hosting 413 responses have a useful message even without JSON', async () => {
  for (const response of [new Response('FUNCTION_PAYLOAD_TOO_LARGE', { status: 413 }), new Response('<html>413</html>', { status: 413 }), Response.json({ error: 'Payload Too Large' }, { status: 413 })]) {
    const body = await response.json().catch(() => null);
    assert.equal(uploadErrorMessage(response.status, body?.error, 'Falha no envio.'), UPLOAD_LIMIT_MESSAGE);
  }
  assert.ok(MAX_UPLOAD_BODY_BYTES < 4_500_000);
  assert.equal(uploadErrorMessage(403, 'Acesso restrito.', 'Falha no envio.'), 'Acesso restrito.');
  assert.equal(uploadErrorMessage(502, undefined, 'Falha no envio.'), 'Falha no envio.');
});
