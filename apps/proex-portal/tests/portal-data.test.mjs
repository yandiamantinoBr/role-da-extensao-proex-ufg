import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Compile the actual read/projection and authorization modules, then execute their SQL against
// the complete migration set. Only native request identity and the Cloudflare binding are replaced
// at the transport boundary. These synthetic, in-memory fixtures never reach production.
const temporary = mkdtempSync(join(tmpdir(), 'proex-portal-data-'));
writeFileSync(join(temporary, 'package.json'), '{"type":"module"}');
for (const name of ['access', 'database', 'errors', 'portal-data', 'users', 'mutations']) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${path}.js'`);
  writeFileSync(join(temporary, `${name}.js`), output);
}
writeFileSync(join(temporary, 'native-auth.js'), 'export async function getChatGPTUser(){return globalThis.__proexReportTestUser ?? null;}');
writeFileSync(join(temporary, 'session.js'), 'export async function getPortalUser(){return globalThis.__proexReportTestUser ?? null;}');
writeFileSync(join(temporary, 'platform.js'), 'export function database(){return globalThis.__proexReportTestDatabase;} export function ownerEmail(){return undefined;}');
const routeSource = readFileSync(new URL('../app/api/export/route.ts', import.meta.url), 'utf8');
const routeOutput = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('@/app/chatgpt-auth', './native-auth.js').replace(/@\/lib\/([A-Za-z-]+)/g, './$1.js');
writeFileSync(join(temporary, 'export-route.js'), routeOutput);
after(() => {
  rmSync(temporary, { recursive: true, force: true });
  delete globalThis.__proexReportTestUser;
  delete globalThis.__proexReportTestDatabase;
});
const { portalSnapshot } = await import(pathToFileURL(join(temporary, 'portal-data.js')).href);
const { getActor } = await import(pathToFileURL(join(temporary, 'access.js')).href);
const { GET } = await import(pathToFileURL(join(temporary, 'export-route.js')).href);
const timestamp = '2026-10-20T02:30:00.000Z'; // 19 October in Brasília.

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  }
  function prepare(sql, parameters = []) {
    return {
      bind(...values) { return prepare(sql, values); },
      async first() { return sqlite.prepare(sql).get(...parameters) ?? null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...parameters) }; },
      async run() { return this.execute(); },
      execute() {
        const result = sqlite.prepare(sql).run(...parameters);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      },
    };
  }
  const db = {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  function insert(table, row) {
    const columns = Object.keys(row);
    sqlite.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
      .run(...Object.values(row));
  }
  function member(role, project = 'project-a') {
    const user = { userId: `user-${role}`, email: `${role}@example.test`, displayName: `Fixture ${role}` };
    insert('portal_users', { user_id: user.userId, email: user.email, status: 'active', created_at: timestamp, updated_at: timestamp });
    insert('profiles', { user_id: user.userId, display_name: user.displayName, created_at: timestamp, updated_at: timestamp });
    insert('members', {
      id: `member-${role}`, user_id: user.userId, email: user.email, role,
      project_id: role === 'owner' ? null : project, revoked_at: null, created_at: timestamp,
    });
    return user;
  }
  function participation(project, suffix, { identity = 'ticket', modality = 'physical', results = ['brinde'], prize = null, createdAt = timestamp } = {}) {
    const id = `participation-${suffix}`;
    insert('participations', {
      id, campaign_id: `campaign-${project}`, identity_id: `PRIVATE IDENTITY ${suffix}`,
      identity_method: identity, modality, state: 'ready', created_at: createdAt,
    });
    let attemptId;
    for (let index = 0; index < results.length; index++) {
      attemptId = `attempt-${suffix}-${index + 1}`;
      insert('attempts', {
        id: attemptId, participation_id: id, number: index + 1,
        idempotency_key: `PRIVATE OPERATION ${suffix}-${index}`, result: results[index],
        state: results[index] === 'pending' ? 'pending' : 'done', created_at: createdAt,
      });
    }
    if (prize) insert('entitlements', {
      id: `entitlement-${suffix}`, attempt_id: attemptId, participation_id: id,
      offer_id: `offer-${project}`, state: prize, created_at: createdAt,
      delivered_at: prize === 'delivered' ? createdAt : null,
    });
    return id;
  }
  for (const project of ['a', 'b']) {
    insert('projects', { id: `project-${project}`, name: project === 'a' ? 'Projeto A' : 'SECRET PROJECT B', created_at: timestamp });
    insert('items', {
      id: `gift-${project}`, project_id: `project-${project}`, name: project === 'a' ? '=Button A' : 'SECRET ITEM B',
      category: 'gift', unit: 'unidade', stock: 1000, created_at: timestamp,
    });
    insert('items', {
      id: `equipment-${project}`, project_id: `project-${project}`, name: `Equipamento ${project}`,
      category: 'equipment', unit: 'unidade', stock: 1, created_at: timestamp,
    });
    insert('offers', { id: `offer-${project}`, project_id: `project-${project}`, name: `Oferta ${project}`, kind: 'brinde' });
    insert('offer_components', { offer_id: `offer-${project}`, item_id: `gift-${project}`, quantity: 3 });
    insert('campaigns', {
      id: `campaign-${project}`, project_id: `project-${project}`, name: `Campanha ${project}`,
      starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 86400000).toISOString(),
      status: 'active', retry_limit: 3, created_at: timestamp,
    });
    insert('loans', {
      id: `loan-${project}`, project_id: `project-${project}`, item_id: `equipment-${project}`,
      action_name: `Ação ${project}`, borrower_name: `PRIVATE BORROWER ${project}`,
      borrower_contact: `private-${project}@example.test`, note: 'PRIVATE LOAN NOTE',
      starts_at: Date.parse(timestamp), ends_at: Date.parse(timestamp) + 3600000,
      created_by: 'PRIVATE ACTOR', created_at: timestamp,
    });
    insert('documents', {
      id: `document-${project}`, project_id: `project-${project}`, loan_id: `loan-${project}`,
      object_key: `PRIVATE STORAGE KEY ${project}`, name: 'Termo.pdf', mime: 'application/pdf',
      size: 22, created_by: 'PRIVATE ACTOR', created_at: timestamp,
    });
    insert('invites', {
      id: `invite-${project}`, project_id: `project-${project}`, token_hash: `PRIVATE TOKEN HASH ${project}`,
      email: `invited-${project}@example.test`, role: 'operator', created_by: 'PRIVATE ACTOR',
      expires_at: new Date(Date.now() + 86400000).toISOString(), created_at: timestamp,
    });
    insert('audit', {
      id: `audit-${project}`, project_id: `project-${project}`, actor_id: 'PRIVATE ACTOR',
      action: 'loan.create', entity_id: `private-${project}@example.test`,
      details: 'PRIVATE AUDIT DETAILS', created_at: timestamp,
    });
    insert('visits', { campaign_id: `campaign-${project}`, day: '2026-10-19', hits: project === 'a' ? 7 : 99 });
  }
  insert('settings', { name: 'privacyNotice', value: 'Aviso institucional', updated_at: timestamp });
  insert('settings', { name: 'instagramUrl', value: 'https://www.instagram.com/example/', updated_at: timestamp });
  insert('settings', { name: 'INTERNAL_SECRET', value: 'PRIVATE INTERNAL SETTING', updated_at: timestamp });
  return { sqlite, db, insert, member, participation };
}

