import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

// Google Drive por pessoa (0042). Google simulado; nenhum dado real, token real ou chamada externa.
const root = fileURLToPath(new URL('../', import.meta.url)), cache = new Map(), url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const replacements = new Map([
  [resolve(root, 'lib/session.ts'), url('export async function getPortalUser(){return globalThis.__driveTest?.user??null;}')],
  [resolve(root, 'lib/platform.ts'), url(`export function database(){return globalThis.__driveTest.db;}
export function bucket(){return globalThis.__driveTest.storage;}
export function inviteSecret(){return globalThis.__driveTest.authSecret;}
export function assistantCredentialKeys(){return globalThis.__driveTest.keys;}
export function googleDriveEnvironment(){return globalThis.__driveTest.env;}
export function portalOrigin(){return globalThis.__driveTest.env.origin;}`)],
]);
function compile(file) {
  file = resolve(root, file);
  if (replacements.has(file)) return replacements.get(file);
  if (cache.has(file)) return cache.get(file);
  let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, _quote, dep) => {
    if (!dep.startsWith('.') && !dep.startsWith('@/')) return match;
    const target = dep.startsWith('@/') ? resolve(root, dep.slice(2)) : resolve(dirname(file), dep);
    return `from ${JSON.stringify(compile(target.endsWith('.ts') ? target : `${target}.ts`))}`;
  });
  const result = url(code); cache.set(file, result); return result;
}
const access = await import(compile('lib/access.ts'));
const crypt = await import(compile('lib/google-drive/crypto.ts'));
const connection = await import(compile('lib/google-drive/connection.ts'));
const folders = await import(compile('lib/google-drive/folders.ts'));
const save = await import(compile('lib/google-drive/save.ts'));
const callbackRoute = await import(compile('app/api/drive/oauth/callback/route.ts'));
const startRoute = await import(compile('app/api/drive/oauth/start/route.ts'));
const statusRoute = await import(compile('app/api/drive/route.ts'));
const activityMedia = await import(compile('lib/google-drive/activity-media.ts'));
const activityMediaRoute = await import(compile('app/api/records/activity-media/route.ts'));

const REFRESH = 'rt-sintetico-0123456789-refresh-token-abcdef';
const ACCESS = 'at-sintetico-9876543210-access-token-zyxwvu';
const AUTH_SECRET = 'segredo-de-sessao-sintetico-'.padEnd(48, 'x');
const KEYS = { current: 'segredo-do-cofre-sintetico-atual-'.padEnd(48, 'k') };
const ENV = { clientId: 'cliente-sintetico.apps.googleusercontent.com', clientSecret: 'segredo-cliente-sintetico-000', pickerApiKey: 'chave-picker-sintetica', appId: '123456789012', origin: 'https://portal.example.test' };
const FOLDER = 'pastaSinteticaComunicacao01';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

