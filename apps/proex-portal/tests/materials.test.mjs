import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = fileURLToPath(new URL('../', import.meta.url));
const modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  let code = ts.transpileModule(readFileSync(`${directory}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])(\.\/[^'"]+)\1/g, (_match, _quote, dependency) => `from ${JSON.stringify(compile(dependency.slice(2).replace(/\.ts$/, '')))}`);
  const url = `data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=${name}-under-test.mjs`).toString('base64')}`;
  modules.set(name, url);
  return url;
}
const { materialsAction } = await import(compile('materials'));
const member = { id: 'member-test', user_id: 'test-user', email: 'manager@example.invalid', role: 'manager', project_id: 'project-a', revoked_at: null, created_at: '2026-10-20T00:00:00.000Z' };
const actor = { userId: 'test-user', email: member.email, displayName: 'Test manager', members: [member], capabilities: [] };

function database() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  const migrations = readdirSync(`${directory}drizzle`).filter(name => name.endsWith('.sql')).sort();
  assert.ok(migrations.length, 'Generate the real Drizzle migrations before testing.');
  for (const migration of migrations) native.exec(readFileSync(`${directory}drizzle/${migration}`, 'utf8'));
  native.prepare('INSERT INTO projects(id,name,description,created_at) VALUES (?,?,?,?)').run('project-a', 'Test project', '', '2026-10-20T00:00:00Z');
  native.prepare('INSERT INTO projects(id,name,description,created_at) VALUES (?,?,?,?)').run('project-b', 'Other project', '', '2026-10-20T00:00:00Z');
  native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES (?,?,?,?,?,?,?)').run(...Object.values(member));
  const prepare = sql => {
    let values = [];
    return {
      sql,
      bind(...args) { values = args; return this; },
      async first(column) { const row = native.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return { results: native.prepare(sql).all(...values), success: true }; },
      async run() { const result = native.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) }, results: [] }; },
      execute() { const results = native.prepare(sql).all(...values); return { success: true, results, meta: { changes: Number(native.prepare('SELECT changes() AS n').get().n) } }; },
    };
  };
  return {
    native, prepare,
    async batch(statements) {
      native.exec('BEGIN');
      try { const results = statements.map(value => value.execute()); native.exec('COMMIT'); return results; }
      catch (error) { native.exec('ROLLBACK'); throw error; }
    },
  };
}
async function item(db, category = 'gift', projectId = 'project-a') {
  return (await materialsAction(db, actor, 'item.create', { projectId, name: category === 'equipment' ? 'Projector asset 01' : 'Pin', category, unit: 'unidade', lowStock: 0, operationKey: crypto.randomUUID() })).item;
}
async function receive(db, material, quantity, operationKey = 'receive-0001') {
  return materialsAction(db, actor, 'stock.move', { itemId: material.id, delta: quantity, kind: 'receive', note: '', operationKey });
}

test('stock movement retry is idempotent and a reused key cannot change its meaning', async () => {
  const db = database();
  try {
    const material = await item(db);
    await receive(db, material, 10);
    const retry = await receive(db, material, 10);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.item.stock, 10);
    assert.equal(db.native.prepare('SELECT COUNT(*) AS count FROM stock_movements').get().count, 1);
    await assert.rejects(receive(db, material, 20), error => error.status === 409 && error.code === 'operation_conflict');
    assert.equal(db.native.prepare('SELECT COUNT(*) AS count FROM audit WHERE action=?').get('stock.move').count, 1);
    await assert.rejects(materialsAction(db, actor, 'stock.move', { itemId: material.id, delta: -11, kind: 'distribute', operationKey: 'distribute-0001' }), error => error.status === 409);
    assert.equal(db.native.prepare('SELECT stock FROM items WHERE id=?').get(material.id).stock, 10);
  } finally { db.native.close(); }
});

