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
const { materialsAction, materialDetail, listMaterialCategories } = await import(compile('materials'));
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

async function category(db, overrides = {}) {
  return (await materialsAction(db, actor, 'material.category.create', { projectId: 'project-a', label: 'Materiais de oficina', coreKind: 'gift', operationKey: crypto.randomUUID(), ...overrides })).category;
}

test('custom categories preserve the stock behavior, have normalized uniqueness and use mobile idempotency', async () => {
  const db = database();
  try {
    const input = { projectId: 'project-a', label: '  Materiais   de oficina ', coreKind: 'gift', operationKey: 'category-mobile-0001' };
    const concurrent = await Promise.all([materialsAction(db, actor, 'material.category.create', input), materialsAction(db, actor, 'material.category.create', input)]);
    assert.equal(concurrent[0].category.id, concurrent[1].category.id);
    assert.equal(concurrent[0].category.label, 'Materiais de oficina');
    await assert.rejects(category(db, { label: 'MATERIAIS DE OFICINA' }), error => error.code === 'category_exists');
    await assert.rejects(category(db, { projectId: 'project-b' }), error => error.status === 403);
    const custom = concurrent[0].category;
    const created = await materialsAction(db, actor, 'item.create', { projectId: 'project-a', name: 'Buttons para oficina', categoryId: custom.id, unit: 'unidade', operationKey: 'custom-material-0001' });
    assert.equal(created.item.category, 'gift');
    assert.equal(created.item.category_id, custom.id);
    await assert.rejects(materialsAction(db, actor, 'material.category.update', { id: custom.id, expectedVersion: 1, coreKind: 'equipment' }), error => error.code === 'immutable_category_core');
    const updated = await materialsAction(db, actor, 'material.category.update', { id: custom.id, expectedVersion: 1, label: 'Oficinas da extensão', status: 'archived' });
    assert.equal(updated.category.version, 2);
    await assert.rejects(materialsAction(db, actor, 'material.category.update', { id: custom.id, expectedVersion: 1, label: 'Stale rename' }), error => error.code === 'category_changed');
    await materialsAction(db, actor, 'item.update', { id: created.item.id, expectedVersion: 1, name: 'Buttons identificados', categoryId: custom.id });
    await assert.rejects(materialsAction(db, actor, 'item.create', { projectId: 'project-a', name: 'New archived assignment', categoryId: custom.id, unit: 'unidade', operationKey: 'archived-material-0001' }), error => error.code === 'category_mismatch');
    const snapshots = db.native.prepare('SELECT snapshot_json FROM entity_versions WHERE entity_id=? ORDER BY version').all(created.item.id).map(row => JSON.parse(row.snapshot_json));
    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[1].name, 'Buttons identificados');
    for (const snapshot of snapshots) assert.ok(!('stock' in snapshot) && !('reserved' in snapshot), 'metadata snapshots must never roll back inventory');
    assert.throws(() => db.native.prepare('DELETE FROM entity_versions WHERE entity_id=?').run(created.item.id), /metadata_version_immutable/);
  } finally { db.native.close(); }
});

