import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = fileURLToPath(new URL('../', import.meta.url));
const errorsSource = ts.transpileModule(readFileSync(`${directory}lib/errors.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText + '\n//# sourceURL=portal-errors-under-test.mjs';
const errorsUrl = `data:text/javascript;base64,${Buffer.from(errorsSource).toString('base64')}`;
const accessUrl = `data:text/javascript;base64,${Buffer.from(`import { HttpError } from ${JSON.stringify(errorsUrl)}; export function requireCapability(actor, cap, project) { if (!actor.projects.includes(project) || !actor.capabilities.includes(cap)) throw new HttpError(403, 'Sem permissão.', 'forbidden'); }`).toString('base64')}`;
const compiled = ts.transpileModule(readFileSync(`${directory}lib/materials.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/from ['"]\.\/access['"]/g, `from ${JSON.stringify(accessUrl)}`)
  .replace(/from ['"]\.\/errors['"]/g, `from ${JSON.stringify(errorsUrl)}`) + '\n//# sourceURL=materials-under-test.mjs';
const { materialsAction } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const actor = { userId: 'test-user', projects: ['project-a'], capabilities: ['inventory.manage', 'inventory.deliver', 'loans.manage'] };

function database() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  const migrations = readdirSync(`${directory}drizzle`).filter(name => name.endsWith('.sql')).sort();
  assert.ok(migrations.length, 'Generate the real Drizzle migrations before testing.');
  for (const migration of migrations) native.exec(readFileSync(`${directory}drizzle/${migration}`, 'utf8'));
  native.prepare('INSERT INTO projects(id,name,description,created_at) VALUES (?,?,?,?)').run('project-a', 'Test project', '', '2026-10-20T00:00:00Z');
  native.prepare('INSERT INTO projects(id,name,description,created_at) VALUES (?,?,?,?)').run('project-b', 'Other project', '', '2026-10-20T00:00:00Z');
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
  return (await materialsAction(db, actor, 'item.create', { projectId, name: category === 'equipment' ? 'Projector asset 01' : 'Pin', category, unit: 'unidade', lowStock: 0 })).item;
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
    await assert.rejects(materialsAction(db, actor, 'offer.create', { projectId: 'project-a', name: 'Pins', kind: 'super', components: [{ itemId: material.id, quantity: 1 }, { itemId: material.id, quantity: 2 }] }), error => error.code === 'duplicate_component');
    const offer = await materialsAction(db, actor, 'offer.create', { projectId: 'project-a', name: 'Three pins', kind: 'super', components: [{ itemId: material.id, quantity: 3 }] });
    assert.equal(offer.offer.components[0].quantity, 3);
    const asset = await item(db, 'equipment');
    await assert.rejects(materialsAction(db, actor, 'offer.create', { projectId: 'project-a', name: 'Unsafe offer', kind: 'super', components: [{ itemId: asset.id, quantity: 1 }] }), error => error.code === 'invalid_components');
  } finally { db.native.close(); }
});

test('equipment is individual, overlapping loans are blocked and transitions are auditable', async () => {
  const db = database();
  try {
    const asset = await item(db, 'equipment');
    await assert.rejects(receive(db, asset, 2), error => error.code === 'equipment_unit');
    await receive(db, asset, 1);
    const requestTime = Date.now();
    const futureRequest = { projectId: 'project-a', itemId: asset.id, actionName: 'Future extension project', borrowerName: 'Test recipient', startsAt: new Date(requestTime + 86400000).toISOString(), endsAt: new Date(requestTime + 90000000).toISOString() };
    const future = await materialsAction(db, actor, 'loan.create', futureRequest);
    await assert.rejects(materialsAction(db, actor, 'loan.status', { id: future.loan.id, status: 'out' }), error => error.status === 409 || String(error).includes('loan_checkout_window'));
    await materialsAction(db, actor, 'loan.status', { id: future.loan.id, status: 'cancelled' });
    const request = { ...futureRequest, actionName: 'Current extension project', startsAt: new Date(requestTime - 3600000).toISOString(), endsAt: new Date(requestTime + 3600000).toISOString() };
    const created = await materialsAction(db, actor, 'loan.create', request);
    const next = await materialsAction(db, actor, 'loan.create', { ...request, actionName: 'Next project', startsAt: new Date(requestTime + 7200000).toISOString(), endsAt: new Date(requestTime + 10800000).toISOString() });
    await assert.rejects(materialsAction(db, actor, 'stock.move', { itemId: asset.id, delta: -1, kind: 'adjust', note: 'Attempted removal while reserved', operationKey: 'adjust-equipment-0001' }), error => error.code === 'asset_in_use');
    await assert.rejects(materialsAction(db, actor, 'loan.create', request), error => error.code === 'loan_conflict');
    await assert.rejects(materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'returned' }), error => error.code === 'invalid_transition');
    await materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'out', note: 'Term attached separately' });
    await assert.rejects(materialsAction(db, actor, 'loan.status', { id: next.loan.id, status: 'out' }), error => error.status === 409 || /loan_checkout_window|loan_conflict/.test(String(error)));
    await assert.rejects(materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'cancelled' }), error => error.code === 'invalid_transition');
    const returned = await materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'returned', note: 'Returned intact' });
    assert.equal(returned.loan.status, 'returned');
    const retry = await materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'returned' });
    assert.equal(retry.duplicate, true);
    assert.equal(db.native.prepare("SELECT COUNT(*) AS count FROM audit WHERE action='loan.status' AND entity_id=?").get(created.loan.id).count, 2);
    await assert.rejects(materialsAction(db, actor, 'loan.create', { ...request, startsAt: '2030-02-30T10:00:00Z' }), error => error.code === 'invalid_date');
  } finally { db.native.close(); }
});

test('unknown actions are left for other services', async () => {
  assert.equal(await materialsAction({}, actor, 'campaign.create', {}), null);
});