async function snapshot(f, role, project) {
  return portalSnapshot(f.db, await getActor(f.db, f.member(role, project)));
}
function observeExport(f, user) {
  globalThis.__proexReportTestDatabase = f.db;
  globalThis.__proexReportTestUser = user;
}

test('snapshot scopes and redacts personal fields, hashes, object keys and activity details', async t => {
  const f = fixture(t);
  const viewer = await snapshot(f, 'viewer');
  assert.deepEqual(viewer.projects.map(project => project.id), ['project-a']);
  assert.equal(viewer.loans.length, 1);
  assert.ok(!('borrower_contact' in viewer.loans[0]));
  assert.ok(!('borrower_name' in viewer.loans[0]));
  assert.equal(viewer.members.length, 0);
  assert.equal(viewer.invites.length, 0);
  assert.equal(viewer.documents.length, 0);
  assert.ok(!('details' in viewer.audit[0]));
  assert.ok(!('actor_id' in viewer.audit[0]));
  assert.ok(!('entity_id' in viewer.audit[0]));
  assert.ok(!/PRIVATE|SECRET PROJECT B|SECRET ITEM B/.test(JSON.stringify(viewer)));

  const manager = await snapshot(f, 'manager');
  assert.ok(manager.members.length > 0);
  assert.equal(manager.invites[0].email, 'invited-a@example.test');
  assert.equal(manager.loans[0].borrower_contact, 'private-a@example.test');
  assert.equal(manager.documents.length, 1);
  assert.equal(manager.offers[0].components[0].quantity, 3);
  assert.ok(!/PRIVATE TOKEN HASH|PRIVATE STORAGE KEY|PRIVATE AUDIT DETAILS|SECRET PROJECT B/.test(JSON.stringify(manager)));

  const borrowerTeam = await snapshot(f, 'loans');
  assert.equal(borrowerTeam.items.length, 1);
  assert.equal(borrowerTeam.items[0].category, 'equipment');
  assert.equal(borrowerTeam.loans[0].borrower_contact, 'private-a@example.test');
  const inventory = await snapshot(f, 'inventory');
  assert.equal(inventory.metrics.available, false);
  assert.equal(inventory.metrics.participations, null);
  assert.equal(inventory.loans.length, 0);
  await assert.rejects(() => portalSnapshot(f.db, null), error => error.status === 401);
});