test('material detail paginates timestamp ties and exposes no private loan terms or R2 keys', async () => {
  const db = database();
  try {
    const material = await item(db);
    for (const id of ['move-a', 'move-b', 'move-c']) db.native.prepare('INSERT INTO stock_movements(id,item_id,delta,kind,note,ref_id,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, material.id, 1, 'receive', `Reason ${id}`, id, actor.userId, '2026-10-22T12:00:00.000Z');
    const insertRecord = (id, kind, loanId = null) => db.native.prepare('INSERT INTO records(id,project_id,kind,title,body,occurred_at,item_id,loan_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, 'project-a', kind, id, '', '2026-10-22T00:00:00Z', material.id, loanId, actor.userId, '2026-10-22T00:00:00Z');
    const attach = (id, recordId, mime, deletedAt = null) => db.native.prepare('INSERT INTO record_attachments(id,record_id,project_id,object_key,name,mime,size,operation_key,created_by,created_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, recordId, 'project-a', `private/${id}`, `${id}.jpg`, mime, 42, id, actor.userId, '2026-10-22T00:00:00Z', deletedAt);
    insertRecord('public-material-photo', 'material'); attach('visible-photo', 'public-material-photo', 'image/jpeg'); attach('deleted-photo', 'public-material-photo', 'image/jpeg', new Date().toISOString()); attach('private-pdf', 'public-material-photo', 'application/pdf');
    insertRecord('loan-terms-private', 'loan'); attach('loan-term', 'loan-terms-private', 'image/jpeg');
    const first = await materialDetail(db, actor, material.id, { limit: 2 });
    assert.deepEqual(first.movements.map(row => row.id), ['move-c', 'move-b']);
    const next = await materialDetail(db, actor, material.id, { limit: 2, before: first.nextCursor });
    assert.deepEqual(next.movements.map(row => row.id), ['move-a']);
    assert.equal(next.nextCursor, null);
    assert.deepEqual(first.photos.map(photo => photo.id), ['visible-photo']);
    assert.equal(first.availability.available, 3);
    assert.ok(!JSON.stringify(first).includes('private/'));
    assert.ok(!JSON.stringify(first.movements).includes('actor_id'));
    assert.ok(!JSON.stringify(first.movements).includes('ref_id'));
    await assert.rejects(materialDetail(db, null, material.id), error => error.status === 401);
    db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), member.id);
    await assert.rejects(materialDetail(db, actor, material.id), error => error.code === 'access_changed');
  } finally { db.native.close(); }
});

test('equipment availability follows actual reservations and loans without sharing borrower contact', async () => {
  const db = database();
  try {
    const asset = await item(db, 'equipment'); await receive(db, asset, 1);
    const clock = Date.now();
    const created = await materialsAction(db, actor, 'loan.create', { projectId: 'project-a', itemId: asset.id, actionName: 'Public event', borrowerName: 'Private Person', borrowerContact: 'private@example.invalid', startsAt: new Date(clock - 3600000).toISOString(), endsAt: new Date(clock + 3600000).toISOString(), operationKey: 'availability-loan-0001' });
    const detail = await materialDetail(db, actor, asset.id);
    assert.equal(detail.item.stock, 1);
    assert.equal(detail.availability.available, 0);
    assert.equal(detail.availability.equipmentState, 'reserved');
    assert.ok(!JSON.stringify(detail).includes('private@example.invalid'));
    await materialsAction(db, actor, 'loan.status', { id: created.loan.id, status: 'cancelled' });
    assert.equal((await materialDetail(db, actor, asset.id)).availability.available, 1);
  } finally { db.native.close(); }
});

test('groups link donations and loans inside one project, and blocked users cannot use category detail APIs', async () => {
  const db = database();
  try {
    const grouped = await materialsAction(db, actor, 'activity.group.create', { projectId: 'project-a', title: 'Ação na unidade', occurredAt: '2026-10-23T12:00:00Z', kind: 'mixed', operationKey: 'group-action-0001' });
    const material = await item(db);
    await materialsAction(db, actor, 'stock.move', { itemId: material.id, delta: 5, kind: 'receive', reason: 'Recebimento para ação', groupId: grouped.group.id, operationKey: 'grouped-receive-0001' });
    assert.equal((await materialDetail(db, actor, material.id)).movements[0].group_title, 'Ação na unidade');
    db.native.prepare('INSERT INTO activity_groups(id,project_id,title,occurred_at,kind,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run('other-project-group', 'project-b', 'Other', '2026-10-23T12:00:00Z', 'donation', actor.userId, '2026-10-23T12:00:00Z');
    await assert.rejects(materialsAction(db, actor, 'stock.move', { itemId: material.id, delta: 1, kind: 'receive', groupId: 'other-project-group', operationKey: 'crossgroup-0001' }), error => error.code === 'group_mismatch');
    db.native.prepare('INSERT INTO portal_users(user_id,status,created_at,updated_at) VALUES(?,?,?,?)').run(actor.userId, 'blocked', '2026-10-23T00:00:00Z', '2026-10-23T00:00:00Z');
    await assert.rejects(materialDetail(db, actor, material.id), error => error.code === 'access_changed');
    assert.deepEqual(await listMaterialCategories(db, actor), []);
    await assert.rejects(category(db), error => error.status === 409 || error.status === 403);
  } finally { db.native.close(); }
});

test('restoring metadata creates a new revision and never rewinds stock or immutable category behavior', async () => {
  const db = database();
  try {
    const material = await item(db); await receive(db, material, 10);
    await materialsAction(db, actor, 'item.update', { id: material.id, expectedVersion: 1, name: 'Current name', lowStock: 5 });
    await materialsAction(db, actor, 'stock.move', { itemId: material.id, delta: -2, kind: 'distribute', reason: 'Delivered at event', operationKey: 'restore-distribute-0001' });
    const restored = await materialsAction(db, actor, 'item.restore', { id: material.id, expectedVersion: 2, restoreVersion: 1 });
    assert.equal(restored.item.name, material.name);
    assert.equal(restored.item.version, 3);
    assert.equal(restored.item.stock, 8);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM stock_movements WHERE item_id=?').get(material.id).n, 2);
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM entity_versions WHERE entity_type='item' AND entity_id=?").get(material.id).n, 3);
    assert.equal(JSON.parse(db.native.prepare("SELECT details FROM audit WHERE action='item.restore'").get().details).restoredFromVersion, 1);
    await assert.rejects(materialsAction(db, actor, 'item.restore', { id: material.id, expectedVersion: 2, restoreVersion: 1 }), error => error.code === 'item_changed');
    const custom = await category(db);
    await materialsAction(db, actor, 'material.category.update', { id: custom.id, expectedVersion: 1, label: 'Revised category' });
    const restoredCategory = await materialsAction(db, actor, 'material.category.restore', { id: custom.id, expectedVersion: 2, restoreVersion: 1 });
    assert.equal(restoredCategory.category.version, 3);
    assert.equal(restoredCategory.category.label, custom.label);
    assert.equal(restoredCategory.category.core_kind, 'gift');
  } finally { db.native.close(); }
});