test('server checks project scope, quantities and offer composition', async () => {
  const db = database();
  try {
    await assert.rejects(item(db, 'gift', 'project-b'), error => error.status === 403);
    const material = await item(db);
    await assert.rejects(receive(db, material, 1.5), error => error.code === 'invalid_quantity');
    await assert.rejects(materialsAction(db, actor, 'offer.create', { projectId: 'project-a', name: 'Pins', kind: 'super', operationKey: crypto.randomUUID(), components: [{ itemId: material.id, quantity: 1 }, { itemId: material.id, quantity: 2 }] }), error => error.code === 'duplicate_component');
    const offer = await materialsAction(db, actor, 'offer.create', { projectId: 'project-a', name: 'Three pins', kind: 'super', operationKey: crypto.randomUUID(), components: [{ itemId: material.id, quantity: 3 }] });
    assert.equal(offer.offer.components[0].quantity, 3);
    const asset = await item(db, 'equipment');
    await assert.rejects(materialsAction(db, actor, 'offer.create', { projectId: 'project-a', name: 'Unsafe offer', kind: 'super', operationKey: crypto.randomUUID(), components: [{ itemId: asset.id, quantity: 1 }] }), error => error.code === 'invalid_components');
  } finally { db.native.close(); }
});

test('equipment is individual, overlapping loans are blocked and transitions are auditable', async () => {
  const db = database();
  try {
    const asset = await item(db, 'equipment');
    await assert.rejects(receive(db, asset, 2), error => error.code === 'equipment_unit');
    await receive(db, asset, 1);
    const requestTime = Date.now();
    const futureRequest = { projectId: 'project-a', itemId: asset.id, actionName: 'Future extension project', borrowerName: 'Test recipient', operationKey: crypto.randomUUID(), startsAt: new Date(requestTime + 86400000).toISOString(), endsAt: new Date(requestTime + 90000000).toISOString() };
    const future = await materialsAction(db, actor, 'loan.create', futureRequest);
    await assert.rejects(materialsAction(db, actor, 'loan.status', { id: future.loan.id, status: 'out' }), error => error.status === 409 || String(error).includes('loan_checkout_window'));
    await materialsAction(db, actor, 'loan.status', { id: future.loan.id, status: 'cancelled' });
    const request = { ...futureRequest, operationKey: crypto.randomUUID(), actionName: 'Current extension project', startsAt: new Date(requestTime - 3600000).toISOString(), endsAt: new Date(requestTime + 3600000).toISOString() };
    const created = await materialsAction(db, actor, 'loan.create', request);
    const next = await materialsAction(db, actor, 'loan.create', { ...request, operationKey: crypto.randomUUID(), actionName: 'Next project', startsAt: new Date(requestTime + 7200000).toISOString(), endsAt: new Date(requestTime + 10800000).toISOString() });
    await assert.rejects(materialsAction(db, actor, 'stock.move', { itemId: asset.id, delta: -1, kind: 'adjust', note: 'Attempted removal while reserved', operationKey: 'adjust-equipment-0001' }), error => error.code === 'asset_in_use');
    await assert.rejects(materialsAction(db, actor, 'loan.create', { ...request, operationKey: crypto.randomUUID() }), error => error.code === 'loan_conflict');
    await assert.rejects(materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'returned' }), error => error.code === 'invalid_transition');
    await materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'out', note: 'Term attached separately' });
    await assert.rejects(materialsAction(db, actor, 'loan.status', { id: next.loan.id, status: 'out' }), error => error.status === 409 || /loan_checkout_window|loan_conflict/.test(String(error)));
    await assert.rejects(materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'cancelled' }), error => error.code === 'invalid_transition');
    const returned = await materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'returned', note: 'Returned intact' });
    assert.equal(returned.loan.status, 'returned');
    const retry = await materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'returned' });
    assert.equal(retry.duplicate, true);
    assert.equal(db.native.prepare("SELECT COUNT(*) AS count FROM audit WHERE action='loan.status' AND entity_id=?").get(created.loan.id).count, 2);
    await assert.rejects(materialsAction(db, actor, 'loan.create', { ...request, operationKey: crypto.randomUUID(), startsAt: '2030-02-30T10:00:00Z' }), error => error.code === 'invalid_date');
  } finally { db.native.close(); }
});