test('snapshot exposes editable V3 project, item and loan fields without widening scope', async t => {
  const f = fixture(t);
  f.sqlite.prepare(`UPDATE projects SET short_name='Rolê',status='archived',color='#ffaa3d',
    official_url='https://proex.ufg.br/',starts_at=?,ends_at=?,location='Campus Samambaia',version=4 WHERE id='project-a'`)
    .run(timestamp, '2026-12-20T02:30:00.000Z');
  f.sqlite.prepare("UPDATE items SET asset_code='UFG-001',version=3,updated_at=? WHERE id='equipment-a'").run(timestamp);
  f.sqlite.prepare('UPDATE loans SET checked_out_at=?,updated_at=? WHERE id=?').run(timestamp, timestamp, 'loan-a');
  const data = await snapshot(f, 'manager');
  assert.deepEqual({ ...data.projects[0] }, {
    id: 'project-a', name: 'Projeto A', description: '', created_at: timestamp,
    short_name: 'Rolê', status: 'archived', color: '#ffaa3d', official_url: 'https://proex.ufg.br/',
    starts_at: timestamp, ends_at: '2026-12-20T02:30:00.000Z', location: 'Campus Samambaia', version: 4,
    lifecycle: 'active', type_id: null, parent_id: null,
  });
  const equipment = data.items.find(item => item.id === 'equipment-a');
  assert.equal(equipment.asset_code, 'UFG-001'); assert.equal(equipment.version, 3); assert.equal(equipment.updated_at, timestamp);
  assert.equal(data.loans[0].checked_out_at, timestamp); assert.equal(data.loans[0].updated_at, timestamp);
  assert.ok(data.items.every(item => item.project_id === 'project-a'));
});

test('capabilities remain separate between global access and each project even with mixed roles', async t => {
  const f = fixture(t), user = f.member('viewer', 'project-b');
  f.insert('members', { id: 'inventory-project-a', user_id: user.userId, email: user.email,
    role: 'inventory', project_id: 'project-a', revoked_at: null, created_at: timestamp });
  const actor = await getActor(f.db, user);
  actor.capabilities.push('*', 'organization.manage');
  const data = await portalSnapshot(f.db, actor);
  assert.deepEqual(data.globalCapabilities, []);
  assert.deepEqual(data.capabilitiesByProject['project-a'].sort(), ['inventory.manage', 'inventory.read']);
  assert.deepEqual(data.capabilitiesByProject['project-b'], ['reports.read']);
  assert.ok(!data.capabilities.includes('*')); assert.ok(!data.capabilities.includes('organization.manage'));
  const ownerData = await snapshot(f, 'owner');
  assert.ok(ownerData.globalCapabilities.includes('organization.manage'));
  assert.ok(ownerData.capabilitiesByProject['project-a'].includes('inventory.manage'));
  assert.ok(ownerData.capabilitiesByProject['project-b'].includes('inventory.manage'));
});

