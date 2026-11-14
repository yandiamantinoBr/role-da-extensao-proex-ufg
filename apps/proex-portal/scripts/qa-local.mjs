#!/usr/bin/env node
// QA descartável e exclusivamente local. Não carrega .env/.dev.vars e não usa
// o CLI `vinext start`, que faria autoload desses arquivos. Requer build:node.
// A senha abaixo é pública, sintética e válida somente neste banco temporário.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { restoreEncryptedBackup, RESTORE_PREFIX } from '../platform-node/backup-restore.mjs';
import { localMigrations } from './backup-cli-input.mjs';

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
  process.on('message', message => { if (message?.event === 'shutdown') stop(); if (message?.event === 'memory') process.send?.({ event: 'memory', rssBytes: process.memoryUsage().rss, maxRssKiB: process.resourceUsage().maxRSS }); });
  process.on('disconnect', stop);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.send({ event: 'listening', port: PORT });
}

export function localClient(port = PORT) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Informe a porta da bancada local.');
  const origin = `http://${HOST}:${port}`;
  const cookies = new Map();
  return async function api(path, body, authenticated = true, binary = false) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('QA aceita somente caminhos locais.');
    const upload = body instanceof FormData ? new Response(body) : null;
    const payload = upload ? Buffer.from(await upload.arrayBuffer()) : body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Accept: 'application/json' };
    if (authenticated && cookies.size) headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    if (payload) Object.assign(headers, { Origin: origin, 'X-Proex-Action': '1', 'Content-Type': upload?.headers.get('content-type') ?? 'application/json', 'Content-Length': payload.byteLength });
    // Native http.request connects directly to loopback and never follows redirects
    // or inherits an HTTP proxy agent. No browser session/cookie is written to disk.
    return new Promise((done, reject) => {
      const request = httpRequest({ hostname: HOST, port, method: payload ? 'POST' : 'GET', path, headers }, response => {
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
          const data = Buffer.concat(chunks);
          let value; try { value = binary ? data : JSON.parse(data.toString('utf8')); } catch { value = null; }
          done({ status: response.statusCode, value, bytes: size, headers: response.headers, chunks: chunks.length });
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

// Separate clients model a fresh browser, a signed-in manager and a volunteer.
// All writes use the same disposable fixture and the loopback-only client.
async function invitationSmoke(owner, fixture) {
  const fresh = localClient();
  const client = localClient();
  const email = 'equipe.qa@example.test';
  const volunteerEmail = 'voluntaria.qa@example.test';
  const other = ok(await owner('/api/portal', {
    action: 'project.create', operationKey: randomUUID(), name: 'Projeto fora do convite QA',
    status: 'active', scope: 'internal',
  }), 'Segundo projeto QA');
  const issue = async input => {
    const invite = ok(await owner('/api/portal', {
      action: 'invite.create', operationKey: randomUUID(), projectId: fixture.projectId, ...input,
    }), 'Emissão de convite QA');
    const link = new URL(invite.inviteUrl);
    assert.equal(link.origin, QA_ORIGIN);
    assert.equal(link.pathname, '/convite');
    const token = link.searchParams.get('token') ?? new URLSearchParams(link.hash.slice(1)).get('token');
    assert.match(token ?? '', /^[A-Za-z0-9_-]{43}$/);
    return { id: invite.id, token, expiresAt: invite.expiresAt };
  };
  const startedAt = Date.now();
  const invite = await issue({ email, role: 'viewer' });
  const duration = Date.parse(invite.expiresAt) - startedAt;
  assert.ok(duration >= 7 * 86400000 && duration < 7 * 86400000 + 15000, 'convite comum deve valer sete dias');
  assert.equal((await fresh('/api/portal')).status, 401);
  const publicPage = await fresh('/convite', undefined, false, true);
  assert.equal(publicPage.status, 200);
  const publicHtml = publicPage.value.toString('utf8');
  assert.ok(publicHtml.includes('og:image') && publicHtml.includes('/convite-proex.png'), 'prévia institucional disponível');
  assert.ok(!publicHtml.includes(invite.token) && !publicHtml.includes(email), 'prévia genérica sem dados da pessoa');
  const legacyPage = await fresh(`/convite?token=${encodeURIComponent(invite.token)}`, undefined, false, true);
  assert.equal(legacyPage.status, 307, 'link antigo deve passar pelo redirecionamento antes de chegar ao HTML');
  assert.match(String(legacyPage.headers['cache-control']), /private.*no-store/i);
  assert.equal(legacyPage.headers['referrer-policy'], 'no-referrer');
  const location = new URL(legacyPage.headers.location, QA_ORIGIN);
  assert.equal(location.origin, QA_ORIGIN);
  assert.equal(location.pathname, '/convite');
  assert.equal(location.search, '');
  assert.ok(new URLSearchParams(location.hash.slice(1)).get('token') === invite.token, 'redirecionamento preserva o código somente no fragmento');
  assert.ok(!legacyPage.value.toString('utf8').includes(invite.token), 'resposta anterior à renderização não deve expor código no corpo');
  const bodyDetails = await fresh('/api/account', { action: 'inspectInvite', token: invite.token }, false);
  assert.equal(ok(bodyDetails, 'Consulta de convite sem segredo na URL').email, email);
  assert.match(String(bodyDetails.headers['cache-control']), /private.*no-store/i);
  const details = ok(await client(`/api/account?token=${encodeURIComponent(invite.token)}`), 'Consulta de link legado');
  assert.equal(details.email, email);
  assert.equal(details.accepted, false);
  const activated = await client('/api/account', {
    action: 'activateInvite', token: invite.token, password: QA_TEST_PASSWORD, name: 'Pessoa fictícia QA',
  });
  ok(activated, 'Ativação convidada');
  assert.ok(activated.headers['set-cookie']?.some(row => /HttpOnly/i.test(row) && /Max-Age=604800(?:;|$)/i.test(row)), 'sessão local HttpOnly com sete dias');
  const account = ok(await client('/api/account'), 'Sessão após ativar');
  assert.equal(account.user.email, email);
  const snapshot = ok(await client('/api/portal'), 'Releitura com sessão ativada');
  assert.ok(snapshot.projects.some(project => project.id === fixture.projectId));
  assert.ok(!snapshot.projects.some(project => project.id === other.id));
  const escalation = await client('/api/portal', {
    action: 'invite.create', operationKey: randomUUID(), projectId: fixture.projectId,
    email: 'elevacao.qa@example.test', role: 'manager',
  });
  assert.equal(escalation.status, 403, 'convite de consulta não pode delegar acesso');
  assert.equal((await client('/api/account', { action: 'logout' })).status, 200);
  assert.equal((await client('/api/portal')).status, 401);
  ok(await client('/api/account', { action: 'login', identifier: email, password: QA_TEST_PASSWORD }), 'Novo login com a conta persistida');
  assert.equal(ok(await client('/api/account'), 'Releitura da identidade persistida').user.userId, account.user.userId);

  const endsAt = new Date(Date.now() + 2 * 3600000).toISOString();
  const volunteer = await issue({ email: volunteerEmail, role: 'operator', campaignId: fixture.campaignId, endsAt });
  assert.equal(volunteer.expiresAt, endsAt, 'convite de voluntário não pode sobreviver ao acesso');
  ok(await fresh('/api/account', {
    action: 'activateInvite', token: volunteer.token, password: QA_TEST_PASSWORD, name: 'Voluntária fictícia QA',
  }), 'Ativação voluntária');
  const restricted = ok(await fresh('/api/portal'), 'Painel de voluntário');
  assert.deepEqual(restricted.volunteerAccess.map(row => row.campaign_id), [fixture.campaignId]);
  assert.ok(!restricted.projects?.some(project => project.id === other.id));

  const revoked = await issue({ email: 'revogado.qa@example.test', role: 'viewer' });
  ok(await owner('/api/portal', { action: 'invite.revoke', id: revoked.id }), 'Revogação local');
  assert.equal((await localClient()('/api/account', {
    action: 'activateInvite', token: revoked.token, password: QA_TEST_PASSWORD, name: 'Pessoa revogada QA',
  })).status, 410, 'link revogado não cria sessão');
  console.log('Convites QA: ativação, sessão de sete dias, sair/entrar, escopo do projeto, voluntário com prazo e revogação aprovados.');
}

async function rolesSmoke(owner, fixture) {
  const projectId = fixture.projectId;
  const other = ok(await owner('/api/portal', { action: 'project.create', operationKey: randomUUID(), name: 'Projeto QA B', status: 'active', scope: 'internal' }), 'Projeto QA B');
  const people = {};
  for (const [role, name, scope] of [
    ['manager', 'Coordenação QA', projectId], ['viewer', 'Bolsista QA', projectId],
    ['inventory', 'Materiais QA', projectId], ['loans', 'Empréstimos QA', projectId],
    ['operator', 'Operação QA', other.id],
  ]) {
    const email = `${role}@proex.example.test`;
    const issued = ok(await owner('/api/portal', { action: 'invite.create', operationKey: randomUUID(), projectId: scope, email, role }), 'Emissão QA por perfil');
    const link = new URL(issued.inviteUrl);
    assert.equal(link.origin, QA_ORIGIN);
    const token = link.searchParams.get('token') ?? new URLSearchParams(link.hash.slice(1)).get('token');
    assert.ok(token, 'convite de teste válido');
    const api = localClient();
    ok(await api('/api/account', { action: 'activateInvite', token, password: QA_TEST_PASSWORD, name }), 'Ativação QA por perfil');
    const account = ok(await api('/api/account'), 'Identidade QA');
    assert.equal(account.user.email, email);
    people[role] = { api, userId: account.user.userId };
  }
  const { api: manager } = people.manager, { api: viewer, userId } = people.viewer;
  const { api: inventory } = people.inventory, { api: loans } = people.loans, { api: operator } = people.operator;
  const catalogPath = `/api/follow-up?view=catalog&projectId=${projectId}`;
  for (const [client, expected] of [[manager, [true, true, true]], [inventory, [true, false, false]], [loans, [false, false, true]], [viewer, [false, false, false]]]) {
    const catalog = ok(await client(catalogPath), 'Opções autorizadas QA');
    assert.deepEqual([catalog.items.length > 0, catalog.campaigns.length > 0, catalog.loans.length > 0], expected);
  }
  for (const loanId of [fixture.loanId, 'inexistente-qa']) {
    assert.equal((await inventory('/api/follow-up', { action: 'task.create', title: 'Vínculo recusado QA', projectId, loanId, operationKey: randomUUID() })).status, 403);
  }
  assert.equal((await operator(catalogPath)).status, 403);
  assert.equal((await operator(`/api/calendar?projectId=${other.id}`)).status, 403);
  assert.equal(ok(await operator(`/api/projects/${other.id}`), 'Ficha sem registros para operação QA').relationships.records, null);
  const task = ok(await manager('/api/follow-up', { action: 'checklist.activity.create', projectId, campaignId: fixture.campaignId, title: 'Sparks QA · Cobertura', rows: [{ label: 'Fotos da ação reunidas?' }], userIds: [userId], operationKey: randomUUID() }), 'Checklist da ação QA');
  const answer = { action: 'checklist.activity.answer', id: task.checklist.id, rowId: task.checklist.rows[0].id, expectedVersion: 1, answer: 'yes', note: 'Conferido no cenário fictício.', operationKey: randomUUID() };
  assert.equal((await viewer('/api/follow-up', answer)).status, 403, 'atribuição sem autorização de execução');
  ok(await manager('/api/follow-up', { action: 'task.worker.grant', id: task.task.id, userId, confirmed: true, operationKey: randomUUID() }), 'Autorização só neste checklist QA');
  assert.equal(ok(await viewer('/api/follow-up', answer), 'Verificação pelo bolsista QA').checklist.rows[0].answer, 'yes');
  assert.equal((await viewer('/api/follow-up', { action: 'task.create', title: 'Demanda recusada QA', projectId, operationKey: randomUUID() })).status, 403);
  assert.equal((await operator(`/api/follow-up?view=detail&id=${task.task.id}`)).status, 404);
  const day = dayBrasilia(Date.now());
  const schedule = async title => ok(await manager('/api/portal', { action: 'project.schedule.create', projectId, title, startsAt: day, endsAt: day, operationKey: randomUUID() }), 'Atividade de cronograma QA');
  const action = await schedule('Ação no Sparks QA'), otherAction = await schedule('Outro compromisso QA');
  const observation = { action: 'create', projectId, scheduleItemId: action.id, kind: 'project', title: 'Sparks QA · Registro e fotos', occurredAt: new Date().toISOString(), operationKey: randomUUID() };
  assert.equal((await viewer('/api/records', observation)).status, 403);
  assert.equal((await inventory('/api/records', observation)).status, 403);
  const receipt = ok(await manager('/api/records', observation), 'Registro da ação QA');
  assert.equal(receipt.record.schedule_item_id, action.id);
  assert.equal(ok(await manager('/api/records', observation), 'Reenvio do registro QA').id, receipt.id);
  const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6qdsAAAAASUVORK5CYII=', 'base64');
  const form = new FormData();
  form.set('recordId', receipt.id);
  form.set('operationKey', randomUUID());
  form.set('file', new Blob([picture], { type: 'image/png' }), 'evidencia-sintetica.png');
  assert.equal((await viewer('/api/records', form)).status, 403);
  const uploaded = ok(await manager('/api/records', form), 'Foto privada QA');
  const filePath = `/api/records/files/${uploaded.attachment.id}`;
  const downloaded = await viewer(filePath, undefined, true, true);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.value, picture);
  assert.match(String(downloaded.headers['cache-control']), /private.*no-store/i);
  assert.match(String((await viewer(filePath + '?v=list',undefined,true,true)).headers['cache-control']), /private.*no-store/i, 'foto de atividade nunca recebe cache de miniatura');
  const actionRecords = `/api/records?projectId=${projectId}&scheduleItemId=${action.id}`;
  const authorized = ok(await viewer(actionRecords), 'Leitura dos registros da atividade QA');
  assert.equal(authorized.scheduleItem.title, 'Ação no Sparks QA');
  assert.deepEqual(authorized.records.map(row => row.id), [receipt.id]);
  assert.deepEqual(ok(await viewer(`/api/records?projectId=${projectId}&scheduleItemId=${otherAction.id}`), 'Outra atividade QA').records, []);
  assert.equal((await inventory(actionRecords)).status, 404);
  assert.equal((await operator(filePath)).status, 403);
  const member = ok(await owner('/api/portal'), 'Vínculos QA').members.find(member => member.email === 'viewer@proex.example.test' && member.project_id === projectId && !member.revoked_at);
  assert.ok(member, 'vínculo sintético encontrado');
  ok(await owner('/api/portal', { action: 'member.revoke', id: member.id }), 'Revogação QA');
  assert.equal((await viewer(filePath)).status, 403);
  assert.equal((await viewer(actionRecords)).status, 403);
  assert.equal((await viewer(`/api/follow-up?view=detail&id=${task.task.id}`)).status, 404);
  console.log('Perfis QA: responsável, gestor, bolsista leitor, materiais, empréstimos e operação. Vínculos, checklist, foto privada e revogação aprovados.');
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
  environment.PROEX_QA_PORTAL_EDIT = '1';
  const child = spawn(process.execPath, [join(projectRoot, 'scripts/apps-script-harness.mjs')], { cwd: projectRoot, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { if (output.length < 100000) output += chunk.toString(); });
  const exitCode = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', code => done(code)); });
  // curl errors can contain header arguments; redact this ephemeral token too.
  console.log(redact(output.split(issued.token).join('[CHAVE QA OMITIDA]')).trim());
  if (exitCode !== 0) throw new Error('O harness da planilha simulada falhou no portal local.');
}

async function backupSmoke(api, directory, server) {
  const capability = ok(await api('/api/backup'), 'Disponibilidade do backup local');
  assert.equal(capability.supported, true);
  assert.equal((await api('/api/backup', undefined, false)).status, 401, 'metadados do backup exigem autenticação');
  // A large private orphan proves the complete inventory is captured even when
  // no operational row refers to the object. Bytes and phrase are synthetic.
  const bytes = randomBytes(5 * 1024 * 1024), key = createHash('sha256').update('qa-private-orphan').digest('hex');
  writeFileSync(join(directory, 'data', 'objects', key), bytes);
  writeFileSync(join(directory, 'data', 'objects', key + '.type'), 'application/octet-stream');
  let protection = randomBytes(32).toString('base64url'), restored;
  try {
    const response = await api('/api/backup', { password: protection }, true, true);
    assert.equal(response.status, 200, 'API local deve preparar o backup completo');
    assert.ok(response.bytes > 4.5 * 1024 * 1024); assert.ok(response.chunks > 1);
    assert.equal(response.headers['content-length'], undefined, 'backup deve usar streaming sem Content-Length');
    assert.equal(response.headers['transfer-encoding'], 'chunked');
    const dry = await restoreEncryptedBackup(response.value, protection, { dryRun: true, migrations: localMigrations() });
    assert.equal(dry.verified, true); assert.equal(dry.objects, 1);
    restored = await restoreEncryptedBackup(response.value, protection, { migrations: localMigrations() });
    const copied = readFileSync(join(restored.directory, 'data', 'objects', key));
    assert.equal(createHash('sha256').update(copied).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
    assert.equal(JSON.parse(readFileSync(join(restored.directory, 'ISOLATED-RESTORE.json'))).ready, true);
    const memory = await new Promise((done, reject) => {
      const timeout = setTimeout(() => { server.removeListener('message', receive); reject(new Error('Métrica local do processo QA indisponível.')); }, 5000);
      const receive = message => { if (message?.event === 'memory') { clearTimeout(timeout); server.removeListener('message', receive); done(message); } };
      server.on('message', receive); server.send({ event: 'memory' });
    });
    console.log(JSON.stringify({ backupSmoke: 'passed', environment: 'loopback, dados sintéticos; não confirma edge Vercel ou backup de produção', encryptedBytes: response.bytes, httpChunks: response.chunks, verifiedObjects: restored.objects, sqliteBytes: restored.sqliteBytes, isolatedRestore: true,
      serverCurrentRssBytes: memory.rssBytes, serverProcessMaxRssKiB: memory.maxRssKiB, memoryScope: 'máximo do processo servidor desde o início deste QA, incluindo preparação e criptografia' }));
  } finally {
    protection = ''; bytes.fill(0);
    if (restored?.directory) {
      const absolute = realpathSync(restored.directory), temporaryParent = realpathSync(tmpdir());
      if (dirname(absolute) !== temporaryParent || !basename(absolute).startsWith(RESTORE_PREFIX)) throw new Error('Pasta restaurada fora do limite local esperado.');
      rmSync(absolute, { recursive: true, force: true });
    }
  }
}

async function run(options) {
  if (!existsSync(join(projectRoot, 'dist/server/index.js')) || !existsSync(join(projectRoot, 'node_modules/vinext/dist/server/prod-server.js'))) {
    throw new Error('Execute npx --yes pnpm@11.25.0 build:node antes de iniciar o QA local.');
  }
  await freePort();
  const temporaryParent = realpathSync(tmpdir()), directory = mkdtempSync(join(temporaryParent, TEMP_PREFIX));
  mkdirSync(join(directory, 'runtime')); mkdirSync(join(directory, 'data'));
  const authSecret = randomBytes(32).toString('base64url'), setupToken = randomBytes(32).toString('base64url');
  const credentialSecret = options.credentialVault ? randomBytes(32).toString('base64url') : null;
  const redact = text => [authSecret, setupToken, QA_TEST_PASSWORD, credentialSecret].filter(Boolean).reduce((value, secret) => value.split(secret).join('[SEGREDO QA OMITIDO]'), String(text));
  const environment = qaEnvironment(directory, authSecret, setupToken);
  if (credentialSecret) environment.PROEX_KEYS_SECRET = credentialSecret;
  const child = spawn(process.execPath, [scriptPath, '--serve'], { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
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
    if (options.backupSmoke) await backupSmoke(api, directory, child);
    if (options.inviteSmoke) await invitationSmoke(api, fixture);
    if (options.rolesSmoke) await rolesSmoke(api, fixture);
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
    console.log('Uso: node scripts/qa-local.mjs [--smoke] [--invite-smoke] [--roles-smoke] [--sync-smoke] [--backup-smoke] [--benchmark] [--credential-vault]\nRequer build:node atual e porta 5173 livre. Sem --smoke, mantém o QA aberto para o navegador.\nHost fixo 127.0.0.1; não aceita URL/host remoto. Não lê .env/.dev.vars, não instala dependências e não acessa a planilha/Drive reais.');
    return;
  }
  if (args.some(arg => !['--smoke', '--invite-smoke', '--roles-smoke', '--sync-smoke', '--backup-smoke', '--benchmark', '--credential-vault'].includes(arg))) throw new Error('Opção desconhecida; use --help. Host/URL remoto não são aceitos.');
  await run({ smoke: args.includes('--smoke'), inviteSmoke: args.includes('--invite-smoke'), rolesSmoke: args.includes('--roles-smoke'), syncSmoke: args.includes('--sync-smoke'), backupSmoke: args.includes('--backup-smoke'), benchmark: args.includes('--benchmark'), credentialVault: args.includes('--credential-vault') });
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Falha no QA local.'); process.exitCode = 1; });
}