test('unknown actions are left for other services', async () => {
  assert.equal(await materialsAction({}, actor, 'campaign.create', {}), null);
});

function grant(db, role, projectId = 'project-a') {
  const membership = { id: crypto.randomUUID(), user_id: crypto.randomUUID(), email: `${role}@example.invalid`, role, project_id: projectId, revoked_at: null, created_at: new Date().toISOString() };
  db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES (?,?,?,?,?,?,?)').run(...Object.values(membership));
  return { userId: membership.user_id, email: membership.email, displayName: role, members: [membership], capabilities: ['inventory.manage'] };
}

test('real roles allow inventory staff to distribute and consume while event operators cannot make manual stock changes', async () => {
  const db = database();
  try {
    const material = await item(db);
    await receive(db, material, 10);
    const inventory = grant(db, 'inventory');
    await materialsAction(db, inventory, 'stock.move', { itemId: material.id, delta: -2, kind: 'distribute', operationKey: 'inventory-distribute-0001' });
    await materialsAction(db, inventory, 'stock.move', { itemId: material.id, delta: -1, kind: 'consume', operationKey: 'inventory-consume-0001' });
    const operator = grant(db, 'operator');
    await assert.rejects(materialsAction(db, operator, 'stock.move', { itemId: material.id, delta: -1, kind: 'consume', operationKey: 'operator-consume-0001' }), error => error.status === 403);
    assert.equal(db.native.prepare('SELECT stock FROM items WHERE id=?').get(material.id).stock, 7);
  } finally { db.native.close(); }
});

test('item metadata uses version checks, preserves category and checks current project membership', async () => {
  const db = database();
  try {
    const material = await item(db, 'equipment');
    const updated = await materialsAction(db, actor, 'item.update', { id: material.id, expectedVersion: 1, name: 'Projector asset revised', assetCode: 'PROEX-001', lowStock: 1 });
    assert.equal(updated.item.name, 'Projector asset revised');
    assert.equal(updated.item.version, 2);
    assert.equal(updated.item.asset_code, 'PROEX-001');
    assert.ok(updated.item.updated_at);
    await assert.rejects(materialsAction(db, actor, 'item.update', { id: material.id, expectedVersion: 1, name: 'Stale update' }), error => error.code === 'item_changed');
    await assert.rejects(materialsAction(db, actor, 'item.update', { id: material.id, expectedVersion: 2, category: 'gift' }), error => error.code === 'immutable_category');
    await assert.rejects(materialsAction(db, actor, 'item.update', { id: material.id, expectedVersion: 2, projectId: 'project-b' }), error => error.code === 'immutable_project');
    db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), member.id);
    await assert.rejects(materialsAction(db, actor, 'item.update', { id: material.id, expectedVersion: 2, name: 'Revoked actor update' }), error => error.code === 'access_changed' && error.status === 403);
    assert.equal(db.native.prepare('SELECT name,version FROM items WHERE id=?').get(material.id).version, 2);
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='item.update'").get().n, 1);
  } finally { db.native.close(); }
});

test('concurrent metadata edits preserve one winner and a unique nonempty asset code per project', async () => {
  const db = database();
  try {
    const first = await item(db, 'equipment');
    const second = await item(db, 'equipment');
    const results = await Promise.allSettled([
      materialsAction(db, actor, 'item.update', { id: first.id, expectedVersion: 1, name: 'First revision', assetCode: 'ASSET-001' }),
      materialsAction(db, actor, 'item.update', { id: first.id, expectedVersion: 1, name: 'Other revision', assetCode: 'ASSET-001' }),
    ]);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    await assert.rejects(materialsAction(db, actor, 'item.update', { id: second.id, expectedVersion: 1, assetCode: 'ASSET-001' }), error => error.status === 409);
    assert.equal(db.native.prepare('SELECT version FROM items WHERE id=?').get(first.id).version, 2);
    assert.equal(db.native.prepare('SELECT version FROM items WHERE id=?').get(second.id).version, 1);
  } finally { db.native.close(); }
});