test('an overdue out equipment stays unavailable without disclosing its borrower to inventory staff', async t => {
  const f = fixture(t), now = Date.now();
  f.insert('items', { id: 'overdue-equipment', project_id: 'project-a', name: 'Projetor em atraso', category: 'equipment',
    unit: 'unidade', stock: 1, created_at: timestamp });
  f.insert('loans', { id: 'overdue-loan', project_id: 'project-a', item_id: 'overdue-equipment', action_name: 'Ação anterior',
    borrower_name: 'PRIVATE OVERDUE BORROWER', borrower_contact: 'private-borrower@example.test', note: 'PRIVATE OVERDUE NOTE',
    starts_at: now - 7200000, ends_at: now - 3600000, status: 'out', created_by: 'PRIVATE ACTOR', created_at: timestamp,
    checked_out_at: timestamp, updated_at: timestamp });
  const user = f.member('inventory'), actor = await getActor(f.db, user);
  const first = await portalSnapshot(f.db, actor), equipment = first.items.find(item => item.id === 'overdue-equipment');
  assert.equal(equipment.stock, 1); assert.equal(equipment.reserved, 0);
  assert.equal(equipment.on_loan, true); assert.equal(equipment.available, 0); assert.equal(equipment.reserved_now, false);
  assert.equal(first.loans.length, 0); assert.ok(!/PRIVATE|borrower/.test(JSON.stringify(first)));
  f.sqlite.prepare("UPDATE loans SET status='returned',returned_at=? WHERE id='overdue-loan'").run(new Date().toISOString());
  const returned = (await portalSnapshot(f.db, actor)).items.find(item => item.id === 'overdue-equipment');
  assert.equal(returned.on_loan, false); assert.equal(returned.available, 1);
});

test('availability accounts for present reservations, future reservations and inactive condition separately', async t => {
  const f = fixture(t), now = Date.now();
  for (const [id, start, end] of [['current', now - 60000, now + 60000], ['future', now + 3600000, now + 7200000]]) {
    f.insert('items', { id, project_id: 'project-a', name: id, category: 'equipment', unit: 'unidade', stock: 1, created_at: timestamp });
    f.insert('loans', { id: `loan-${id}`, project_id: 'project-a', item_id: id, action_name: 'Reserva', borrower_name: 'PRIVATE BORROWER',
      starts_at: start, ends_at: end, created_by: 'PRIVATE ACTOR', created_at: timestamp });
  }
  f.sqlite.prepare("UPDATE items SET condition='maintenance' WHERE id='equipment-a'").run();
  const data = await snapshot(f, 'inventory');
  const current = data.items.find(item => item.id === 'current'), future = data.items.find(item => item.id === 'future');
  assert.equal(current.available, 0); assert.equal(current.reserved_now, true);
  assert.equal(future.available, 1); assert.equal(future.reserved_now, false);
  assert.equal(data.items.find(item => item.id === 'equipment-a').available, 0);
  observeExport(f, f.member('viewer'));
  const response = await GET(new Request('https://portal.example.test/api/export?kind=stock'));
  assert.equal(response.status, 200);
  const csvLines = (await response.text()).split('\n');
  assert.match(csvLines.find(line => line.includes('"current"')), /"0";"active"\r?$/);
  assert.match(csvLines.find(line => line.includes('"future"')), /"1";"active"\r?$/);
});

