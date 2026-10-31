import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const modules = new Map();
function compile(file) {
  file = resolve(root, file);
  if (modules.has(file)) return modules.get(file);
  let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, dependency) => `from ${JSON.stringify(compile(resolve(dirname(file), dependency.endsWith('.ts') ? dependency : `${dependency}.ts`)))}`);
  const url = dataModule(`${code}\n//# sourceURL=${file.replace(root, '')}-under-test.mjs`);
  modules.set(file, url);
  return url;
}
const { reportRows } = await import(compile('lib/reports.ts'));

function fixture() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = '2026-10-10T15:00:00.000Z';
  native.prepare("INSERT INTO organizational_units(id,name,acronym,kind,created_at,updated_at) VALUES('unit-a','Faculdade A','FA','academic',?,?)").run(now, now);
  native.prepare("INSERT INTO projects(id,name,created_at,unit_id,thematic_area,scope) VALUES('project-a','Projeto A',?,'unit-a','cultura','external'),('project-b','Projeto B',?,NULL,'saude','internal')").run(now, now);
  native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,reserved,low_stock,created_at) VALUES('item-a','project-a','Caixa de som','equipment','unidade',1,0,1,?),('item-b','project-b','Camisetas','gift','unidade',40,5,10,?)").run(now, now);
  native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at) VALUES('m-1','item-b',50,'receive','Compra','test','2026-09-02T12:00:00.000Z'),('m-2','item-b',-10,'distribute','Feira','test','2026-10-05T12:00:00.000Z')").run();
  native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,borrower_contact,starts_at,ends_at,created_by,created_at) VALUES('loan-a','project-a','item-a','Mostra','Pessoa privada','pessoa@example.invalid',?,?,'test',?)").run(Date.parse('2026-10-01T12:00:00.000Z'), Date.parse('2026-10-03T12:00:00.000Z'), now);
  native.prepare("INSERT INTO records(id,project_id,kind,title,body,occurred_at,created_by,created_at) VALUES('r-1','project-a','observation','Reunião','Notas','2026-10-01T12:00:00.000Z','test',?),('r-2','project-a','maintenance','Conserto','Cabo','2026-10-02T12:00:00.000Z','test',?)").run(now, now);
  const db = { native, prepare(sql) { let values = []; return { bind(...args) { values = args; return this; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async first() { return native.prepare(sql).get(...values) ?? null; } }; } };
  return db;
}
const actor = (role, project = null) => ({ userId: `${role}-user`, email: `${role}@example.invalid`, displayName: role, capabilities: [], members: [{ id: `${role}-member`, user_id: `${role}-user`, email: `${role}@example.invalid`, role, project_id: project, revoked_at: null, created_at: '2026-01-01T00:00:00.000Z' }] });

test('reports respect project scope and the capability of each dataset', async () => {
  const db = fixture();
  const owner = await reportRows(db, actor('owner'), { dataset: 'projects' });
  assert.deepEqual(owner.rows.map(row => row.projeto), ['Projeto A', 'Projeto B']);
  assert.equal(owner.rows[0].unidade_sigla, 'FA');
  assert.equal(owner.rows[0].materiais, 1);
  const scoped = await reportRows(db, actor('manager', 'project-b'), { dataset: 'materials' });
  assert.deepEqual(scoped.rows.map(row => row.material), ['Camisetas']);
  assert.equal(scoped.rows[0].disponivel, 75, 'stock triggers apply the two movements: 40 + 50 - 10 - 5 reserved');
  const loansOnly = await reportRows(db, actor('loans', 'project-a'), { dataset: 'materials' });
  assert.equal(loansOnly.rows.length, 0, 'loan operators do not read inventory reports');
  await assert.rejects(reportRows(db, null, { dataset: 'projects' }), /Entre/);
  await assert.rejects(reportRows(db, actor('owner'), { dataset: 'users' }), /relatório válido/);
});

