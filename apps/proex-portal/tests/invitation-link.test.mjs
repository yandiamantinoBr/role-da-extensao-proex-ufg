import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { NextResponse } from 'next/server.js';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/invitation-link.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { invitationShareLink, readInvitationCode } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const proxySource = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
const proxyModule = ts.transpileModule(proxySource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const proxyExports = {};
new Function('require', 'exports', proxyModule)(name => {
  if (name === 'next/server') return { NextResponse };
  if (name === './lib/invitation-link') return { readInvitationCode };
  throw new Error('Import inesperado: ' + name);
}, proxyExports);
const origin = 'https://synthetic.example.test';
const code = '-_' + 'S'.repeat(41);

test('sharing keeps the code for the recipient and omits it from the HTTP request', async t => {
  let requestPath = '';
  const server = createServer((request, response) => {
    requestPath = request.url;
    response.end('Generic preview');
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const local = `http://127.0.0.1:${server.address().port}`;
  const share = new URL(invitationShareLink(`${local}/convite?token=${code}`, local));
  assert.equal(share.search, '');
  assert.equal(readInvitationCode(share.search, share.hash), code);
  assert.equal(await (await fetch(share)).text(), 'Generic preview');
  assert.equal(requestPath, '/convite');
  assert.equal(readInvitationCode(`?token=${code}`, ''), code);
});

test('foreign links and conflicting or malformed codes cannot be shared', () => {
  for (const link of [
    `https://outside.example.test/convite?token=${code}`,
    `${origin}/redefinir-senha?token=${code}`,
    `${origin}/convite?token=${code}#token=${code}`,
    `${origin}/convite?token=${code}&token=${code}`,
    `${origin}/convite?token=short`,
    `${origin}/convite#token=%3Cscript%3E`,
    'not a URL',
  ]) assert.throws(() => invitationShareLink(link, origin));
});

test('legacy query redirects before rendering and the generic invitation stays private', async () => {
  const path = `${origin}/convite`;
  const proxy = query => proxyExports.proxy(new Request(path + query));
  assert.deepEqual(proxyExports.config.matcher, ['/convite']);

  const legacy = proxy(`?token=${code}`);
  assert.equal(legacy.status, 307);
  assert.equal(legacy.headers.get('Location'), `/convite#token=${code}`);
  assert.equal(await legacy.text(), '');
  assert.equal(proxy(`?token=${code}&token=duplicate`).headers.get('Location'), '/convite');
  assert.equal(proxy('?token=invalid').headers.get('Location'), '/convite');

  const preview = proxy('');
  assert.equal(preview.headers.get('Location'), null);
  for (const response of [legacy, preview]) {
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  }
});