test('snapshot presents the current own profile and protected avatar URL without exposing storage or password data', async t => {
  const f = fixture(t), user = f.member('viewer'), ms = Date.now();
  f.sqlite.prepare("UPDATE profiles SET display_name='Nome atualizado',avatar_key='PRIVATE AVATAR KEY',mime='image/png',version=7 WHERE user_id=?").run(user.userId);
  f.insert('auth_user', { id: 'PRIVATE PROVIDER SUBJECT', name: 'Provider name', email: 'credential@example.test', created_at: ms, updated_at: ms });
  f.insert('auth_account', { id: 'credential-id', account_id: 'credential-id', provider_id: 'credential', user_id: 'PRIVATE PROVIDER SUBJECT',
    password: 'PRIVATE PASSWORD HASH', created_at: ms, updated_at: ms });
  f.insert('identity_aliases', { provider: 'password', subject: 'PRIVATE PROVIDER SUBJECT', user_id: user.userId, created_at: timestamp });
  const actor = await getActor(f.db, user), data = await portalSnapshot(f.db, actor);
  assert.equal(data.user.displayName, 'Nome atualizado'); assert.equal(data.profile.displayName, 'Nome atualizado');
  assert.equal(data.user.email, user.email); assert.equal(data.user.avatarUrl, `/api/profile/avatar/${user.userId}?v=7`);
  assert.equal(data.profile.version, 7); assert.equal(data.hasPassword, true); assert.equal(data.user.hasPassword, true);
  assert.ok(!/PRIVATE AVATAR|PRIVATE PASSWORD|PRIVATE PROVIDER/.test(JSON.stringify(data)));
  f.sqlite.prepare('UPDATE auth_account SET password=NULL WHERE id=?').run('credential-id');
  assert.equal((await portalSnapshot(f.db, actor)).hasPassword, false);
});

test('owner materializes only trusted membership identities without email merges, aliases or new grants', async t => {
  const f = fixture(t), user = f.member('owner');
  for (const [id, revoked] of [['legacy-one', null], ['legacy-two', timestamp]]) {
    f.insert('members', { id: `member-${id}`, user_id: id, email: 'same@example.test', role: 'viewer',
      project_id: 'project-a', revoked_at: revoked, created_at: timestamp });
  }
  f.insert('members', { id: 'invalid-member', user_id: 'invalid / id', email: 'invalid@example.test', role: 'viewer',
    project_id: 'project-a', revoked_at: null, created_at: timestamp });
  f.insert('participations', { id: 'participant-no-membership', campaign_id: 'campaign-a', identity_id: 'participant-only',
    identity_method: 'account', modality: 'dice', state: 'ready', created_at: timestamp });
  const blocked = f.member('operator');
  f.sqlite.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(blocked.userId);
  f.sqlite.prepare("UPDATE profiles SET display_name='Nome preservado',avatar_key='PRIVATE KEY',mime='image/png',version=8 WHERE user_id=?").run(blocked.userId);
  const beforeMembers = f.sqlite.prepare('SELECT * FROM members ORDER BY id').all();
  const actor = await getActor(f.db, user), first = await portalSnapshot(f.db, actor);
  assert.equal(first.users.filter(account => account.email === 'same@example.test').length, 2);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM identity_aliases').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT user_id FROM portal_users WHERE user_id=?').get('participant-only'), undefined);
  assert.equal(f.sqlite.prepare('SELECT user_id FROM portal_users WHERE user_id=?').get('invalid / id'), undefined);
  assert.equal(f.sqlite.prepare('SELECT status FROM portal_users WHERE user_id=?').get(blocked.userId).status, 'blocked');
  assert.equal(f.sqlite.prepare('SELECT display_name,version FROM profiles WHERE user_id=?').get(blocked.userId).display_name, 'Nome preservado');
  assert.equal(f.sqlite.prepare('SELECT version FROM profiles WHERE user_id=?').get(blocked.userId).version, 8);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM members ORDER BY id').all(), beforeMembers);
  const accounts = f.sqlite.prepare('SELECT COUNT(*) n FROM portal_users').get().n;
  await portalSnapshot(f.db, actor);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM portal_users').get().n, accounts);
});

test('project managers do not materialize legacy identities or see another project through the directory', async t => {
  const f = fixture(t), user = f.member('manager');
  f.insert('members', { id: 'member-other-legacy', user_id: 'other-legacy', email: 'private-other@example.test', role: 'operator',
    project_id: 'project-b', revoked_at: null, created_at: timestamp });
  const data = await portalSnapshot(f.db, await getActor(f.db, user));
  assert.equal(f.sqlite.prepare('SELECT user_id FROM portal_users WHERE user_id=?').get('other-legacy'), undefined);
  assert.deepEqual(data.users.map(account => account.userId), [user.userId]);
  assert.ok(!JSON.stringify(data).includes('private-other@example.test'));
});

