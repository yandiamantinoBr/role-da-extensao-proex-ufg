import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { load } from './support/project-report-module.mjs';

const root = new URL('../', import.meta.url);
const { projectReportData, listReportTemplates, reportTemplateAction } = await load('lib/project-report.ts');
const { defaultReportConfig } = await load('lib/project-report-config.ts');

function fixture() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(new URL('drizzle/', root)).filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(new URL(`drizzle/${migration}`, root), 'utf8'));
  const at = '2026-10-10T15:00:00.000Z';
  native.prepare("INSERT INTO projects(id,name,created_at,scope,official_url) VALUES('project-a','Projeto A',?,'internal','https://example.org/a'),('project-b','Projeto B',?,'internal','')").run(at, at);
  native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,reserved,low_stock,created_at) VALUES('item-a','project-a','Caixa de som','equipment','unidade',1,0,1,?),('item-b','project-a','Camisetas','gift','unidade',40,5,10,?),('item-x','project-b','Segredo B','gift','unidade',9,0,1,?)").run(at, at, at);
  native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at) VALUES('m-1','item-b',50,'receive','Compra','test','2026-09-02T12:00:00.000Z'),('m-2','item-b',-10,'distribute','Feira','test','2026-10-05T12:00:00.000Z'),('m-x','item-x',5,'receive','Segredo','test','2026-10-05T12:00:00.000Z')").run();
  native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,borrower_contact,starts_at,ends_at,created_by,created_at) VALUES('loan-a','project-a','item-a','Mostra','Pessoa privada','pessoa@example.invalid',?,?,'test',?)").run(Date.parse('2026-10-01T12:00:00.000Z'), Date.parse('2026-10-03T12:00:00.000Z'), at);
  native.prepare("INSERT INTO records(id,project_id,kind,title,body,occurred_at,item_id,created_by,created_at) VALUES('r-1','project-a','maintenance','Conserto','Cabo','2026-10-02T12:00:00.000Z','item-a','test',?),('r-2','project-a','observation','Reunião','Notas','2026-09-10T12:00:00.000Z',NULL,'test',?)").run(at, at);
  native.prepare("INSERT INTO record_attachments(id,record_id,project_id,object_key,name,mime,size,operation_key,created_by,created_at) VALUES('att-1','r-1','project-a','private/key-never-shown','nota.pdf','application/pdf',1200,'op-1','test','2026-10-02T12:30:00.000Z')").run();
  native.prepare("INSERT INTO project_links(id,project_id,label,url,kind,version,created_at,updated_at) VALUES('link-a','project-a','Planilha da equipe','https://docs.google.com/spreadsheets/d/synthetic/edit','report',1,?,?),('link-b','project-b','Link B','https://example.org/b','other',1,?,?)").run(at, at, at, at);
  native.prepare("INSERT INTO project_schedule_items(id,project_id,title,starts_at,ends_at,status,note,url,version,created_at,updated_at) VALUES('s-1','project-a','Abertura','2026-10-04','2026-10-04','completed','','https://example.org/abertura.pdf',1,?,?)").run(at, at);
  const version = native.prepare('INSERT INTO entity_versions(id,entity_type,entity_id,project_id,version,snapshot_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)');
  version.run('v-1', 'project', 'project-a', 'project-a', 1, JSON.stringify({ name: 'Projeto A', location: '' }), 'test', '2026-09-01T12:00:00.000Z');
  version.run('v-2', 'project', 'project-a', 'project-a', 2, JSON.stringify({ name: 'Projeto A', location: 'Campus' }), 'test', '2026-10-01T12:00:00.000Z');
  version.run('v-i1', 'item', 'item-b', 'project-a', 1, JSON.stringify({ name: 'Camiseta', low_stock: 5 }), 'test', '2026-09-01T12:00:00.000Z');
  version.run('v-i2', 'item', 'item-b', 'project-a', 2, JSON.stringify({ name: 'Camisetas', low_stock: 10 }), 'test', '2026-10-06T12:00:00.000Z');
  const task = native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,due_at,created_by,created_at,updated_at) VALUES(?,'org_proex',?,?,'CORPO PRIVADO',?,?,NULL,'synthetic',?,?)");
  task.run('task-a', 'project-a', 'Recontar bottons', 'high', 'completed', '2026-09-05T12:00:00.000Z', '2026-10-08T12:00:00.000Z');
  task.run('task-b', 'project-a', 'Montar estande', 'medium', 'open', '2026-10-06T12:00:00.000Z', '2026-10-06T12:00:00.000Z');
  task.run('task-x', 'project-b', 'Demanda B', 'low', 'open', '2026-10-06T12:00:00.000Z', '2026-10-06T12:00:00.000Z');
  native.prepare("INSERT INTO followup_history(id,task_id,version,snapshot_json,actor_id,created_at) VALUES('h-1','task-a',1,'{\"status\":\"open\"}','synthetic','2026-09-05T12:00:00.000Z'),('h-2','task-a',2,'{\"status\":\"completed\"}','synthetic','2026-10-07T12:00:00.000Z')").run();
  const statement = sql => ({ values: [], bind(...args) { this.values = args; return this; },
    async all() { return { results: native.prepare(sql).all(...this.values) }; },
    async first() { return native.prepare(sql).get(...this.values) ?? null; },
    async run() { const result = native.prepare(sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; } });
  return { native, prepare: sql => statement(sql), async batch(list) { return Promise.all(list.map(item => item.run())); } };
}
function actor(db, role, project = null) {
  const userId = crypto.randomUUID(), member = { id: crypto.randomUUID(), user_id: userId, email: `${role}@example.invalid`, role, project_id: project, revoked_at: null, created_at: '2026-01-01T00:00:00.000Z' };
  db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?)').run(...Object.values(member));
  return { userId, email: member.email, displayName: role, capabilities: [], members: [member] };
}
const config = () => ({ ...defaultReportConfig(), title: 'Mensal', notes: 'Observação sintética.' });