test('every report dataset intersects an explicit project or unit filter with the authorized projects', async t => {
  const db = fixture(); t.after(() => db.native.close());
  const now = '2026-10-10T15:00:00.000Z';
  db.native.prepare("INSERT INTO campaigns(id,project_id,name,starts_at,ends_at,status,created_at) VALUES('campaign-a','project-a','Event A',?,?,'draft',?),('campaign-b','project-b','Event B',?,?,'draft',?)").run(now, '2026-10-11T15:00:00.000Z', now, now, '2026-10-11T15:00:00.000Z', now);
  for (const dataset of ['projects','materials','movements','outflows','loans','records','campaigns']) {
    for (const [own, other] of [['project-a','project-b'],['project-b','project-a']]) {
      const manager = actor('manager', own);
      const forbidden = await reportRows(db, manager, { dataset, projectId: other });
      assert.deepEqual(forbidden.rows, [], `${dataset} must not replace scope with a requested foreign project`);
      const all = await reportRows(db, manager, { dataset });
      assert.ok(all.rows.every(row => row.projeto === (own === 'project-a' ? 'Projeto A' : 'Projeto B')));
    }
    assert.deepEqual((await reportRows(db, actor('manager', 'project-b'), { dataset, unitId: 'unit-a' })).rows, [], `${dataset} must not gain access through another unit`);
  }
});

test('loan reports never expose borrower data and records follow the history visibility rules', async () => {
  const db = fixture();
  const loans = await reportRows(db, actor('owner'), { dataset: 'loans' });
  assert.equal(loans.rows.length, 1);
  assert.ok(!JSON.stringify(loans.rows).includes('Pessoa privada'));
  assert.ok(!JSON.stringify(loans.rows).includes('example.invalid'));
  assert.equal(loans.rows[0].em_atraso, 'nao');
  const viewer = await reportRows(db, actor('viewer', 'project-a'), { dataset: 'records' });
  assert.deepEqual(viewer.rows.map(row => row.titulo), ['Reunião'], 'viewers see project records, not maintenance ones');
  const inventory = await reportRows(db, actor('inventory', 'project-a'), { dataset: 'records' });
  assert.deepEqual(inventory.rows.map(row => row.titulo), ['Conserto']);
});