test('blocked and activation-pending stale actors cannot read the snapshot or materialize metadata', async t => {
  const f = fixture(t), user = f.member('owner'), actor = await getActor(f.db, user);
  f.insert('members', { id: 'member-legacy', user_id: 'legacy-user', email: 'legacy@example.test', role: 'viewer',
    project_id: 'project-a', revoked_at: null, created_at: timestamp });
  f.sqlite.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(user.userId);
  await assert.rejects(portalSnapshot(f.db, actor), error => error.status === 403 && error.code === 'account_inactive');
  f.sqlite.prepare("UPDATE portal_users SET status='active',activation_pending=1 WHERE user_id=?").run(user.userId);
  await assert.rejects(portalSnapshot(f.db, actor), error => error.status === 403 && error.code === 'account_inactive');
  assert.equal(f.sqlite.prepare('SELECT user_id FROM portal_users WHERE user_id=?').get('legacy-user'), undefined);
});

test('metrics separate participation, attempts, redemptions and units and reconcile by project/day', async t => {
  const f = fixture(t);
  f.participation('a', 'a', { results: ['retry', 'brinde'], prize: 'delivered' });
  f.participation('b', 'b', { identity: 'account', modality: 'wheel', results: ['super'], prize: 'delivered' });
  for (const project of ['a', 'b']) f.insert('stock_movements', {
    id: `redemption-${project}`, item_id: `gift-${project}`, delta: project === 'a' ? -3 : -5,
    kind: 'redeem', note: 'PRIVATE MOVEMENT NOTE', actor_id: 'PRIVATE ACTOR', created_at: timestamp,
  });
  const viewer = await snapshot(f, 'viewer');
  assert.deepEqual([
    viewer.metrics.participations, viewer.metrics.attempts, viewer.metrics.deliveries,
    viewer.metrics.unitsDelivered, viewer.metrics.tickets, viewer.metrics.visits,
  ], [1, 2, 1, 3, 1, 7]);
  assert.equal(viewer.metrics.byProject.length, 1);
  assert.equal(viewer.metrics.byProject[0].unitsDelivered, 3);
  assert.equal(viewer.metrics.daily.length, 1);
  assert.deepEqual([
    viewer.metrics.daily[0].day, viewer.metrics.daily[0].participations,
    viewer.metrics.daily[0].attempts, viewer.metrics.daily[0].deliveries,
  ], ['2026-10-19', 1, 2, 1]);
  const owner = await snapshot(f, 'owner');
  assert.equal(owner.projects.length, 2);
  assert.equal(owner.metrics.visits, 106);
  assert.equal(owner.metrics.unitsDelivered, 8);
  assert.equal(owner.metrics.byProject.length, 2);
  assert.ok(!('uniquePeople' in owner.metrics));
});

test('physical queue restores pending and retry sessions for both account and ticket with latest attempt', async t => {
  const f = fixture(t);
  f.participation('a', 'ticket-pending', { results: ['retry', 'pending'] });
  f.participation('a', 'account-retry', { identity: 'account', results: ['retry'] });
  f.participation('a', 'complete', { results: ['miss'] });
  f.participation('a', 'digital-retry', { identity: 'account', modality: 'wheel', results: ['retry'] });
  f.participation('b', 'other-pending', { results: ['pending'] });
  const operator = await snapshot(f, 'operator');
  assert.equal(operator.physicalTickets.length, 2);
  assert.deepEqual(new Set(operator.physicalTickets.map(row => row.identity_method)), new Set(['ticket', 'account']));
  assert.equal(operator.physicalTickets.find(row => row.identity_method === 'ticket').attempt_id, 'attempt-ticket-pending-2');
  assert.ok(operator.physicalTickets.every(row => row.project_id === 'project-a' && !('identity_id' in row)));
  assert.ok(!JSON.stringify(operator.physicalTickets).includes('PRIVATE'));
  assert.equal((await snapshot(f, 'viewer')).physicalTickets.length, 0);
});

