#!/usr/bin/env node
// QA descartável e exclusivamente local. Não carrega .env/.dev.vars e não usa
// o CLI `vinext start`, que faria autoload desses arquivos. Requer build:node.
// A senha abaixo é pública, sintética e válida somente neste banco temporário.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const QA_ORIGIN = 'http://127.0.0.1:5173';
export const QA_EMAIL = 'qa@proex.example.test';
export const QA_TEST_PASSWORD = 'Proex-QA-local-only-2026!';
const HOST = '127.0.0.1', PORT = 5173, TEMP_PREFIX = 'proex-qa-local-';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const safeKeys = ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'SystemDrive'];

// Copy only OS necessities, never the caller's provider credentials, NODE_OPTIONS,
// database URL, VERCEL flags, proxy configuration or authentication environment.
export function qaEnvironment(directory, secret, setupToken, source = process.env) {
  const environment = Object.fromEntries(safeKeys.filter(key => typeof source[key] === 'string').map(key => [key, source[key]]));
  const runtime = join(directory, 'runtime');
  return { ...environment, NODE_ENV: 'production', PROEX_TARGET: 'node', PROEX_STANDALONE: '1', PROEX_LOCAL_HTTP: '1',
    PROEX_DATA_DIR: join(directory, 'data'), BETTER_AUTH_URL: QA_ORIGIN, OWNER_EMAIL: QA_EMAIL,
    BETTER_AUTH_SECRET: secret, SETUP_TOKEN: setupToken, TEMP: runtime, TMP: runtime, TMPDIR: runtime,
    HOME: directory, USERPROFILE: directory, CURL_HOME: directory, PROEX_QA_CHILD: '1' };
}

async function freePort() {
  const probe = createProbe();
  await new Promise((done, reject) => {
    probe.once('error', () => reject(new Error(`A porta ${PORT} está ocupada. Pare somente o servidor local do portal antes de iniciar este QA.`)));
    probe.listen(PORT, HOST, done);
  });
  await new Promise(done => probe.close(done));
}

async function serve() {
  if (!process.send || process.env.PROEX_QA_CHILD !== '1' || !basename(process.cwd()).startsWith(TEMP_PREFIX)) {
    throw new Error('O modo interno de servidor exige o processo de QA descartável.');
  }
  if (process.env.PROEX_DATABASE_URL || process.env.VERCEL || process.env.BETTER_AUTH_URL !== QA_ORIGIN
    || resolve(process.env.PROEX_DATA_DIR ?? '') !== join(process.cwd(), 'data')) {
    throw new Error('O isolamento local do servidor QA não foi confirmado.');
  }
  const fail = error => {
    process.send?.({ event: 'failed', code: typeof error?.code === 'string' ? error.code : 'qa_server_failed' });
    process.exit(1);
  };
  process.once('uncaughtException', fail);
  process.once('unhandledRejection', fail);
  // Import the same production server used by vinext's CLI, without its dotenv loader.
  const { startProdServer } = await import(pathToFileURL(join(projectRoot, 'node_modules/vinext/dist/server/prod-server.js')).href);
  const { server } = await startProdServer({ host: HOST, port: PORT, outDir: join(projectRoot, 'dist'), silent: true });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
  };
  process.on('message', message => { if (message?.event === 'shutdown') stop(); });
  process.on('disconnect', stop);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.send({ event: 'listening', port: PORT });
}

function localClient() {
  const cookies = new Map();
  return async function api(path, body, authenticated = true) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('QA aceita somente caminhos locais.');
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Accept: 'application/json' };
    if (authenticated && cookies.size) headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    if (payload) Object.assign(headers, { Origin: QA_ORIGIN, 'X-Proex-Action': '1', 'Content-Type': 'application/json', 'Content-Length': payload.byteLength });
    // Native http.request connects directly to loopback and never follows redirects
    // or inherits an HTTP proxy agent. No browser session/cookie is written to disk.
    return new Promise((done, reject) => {
      const request = httpRequest({ hostname: HOST, port: PORT, method: payload ? 'POST' : 'GET', path, headers }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.byteLength;
          if (size > 16 * 1024 * 1024) { request.destroy(); reject(new Error('Resposta QA maior que o limite local.')); }
          else chunks.push(chunk);
        });
        response.on('end', () => {
          for (const cookie of response.headers['set-cookie'] ?? []) {
            const pair = cookie.split(';', 1)[0], split = pair.indexOf('=');
            if (split > 0) cookies.set(pair.slice(0, split), pair.slice(split + 1));
          }
          const text = Buffer.concat(chunks).toString('utf8');
          let value; try { value = JSON.parse(text); } catch { value = null; }
          done({ status: response.statusCode, value, bytes: size });
        });
      });
      request.setTimeout(15000, () => request.destroy(new Error('Tempo de resposta excedido no QA local.')));
      request.once('error', reject);
      request.end(payload ?? undefined);
    });
  };
}