/** Google falso: guarda as chamadas e responde conforme `google.state`. */
function fakeGoogle() {
  const state = { refreshGrant: 'ok', folders: { [FOLDER]: { name: 'Comunicação 2026', canAddChildren: true, permissionIds: ['owner1'], driveId: 'driveCompartilhado01' } }, scopes: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file', sub: '111111111111', uploadStatus: 200, revokeStatus: 200 };
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  async function fetcher(input, init = {}) {
    const target = new URL(String(input)), body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body;
    calls.push({ url: target, method: init.method ?? 'GET', body, headers: init.headers ?? {} });
    if (target.href === 'https://oauth2.googleapis.com/token') {
      if (body.grant_type === 'authorization_code') return body.code === 'codigo-bom' ? json({ access_token: ACCESS, refresh_token: REFRESH, scope: state.scopes, expires_in: 3599 }) : json({ error: 'invalid_grant' }, 400);
      if (state.refreshGrant === 'revoked') return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
      if (state.refreshGrant === 'down') return json({}, 503);
      if (state.refreshGrant === 'bad_client') return json({ error: 'invalid_client' }, 401);
      return body.refresh_token === REFRESH ? json({ access_token: ACCESS, scope: state.scopes, expires_in: 3599 }) : json({ error: 'invalid_grant' }, 400);
    }
    if (target.href === 'https://oauth2.googleapis.com/revoke') return new Response('', { status: state.revokeStatus });
    if (target.href === 'https://openidconnect.googleapis.com/v1/userinfo') return json({ sub: state.sub, email: 'pessoa.sintetica@example.test', email_verified: true });
    const auth = init.headers?.Authorization;
    if (auth !== `Bearer ${ACCESS}`) return json({ error: { code: 401 } }, 401);
    const folderMatch = target.pathname.match(/^\/drive\/v3\/files\/(.+)$/);
    if (folderMatch) {
      const folder = state.folders[decodeURIComponent(folderMatch[1])];
      if (!folder) return json({ error: { code: 404, errors: [{ reason: 'notFound' }] } }, 404);
      return json({ id: decodeURIComponent(folderMatch[1]), name: folder.name, mimeType: folder.mimeType ?? 'application/vnd.google-apps.folder', driveId: folder.driveId, trashed: !!folder.trashed, permissionIds: folder.permissionIds, ...(folder.permissions ? { permissions: folder.permissions } : {}), capabilities: { canAddChildren: folder.canAddChildren } });
    }
    if (target.pathname === '/upload/drive/v3/files') {
      if (state.uploadStatus !== 200) return json({ error: { code: state.uploadStatus, errors: [{ reason: state.uploadReason ?? 'insufficientFilePermissions' }] } }, state.uploadStatus);
      return json({ id: 'arquivoNoDrive01', name: 'x', webViewLink: 'https://drive.google.com/file/d/arquivoNoDrive01/view' });
    }
    return json({ error: 'unexpected' }, 500);
  }
  return { state, calls, fetcher };
}

function fixture(t) {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  for (const f of readdirSync(`${root}drizzle`).filter(x => x.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${f}`, 'utf8'));
  const now = new Date().toISOString();
  const insert = (table, row) => { const cols = Object.keys(row); native.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(row)); };
  const db = { beforeBatch: null, prepare(sql) { let values = []; return { bind(...args) { values = args; return this; }, async first(column) { const row = native.prepare(sql).get(...values) ?? null; return column ? row?.[column] ?? null : row; }, async all() { return { results: native.prepare(sql).all(...values), success: true }; }, async run() { return this.execute(); }, execute() { const results = native.prepare(sql).all(...values); return { results, success: true, meta: { changes: Number(native.prepare('SELECT changes() AS n').get().n) } }; } }; }, async batch(statements) { if (this.beforeBatch) { const hook = this.beforeBatch; this.beforeBatch = null; hook(); } native.exec('BEGIN'); try { const r = statements.map(s => s.execute()); native.exec('COMMIT'); return r; } catch (e) { native.exec('ROLLBACK'); throw e; } } };
  const user = async (id, role, project = null, org = null) => {
    insert('portal_users', { user_id: id, email: `${id}@example.invalid`, status: 'active', created_at: now, updated_at: now });
    insert('profiles', { user_id: id, display_name: `Pessoa ${id}`, created_at: now, updated_at: now });
    if (role) insert('members', { id: `m-${id}`, user_id: id, email: `${id}@example.invalid`, role, project_id: project, organization_id: org, created_at: now });
    return access.getActor(db, { userId: id, email: `${id}@example.invalid`, displayName: `Pessoa ${id}` });
  };
  insert('organizational_units', { id: 'un-com', name: 'Comunicação', kind: 'proex', created_at: now, updated_at: now });
  for (const id of ['a', 'b']) {
    insert('organizations', { id: `o-${id}`, name: `Org ${id}`, slug: `org-${id}`, created_at: now, updated_at: now });
    insert('projects', { id: `p-${id}`, name: `Projeto ${id}`, organization_id: `o-${id}`, created_at: now, ...(id === 'a' ? { unit_id: 'un-com' } : {}) });
  }
  insert('projects', { id: 'p-a2', name: 'Projeto a2', organization_id: 'o-a', created_at: now });
  insert('items', { id: 'item-1', project_id: 'p-a', name: 'Botton do Rolê', category: 'gift', unit: 'un', created_at: now });
  insert('records', { id: 'rec-1', project_id: 'p-a', kind: 'material', title: 'Foto', occurred_at: now, item_id: 'item-1', created_by: 'x', created_at: now });
  insert('record_attachments', { id: 'att-1', record_id: 'rec-1', project_id: 'p-a', object_key: 'record-attachments/obj-1', name: 'botton.png', mime: 'image/png', size: PNG.length, operation_key: 'op-1', created_by: 'x', created_at: now });
  const google = fakeGoogle();
  const storage = { async get(key) { return key === 'record-attachments/obj-1' ? { size: PNG.length, async arrayBuffer() { return PNG.slice().buffer; } } : null; } };
  const deps = { env: { ...ENV }, keys: { ...KEYS }, authSecret: AUTH_SECRET, fetcher: google.fetcher, storage };
  globalThis.__driveTest = { db, user: null, storage, authSecret: AUTH_SECRET, keys: deps.keys, env: deps.env };
  t.after(() => { native.close(); delete globalThis.__driveTest; });
  return { native, db, user, now, insert, google, deps };
}
const count = (f, table, where = '1=1', ...values) => Number(f.native.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get(...values).n);
function dump(native) { const rows = []; for (const { name } of native.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) for (const row of native.prepare(`SELECT * FROM "${name}"`).all()) rows.push(`${name}:${JSON.stringify(row)}`); return rows.join('\n'); }
function assertNoTokens(text, label) { for (const secret of [REFRESH, ACCESS, ENV.clientSecret, KEYS.current, AUTH_SECRET]) assert.ok(!String(text).includes(secret), `${label} vazou um segredo`); }

/** Conecta a pessoa com o Google falso, como faria o navegador. */
async function connect(f, actor) {
  const started = await connection.startConnection(f.db, actor, f.deps);
  const state = new URL(started.url).searchParams.get('state');
  return connection.completeConnection(f.db, actor, f.deps, { code: 'codigo-bom', state, error: null, cookie: started.cookie });
}
async function registerFolder(f, admin, extra = {}) {
  return folders.folderAction(f.db, admin, { action: 'register', organizationId: 'o-a', driveFolderId: FOLDER, name: 'Fotos da comunicação — CONPEEX 2026', purpose: 'Fotos de divulgação do evento', audience: 'organization', unitId: 'un-com', ...extra }, f.deps);
}

test('cofre: o token abre só para a mesma pessoa e conta, e segue a rotação da chave', async () => {
  const owner = { userId: 'u1', googleSub: '111' };
  const sealed = await crypt.sealRefreshToken(REFRESH, owner, KEYS, AUTH_SECRET);
  assert.match(sealed.ciphertext, /^gd1\.[A-Za-z0-9_-]{16}\./); assertNoTokens(sealed.ciphertext, 'envelope');
  assert.equal(await crypt.openRefreshToken(sealed.ciphertext, owner, KEYS, AUTH_SECRET), REFRESH);
  await assert.rejects(() => crypt.openRefreshToken(sealed.ciphertext, { userId: 'u2', googleSub: '111' }, KEYS, AUTH_SECRET), e => e.code === 'drive_vault_unavailable');
  await assert.rejects(() => crypt.openRefreshToken(sealed.ciphertext, { userId: 'u1', googleSub: '222' }, KEYS, AUTH_SECRET), e => e.code === 'drive_vault_unavailable');
  const rotated = { current: 'segredo-novo-do-cofre-sintetico-'.padEnd(48, 'n'), previous: KEYS.current };
  assert.equal(await crypt.openRefreshToken(sealed.ciphertext, owner, rotated, AUTH_SECRET), REFRESH, 'a chave anterior abre durante a rotação');
  await assert.rejects(() => crypt.openRefreshToken(sealed.ciphertext, owner, { current: rotated.current }, AUTH_SECRET), e => e.code === 'drive_vault_unavailable', 'segredo trocado sem o anterior: erro de configuração, não revogação');
  await assert.rejects(() => crypt.sealRefreshToken(REFRESH, owner, {}, AUTH_SECRET), e => e.code === 'drive_vault_unavailable');
  await assert.rejects(() => crypt.sealRefreshToken(REFRESH, owner, { current: AUTH_SECRET }, AUTH_SECRET), e => e.code === 'drive_vault_unavailable', 'nunca reaproveita o segredo da sessão');
});

test('OAuth: escopo drive.file, PKCE S256, estado preso à pessoa e ao navegador; token nunca em claro', async t => {
  const f = fixture(t), a = await f.user('a', 'viewer', 'p-a', 'o-a'), b = await f.user('b', 'viewer', 'p-a', 'o-a');
  const started = await connection.startConnection(f.db, a, f.deps);
  const auth = new URL(started.url);
  assert.equal(auth.origin + auth.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(auth.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/drive.file');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('access_type'), 'offline');
  assert.equal(auth.searchParams.get('redirect_uri'), 'https://portal.example.test/api/drive/oauth/callback');
  assert.ok(!started.url.includes(started.cookie) && !/verifier/.test(started.url));
  const state = auth.searchParams.get('state');
  await assert.rejects(() => connection.completeConnection(f.db, a, f.deps, { code: 'codigo-bom', state: 'outro', error: null, cookie: started.cookie }), e => e.code === 'drive_oauth_state');
  await assert.rejects(() => connection.completeConnection(f.db, a, f.deps, { code: 'codigo-bom', state, error: null, cookie: undefined }), e => e.code === 'drive_oauth_state');
  await assert.rejects(() => connection.completeConnection(f.db, b, f.deps, { code: 'codigo-bom', state, error: null, cookie: started.cookie }), e => e.status === 403);
  await assert.rejects(() => connection.completeConnection(f.db, a, f.deps, { code: null, state, error: 'access_denied', cookie: started.cookie }), e => e.code === 'drive_oauth_denied');
  assert.equal(count(f, 'google_drive_connections'), 0);
  await connection.completeConnection(f.db, a, f.deps, { code: 'codigo-bom', state, error: null, cookie: started.cookie });
  const row = f.native.prepare('SELECT * FROM google_drive_connections WHERE user_id=?').get('a');
  assert.equal(row.status, 'active'); assert.equal(row.google_sub, '111111111111');
  const exchange = f.google.calls.find(call => call.body?.grant_type === 'authorization_code');
  assert.ok(exchange.body.code_verifier?.length >= 43, 'o verificador PKCE vai só na troca, servidor a servidor');
  assertNoTokens(dump(f.native), 'banco');
  const view = await connection.connectionView(f.db, a, f.deps);
  assert.equal(view.status, 'connected'); assert.equal(view.account, 'pes…@example.test'); assertNoTokens(JSON.stringify(view), 'tela');
  const expired = await crypt.openOAuthState(started.cookie, KEYS.current, Date.now() + 11 * 60000);
  assert.equal(expired, null, 'o estado vence em 10 minutos');
});

test('OAuth: sem a caixa do Drive marcada, nada é guardado e a autorização parcial é revogada', async t => {
  const f = fixture(t), a = await f.user('a', 'viewer', 'p-a', 'o-a');
  f.google.state.scopes = 'openid https://www.googleapis.com/auth/userinfo.email';
  await assert.rejects(() => connect(f, a), e => e.code === 'drive_oauth_scope');
  assert.equal(count(f, 'google_drive_connections'), 0);
  assert.ok(f.google.calls.some(call => call.url.href === 'https://oauth2.googleapis.com/revoke' && call.body.token === REFRESH));
});

test('servidor sem configuração ou sem cofre: o recurso fica desligado com mensagem clara', async t => {
  const f = fixture(t), a = await f.user('a', 'viewer', 'p-a', 'o-a');
  assert.equal((await connection.connectionView(f.db, a, { ...f.deps, env: { ...ENV, clientSecret: undefined } })).status, 'unconfigured');
  await assert.rejects(() => connection.startConnection(f.db, a, { ...f.deps, keys: {} }), e => e.code === 'drive_unconfigured');
  await assert.rejects(() => connection.startConnection(f.db, null, f.deps), e => e.status === 401);
});

test('token revogado na conta Google: o envelope é apagado, as confirmações caem e a pessoa é chamada a reconectar', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a');
  await connect(f, admin); await registerFolder(f, admin);
  assert.equal(count(f, 'google_drive_folder_grants', 'user_id=?', 'adm'), 1);
  f.google.state.refreshGrant = 'revoked';
  await assert.rejects(() => connection.accessTokenFor(f.db, 'adm', f.deps), e => e.code === 'drive_reconnect_required' && e.status === 409);
  const row = f.native.prepare('SELECT * FROM google_drive_connections WHERE user_id=?').get('adm');
  assert.equal(row.status, 'revoked'); assert.equal(row.token_ciphertext, null); assert.ok(row.revoked_at);
  assert.equal(count(f, 'google_drive_folder_grants', 'user_id=?', 'adm'), 0);
  assert.equal((await connection.connectionView(f.db, admin, f.deps)).status, 'revoked');
  await assert.rejects(() => connection.accessTokenFor(f.db, 'adm', f.deps), e => e.code === 'drive_reconnect_required');
  f.google.state.refreshGrant = 'ok'; await connect(f, admin);
  assert.equal((await connection.connectionView(f.db, admin, f.deps)).status, 'connected', 'reconectar volta a funcionar');
  f.google.state.refreshGrant = 'down';
  await assert.rejects(() => connection.accessTokenFor(f.db, 'adm', f.deps), e => e.code === 'drive_google_unavailable');
  assert.equal(f.native.prepare('SELECT status FROM google_drive_connections WHERE user_id=?').get('adm').status, 'active', 'queda do Google não revoga nada');
});

test('desconectar e revogar: revogar chama o Google; desconectar só apaga; Google fora do ar não apaga nada', async t => {
  const f = fixture(t), a = await f.user('a', 'viewer', 'p-a', 'o-a');
  await connect(f, a);
  const revokesBefore = f.google.calls.filter(call => call.url.href.endsWith('/revoke')).length;
  assert.deepEqual(await connection.disconnect(f.db, a, f.deps, false), { status: 'not_connected', revokedAtGoogle: false });
  assert.equal(f.google.calls.filter(call => call.url.href.endsWith('/revoke')).length, revokesBefore);
  assert.equal(count(f, 'google_drive_connections'), 0);
  await connect(f, a);
  f.google.state.revokeStatus = 503;
  await assert.rejects(() => connection.disconnect(f.db, a, f.deps, true), e => e.code === 'drive_revoke_unreachable');
  assert.equal(count(f, 'google_drive_connections'), 1, 'sem confirmação do Google, mantém a conexão');
  f.google.state.revokeStatus = 200;
  assert.deepEqual(await connection.disconnect(f.db, a, f.deps, true), { status: 'not_connected', revokedAtGoogle: true });
  const revoke = f.google.calls.filter(call => call.url.href.endsWith('/revoke')).at(-1);
  assert.equal(revoke.body.token, REFRESH);
  assert.equal(count(f, 'google_drive_connections'), 0);
  const audit = f.native.prepare("SELECT action,details FROM audit WHERE action LIKE 'google_drive.%' ORDER BY created_at").all();
  assert.deepEqual(audit.map(row => row.action), ['google_drive.connect', 'google_drive.disconnect', 'google_drive.connect', 'google_drive.revoke']);
  assertNoTokens(JSON.stringify(audit), 'auditoria');
});

test('registro de pastas: só a administração cadastra; pasta pública, sem permissão, lixeira ou não-pasta são recusadas', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a'), manager = await f.user('ger', 'manager', 'p-a', 'o-a'), otherAdmin = await f.user('admb', 'owner', null, 'o-b');
  await connect(f, admin); await connect(f, manager); await connect(f, otherAdmin);
  await assert.rejects(() => registerFolder(f, manager), e => e.status === 403 && e.code === 'drive_folder_admin');
  await assert.rejects(() => registerFolder(f, otherAdmin), e => e.status === 403, 'dono de outra organização não cadastra aqui');
  f.google.state.folders[FOLDER].permissionIds = ['owner1', 'anyoneWithLink'];
  await assert.rejects(() => registerFolder(f, admin), e => e.code === 'drive_folder_public');
  f.google.state.folders[FOLDER].permissionIds = ['owner1']; f.google.state.folders[FOLDER].canAddChildren = false;
  await assert.rejects(() => registerFolder(f, admin), e => e.code === 'drive_permission_denied' && e.status === 403);
  f.google.state.folders[FOLDER].canAddChildren = true; f.google.state.folders[FOLDER].trashed = true;
  await assert.rejects(() => registerFolder(f, admin), e => e.code === 'drive_folder_trashed');
  f.google.state.folders[FOLDER].trashed = false;
  f.google.state.folders.arquivoNaoPasta01 = { name: 'planilha', mimeType: 'application/vnd.google-apps.spreadsheet', canAddChildren: false, permissionIds: [] };
  await assert.rejects(() => registerFolder(f, admin, { driveFolderId: 'arquivoNaoPasta01' }), e => e.code === 'drive_not_folder');
  await assert.rejects(() => registerFolder(f, admin, { driveFolderId: 'pastaQueNaoFoiEscolhida' }), e => e.code === 'drive_folder_confirm_required', 'drive.file: pasta não escolhida no seletor não aparece');
  await assert.rejects(() => registerFolder(f, admin, { audience: 'project', projectId: null }), e => e.status === 400);
  await assert.rejects(() => registerFolder(f, admin, { audience: 'project', projectId: 'p-b' }), e => e.status === 400, 'projeto de outra organização');
  const { folder } = await registerFolder(f, admin);
  assert.equal(folder.driveName, 'Comunicação 2026'); assert.equal(folder.sharedDrive, true); assert.equal(folder.unitName, 'Comunicação'); assert.equal(folder.confirmedByMe, true);
  await assert.rejects(() => registerFolder(f, admin), e => e.code === 'drive_folder_duplicate');
  const stored = f.native.prepare('SELECT * FROM google_drive_folders').get();
  assert.deepEqual(Object.keys(stored).filter(key => /token|secret|email/.test(key)), [], 'o cadastro guarda só id e metadados');
  await assert.rejects(() => folders.folderAction(f.db, admin, { action: 'update', folderId: folder.id, version: 99, name: 'x', purpose: 'y', audience: 'organization' }, f.deps), e => e.code === 'drive_folder_changed');
  const updated = await folders.folderAction(f.db, admin, { action: 'update', folderId: folder.id, version: 1, name: 'Fotos CONPEEX', purpose: 'Divulgação', audience: 'managers' }, f.deps);
  assert.equal(updated.folder.version, 2); assert.equal(updated.folder.audience, 'managers');
  const archived = await folders.folderAction(f.db, admin, { action: 'archive', folderId: folder.id, version: 2 }, f.deps);
  assert.equal(archived.folder.status, 'archived');
  assert.equal((await folders.usableFolders(f.db, admin)).length, 0, 'arquivada some da lista de uso');
  assert.equal((await folders.folderAdminView(f.db, admin)).folders.length, 1, 'mas continua na tela da administração');
  assert.equal((await folders.folderAdminView(f.db, manager)).canManage, false);
});

test('quem pode usar: organização, equipe do projeto e só gestão; outra organização nunca vê', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a');
  const viewerA = await f.user('va', 'viewer', 'p-a', 'o-a'), viewerA2 = await f.user('va2', 'viewer', 'p-a2', 'o-a'), manager = await f.user('ger', 'manager', 'p-a2', 'o-a'), viewerB = await f.user('vb', 'viewer', 'p-b', 'o-b');
  await connect(f, admin);
  const org = (await registerFolder(f, admin)).folder;
  f.google.state.folders.pastaDoProjetoA01 = { name: 'Projeto A', canAddChildren: true, permissionIds: [] };
  f.google.state.folders.pastaDaGestao0001 = { name: 'Gestão', canAddChildren: true, permissionIds: [] };
  const project = (await registerFolder(f, admin, { driveFolderId: 'pastaDoProjetoA01', name: 'Fotos do projeto A', audience: 'project', projectId: 'p-a' })).folder;
  const managers = (await registerFolder(f, admin, { driveFolderId: 'pastaDaGestao0001', name: 'Documentos da gestão', audience: 'managers' })).folder;
  const ids = async actor => (await folders.usableFolders(f.db, actor)).map(folder => folder.id).sort();
  assert.deepEqual(await ids(viewerA), [org.id, project.id].sort());
  assert.deepEqual(await ids(viewerA2), [org.id]);
  assert.deepEqual(await ids(manager), [org.id, managers.id].sort());
  assert.deepEqual(await ids(viewerB), []);
  assert.deepEqual(await ids(admin), [org.id, project.id, managers.id].sort());
  await assert.rejects(() => folders.usableFolder(f.db, viewerB, org.id), e => e.status === 404, 'sem acesso = não encontrada');
  f.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(f.now, 'va');
  assert.deepEqual(await ids(viewerA), [], 'revogação vale na hora, mesmo com o ator antigo');
});

test('confirmar a pasta: precisa ser a mesma pasta, escolhida com a conta conectada', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a'), viewer = await f.user('va', 'viewer', 'p-a', 'o-a');
  await connect(f, admin); const { folder } = await registerFolder(f, admin);
  await assert.rejects(() => folders.confirmFolder(f.db, viewer, { folderId: folder.id, pickedId: FOLDER }, f.deps), e => e.code === 'drive_connect_required');
  await connect(f, viewer);
  await assert.rejects(() => folders.confirmFolder(f.db, viewer, { folderId: folder.id, pickedId: 'outraPastaQualquer01' }, f.deps), e => e.code === 'drive_folder_mismatch');
  assert.deepEqual(await folders.confirmFolder(f.db, viewer, { folderId: folder.id, pickedId: FOLDER }, f.deps), { folderId: folder.id, confirmedByMe: true });
  assert.equal((await folders.usableFolder(f.db, viewer, folder.id)).confirmedByMe, true);
  f.google.state.sub = '222222222222'; await connect(f, viewer);
  assert.equal((await folders.usableFolder(f.db, viewer, folder.id)).confirmedByMe, false, 'outra conta Google precisa confirmar de novo');
});

test('sugestão de pasta: projeto e palavras do pedido decidem; empate ou nada claro vira pergunta', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a');
  await connect(f, admin);
  const base = { purpose: 'Arquivos', audience: 'organization' };
  f.google.state.folders.pastaFotosConpeex01 = { name: 'F', canAddChildren: true, permissionIds: [] };
  f.google.state.folders.pastaTermosEmprest1 = { name: 'T', canAddChildren: true, permissionIds: [] };
  const photos = (await registerFolder(f, admin, { ...base, driveFolderId: 'pastaFotosConpeex01', name: 'Fotos da comunicação — CONPEEX 2026', purpose: 'Fotos de divulgação', unitId: null })).folder;
  const terms = (await registerFolder(f, admin, { ...base, driveFolderId: 'pastaTermosEmprest1', name: 'Termos de empréstimo', purpose: 'Termos assinados', unitId: null })).folder;
  const list = await folders.usableFolders(f.db, admin);
  assert.equal((await save.suggestFolder(f.db, list, { projectId: null }, 'coloca essa foto do conpeex no drive')).folderId, photos.id);
  assert.equal((await save.suggestFolder(f.db, list, { projectId: null }, 'salva o termo de empréstimo')).folderId, terms.id);
  const doubt = await save.suggestFolder(f.db, list, { projectId: null }, 'salva no drive');
  assert.equal(doubt.folderId, null); assert.match(doubt.ask, /Em qual pasta devo salvar\?/); assert.match(doubt.ask, /Termos de empréstimo/);
  const none = await save.suggestFolder(f.db, [], { projectId: null }, 'foto');
  assert.equal(none.folderId, null); assert.match(none.ask, /administração/);
  const one = await save.suggestFolder(f.db, [photos], { projectId: null }, '');
  assert.equal(one.folderId, photos.id, 'uma só pasta disponível é sugerida (e ainda passa pela prévia)');
});

test('envio pela tela: opções → prévia → confirmação; grava quem, o quê, pasta e link; repetir não duplica', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a'), staff = await f.user('inv', 'inventory', 'p-a', 'o-a');
  await connect(f, admin); const { folder } = await registerFolder(f, admin);
  const source = { kind: 'record_attachment', id: 'att-1' };
  const options = await save.driveSaveOptions(f.db, staff, { source, hint: 'foto do conpeex' }, f.deps);
  assert.equal(options.connection.status, 'not_connected'); assert.equal(options.connection.href, '/?module=profile#google-drive');
  assert.equal(options.suggestion.folderId, folder.id); assert.match(options.fileName, /^\d{4}-\d{2}-\d{2} botton\.png$/);
  await assert.rejects(() => save.driveSavePrepare(f.db, staff, { source, folderId: folder.id }, f.deps), e => e.code === 'drive_connect_required' && e.status === 409);
  await connect(f, staff);
  await assert.rejects(() => save.driveSavePrepare(f.db, staff, { source, folderId: folder.id }, f.deps), e => e.code === 'drive_folder_confirm_required');
  await folders.confirmFolder(f.db, staff, { folderId: folder.id, pickedId: FOLDER }, f.deps);
  const prepared = await save.driveSavePrepare(f.db, staff, { source, folderId: folder.id, fileName: 'Botton/Rolê: frente.PNG' }, f.deps);
  assert.equal(prepared.preview.fileName, 'Botton Rolê frente.png'); assert.equal(prepared.preview.folderName, 'Fotos da comunicação — CONPEEX 2026');
  assert.match(prepared.preview.sourceLabel, /Botton do Rolê/);
  assertNoTokens(JSON.stringify(prepared), 'prévia');
  await assert.rejects(() => save.driveSaveApply(f.db, admin, { planToken: prepared.planToken }, f.deps), e => e.code === 'drive_plan_invalid', 'a prévia é de quem preparou');
  const applied = await save.driveSaveApply(f.db, staff, { planToken: prepared.planToken }, f.deps);
  assert.equal(applied.upload.status, 'sent'); assert.equal(applied.upload.webViewLink, 'https://drive.google.com/file/d/arquivoNoDrive01/view');
  const upload = f.google.calls.find(call => call.url.pathname === '/upload/drive/v3/files');
  assert.equal(upload.url.searchParams.get('supportsAllDrives'), 'true', 'funciona em drive compartilhado');
  const metadata = JSON.parse(Buffer.from(upload.body).toString('utf8').split('\r\n\r\n')[1].split('\r\n')[0]);
  assert.deepEqual(metadata.parents, [FOLDER]); assert.equal(metadata.name, 'Botton Rolê frente.png'); assert.equal(metadata.mimeType, 'image/png');
  const history = f.native.prepare('SELECT * FROM google_drive_uploads').get();
  assert.equal(history.user_id, 'inv'); assert.equal(history.via, 'screen'); assert.equal(history.source_kind, 'record_attachment'); assert.equal(history.source_id, 'att-1');
  assert.equal(history.sha256, createHash('sha256').update(PNG).digest('hex')); assert.equal(history.drive_file_id, 'arquivoNoDrive01');
  const again = await save.driveSaveApply(f.db, staff, { planToken: prepared.planToken }, f.deps);
  assert.equal(again.duplicate, true); assert.equal(f.google.calls.filter(call => call.url.pathname === '/upload/drive/v3/files').length, 1);
  const mine = await save.uploadHistory(f.db, staff, 'mine');
  assert.equal(mine.uploads.length, 1); assert.equal(mine.uploads[0].folderName, 'Fotos da comunicação — CONPEEX 2026'); assert.equal(mine.uploads[0].personName, 'Pessoa inv');
  await assert.rejects(() => save.uploadHistory(f.db, staff, 'organization'), e => e.status === 403);
  assert.equal((await save.uploadHistory(f.db, admin, 'organization')).uploads.length, 1);
  assertNoTokens(dump(f.native), 'banco depois do envio');
});

test('permissão negada: sem leitura do anexo, pasta fora do público, Drive recusando ou acesso revogado no meio', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a'), staff = await f.user('inv', 'inventory', 'p-a', 'o-a'), outsider = await f.user('va2', 'viewer', 'p-a2', 'o-a');
  await connect(f, admin); await connect(f, staff); await connect(f, outsider);
  const { folder } = await registerFolder(f, admin);
  const source = { kind: 'record_attachment', id: 'att-1' };
  await assert.rejects(() => save.driveSaveOptions(f.db, outsider, { source }, f.deps), e => e.status === 404, 'quem não lê o anexo não envia (e não descobre se ele existe)');
  await folders.confirmFolder(f.db, staff, { folderId: folder.id, pickedId: FOLDER }, f.deps);
  f.google.state.uploadStatus = 403;
  let prepared = await save.driveSavePrepare(f.db, staff, { source, folderId: folder.id }, f.deps);
  await assert.rejects(() => save.driveSaveApply(f.db, staff, { planToken: prepared.planToken }, f.deps), e => e.code === 'drive_permission_denied' && e.status === 403);
  let row = f.native.prepare('SELECT status,error_code,web_view_link FROM google_drive_uploads WHERE user_id=?').get('inv');
  assert.deepEqual({ ...row }, { status: 'failed', error_code: 'drive_permission_denied', web_view_link: null });
  await assert.rejects(() => save.driveSaveApply(f.db, staff, { planToken: prepared.planToken }, f.deps), e => e.code === 'drive_plan_used');
  f.google.state.uploadStatus = 200;
  f.google.state.folders[FOLDER].permissionIds = ['anyoneWithLink'];
  prepared = await save.driveSavePrepare(f.db, staff, { source, folderId: folder.id }, f.deps);
  await assert.rejects(() => save.driveSaveApply(f.db, staff, { planToken: prepared.planToken }, f.deps), e => e.code === 'drive_folder_public', 'pasta que virou pública bloqueia o envio');
  f.google.state.folders[FOLDER].permissionIds = [];
  prepared = await save.driveSavePrepare(f.db, staff, { source, folderId: folder.id }, f.deps);
  f.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(f.now, 'inv');
  await assert.rejects(() => save.driveSaveApply(f.db, staff, { planToken: prepared.planToken }, f.deps), e => e.status === 403 || e.status === 404, 'revogado entre a prévia e a confirmação');
  assert.equal(f.google.calls.filter(call => call.url.pathname === '/upload/drive/v3/files').length, 1, 'só a tentativa recusada chegou ao Drive');
});

test('token revogado na hora do envio e pasta que deixou de estar liberada', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a');
  await connect(f, admin); const { folder } = await registerFolder(f, admin);
  const source = { kind: 'record_attachment', id: 'att-1' };
  let prepared = await save.driveSavePrepare(f.db, admin, { source, folderId: folder.id }, f.deps);
  f.google.state.refreshGrant = 'revoked';
  await assert.rejects(() => save.driveSaveApply(f.db, admin, { planToken: prepared.planToken }, f.deps), e => e.code === 'drive_reconnect_required');
  assert.equal(f.native.prepare('SELECT error_code FROM google_drive_uploads').get().error_code, 'drive_reconnect_required');
  f.google.state.refreshGrant = 'ok'; await connect(f, admin);
  await folders.confirmFolder(f.db, admin, { folderId: folder.id, pickedId: FOLDER }, f.deps);
  prepared = await save.driveSavePrepare(f.db, admin, { source, folderId: folder.id }, f.deps);
  delete f.google.state.folders[FOLDER];
  await assert.rejects(() => save.driveSaveApply(f.db, admin, { planToken: prepared.planToken }, f.deps), e => e.code === 'drive_folder_confirm_required');
  assert.equal(count(f, 'google_drive_folder_grants', 'user_id=?', 'adm'), 0, 'a confirmação antiga é apagada');
});

test('Rolê: arquivo mandado no chat confere hash e tamanho; via Rolê fica no histórico', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a');
  await connect(f, admin); const { folder } = await registerFolder(f, admin);
  const sha256 = createHash('sha256').update(PNG).digest('hex');
  const source = { kind: 'upload', name: 'foto do chat.png', mime: 'image/png', bytes: PNG.length, sha256, projectId: 'p-a' };
  const options = await save.driveSaveOptions(f.db, admin, { source, hint: 'coloca no drive da comunicação' }, f.deps);
  assert.equal(options.suggestion.folderId, folder.id);
  const prepared = await save.driveSavePrepare(f.db, admin, { source, folderId: folder.id, via: 'role' }, f.deps);
  await assert.rejects(() => save.driveSaveApply(f.db, admin, { planToken: prepared.planToken }, f.deps), e => e.code === 'missing_file');
  const forged = PNG.slice(); forged[12] = 99;
  const prepared2 = await save.driveSavePrepare(f.db, admin, { source, folderId: folder.id, via: 'role' }, f.deps);
  await assert.rejects(() => save.driveSaveApply(f.db, admin, { planToken: prepared2.planToken }, f.deps, forged), e => e.code === 'drive_plan_invalid');
  const prepared3 = await save.driveSavePrepare(f.db, admin, { source, folderId: folder.id, via: 'role' }, f.deps);
  const done = await save.driveSaveApply(f.db, admin, { planToken: prepared3.planToken }, f.deps, PNG);
  assert.equal(done.upload.via, 'role');
  const upload = f.google.calls.filter(call => call.url.pathname === '/upload/drive/v3/files').at(-1);
  assert.match(Buffer.from(upload.body).toString('utf8'), /pelo Rolê, a pedido de quem enviou/);
  await assert.rejects(() => save.driveSaveOptions(f.db, admin, { source: { ...source, mime: 'text/html' } }, f.deps), e => e.status === 415);
  await assert.rejects(() => save.driveSaveOptions(f.db, admin, { source: { ...source, bytes: 5 * 1024 * 1024 } }, f.deps), e => e.status === 413);
  await assert.rejects(() => save.driveSavePrepare(f.db, admin, { source, folderId: folder.id }, { ...f.deps, now: Date.now() }).then(p => save.driveSaveApply(f.db, admin, { planToken: p.planToken }, { ...f.deps, now: Date.now() + 11 * 60000 }, PNG)), e => e.code === 'drive_plan_invalid', 'prévia vence em 10 minutos');
});

test('rotas: status sem segredo; início exige ação da mesma origem; volta do Google não põe código na URL', async t => {
  const f = fixture(t), a = await f.user('a', 'viewer', 'p-a', 'o-a');
  globalThis.__driveTest.user = { userId: 'a', email: 'a@example.invalid', displayName: 'Pessoa a' };
  const status = await (await statusRoute.GET()).json();
  assert.equal(status.configured, true); assert.deepEqual(status.picker, { clientId: ENV.clientId, apiKey: ENV.pickerApiKey, appId: ENV.appId, loginHint: null });
  assert.ok(!JSON.stringify(status).includes(ENV.clientSecret));
  const denied = await startRoute.POST(new Request('https://portal.example.test/api/drive/oauth/start', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' } }));
  assert.equal(denied.status, 403);
  const started = await startRoute.POST(new Request('https://portal.example.test/api/drive/oauth/start', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://portal.example.test', 'X-Proex-Action': '1' } }));
  assert.equal(started.status, 200); assert.equal(started.headers.get('Cache-Control'), 'private, no-store');
  const setCookie = started.headers.get('Set-Cookie');
  assert.match(setCookie, /^proex\.gdrive\.oauth=[^;]+; Path=\/api\/drive\/oauth; Max-Age=600; SameSite=Lax; Secure; HttpOnly$/);
  const state = new URL((await started.json()).url).searchParams.get('state');
  globalThis.__driveTest.deps = f.deps;
  // A rota usa o fetch global: o Google falso responde só a esta troca.
  const realFetch = globalThis.fetch; globalThis.fetch = f.google.fetcher; t.after(() => { globalThis.fetch = realFetch; });
  const back = await callbackRoute.GET(new Request(`https://portal.example.test/api/drive/oauth/callback?code=codigo-bom&state=${state}`, { headers: { cookie: setCookie.split(';')[0] } }));
  assert.equal(back.status, 303); assert.equal(back.headers.get('Location'), 'https://portal.example.test/?module=profile#google-drive');
  const cookies = back.headers.getSetCookie();
  assert.ok(cookies.some(value => value.startsWith('proex.gdrive.oauth=; ') && value.includes('Max-Age=0')));
  assert.ok(cookies.some(value => value.startsWith('proex.gdrive.result=connected;')));
  assert.equal((await connection.connectionView(f.db, a, f.deps)).status, 'connected');
  const replay = await callbackRoute.GET(new Request(`https://portal.example.test/api/drive/oauth/callback?code=codigo-bom&state=${state}`));
  assert.ok(replay.headers.getSetCookie().some(value => value.startsWith('proex.gdrive.result=drive_oauth_state;')), 'sem o cookie, a volta é recusada');
  assertNoTokens(JSON.stringify([...back.headers, ...replay.headers]), 'cabeçalhos');
});

test('configuração errada não apaga conexões: cliente inválido e segredo trocado viram erro de configuração', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a');
  await connect(f, admin);
  f.google.state.refreshGrant = 'bad_client';
  await assert.rejects(() => connection.accessTokenFor(f.db, 'adm', f.deps), e => e.code === 'drive_client_misconfigured' && e.status === 503);
  let row = f.native.prepare('SELECT status,token_ciphertext FROM google_drive_connections WHERE user_id=?').get('adm');
  assert.equal(row.status, 'active'); assert.ok(row.token_ciphertext, 'a permissão cifrada continua guardada');
  f.google.state.refreshGrant = 'ok';
  await assert.rejects(() => connection.accessTokenFor(f.db, 'adm', { ...f.deps, keys: { current: 'outro-segredo-do-cofre-sintetico-'.padEnd(48, 'z') } }), e => e.code === 'drive_vault_unavailable');
  row = f.native.prepare('SELECT status,token_ciphertext FROM google_drive_connections WHERE user_id=?').get('adm');
  assert.equal(row.status, 'active'); assert.ok(row.token_ciphertext, 'segredo trocado não apaga nada');
  assert.ok(await connection.accessTokenFor(f.db, 'adm', f.deps), 'com o segredo certo volta a funcionar');
});

test('compartilhamento: domínio inteiro é recusado; sem saber com quem está compartilhada, o cadastro é recusado', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a');
  await connect(f, admin);
  f.google.state.folders[FOLDER].permissions = [{ type: 'user', role: 'owner' }, { type: 'domain', role: 'reader' }];
  await assert.rejects(() => registerFolder(f, admin), e => e.code === 'drive_folder_public');
  f.google.state.folders[FOLDER].permissions = undefined; f.google.state.folders[FOLDER].permissionIds = undefined;
  await assert.rejects(() => registerFolder(f, admin), e => e.code === 'drive_folder_sharing_unknown');
  f.google.state.folders[FOLDER].permissions = [{ type: 'user', role: 'owner' }];
  assert.ok((await registerFolder(f, admin)).folder.id);
});

