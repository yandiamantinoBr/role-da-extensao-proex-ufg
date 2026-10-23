// Run after a production build. This is separate from *.test.mjs because a
// clean checkout does not contain dist/. All writes use disposable local D1/R2.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const server = path.join(project, 'dist/server');
if (!fs.existsSync(path.join(server, 'wrangler.json'))) throw new Error('Run pnpm build before the Worker authentication smoke test.');
const wrangler = fs.realpathSync(path.join(project, 'node_modules/wrangler'));
const require = createRequire(path.join(wrangler, 'package.json'));
const { Miniflare, Log, LogLevel } = await import(pathToFileURL(require.resolve('miniflare')).href);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'proex-auth-worker-'));
const origin = 'https://worker-auth.example.test';
const config = JSON.parse(fs.readFileSync(path.join(server, 'wrangler.json'), 'utf8'));
// Vinext has computed dynamic imports; explicitly register its compiled chunks.
const chunks = fs.readdirSync(server, { recursive: true }).filter(file => file.endsWith('.js')).map(file => path.join(server, file));
const entry = path.join(server, 'index.js');
const modules = [entry, ...chunks.filter(file => file !== entry)].map(file => ({ type: 'ESModule', path: file }));
let worker;

try {
  worker = new Miniflare({
    cf: false, name: 'proex-auth-worker-smoke', modules, modulesRoot: server,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    d1Databases: { DB: 'qa-auth-db' }, d1Persist: path.join(temporary, 'd1'),
    r2Buckets: { BUCKET: 'qa-auth-bucket' }, r2Persist: path.join(temporary, 'r2'),
    assets: {
      directory: path.join(project, 'dist/client'), binding: 'ASSETS',
      routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true },
    },
    bindings: { BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: crypto.randomBytes(32).toString('base64url') },
    log: new Log(LogLevel.WARN),
  });
  const db = await worker.getD1Database('DB');
  const migrations = path.join(project, 'drizzle');
  for (const file of fs.readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    const statements = fs.readFileSync(path.join(migrations, file), 'utf8').split('--> statement-breakpoint').filter(sql => sql.trim());
    for (const sql of statements) await db.prepare(sql).run();
  }

  // Only a synthetic issuer and invitation are seeded. The Worker itself creates
  // the auth user, hashes its password, grants its membership and issues cookies.
  const tag = crypto.randomBytes(6).toString('hex');
  const owner = `qa_owner_${tag}`, invite = `qa_invite_${tag}`;
  const email = `qa-${tag}@example.test`, ownerEmail = `owner-${tag}@example.test`;
  const password = crypto.randomBytes(20).toString('base64url');
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at) VALUES(?,?,'active',0,?,?)")
      .bind(owner, ownerEmail, now, now),
    db.prepare("INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,'owner',NULL,?)")
      .bind(crypto.randomUUID(), owner, ownerEmail, now),
    db.prepare("INSERT INTO invites(id,token_hash,email,role,project_id,created_by,expires_at,created_at) VALUES(?,?,?,'viewer',NULL,?,?,?)")
      .bind(invite, crypto.createHash('sha256').update(token).digest('hex'), email, owner, new Date(Date.now() + 86_400_000).toISOString(), now),
  ]);
  function cookieOf(response) {
    const values = response.headers.getSetCookie();
    assert.ok(values.length, 'Set-Cookie must reach the caller');
    return values.map(value => value.split(';')[0]).join('; ');
  }
  async function post(input, cookie) {
    return worker.dispatchFetch(`${origin}/api/account`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Proex-Action': '1', 'cf-connecting-ip': '192.0.2.44', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(input),
    });
  }
  const started = Date.now();
  const activated = await post({ action: 'activateInvite', token, name: 'Pessoa QA isolada', password });
  if (activated.status !== 200) {
    const body = await activated.json().catch(() => ({}));
    throw new Error(`Worker activation failed: ${JSON.stringify({ status: activated.status, code: body.code, error: body.error || body.message })}`);
  }
  const firstCookie = cookieOf(activated);
  assert.match(activated.headers.getSetCookie().join(';'), /Secure/);
  assert.match(activated.headers.getSetCookie().join(';'), /HttpOnly/);
  const created = await db.prepare('SELECT a.id,c.password FROM auth_user a JOIN auth_account c ON c.user_id=a.id WHERE a.email=?').bind(email).first();
  assert.match(created.password, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  console.log(JSON.stringify({ step: 'Worker generated scrypt hash and Secure HttpOnly session', status: activated.status, durationMs: Date.now() - started }));

  const account = await worker.dispatchFetch(`${origin}/api/account`, { headers: { Cookie: firstCookie } });
  const canonical = (await account.json()).user;
  assert.equal(canonical.source, 'password');
  assert.equal(canonical.hasPassword, true);
  assert.notEqual(canonical.userId, created.id);
  const portal = await worker.dispatchFetch(`${origin}/api/portal`, { headers: { Cookie: firstCookie } });
  assert.equal(portal.status, 200);
  const logout = await post({ action: 'logout' }, firstCookie);
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.getSetCookie().length);

  const login = await post({ action: 'login', email, password });
  assert.equal(login.status, 200);
  const secondCookie = cookieOf(login);
  const invalid = await post({ action: 'login', email, password: 'Senha incorreta de QA 2026!' });
  assert.equal(invalid.status, 401);
  const username=`qa.${tag}`,syntheticCpf='52998224725';
  const wrongProof=await post({action:'identifiers.update',kind:'username',value:username,acknowledged:true,currentPassword:'Senha incorreta de QA 2026!'},secondCookie);
  assert.equal(wrongProof.status,400);
  for(const [kind,value]of [['username',username],['cpf',syntheticCpf]]){
    const saved=await post({action:'identifiers.update',kind,value,acknowledged:true,currentPassword:password},secondCookie);
    assert.equal(saved.status,200,`Worker must verify the current password before storing ${kind}`);
    assert.equal((await post({action:'login',identifier:value,password})).status,200);
  }
  const settings=await worker.dispatchFetch(`${origin}/api/account?action=identifiers`,{headers:{Cookie:secondCookie}});
  assert.equal(settings.status,200);const identifiers=await settings.json();
  assert.equal(identifiers.username,username);assert.equal(identifiers.cpfConfigured,true);
  assert.equal(JSON.stringify(identifiers).includes(syntheticCpf),false);
  const cpfStored=await db.prepare("SELECT lookup_hash,display_hint FROM login_identifiers WHERE user_id=? AND kind='cpf'").bind(canonical.userId).first();
  assert.match(cpfStored.lookup_hash,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(cpfStored).includes(syntheticCpf),false);
  console.log('PASS compiled Worker: optional username and CPF resolve the same password account, require current-password proof and retain only a keyed CPF digest.');
  const changed = await post({ action: 'changePassword', currentPassword: password, newPassword: crypto.randomBytes(20).toString('base64url') }, secondCookie);
  assert.equal(changed.status, 200);
  const thirdCookie = cookieOf(changed);
  assert.notEqual(thirdCookie, secondCookie);
  const oldSession = await worker.dispatchFetch(`${origin}/api/account`, { headers: { Cookie: secondCookie } });
  assert.equal((await oldSession.json()).user, null);
  const newSession = await worker.dispatchFetch(`${origin}/api/account`, { headers: { Cookie: thirdCookie } });
  assert.equal((await newSession.json()).user.userId, canonical.userId);
  console.log('PASS compiled Worker: canonical identity, portal API, logout, password verification, rejected credentials, cookie rotation and immediate session revocation.');

  // Only this disposable Miniflare fixture supplies synthetic native headers.
  // Production callers must use the authenticated Site plugin, never forged headers.
  async function mcp(method,params={},asOwner=false){
    const response=await worker.dispatchFetch(`${origin}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',...(asOwner?{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':ownerEmail}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    assert.equal(response.status,200);return (await response.json()).result;
  }
  const discovery=await mcp('server/discover');assert.ok(discovery.supportedVersions.includes('2026-07-28'));
  const listing=await mcp('tools/list');assert.ok(listing.tools.some(tool=>tool.name==='proex_sync_apply'));
  assert.equal((await mcp('tools/call',{name:'proex_sync_describe',arguments:{}})).isError,true);
  const configuration=await mcp('tools/call',{name:'proex_sync_configure',arguments:{spreadsheetId:'qa_sheet_123456',folderId:'qa_folder_123456',attachmentsFolderId:'qa_attachments_123456'}},true);
  assert.notEqual(configuration.isError,true);
  const seeded=await mcp('tools/call',{name:'proex_catalog_seed',arguments:{}},true);assert.notEqual(seeded.isError,true,JSON.stringify(seeded));
  const exported=await mcp('tools/call',{name:'proex_sync_read',arguments:{table:'projects'}},true);
  assert.notEqual(exported.isError,true);const page=JSON.parse(exported.content[0].text);assert.equal(page.rows.length,10);
  const original=page.rows[0];
  const applied=await mcp('tools/call',{name:'proex_sync_apply',arguments:{changes:[{changeKey:'worker-roundtrip-0001',table:'projects',id:original.id,expectedVersion:original.version,fields:{description:'Atualização QA isolada'}}]}},true);
  assert.equal(JSON.parse(applied.content[0].text).results[0].status,'applied');
  assert.equal((await db.prepare('SELECT description FROM projects WHERE id=?').bind(original.id).first()).description,'Atualização QA isolada');
  await db.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').bind(now,owner).run();
  assert.equal((await mcp('tools/call',{name:'proex_sync_describe',arguments:{}},true)).isError,true);
  console.log('PASS compiled Worker MCP: discovery, owner authorization, catalog seed, portable roundtrip, private configuration and immediate owner revocation.');
} finally {
  try { if (worker) await worker.dispose(); }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