test('loan stages preserve initial notes, conditions and actual checkout; maintenance waits for return', async () => {
  const db = database();
  try {
    const asset = await item(db, 'equipment');
    await receive(db, asset, 1);
    const clock = Date.now();
    const created = await materialsAction(db, actor, 'loan.create', { projectId: 'project-a', itemId: asset.id, actionName: 'Stage history test', borrowerName: 'Recipient', startsAt: new Date(clock - 3600000).toISOString(), endsAt: new Date(clock + 3600000).toISOString(), note: 'Reservation includes two cables', operationKey: 'history-loan-0001' });
    const out = await materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'out', conditionOut: 'Working and complete', note: 'Checkout observed' });
    assert.ok(out.loan.checked_out_at);
    assert.equal(out.loan.note, 'Reservation includes two cables');
    assert.equal(out.loan.condition_out, 'Working and complete');
    await assert.rejects(materialsAction(db, actor, 'item.update', { id: asset.id, expectedVersion: 1, condition: 'maintenance' }), error => error.code === 'asset_in_use');
    const returned = await materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'returned', conditionIn: 'One cable damaged', note: 'Damage recorded on return' });
    assert.equal(returned.loan.note, 'Reservation includes two cables');
    assert.equal(returned.loan.condition_out, 'Working and complete');
    assert.equal(returned.loan.condition_in, 'One cable damaged');
    assert.equal(returned.loan.checked_out_at, out.loan.checked_out_at);
    assert.ok(returned.loan.returned_at);
    const maintenance = await materialsAction(db, actor, 'item.update', { id: asset.id, expectedVersion: 1, condition: 'maintenance' });
    assert.equal(maintenance.item.condition, 'maintenance');
    const audits = db.native.prepare("SELECT details FROM audit WHERE action='loan.status' AND entity_id=? ORDER BY rowid").all(created.loan.id).map(row => JSON.parse(row.details));
    assert.deepEqual(audits.map(row => row.note), ['Checkout observed', 'Damage recorded on return']);
  } finally { db.native.close(); }
});

test('mobile retries create one material, offer and loan with one audit each', async () => {
  const db = database();
  try {
    const input = { projectId: 'project-a', name: 'Idempotent pins', category: 'gift', unit: 'unidade', operationKey: 'create-material-0001' };
    const created = await Promise.all([materialsAction(db, actor, 'item.create', input), materialsAction(db, actor, 'item.create', input)]);
    assert.equal(created[0].item.id, created[1].item.id);
    await assert.rejects(materialsAction(db, actor, 'item.create', { ...input, name: 'Different request' }), error => error.code === 'operation_changed');
    const offerInput = { projectId: 'project-a', name: 'Idempotent prize', kind: 'brinde', components: [{ itemId: created[0].item.id, quantity: 1 }], operationKey: 'create-offer-0001' };
    const offers = await Promise.all([materialsAction(db, actor, 'offer.create', offerInput), materialsAction(db, actor, 'offer.create', offerInput)]);
    assert.equal(offers[0].offer.id, offers[1].offer.id);
    const asset = await item(db, 'equipment');
    await receive(db, asset, 1, 'receive-idem-asset-0001');
    const clock = Date.now();
    const loanInput = { projectId: 'project-a', itemId: asset.id, actionName: 'Idempotent reservation', borrowerName: 'Recipient', startsAt: new Date(clock + 86400000).toISOString(), endsAt: new Date(clock + 90000000).toISOString(), operationKey: 'create-loan-0001' };
    const loans = await Promise.all([materialsAction(db, actor, 'loan.create', loanInput), materialsAction(db, actor, 'loan.create', loanInput)]);
    assert.equal(loans[0].loan.id, loans[1].loan.id);
    const replay = await materialsAction(db, actor, 'loan.create', loanInput);
    assert.equal(replay.loan.id, loans[0].loan.id);
    for (const action of ['offer.create', 'loan.create']) assert.equal(db.native.prepare('SELECT COUNT(*) n FROM audit WHERE action=?').get(action).n, 1);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM offers').get().n, 1);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM loans').get().n, 1);
  } finally { db.native.close(); }
});