test('isolamento de projeto: arquivo de um projeto não vai para pasta de outro; termo de empréstimo só para o projeto ou só gestão', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a');
  await connect(f, admin);
  f.google.state.folders.pastaDoProjetoA2x1 = { name: 'A2', canAddChildren: true, permissionIds: [] };
  f.google.state.folders.pastaDaGestao0001 = { name: 'Gestão', canAddChildren: true, permissionIds: [] };
  const org = (await registerFolder(f, admin)).folder;
  const other = (await registerFolder(f, admin, { driveFolderId: 'pastaDoProjetoA2x1', name: 'Fotos do projeto A2', audience: 'project', projectId: 'p-a2' })).folder;
  const managers = (await registerFolder(f, admin, { driveFolderId: 'pastaDaGestao0001', name: 'Gestão', audience: 'managers' })).folder;
  const photo = { kind: 'record_attachment', id: 'att-1' };
  await assert.rejects(() => save.driveSavePrepare(f.db, admin, { source: photo, folderId: other.id }, f.deps), e => e.code === 'drive_folder_other_project');
  assert.ok((await save.driveSavePrepare(f.db, admin, { source: photo, folderId: org.id }, f.deps)).planToken);
  f.insert('items', { id: 'eq-1', project_id: 'p-a', name: 'Projetor', category: 'equipment', unit: 'un', created_at: f.now });
  f.insert('loans', { id: 'loan-1', project_id: 'p-a', item_id: 'eq-1', action_name: 'Evento', borrower_name: 'Pessoa sintética', starts_at: 1, ends_at: 2, status: 'returned', created_by: 'adm', created_at: f.now });
  f.insert('documents', { id: 'doc-1', loan_id: 'loan-1', project_id: 'p-a', object_key: 'documents/doc-1', name: 'termo.pdf', mime: 'application/pdf', size: 10, created_by: 'adm', created_at: f.now });
  const term = { kind: 'loan_document', id: 'doc-1' };
  await assert.rejects(() => save.driveSavePrepare(f.db, admin, { source: term, folderId: org.id }, f.deps), e => e.code === 'drive_folder_sensitive', 'termo com dados pessoais não vai para pasta de toda a organização');
  await folders.confirmFolder(f.db, admin, { folderId: managers.id, pickedId: 'pastaDaGestao0001' }, f.deps);
  assert.ok((await save.driveSavePrepare(f.db, admin, { source: term, folderId: managers.id }, f.deps)).planToken);
  const viewer = await f.user('vb', 'viewer', 'p-b', 'o-b');
  await assert.rejects(() => save.driveSaveOptions(f.db, viewer, { source: term }, f.deps), e => e.status === 404, 'sem acesso = não encontrado, igual a id inexistente');
  await assert.rejects(() => save.driveSaveOptions(f.db, viewer, { source: { kind: 'loan_document', id: 'nao-existe' } }, f.deps), e => e.status === 404);
  const sha256 = createHash('sha256').update(PNG).digest('hex');
  await assert.rejects(() => save.driveSaveOptions(f.db, viewer, { source: { kind: 'upload', name: 'x.png', mime: 'image/png', bytes: PNG.length, sha256, projectId: 'p-a' } }, f.deps), e => e.status === 404, 'projeto de que a pessoa não participa');
});

