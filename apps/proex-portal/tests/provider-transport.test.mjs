import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const rawModule = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
function compile(file, dependencies = {}) {
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return rawModule(source.replace(/from (['"])([^'"]+)\1/g, (match, _quote, name) =>
    name in dependencies ? `from ${JSON.stringify(dependencies[name])}` : match));
}
const errors = compile('../lib/errors.ts');
const workerRuntime = compile('../lib/assistant/provider-runtime.ts');
// Substitui o socket por uma resposta sintética. O restante é o transporte real,
// inclusive a serialização multipart, a configuração HTTPS e a leitura de resposta.
const syntheticHttps = rawModule(`
  import { EventEmitter } from 'node:events';
  import { Readable } from 'node:stream';
  import { Agent } from 'node:https';
  export { Agent };
  export const calls = [];
  export const replies = [];
  export const request = (options, callback) => {
    const request = new EventEmitter();
    request.end = body => {
      calls.push({ options, body });
      const response = Readable.from([Buffer.from('{"ok":true}')]);
      const reply = replies.shift();
      response.statusCode = reply?.status ?? 200;
      response.headers = reply?.headers ?? { 'content-type': 'application/json' };
      callback(response);
    };
    return request;
  };
`);
const nodeRuntime = compile('../platform-node/provider-runtime.ts', {
  '../lib/errors': errors,
  'ipaddr.js': pathToFileURL(require.resolve('ipaddr.js')).href,
  'node:https': syntheticHttps,
});
const { createPinnedProviderRequest } = await import(nodeRuntime);
const { calls: httpsCalls, replies } = await import(syntheticHttps);
const endpoint = new URL('https://custom.example.test/v1/chat/completions');
const official = 'https://api.openai.com/v1/chat/completions';
const blocked = error => error.code === 'assistant_destination_blocked';

test('recusa todo o conjunto DNS quando um IP é privado, especial ou inválido', async () => {
  const refused = [
    '0.0.0.0', '10.0.0.1', '100.100.100.200', '127.0.0.1', '169.254.169.254', '172.16.1.1', '192.168.0.1',
    '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.1.2.3', '240.1.2.3',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '64:ff9b::a00:1', '2001:db8::1',
    '2002:c0a8:0101::1', '3fff::1', 'fd00:ec2::254', 'fe80::1%lo', 'ff02::1', '127.1', 'garbage',
  ];
  let calls = 0;
  for (const address of refused) {
    const pinned = createPinnedProviderRequest(async () => ['8.8.8.8', address], async () => { calls++; });
    await assert.rejects(pinned(endpoint, { headers: { Authorization: 'Bearer synthetic' } }), blocked, address);
  }
  const empty = createPinnedProviderRequest(async () => [], async () => { calls++; });
  await assert.rejects(empty(endpoint, {}), blocked);
  assert.equal(calls, 0);
});

test('consulta uma vez e usa o IP público validado no socket, com Host, SNI e TLS originais', async () => {
  let lookups = 0;
  const pinned = createPinnedProviderRequest(async name => {
    assert.equal(name, endpoint.hostname);
    return ++lookups === 1 ? ['8.8.8.8', '2606:4700::1111'] : ['169.254.169.254'];
  });
  const response = await pinned(endpoint, {
    method: 'POST', headers: { Authorization: 'Bearer synthetic', Host: 'unsafe.example.test' }, body: '{"request":1}',
  });
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(lookups, 1);
  assert.equal(httpsCalls.length, 1);
  const [{ options, body }] = httpsCalls;
  assert.equal(options.hostname, '8.8.8.8');
  assert.equal(options.port, 443);
  assert.equal(options.servername, endpoint.hostname);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.headers.host, endpoint.hostname);
  assert.equal(options.headers.authorization, 'Bearer synthetic');
  assert.equal(options.agent.options.keepAlive, false);
  assert.equal(options.path, '/v1/chat/completions');
  assert.equal(body.toString(), '{"request":1}');
  await assert.rejects(pinned(endpoint, {}), blocked);
  assert.equal(httpsCalls.length, 1);
});

test('IPv6 público e FormData usam o mesmo transporte com o boundary original', async () => {
  const form = new FormData();
  form.set('file', new Blob(['audio sintético']), 'audio.wav');
  form.set('model', 'modelo-sintetico');
  const pinned = createPinnedProviderRequest(async () => ['2606:4700::1111']);
  const response = await pinned(endpoint, { method: 'POST', body: form });
  await response.body.cancel();
  const { options, body } = httpsCalls.at(-1);
  assert.equal(options.hostname, '2606:4700::1111');
  const boundary = options.headers['content-type'].match(/^multipart\/form-data; boundary=(.+)$/)?.[1];
  assert.ok(boundary);
  assert.equal(options.headers['content-length'], String(body.length));
  assert.ok(body.toString().includes(`--${boundary}\r\n`));
  assert.ok(body.toString().includes('audio sintético'));
});

test('aborto ou falha de resolução encerra antes do envio e a falha TLS não repete', async () => {
  let calls = 0;
  const signal = AbortSignal.abort(new Error('sintético'));
  const afterAbort = createPinnedProviderRequest(async () => ['8.8.8.8'], async () => { calls++; });
  await assert.rejects(afterAbort(endpoint, { signal }), /sintético/);
  const noDns = createPinnedProviderRequest(async () => { throw new Error('DNS indisponível'); }, async () => { calls++; });
  await assert.rejects(noDns(endpoint, {}), /DNS indisponível/);
  assert.equal(calls, 0);
  const failedTls = createPinnedProviderRequest(async () => ['8.8.8.8', '2606:4700::1111'], async () => {
    calls++;
    throw new Error('TLS indisponível');
  });
  await assert.rejects(failedTls(endpoint, {}), /TLS indisponível/);
  assert.equal(calls, 1);
});

test('Worker só envia aos endpoints exatos e impede redirecionamento', async () => {
  const { requestProvider } = await import(compile('../lib/assistant/provider-transport.ts', {
    '../errors': errors, './provider-runtime': workerRuntime,
  }));
  const originalFetch = globalThis.fetch;
  const attempted = [];
  globalThis.fetch = async (url, init) => {
    attempted.push(url);
    assert.equal(init.redirect, 'error');
    return new Response(null, { status: 307, headers: { Location: 'https://169.254.169.254/' } });
  };
  try {
    for (const address of [
      endpoint.href, `${official}.otro`, 'https://api.openai.com.evil.test/v1/chat/completions', 'https://api.openai.com/otra',
    ]) await assert.rejects(requestProvider(address, {}, globalThis.fetch), { code: 'assistant_custom_destination_unavailable' });
    for (const address of ['http://api.openai.com/v1/chat/completions', 'https://2130706433/v1', 'https://[::1]/v1', 'https://u:pw@api.openai.com/', 'https://api.openai.com:444/v1'])
      await assert.rejects(requestProvider(address, {}), blocked);
    assert.deepEqual(attempted, []);
    await assert.rejects(requestProvider(official, { redirect: 'follow' }), { code: 'assistant_destination_redirect' });
    assert.deepEqual(attempted, [official]);
  } finally { globalThis.fetch = originalFetch; }
});


test('Node recusa redirecionamento de endpoint personalizado depois de uma única conexão pinada', async () => {
  const syntheticDns = rawModule(`
    export const names = [];
    export class Resolver {
      async resolve4(name) { names.push(['A', name]); return ['8.8.8.8']; }
      async resolve6(name) { names.push(['AAAA', name]); return ['2606:4700::1111']; }
      cancel() {}
    }
  `);
  const runtime = compile('../platform-node/provider-runtime.ts', {
    '../lib/errors': errors, 'ipaddr.js': pathToFileURL(require.resolve('ipaddr.js')).href,
    'node:https': syntheticHttps, 'node:dns/promises': syntheticDns,
  });
  const { requestProvider } = await import(compile('../lib/assistant/provider-transport.ts', {
    '../errors': errors, './provider-runtime': runtime,
  }));
  const { names } = await import(syntheticDns);
  const count = httpsCalls.length;
  replies.push({ status: 308, headers: { location: 'https://169.254.169.254/' } });
  await assert.rejects(requestProvider(endpoint.href, { method: 'POST', body: '{}' }), { code: 'assistant_destination_redirect' });
  assert.deepEqual(names, [['A', 'custom.example.test.'], ['AAAA', 'custom.example.test.']]);
  assert.equal(httpsCalls.length, count + 1);
  assert.equal(httpsCalls.at(-1).options.hostname, '8.8.8.8');
});