function ok(response, label) {
  if (!response.status || response.status < 200 || response.status >= 300 || response.value === null) {
    const code = typeof response.value?.code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(response.value.code) ? ` (${response.value.code})` : '';
    throw new Error(`${label}: HTTP ${response.status ?? 'sem resposta'}${code}.`);
  }
  return response.value;
}
const dayBrasilia = milliseconds => new Date(milliseconds - 3 * 3600000).toISOString().slice(0, 10);

async function seed(api, setupToken) {
  const initial = await api('/api/portal', undefined, false);
  assert.equal(initial.status, 401, 'painel deve exigir autenticação antes da configuração local');
  ok(await api('/api/account', { action: 'setupOwner', setupToken, email: QA_EMAIL, name: 'Responsável QA local', password: QA_TEST_PASSWORD }), 'Configuração do responsável QA');
  const account = ok(await api('/api/account'), 'Leitura da conta QA');
  assert.equal(account.user?.email, QA_EMAIL, 'sessão deve pertencer à conta sintética local');
  const portal = async input => ok(await api('/api/portal', input), `Fixture ${input.action}`);
  const project = await portal({ action: 'project.create', operationKey: randomUUID(), name: 'Projeto QA descartável', shortName: 'QA LOCAL',
    description: 'Dados inteiramente fictícios para conferir desktop, celular e integração local.', status: 'active', scope: 'internal', thematicArea: 'cultura', prizesEnabled: true, color: '#54216C' });
  const projectId = project.id;
  assert.equal(typeof projectId, 'string', 'API deve retornar o projeto criado');
  const gift = await portal({ action: 'item.create', operationKey: randomUUID(), projectId, name: 'Button azul QA local', category: 'gift', unit: 'unidade', lowStock: 5, description: 'Brinde sintético para o conector simulado.' });
  const equipment = await portal({ action: 'item.create', operationKey: randomUUID(), projectId, name: 'Projetor QA local', category: 'equipment', unit: 'unidade', lowStock: 0, assetCode: 'QA-TEST-001' });
  for (const [itemId, delta] of [[gift.item.id, 40], [equipment.item.id, 1]]) {
    await portal({ action: 'stock.move', operationKey: randomUUID(), itemId, delta, kind: 'receive', note: 'Entrada sintética de QA local.' });
  }
  const offers = {};
  for (const [kind, quantity] of [['brinde', 1], ['super', 2]]) {
    offers[kind] = (await portal({ action: 'offer.create', operationKey: randomUUID(), projectId, name: `${kind === 'brinde' ? 'Brinde' : 'Super brinde'} QA`, kind, components: [{ itemId: gift.item.id, quantity }] })).offer.id;
  }
  await portal({ action: 'setting.update', instagramUrl: '', privacyNotice: 'Ambiente de QA local descartável. Usar somente dados fictícios; nenhuma participação ou pessoa real.' });
  const now = Date.now(), startsAt = now - 15 * 60000, endsAt = now + 2 * 3600000;
  const campaign = await portal({ action: 'campaign.create', projectId, name: 'Evento QA local', location: 'Ambiente fictício', startsAt: new Date(now - 3600000).toISOString(), endsAt: new Date(now + 86400000).toISOString(), retryLimit: 1,
    rulesText: 'Regulamento fictício para testes locais, sem distribuição de prêmio real.', brindeOfferId: offers.brinde, superOfferId: offers.super });
  await portal({ action: 'campaign.status', id: campaign.id, status: 'active' });
  const loan = (await portal({ action: 'loan.create', operationKey: randomUUID(), projectId, itemId: equipment.item.id, actionName: 'Demonstração QA local', borrowerName: 'Pessoa fictícia QA', borrowerContact: '',
    startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), note: 'Empréstimo exclusivamente sintético.' })).loan;
  await portal({ action: 'loan.status', id: loan.id, status: 'out', conditionOut: 'Equipamento fictício conferido.', note: 'Retirada QA local.' });
  const record = ok(await api('/api/records', { action: 'create', operationKey: randomUUID(), projectId, kind: 'project', title: 'Conferência QA local', body: 'Registro sintético para avaliar a leitura no celular.', occurredAt: new Date(now).toISOString() }), 'Criação do registro QA');
  const snapshot = ok(await api('/api/portal'), 'Painel autenticado QA');
  assert.ok(snapshot.projects?.some(row => row.id === projectId), 'projeto deve reaparecer pelo painel');
  assert.equal(snapshot.items?.find(row => row.id === gift.item.id)?.stock, 40, 'saldo deve refletir a movimentação via API');
  assert.equal(snapshot.loans?.find(row => row.id === loan.id)?.status, 'out', 'retirada deve reaparecer pelo painel');
  assert.equal(snapshot.campaigns?.find(row => row.id === campaign.id)?.status, 'active', 'evento deve reaparecer ativo');
  const records = ok(await api(`/api/records?projectId=${encodeURIComponent(projectId)}`), 'Leitura dos registros QA');
  assert.ok(records.records?.some(row => row.id === record.id), 'registro deve reaparecer pela API de leitura');
  const from = dayBrasilia(startsAt), to = dayBrasilia(endsAt);
  const reports = ok(await api(`/api/reports?dataset=loans&projectId=${encodeURIComponent(projectId)}&from=${from}&to=${to}`), 'Relatório QA');
  const reported = reports.rows?.find(row => row.id === loan.id);
  assert.ok(reported, 'empréstimo deve aparecer no filtro de datas do relatório; refaça build:node após corrigir A26');
  assert.deepEqual([reported.inicio, reported.fim, reported.em_atraso], [from, to, 'nao'], 'relatório deve preservar as datas em milissegundos e não inventar atraso');
  return { projectId, campaignId: campaign.id, loanId: loan.id, recordId: record.id };
}