test('a viewer sees the report with project data but never another project, contacts, file keys or private bodies', async () => {
  const db = fixture();
  try {
    const viewer = actor(db, 'viewer', 'project-a');
    const report = await projectReportData(db, viewer, 'project-a');
    assert.equal(report.project.name, 'Projeto A');
    assert.deepEqual(report.sections.demands.rows.map(row => row.id).sort(), ['task-a', 'task-b']);
    assert.equal(report.sections.demands.rows.find(row => row.id === 'task-a').concluida_em, '2026-10-07');
    assert.deepEqual(report.sections.materials.items.map(row => row.material).sort(), ['Caixa de som', 'Camisetas']);
    assert.equal(report.sections.materials.detailed, false, 'viewer has no inventory.read');
    assert.deepEqual(report.sections.materials.corrections, []);
    assert.ok(report.sections.loans && report.sections.campaigns);
    assert.equal(report.sections.history, null, 'only editors see the registration versions');
    assert.equal(report.permissions.canAddReferences, false);
    assert.equal(report.permissions.canSaveTemplates, true);
    assert.deepEqual(report.sections.references.rows.map(row => [row.titulo, row.tipo]), [['Página oficial do projeto', 'link'], ['Planilha da equipe', 'spreadsheet'], ['Abertura', 'document']]);
    const json = JSON.stringify(report);
    assert.doesNotMatch(json, /Segredo B|Demanda B|Link B|example\.org\/b|pessoa@example|Pessoa privada|private\/key|CORPO PRIVADO|viewer@example/);
    await assert.rejects(projectReportData(db, viewer, 'project-b'), error => error.status === 404);
    await assert.rejects(listReportTemplates(db, viewer, 'project-b'), error => error.status === 404);
  } finally { db.native.close(); }
});

test('an operator sees only what the operator role reads: no materials, loans, dynamics or history, and cannot save templates', async () => {
  const db = fixture();
  try {
    const operator = actor(db, 'operator', 'project-a');
    const report = await projectReportData(db, operator, 'project-a');
    assert.equal(report.sections.materials, null);
    assert.equal(report.sections.loans, null);
    assert.equal(report.sections.campaigns, null);
    assert.equal(report.sections.history, null);
    assert.equal(report.sections.demands.rows.length, 2);
    assert.equal(report.permissions.canSaveTemplates, false);
    assert.doesNotMatch(JSON.stringify(report), /Caixa de som|Camisetas|Mostra/);
    await assert.rejects(reportTemplateAction(db, operator, 'project-a', { action: 'save', name: 'Tentativa', config: config() }), error => error.status === 403);
  } finally { db.native.close(); }
});

