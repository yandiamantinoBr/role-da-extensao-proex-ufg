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
for (const name of ['access', 'database', 'errors', 'portal-data']) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${path}.js'`);
  writeFileSync(join(temporary, `${name}.js`), output);
}
writeFileSync(join(temporary, 'native-auth.js'), 'export async function getChatGPTUser(){return globalThis.__proexReportTestUser ?? null;}');
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