test('rota de envio: erros que pedem ação da pessoa trazem o endereço da tela certa', async t => {
  const f = fixture(t), admin = await f.user('adm', 'owner', null, 'o-a'), staff = await f.user('inv', 'inventory', 'p-a', 'o-a');
  await connect(f, admin); const { folder } = await registerFolder(f, admin);
  const saveRoute = await import(compile('app/api/drive/save/route.ts'));
  globalThis.__driveTest.user = { userId: 'inv', email: 'inv@example.invalid', displayName: 'Pessoa inv' };
  const response = await saveRoute.POST(new Request('https://portal.example.test/api/drive/save', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://portal.example.test', 'X-Proex-Action': '1' }, body: JSON.stringify({ action: 'prepare', source: { kind: 'record_attachment', id: 'att-1' }, folderId: folder.id, via: 'role' }) }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'Conecte sua conta Google em Conta › Google Drive antes de enviar.', code: 'drive_connect_required', href: '/?module=profile#google-drive' });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  void staff;
});

test('anonimizar a conta apaga a conexão com o Google e as confirmações de pasta', () => {
  const source = readFileSync(resolve(root, 'lib/privacy.ts'), 'utf8');
  assert.match(source, /DELETE FROM google_drive_folder_grants WHERE user_id=\?/);
  assert.match(source, /DELETE FROM google_drive_connections WHERE user_id=\?/);
});

async function mediaFixture(t) {
  const f = fixture(t);
  const manager = await f.user('gestao-a', 'manager', 'p-a', 'o-a');
  const otherManager = await f.user('gestao-a2', 'manager', 'p-a2', 'o-a');
  const externalManager = await f.user('gestao-b', 'manager', 'p-b', 'o-b');
  const owner = await f.user('dono-a', 'owner', null, 'o-a');
  const viewer = await f.user('leitura-a', 'viewer', 'p-a', 'o-a');
  const operator = await f.user('operacao-a', 'operator', 'p-a', 'o-a');
  const participant = await f.user('participante', null);
  for (const [id, project] of [['atividade-a', 'p-a'], ['sem-vinculo', 'p-a'], ['atividade-a2', 'p-a2'], ['atividade-b', 'p-b']]) {
    f.insert('project_schedule_items', { id, project_id: project, title: id, starts_at: f.now, ends_at: f.now, created_at: f.now, updated_at: f.now });
  }
  for (const [id, project, org, audience, status] of [
    ['privada-a', 'p-a', 'o-a', 'managers', 'active'],
    ['privada-a-reserva', 'p-a', 'o-a', 'managers', 'active'],
    ['privada-a2', 'p-a2', 'o-a', 'managers', 'active'],
    ['privada-b', 'p-b', 'o-b', 'managers', 'active'],
    ['gestao-organizacao', null, 'o-a', 'managers', 'active'],
    ['equipe-do-projeto', 'p-a', 'o-a', 'project', 'active'],
    ['arquivada-a', 'p-a', 'o-a', 'managers', 'archived'],
  ]) {
    f.insert('google_drive_folders', { id, name: id, drive_name: id, drive_folder_id: 'drive-sintetico-' + id, purpose: 'Teste de vídeos',
      project_id: project, organization_id: org, audience, status, created_by: owner.userId, updated_by: owner.userId, created_at: f.now, updated_at: f.now });
  }
  return { ...f, manager, otherManager, externalManager, owner, viewer, operator, participant };
}
const mediaContext = { projectId: 'p-a', scheduleItemId: 'atividade-a' };
const mediaWrite = { ...mediaContext, folderId: 'privada-a', expectedVersion: 0, operationKey: 'grava-pasta-a' };
const unavailableMedia = error => error.status === 404 && error.code === 'activity_media_unavailable';

test('vídeos: somente gestão do projeto encontra a atividade e seleciona pastas privadas do próprio projeto', async t => {
  const f = await mediaFixture(t);
  for (const actor of [f.manager, f.owner]) {
    const view = await activityMedia.activityMediaFolder(f.db, actor, mediaContext);
    assert.deepEqual(view, { ...mediaContext, viewerId: actor.userId, version: 0, selected: null, unavailable: false,
      folders: [{ id: 'privada-a', name: 'privada-a' }, { id: 'privada-a-reserva', name: 'privada-a-reserva' }], truncated: false });
    assert.doesNotMatch(JSON.stringify(view), /drive-sintetico|drive\.google\.com/);
  }
  for (const actor of [f.otherManager, f.externalManager, f.viewer, f.operator, f.participant]) {
    await assert.rejects(() => activityMedia.activityMediaFolder(f.db, actor, mediaContext), unavailableMedia);
    await assert.rejects(() => activityMedia.activityMediaFolderUrl(f.db, actor, mediaContext), unavailableMedia);
    await assert.rejects(() => activityMedia.saveActivityMediaFolder(f.db, actor, mediaWrite), unavailableMedia);
  }
  await assert.rejects(() => activityMedia.activityMediaFolder(f.db, f.owner, { ...mediaContext, scheduleItemId: 'atividade-a2' }), unavailableMedia);
  await assert.rejects(() => activityMedia.activityMediaFolderUrl(f.db, f.manager, mediaContext), unavailableMedia);
  for (const folderId of ['privada-a2', 'privada-b', 'gestao-organizacao', 'equipe-do-projeto', 'arquivada-a', 'inexistente']) {
    await assert.rejects(() => activityMedia.saveActivityMediaFolder(f.db, f.owner, { ...mediaWrite, folderId }), unavailableMedia);
  }
  assert.equal(count(f, 'schedule_item_media_folders'), 0);
  assert.equal(count(f, 'mutation_keys'), 0);
  assert.equal(count(f, 'audit', "action LIKE 'activity.media-folder.%'"), 0);
  const catalogue = await folders.usableFolders(f.db, f.otherManager);
  assert.deepEqual(catalogue.map(folder => folder.id).sort(), ['gestao-organizacao', 'privada-a2']);
  await assert.rejects(() => folders.usableFolder(f.db, f.otherManager, 'privada-a'), e => e.status === 404);
  assert.throws(() => f.insert('schedule_item_media_folders', { schedule_item_id: 'atividade-a', folder_id: 'privada-a2', version: 1, updated_at: f.now }), /activity_media_scope_mismatch/);
});

test('vídeos: gravação idempotente, alteração concorrente, remoção, histórico e atividades separadas', async t => {
  const f = await mediaFixture(t);
  const [saved, retried] = await Promise.all([f.manager, f.manager].map(actor => activityMedia.saveActivityMediaFolder(f.db, actor, mediaWrite)));
  assert.deepEqual(saved, retried);
  assert.equal(saved.version, 1);
  assert.equal(saved.selected.id, 'privada-a');
  assert.equal(await activityMedia.activityMediaFolderUrl(f.db, f.manager, mediaContext), 'https://drive.google.com/drive/folders/drive-sintetico-privada-a');
  assert.equal((await activityMedia.activityMediaFolder(f.db, f.manager, { ...mediaContext, scheduleItemId: 'sem-vinculo' })).selected, null);
  await assert.rejects(() => activityMedia.saveActivityMediaFolder(f.db, f.owner, { ...mediaWrite, folderId: 'privada-a-reserva', operationKey: 'alteracao-concorrente' }), e => e.status === 409 && e.code === 'activity_media_conflict');
  const removed = await activityMedia.saveActivityMediaFolder(f.db, f.manager, { ...mediaWrite, folderId: null, expectedVersion: 1, operationKey: 'remove-pasta-a' });
  assert.equal(removed.version, 2);
  assert.equal(removed.selected, null);
  await assert.rejects(() => activityMedia.activityMediaFolderUrl(f.db, f.manager, mediaContext), unavailableMedia);
  await assert.rejects(() => activityMedia.saveActivityMediaFolder(f.db, f.manager, { ...mediaWrite, expectedVersion: 0, operationKey: 'edicao-antiga-a' }), e => e.status === 409);
  const audit = f.native.prepare("SELECT action, entity_id, details FROM audit WHERE action LIKE 'activity.media-folder.%' ORDER BY rowid").all();
  assert.deepEqual(audit.map(row => ({ ...row })), [
    { action: 'activity.media-folder.link', entity_id: 'atividade-a', details: '{}' },
    { action: 'activity.media-folder.unlink', entity_id: 'atividade-a', details: '{}' },
  ]);
  assert.equal(count(f, 'mutation_keys'), 2);
  assert.equal(f.google.calls.length, 0, 'vínculo somente guarda uma referência');
});

test('vídeos: revogação durante a transação e mudança de escopo bloqueiam gravação e abertura', async t => {
  const f = await mediaFixture(t);
  f.db.beforeBatch = () => f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id=?").run(f.now, f.manager.userId);
  await assert.rejects(() => activityMedia.saveActivityMediaFolder(f.db, f.manager, mediaWrite), unavailableMedia);
  f.db.beforeBatch = () => f.native.prepare("UPDATE google_drive_folders SET status='archived' WHERE id='privada-a'").run();
  await assert.rejects(() => activityMedia.saveActivityMediaFolder(f.db, f.owner, mediaWrite), unavailableMedia);
  assert.equal(count(f, 'schedule_item_media_folders'), 0);
  assert.equal(count(f, 'mutation_keys'), 0);
  assert.equal(count(f, 'audit', "action LIKE 'activity.media-folder.%'"), 0);
  f.native.prepare("UPDATE google_drive_folders SET status='active' WHERE id='privada-a'").run();
  await activityMedia.saveActivityMediaFolder(f.db, f.owner, mediaWrite);
  const initial = await activityMedia.activityMediaFolder(f.db, f.owner, mediaContext);
  assert.equal(initial.selected.id, 'privada-a');
  f.native.prepare("UPDATE google_drive_folders SET project_id='p-a2' WHERE id='privada-a'").run();
  const moved = await activityMedia.activityMediaFolder(f.db, f.owner, mediaContext);
  assert.equal(moved.selected, null);
  assert.equal(moved.unavailable, true);
  assert.equal(moved.version, initial.version);
  assert.doesNotMatch(JSON.stringify(moved), /"privada-a"/);
  await assert.rejects(() => activityMedia.activityMediaFolderUrl(f.db, f.owner, mediaContext), unavailableMedia);
  await assert.rejects(() => activityMedia.activityMediaFolder(f.db, f.manager, mediaContext), unavailableMedia);
  await assert.rejects(() => activityMedia.activityMediaFolderUrl(f.db, f.manager, mediaContext), unavailableMedia);
  await assert.rejects(() => activityMedia.saveActivityMediaFolder(f.db, f.owner, { ...mediaWrite, expectedVersion: 1 }), e => e.status === 409 && e.code === 'operation_changed');
});

test('vídeos: resposta privada, redirecionamento canônico, CSRF e sessão revalidados nas rotas', async t => {
  const f = await mediaFixture(t);
  const endpoint = ENV.origin + '/api/records/activity-media';
  const url = endpoint + '?' + new URLSearchParams(mediaContext), open = url + '&view=open';
  assert.equal((await activityMediaRoute.GET(new Request(url))).status, 401);
  globalThis.__driveTest.user = f.manager;
  const crossSite = await activityMediaRoute.POST(new Request(endpoint, { method: 'POST',
    headers: { Origin: 'https://another.example.test', 'X-Proex-Action': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(mediaWrite) }));
  assert.equal(crossSite.status, 403);
  const write = input => activityMediaRoute.POST(new Request(endpoint, { method: 'POST',
    headers: { Origin: ENV.origin, 'X-Proex-Action': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
  assert.equal((await write({ ...mediaWrite, url: 'https://another.example.test' })).status, 400);
  assert.equal((await write(mediaWrite)).status, 200);
  const metadata = await activityMediaRoute.GET(new Request(url));
  assert.equal(metadata.status, 200);
  assert.equal(metadata.headers.get('Cache-Control'), 'private, no-store');
  assert.doesNotMatch(await metadata.text(), /drive-sintetico|drive\.google\.com/);
  const opened = await activityMediaRoute.GET(new Request(open));
  assert.equal(opened.status, 302);
  assert.equal(opened.headers.get('Location'), 'https://drive.google.com/drive/folders/drive-sintetico-privada-a');
  assert.equal(opened.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(opened.headers.get('Referrer-Policy'), 'no-referrer');
  globalThis.__driveTest.user = f.otherManager;
  const unrelated = await activityMediaRoute.GET(new Request(open));
  assert.equal(unrelated.status, 404);
  assert.equal(unrelated.headers.get('Location'), null);
  assert.doesNotMatch(await unrelated.text(), /privada-a|drive-sintetico/);
  globalThis.__driveTest.user = f.manager;
  f.native.prepare("UPDATE portal_users SET activation_pending=1 WHERE user_id=?").run(f.manager.userId);
  assert.equal((await activityMediaRoute.GET(new Request(open))).status, 404);
  assert.equal(f.google.calls.length, 0);
});