async function benchmark(api, fixture) {
  for (const [label, path, authenticated] of [['evento_publico', `/api/events/${encodeURIComponent(fixture.campaignId)}`, false], ['painel_autenticado', '/api/portal', true]]) {
    for (let index = 0; index < 3; index++) ok(await api(path, undefined, authenticated), `Aquecimento ${label}`);
    const times = []; let bytes = 0;
    for (let index = 0; index < 25; index++) {
      const start = performance.now(), response = await api(path, undefined, authenticated); ok(response, `Benchmark ${label}`);
      times.push(performance.now() - start); bytes += response.bytes;
    }
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({ benchmark: label, samples: times.length, p50Ms: Number(times[12].toFixed(2)), p95Ms: Number(times[23].toFixed(2)), meanResponseBytes: Math.round(bytes / times.length), environment: 'loopback, dados sintéticos, processo único' }));
  }
  const concurrentTimes = [], totalStart = performance.now();
  await Promise.all(Array.from({ length: 10 }, async () => {
    for (let index = 0; index < 10; index++) {
      const start = performance.now();
      ok(await api(`/api/events/${encodeURIComponent(fixture.campaignId)}`, undefined, false), 'Rajada pública local');
      concurrentTimes.push(performance.now() - start);
    }
  }));
  concurrentTimes.sort((a, b) => a - b);
  console.log(JSON.stringify({ benchmark: 'evento_publico_concorrente', samples: concurrentTimes.length, concurrency: 10, errors: 0,
    p50Ms: Number(concurrentTimes[49].toFixed(2)), p95Ms: Number(concurrentTimes[94].toFixed(2)), totalMs: Number((performance.now() - totalStart).toFixed(2)),
    environment: 'loopback, dados sintéticos, processo único; não estima capacidade serverless' }));
}