test('pending prize recovery is deliverer-only, oldest first, with explicit count and 200-row truncation', async t => {
  const f = fixture(t);
  for (let index = 0; index < 202; index++) f.participation('a', `prize-${String(index).padStart(3, '0')}`, {
    identity: index % 2 ? 'account' : 'ticket', results: ['brinde'],
    prize: index === 201 ? 'delivered' : 'reserved',
    createdAt: new Date(Date.parse(timestamp) + index * 1000).toISOString(),
  });
  f.participation('b', 'other-prize', { results: ['brinde'], prize: 'reserved' });
  const operator = await snapshot(f, 'operator');
  assert.equal(operator.pendingPrizes.length, 200);
  assert.equal(operator.pendingPrizesTotal, 201);
  assert.equal(operator.pendingPrizesTruncated, true);
  assert.equal(operator.pendingPrizesLimit, 200);
  assert.equal(operator.pendingPrizes[0].id, 'entitlement-prize-000');
  assert.equal(operator.pendingPrizes.at(-1).id, 'entitlement-prize-199');
  assert.ok(operator.pendingPrizes.every(row => row.entitlement_id === row.id && row.project_id === 'project-a'));
  assert.ok(!/PRIVATE|identity|contact/.test(JSON.stringify(operator.pendingPrizes)));
  const viewer = await snapshot(f, 'viewer');
  assert.equal(viewer.pendingPrizes.length, 0);
  assert.equal(viewer.pendingPrizesTotal, 0);
  assert.equal(viewer.metrics.pendingPrizes, 201);
});

test('three CSV exports are scoped and aggregated, without identities, contacts, notes or storage keys', async t => {
  const f = fixture(t);
  f.participation('a', 'a', { results: ['retry', 'brinde'], prize: 'delivered' });
  f.participation('b', 'b', { identity: 'account', modality: 'wheel', results: ['super'], prize: 'delivered' });
  const user = f.member('viewer');
  observeExport(f, user);
  for (const kind of ['participations', 'stock', 'loans']) {
    const response = await GET(new Request(`https://portal.example.test/api/export?kind=${kind}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.match(response.headers.get('Content-Type'), /^text\/csv/);
    const body = await response.text();
    assert.ok(!/PRIVATE|SECRET PROJECT B|SECRET ITEM B|@example\.test/.test(body));
    if (kind === 'participations') {
      for (const type of ['participacao', 'tentativa', 'premiacao', 'acesso']) assert.ok(body.includes(`"${type}"`));
      assert.ok(body.includes('2026-10-19'));
    }
    if (kind === 'stock') assert.ok(body.includes("'=Button A"), 'CSV neutralizes spreadsheet formulas.');
    if (kind === 'loans') assert.ok(!/borrower|contato|note|observa/i.test(body));
  }
});

test('CSV rejects other projects, missing permission, revocation and anonymous requests without caching errors', async t => {
  const f = fixture(t);
  const viewer = f.member('viewer');
  observeExport(f, viewer);
  assert.equal((await GET(new Request('https://portal.example.test/api/export?kind=stock&projectId=project-b'))).status, 403);
  assert.equal((await GET(new Request('https://portal.example.test/api/export?kind=invalid'))).status, 400);
  f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(new Date().toISOString(), viewer.userId);
  assert.equal((await GET(new Request('https://portal.example.test/api/export?kind=stock'))).status, 403);
  observeExport(f, f.member('inventory'));
  assert.equal((await GET(new Request('https://portal.example.test/api/export?kind=stock'))).status, 403);
  observeExport(f, null);
  const response = await GET(new Request('https://portal.example.test/api/export'));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('owner directory materialization never recreates profile or contact data for an anonymized canonical identity', async t=>{
  const f=fixture(t);
  f.insert('portal_users',{user_id:'legacy-anonymized',email:null,status:'blocked',anonymized_at:timestamp,created_at:timestamp,updated_at:timestamp});
  f.insert('members',{id:'member-anonymized-history',user_id:'legacy-anonymized',email:'old-pii@example.test',role:'viewer',project_id:'project-a',revoked_at:timestamp,created_at:timestamp});
  await snapshot(f,'owner');
  assert.equal(f.sqlite.prepare("SELECT user_id FROM profiles WHERE user_id='legacy-anonymized'").get(),undefined);
  const retained=f.sqlite.prepare("SELECT email,status,anonymized_at FROM portal_users WHERE user_id='legacy-anonymized'").get();
  assert.equal(retained.email,null);assert.equal(retained.status,'blocked');assert.equal(retained.anonymized_at,timestamp);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM identity_aliases WHERE user_id='legacy-anonymized'").get().n,0);
});