test('inventory access adds material corrections and attachment names, and the period filters movements and versions', async () => {
  const db = fixture();
  try {
    const keeper = actor(db, 'inventory', 'project-a');
    const report = await projectReportData(db, keeper, 'project-a', { from: '2026-10-01', to: '2026-10-31' });
    assert.equal(report.sections.materials.detailed, true);
    assert.deepEqual(report.sections.materials.movements.map(row => row.id), ['m-2']);
    assert.deepEqual(report.sections.materials.corrections.map(row => [row.material, row.versao, row.campos]), [['Camisetas', 2, ['low_stock', 'name']]]);
    assert.deepEqual(report.sections.materials.attachments.map(row => [row.material, row.arquivo]), [['Caixa de som', 'nota.pdf']]);
    assert.equal(report.sections.loans, null, 'inventory does not read loans');
    assert.deepEqual(report.sections.demands.rows.map(row => row.id), ['task-b']);
    assert.doesNotMatch(JSON.stringify(report), /private\/key|object_key/);
    await assert.rejects(projectReportData(db, keeper, 'project-a', { from: '2026-10-31', to: '2026-10-01' }), /inicial/);
  } finally { db.native.close(); }
});

test('a manager sees versions and can add references; templates save, update with version, reject duplicates and delete', async () => {
  const db = fixture();
  try {
    const manager = actor(db, 'manager', 'project-a');
    const report = await projectReportData(db, manager, 'project-a');
    assert.equal(report.permissions.canAddReferences, true);
    assert.deepEqual(report.sections.history.rows.map(row => [row.versao, row.campos]), [[2, ['location']], [1, ['__created__']]]);
    const saved = await reportTemplateAction(db, manager, 'project-a', { action: 'save', name: '  Prestação   mensal ', config: config() });
    assert.equal(saved.templates.length, 1);
    assert.equal(saved.templates[0].name, 'Prestação mensal');
    assert.equal(saved.templates[0].config.notes, 'Observação sintética.');
    await assert.rejects(reportTemplateAction(db, manager, 'project-a', { action: 'save', name: 'Prestação mensal', config: config() }), error => error.status === 409);
    await assert.rejects(reportTemplateAction(db, manager, 'project-a', { action: 'save', name: 'Ruim', config: { ...config(), sections: [{ id: 'inventado', on: true }] } }), error => error.status === 400);
    const id = saved.id;
    const updated = await reportTemplateAction(db, manager, 'project-a', { action: 'save', id, expectedVersion: 1, name: 'Prestação mensal', config: { ...config(), title: 'Novo título' } });
    assert.equal(updated.templates[0].version, 2);
    await assert.rejects(reportTemplateAction(db, manager, 'project-a', { action: 'save', id, expectedVersion: 1, name: 'Prestação mensal', config: config() }), error => error.status === 409);
    // Quem vê o projeto usa o modelo; quem é de outro projeto não o enxerga nem o altera.
    const viewer = actor(db, 'viewer', 'project-a'), outsider = actor(db, 'manager', 'project-b');
    assert.equal((await listReportTemplates(db, viewer, 'project-a'))[0].config.title, 'Novo título');
    await assert.rejects(reportTemplateAction(db, outsider, 'project-a', { action: 'delete', id, expectedVersion: 2 }), error => error.status === 404);
    // Acesso revogado depois de carregar a sessão: a escrita confere a permissão no banco.
    db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run('2026-11-01T00:00:00.000Z', manager.members[0].id);
    await assert.rejects(reportTemplateAction(db, manager, 'project-a', { action: 'delete', id, expectedVersion: 2 }), error => error.status === 409);
    const viewerDelete = await reportTemplateAction(db, viewer, 'project-a', { action: 'delete', id, expectedVersion: 2 });
    assert.deepEqual(viewerDelete.templates, []);
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action LIKE 'project.report_template.%'").get().n, 3);
  } finally { db.native.close(); }
});