async function syncSmoke(api, directory, redact) {
  const issued = ok(await api('/api/sync', { action: 'token.create', label: 'QA local descartável' }), 'Chave sintética do conector');
  if (typeof issued.token !== 'string' || !issued.token.startsWith('pxs_')) throw new Error('API não retornou a chave sintética esperada.');
  const environment = qaEnvironment(directory, '', '');
  delete environment.BETTER_AUTH_SECRET; delete environment.SETUP_TOKEN;
  environment.PORTAL_URL = QA_ORIGIN; environment.SYNC_TOKEN = issued.token;
  const child = spawn(process.execPath, [join(projectRoot, 'scripts/apps-script-harness.mjs')], { cwd: projectRoot, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { if (output.length < 100000) output += chunk.toString(); });
  const exitCode = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', code => done(code)); });
  // curl errors can contain header arguments; redact this ephemeral token too.
  console.log(redact(output.split(issued.token).join('[CHAVE QA OMITIDA]')).trim());
  if (exitCode !== 0) throw new Error('O harness da planilha simulada falhou no portal local.');
}

async function run(options) {
  if (!existsSync(join(projectRoot, 'dist/server/index.js')) || !existsSync(join(projectRoot, 'node_modules/vinext/dist/server/prod-server.js'))) {
    throw new Error('Execute npx --yes pnpm@11.25.0 build:node antes de iniciar o QA local.');
  }
  await freePort();
  const temporaryParent = realpathSync(tmpdir()), directory = mkdtempSync(join(temporaryParent, TEMP_PREFIX));
  mkdirSync(join(directory, 'runtime')); mkdirSync(join(directory, 'data'));
  const authSecret = randomBytes(32).toString('base64url'), setupToken = randomBytes(32).toString('base64url');
  const redact = text => [authSecret, setupToken, QA_TEST_PASSWORD].reduce((value, secret) => value.split(secret).join('[SEGREDO QA OMITIDO]'), String(text));
  const child = spawn(process.execPath, [scriptPath, '--serve'], { cwd: directory, env: qaEnvironment(directory, authSecret, setupToken), stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  // Do not forward raw framework logs: even local authentication can log credentials.
  child.stdout.resume(); child.stderr.resume();
  let cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    if (child.exitCode === null && !child.killed) {
      if (child.connected) child.send({ event: 'shutdown' }, () => {});
      await Promise.race([new Promise(done => child.once('exit', done)), sleep(3000)]);
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([new Promise(done => child.once('exit', done)), sleep(2000)]);
      }
    }
    try {
      const absolute = realpathSync(directory), inside = relative(temporaryParent, absolute);
      if (dirname(absolute) !== temporaryParent || inside.startsWith('..') || !basename(absolute).startsWith(TEMP_PREFIX)) throw new Error('Pasta QA fora do limite esperado.');
      rmSync(absolute, { recursive: true, force: true });
    } catch { console.log(`Pasta temporária QA preservada para limpeza local posterior: ${directory}`); }
  })();
  const onSignal = () => { cleanup().finally(() => process.exit(0)); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    await new Promise((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('O servidor QA não iniciou em 30 segundos.')), 30000);
      child.once('error', () => { clearTimeout(timeout); reject(new Error('Não foi possível iniciar o processo QA local.')); });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('O processo QA encerrou antes de ficar disponível.')); });
      child.on('message', message => {
        if (message?.event === 'listening' && message.port === PORT) { clearTimeout(timeout); done(); }
        if (message?.event === 'failed') { clearTimeout(timeout); reject(new Error(`Servidor QA indisponível (${message.code}).`)); }
      });
    });
    const api = localClient();
    assert.equal(ok(await api('/api/health'), 'Saúde local QA').ok, true);
    const fixture = await seed(api, setupToken);
    console.log(`QA local pronto em ${QA_ORIGIN}. Conta sintética: ${QA_EMAIL}; senha pública de teste na constante QA_TEST_PASSWORD deste script.`);
    console.log(JSON.stringify({ fixture, environment: 'descartável, loopback, sem produção', dataDirectory: directory }));
    if (options.benchmark) await benchmark(api, fixture);
    if (options.syncSmoke) await syncSmoke(api, directory, redact);
    console.log('Smoke autenticado concluído: servidor → API → dados → relatório.');
    if (!options.smoke) {
      console.log('Servidor mantido para revisão no navegador. Digite parar ou Ctrl+C para encerrar somente este QA e limpar sua pasta temporária.');
      const stopFromInput = text => { if (String(text).trim() === 'parar') onSignal(); };
      process.stdin.setEncoding('utf8'); process.stdin.on('data', stopFromInput); process.stdin.resume();
      try { await new Promise((done, reject) => child.once('exit', code => code === 0 ? done() : reject(new Error(`Servidor QA encerrou com código ${code}.`)))); }
      finally { process.stdin.removeListener('data', stopFromInput); process.stdin.pause(); }
    }
  } finally {
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    await cleanup();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--serve') return serve();
  if (args.includes('--help')) {
    console.log('Uso: node scripts/qa-local.mjs [--smoke] [--sync-smoke] [--benchmark]\nRequer build:node atual e porta 5173 livre. Sem --smoke, mantém o QA aberto para o navegador.\nHost fixo 127.0.0.1; não aceita URL/host remoto. Não lê .env/.dev.vars, não instala dependências e não acessa a planilha/Drive reais.');
    return;
  }
  if (args.some(arg => !['--smoke', '--sync-smoke', '--benchmark'].includes(arg))) throw new Error('Opção desconhecida; use --help. Host/URL remoto não são aceitos.');
  await run({ smoke: args.includes('--smoke'), syncSmoke: args.includes('--sync-smoke'), benchmark: args.includes('--benchmark') });
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Falha no QA local.'); process.exitCode = 1; });
}