test('report filters combine unit, thematic area and Brasília calendar dates', async () => {
  const db = fixture();
  const byUnit = await reportRows(db, actor('owner'), { dataset: 'projects', unitId: 'unit-a' });
  assert.deepEqual(byUnit.rows.map(row => row.projeto), ['Projeto A']);
  const noUnit = await reportRows(db, actor('owner'), { dataset: 'projects', unitId: '__none__' });
  assert.deepEqual(noUnit.rows.map(row => row.projeto), ['Projeto B']);
  const area = await reportRows(db, actor('owner'), { dataset: 'projects', thematicArea: 'saude' });
  assert.deepEqual(area.rows.map(row => row.projeto), ['Projeto B']);
  const october = await reportRows(db, actor('owner'), { dataset: 'movements', from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(october.rows.map(row => [row.tipo, row.quantidade, row.sentido]), [['distribute', -10, 'saida']]);
  await assert.rejects(reportRows(db, actor('owner'), { dataset: 'movements', from: '01/10/2026' }), /AAAA-MM-DD/);
});

test('loan reports render millisecond reservation dates and preserve ISO checkout and return dates', async (t) => {
  const db = fixture();
  t.after(() => db.native.close());
  const startsAt = Date.parse('2026-10-01T02:59:59.999Z'), endsAt = Date.parse('2026-10-02T03:00:00.001Z');
  db.native.prepare("UPDATE loans SET starts_at=?,ends_at=?,status='returned',checked_out_at=?,returned_at=? WHERE id='loan-a'")
    .run(startsAt, endsAt, '2026-10-01T03:00:00.000Z', '2026-10-02T02:59:59.999Z');

  const { rows } = await reportRows(db, actor('owner'), { dataset: 'loans' });
  assert.deepEqual([rows[0].inicio, rows[0].fim], ['2026-09-30', '2026-10-02']);
  assert.deepEqual([rows[0].retirado_em, rows[0].devolvido_em], ['2026-10-01', '2026-10-01']);
});

test('loan report periods include both Brasília day boundaries with millisecond timestamps', async (t) => {
  const db = fixture();
  t.after(() => db.native.close());
  db.native.exec('DELETE FROM loans');
  const insert = db.native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,starts_at,ends_at,created_by,created_at) VALUES(?,'project-a','item-a','Mostra','Pessoa privada',?,?,'test','2026-10-01T12:00:00.000Z')");
  for (const [id, startsAt] of [
    ['before-day', '2026-10-01T02:59:59.999Z'],
    ['day-start', '2026-10-01T03:00:00.000Z'],
    ['day-end', '2026-10-02T02:59:59.999Z'],
    ['after-day', '2026-10-02T03:00:00.000Z'],
  ]) {
    const milliseconds = Date.parse(startsAt);
    insert.run(id, milliseconds, milliseconds + 1);
  }
  const owner = actor('owner');
  const combined = await reportRows(db, owner, { dataset: 'loans', from: '2026-10-01', to: '2026-10-01', projectId: 'project-a', unitId: 'unit-a', thematicArea: 'cultura' });
  assert.deepEqual(combined.rows.map(row => row.id), ['day-end', 'day-start']);
  assert.ok(combined.rows.every(row => row.inicio === '2026-10-01'));
  const fromOnly = await reportRows(db, owner, { dataset: 'loans', from: '2026-10-01' });
  assert.deepEqual(fromOnly.rows.map(row => row.id), ['after-day', 'day-end', 'day-start']);
  const toOnly = await reportRows(db, owner, { dataset: 'loans', to: '2026-10-01' });
  assert.deepEqual(toOnly.rows.map(row => row.id), ['day-end', 'day-start', 'before-day']);
  assert.deepEqual((await reportRows(db, actor('manager', 'project-b'), { dataset: 'loans', from: '2026-10-01', to: '2026-10-01' })).rows, []);
});

for (const [status, dueOffset, expected] of [
  ['out', -86400000, 'sim'],
  ['out', 86400000, 'nao'],
  ['reserved', -86400000, 'nao'],
  ['returned', -86400000, 'nao'],
  ['cancelled', -86400000, 'nao'],
]) {
  test(`loan reports mark ${status} due ${dueOffset < 0 ? 'in the past' : 'in the future'} as overdue=${expected}`, async (t) => {
    const db = fixture();
    t.after(() => db.native.close());
    db.native.exec('DELETE FROM loans');
    const clock = Date.now();
    db.native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,starts_at,ends_at,status,created_by,created_at) VALUES('loan-a','project-a','item-a','Mostra','Pessoa privada',?,?,?,'test',?)")
      .run(clock - 2 * 86400000, clock + dueOffset, status, new Date(clock).toISOString());
    const { rows } = await reportRows(db, actor('owner'), { dataset: 'loans' });
    assert.equal(rows[0].em_atraso, expected);
  });
}


test('institutional outflows total only effective distribution and delivered prizes within the date and project scope', async t => {
  const db = fixture(); t.after(() => db.native.close());
  const insert = db.native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at) VALUES(?,'item-b',?,?,'No personal details','test',?)");
  insert.run('m-3', -2, 'redeem', '2026-10-08T12:00:00.000Z');
  insert.run('m-4', -3, 'adjust', '2026-10-09T12:00:00.000Z');
  insert.run('m-5', -4, 'consume', '2026-10-10T12:00:00.000Z');
  insert.run('m-6', -5, 'distribute', '2026-11-01T12:00:00.000Z');
  insert.run('m-7', -1, 'distribute', '2026-10-06T12:00:00.000Z');
  const { rows } = await reportRows(db, actor('inventory', 'project-b'), { dataset: 'outflows', from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(rows.map(row => [row.projeto,row.material,row.unidade_medida,row.tipo,row.quantidade,row.movimentacoes]), [['Projeto B','Camisetas','unidade','distribute',11,2],['Projeto B','Camisetas','unidade','redeem',2,1]]);
  assert.deepEqual([rows[0].primeira_saida,rows[0].ultima_saida], ['2026-10-05','2026-10-06']);
  assert.ok(!JSON.stringify(rows).includes('No personal details'));
  assert.deepEqual((await reportRows(db, actor('loans', 'project-b'), { dataset: 'outflows' })).rows, []);
});
