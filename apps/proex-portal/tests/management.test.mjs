import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { load } from './support/project-report-module.mjs';

const root = new URL('../', import.meta.url);
const { guideWorkspace, guideAction, guideHistory, guideForAssistant } = await load('lib/management/guide.ts');
const { risksWorkspace, riskAction, riskLevel } = await load('lib/management/risks.ts');
const { applyTeamTemplate, teamTemplatesState } = await load('lib/management/team-template-service.ts');
const { managementDashboard } = await load('lib/management/dashboard.ts');

function fixture() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(new URL('drizzle/', root)).filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(new URL(`drizzle/${name}`, root), 'utf8'));
  const at = '2026-10-10T15:00:00.000Z';
  native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('org-b','Outra organização','org-b',?,?)").run(at, at);
  native.prepare("INSERT INTO projects(id,name,created_at,scope,official_url) VALUES('project-a','Projeto A',?,'internal',''),('project-b','Projeto B',?,'internal','')").run(at, at);
  native.prepare("INSERT INTO projects(id,name,organization_id,created_at,scope,official_url) VALUES('project-x','Projeto de outra organização','org-b',?,'internal','')").run(at);
  native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,reserved,low_stock,created_at) VALUES('item-a','project-a','Botton sintético','gift','unidade',2,0,5,?)").run(at);
  native.prepare("INSERT INTO project_schedule_items(id,project_id,title,starts_at,ends_at,status,note,url,version,created_at,updated_at) VALUES('s-1','project-a','Oficina futura',date('now','+10 days'),date('now','+10 days'),'planned','','',1,?,?)").run(at, at);
  const task = native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,due_at,created_by,created_at,updated_at) VALUES(?,'org_proex',?,?,'',?,?,?,'synthetic',?,?)");
  task.run('task-a', 'project-a', 'Montar estande', 'high', 'open', '2000-01-01', at, at);
  task.run('task-b', 'project-b', 'Demanda do projeto B', 'low', 'open', null, at, at);
  task.run('task-x', null, 'Rotina da organização', 'medium', 'completed', null, at, at);
  const statement = sql => ({ values: [], bind(...args) { this.values = args; return this; },
    async all() { return { results: native.prepare(sql).all(...this.values) }; },
    async first() { return native.prepare(sql).get(...this.values) ?? null; },
    async run() { const result = native.prepare(sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; } });
  return { native, prepare: sql => statement(sql), async batch(list) { const out = []; for (const item of list) out.push(await item.run()); return out; } };
}
function actor(db, role, project = null, organization = null, name = role) {
  const userId = crypto.randomUUID(), member = { id: crypto.randomUUID(), user_id: userId, email: `${role}@example.invalid`, role, project_id: project, organization_id: organization, revoked_at: null, created_at: '2026-01-01T00:00:00.000Z' };
  db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,organization_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(member));
  db.native.prepare('INSERT INTO profiles(user_id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run(userId, name, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  return { userId, email: member.email, displayName: name, capabilities: [], members: [member], organizationProjects: { org_proex: ['project-a', 'project-b'] } };
}
const ORG = { organizationId: 'org_proex' };

test('guide: members read starter pages with live blocks; only the administration and designated editors edit, with versions and authors', async () => {
  const db = fixture();
  try {
    const owner = actor(db, 'owner', null, null, 'Pessoa Responsável'), viewer = actor(db, 'viewer', 'project-a', null, 'Pessoa Leitora'), outsider = actor(db, 'manager', 'project-x', null);
    const read = await guideWorkspace(db, viewer, ORG);
    assert.equal(read.canEdit, false);
    assert.equal(read.pages.length, 11);
    assert.ok(read.pages.every(page => page.isStarter && page.version === 0));
    const programs = read.pages.find(page => page.slug === 'programas-e-projetos').markdown;
    assert.match(programs, /- Projeto A/);
    assert.doesNotMatch(programs, /Projeto B|outra organização|\{\{/, 'live blocks only list what the reader sees');
    assert.match(read.pages.find(page => page.slug === 'calendario').markdown, /Oficina futura \(Projeto A\)/);
    assert.match(read.pages.find(page => page.slug === 'contatos').markdown, /Equipe PROEX|Pró-Reitoria de Extensão/);
    await assert.rejects(guideAction(db, viewer, { ...ORG, action: 'save', slug: 'glossario', title: 'Glossário', body: '# Glossário\n\nTexto.', expectedVersion: 0 }), error => error.status === 403);
    await assert.rejects(guideWorkspace(db, outsider, ORG), error => error.status === 404);

    const saved = await guideAction(db, owner, { ...ORG, action: 'save', slug: 'glossario', title: 'Glossário da PROEX', body: '# Glossário\n\n- **Termo**: explicação.', expectedVersion: 0, note: 'Primeira revisão' });
    const page = saved.pages.find(entry => entry.slug === 'glossario');
    assert.deepEqual([page.version, page.isStarter, page.title, page.updatedBy], [1, false, 'Glossário da PROEX', 'Pessoa Responsável']);
    await assert.rejects(guideAction(db, owner, { ...ORG, action: 'save', slug: 'glossario', title: 'Outro', body: 'x', expectedVersion: 0 }), error => error.status === 409);

    const withEditor = await guideAction(db, owner, { ...ORG, action: 'editors.add', userId: viewer.userId });
    assert.deepEqual(withEditor.editors.map(editor => editor.name), ['Pessoa Leitora']);
    assert.equal((await guideWorkspace(db, viewer, ORG)).canEdit, true);
    await guideAction(db, viewer, { ...ORG, action: 'save', slug: 'glossario', title: 'Glossário da PROEX', body: '# Glossário\n\n- **Termo**: explicação melhor.', expectedVersion: 1 });
    const history = await guideHistory(db, viewer, { ...ORG, slug: 'glossario' });
    assert.deepEqual(history.versions.map(version => [version.version, version.author]), [[2, 'Pessoa Leitora'], [1, 'Pessoa Responsável']]);
    const restored = await guideAction(db, owner, { ...ORG, action: 'restore', slug: 'glossario', version: 1, expectedVersion: 2 });
    assert.match(restored.pages.find(entry => entry.slug === 'glossario').body, /explicação\.$/);
    // Salvar sem mudança não cria versão nova.
    const same = await guideAction(db, owner, { ...ORG, action: 'save', slug: 'glossario', title: 'Glossário da PROEX', body: '# Glossário\n\n- **Termo**: explicação.', expectedVersion: 3 });
    assert.equal(same.pages.find(entry => entry.slug === 'glossario').version, 3);
    // Editor que perde o vínculo deixa de editar, mesmo continuando na lista.
    db.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run('2026-11-01T00:00:00Z', viewer.userId);
    await assert.rejects(guideAction(db, viewer, { ...ORG, action: 'save', slug: 'glossario', title: 'X', body: 'Y', expectedVersion: 3 }), error => error.status === 404);
    // Convidado de novo depois: lê, mas só volta a editar com nova designação.
    db.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,revoked_at,created_at) VALUES(?,?,'',?,?,NULL,NULL,?)").run(crypto.randomUUID(), viewer.userId, 'viewer', 'project-a', new Date(Date.now() + 1000).toISOString());
    assert.equal((await guideWorkspace(db, viewer, ORG)).canEdit, false);
    await assert.rejects(guideAction(db, viewer, { ...ORG, action: 'save', slug: 'glossario', title: 'X', body: 'Y', expectedVersion: 3 }), error => error.status === 403);
    const forRole = await guideForAssistant(db, owner, 'org_proex');
    assert.equal(forRole.length, 11);
    assert.ok(forRole.every(page => typeof page.markdown === 'string' && !page.markdown.includes('{{')));
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action LIKE 'guide.%'").get().n, 4);
  } finally { db.native.close(); }
});

test('risks: organization risks only for the administration, project risks for project readers, edits for managers; examples on request', async () => {
  const db = fixture();
  try {
    const owner = actor(db, 'owner'), manager = actor(db, 'manager', 'project-a'), viewer = actor(db, 'viewer', 'project-a'), other = actor(db, 'viewer', 'project-b');
    const loaded = await riskAction(db, owner, { ...ORG, action: 'examples.load' });
    assert.equal(loaded.risks.length, 7);
    assert.ok(loaded.risks.every(risk => !/Yan|Vercel|docs\//.test(`${risk.title} ${risk.description} ${risk.mitigation}`)), 'examples carry no personal names, providers or file paths');
    assert.ok(loaded.risks.every(risk => risk.isExample && risk.projectId === null && risk.canEdit));
    assert.equal(loaded.canLoadExamples, false);
    await assert.rejects(riskAction(db, owner, { ...ORG, action: 'examples.load' }), error => error.status === 409);
    await assert.rejects(riskAction(db, manager, { ...ORG, action: 'create', title: 'Risco da organização', probability: 3, impact: 3 }), error => error.status === 403);
    const created = await riskAction(db, manager, { ...ORG, action: 'create', projectId: 'project-a', title: 'Chuva no evento ao ar livre', probability: 3, impact: 4, ownerLabel: 'Coordenação do evento', mitigation: 'Reservar tenda', reviewOn: '2026-01-15' });
    const risk = created.risks.find(entry => entry.title === 'Chuva no evento ao ar livre');
    assert.deepEqual([risk.level, risk.score, risk.reviewOverdue, risk.canEdit], ['alto', 12, true, true]);
    assert.equal(created.risks.some(entry => entry.projectId === null), false, 'managers do not see organization risks');
    const asViewer = await risksWorkspace(db, viewer, ORG);
    assert.deepEqual(asViewer.risks.map(entry => [entry.title, entry.canEdit]), [['Chuva no evento ao ar livre', false]]);
    await assert.rejects(riskAction(db, viewer, { ...ORG, action: 'update', id: risk.id, projectId: 'project-a', title: 'X', probability: 1, impact: 1, expectedVersion: 1 }), error => error.status === 409);
    assert.deepEqual((await risksWorkspace(db, other, ORG)).risks, []);
    const updated = await riskAction(db, manager, { ...ORG, action: 'update', id: risk.id, projectId: 'project-a', title: 'Chuva no evento ao ar livre', probability: 2, impact: 4, status: 'mitigated', expectedVersion: 1 });
    assert.equal(updated.risks.find(entry => entry.id === risk.id).reviewOverdue, false, 'mitigated risks are not overdue');
    await assert.rejects(riskAction(db, manager, { ...ORG, action: 'delete', id: risk.id, expectedVersion: 2 }), error => error.status === 409);
    const example = loaded.risks[0];
    const afterDelete = await riskAction(db, owner, { ...ORG, action: 'delete', id: example.id, expectedVersion: 1 });
    assert.equal(afterDelete.risks.filter(entry => entry.isExample).length, 6);
    assert.equal(riskLevel(5, 5), 'critico');
    assert.equal(riskLevel(1, 4), 'baixo');
    await assert.rejects(riskAction(db, manager, { ...ORG, action: 'create', projectId: 'project-x', title: 'Outro', probability: 1, impact: 1 }), error => error.status === 400);
  } finally { db.native.close(); }
});

test('team templates: the administration applies a model as an empty team; others cannot', async () => {
  const db = fixture();
  try {
    const owner = actor(db, 'owner'), manager = actor(db, 'manager', 'project-a');
    const state = await teamTemplatesState(db, manager, ORG);
    assert.deepEqual(state.templates.map(template => template.id), ['comunicacao', 'administrativo', 'tecnologia', 'gestao', 'eventos', 'bolsistas']);
    assert.equal(state.canApply, false);
    await assert.rejects(applyTeamTemplate(db, manager, { ...ORG, templateId: 'eventos', operationKey: crypto.randomUUID() }));
    const applied = await applyTeamTemplate(db, owner, { ...ORG, templateId: 'eventos', operationKey: crypto.randomUUID() });
    assert.equal(db.native.prepare('SELECT name FROM followup_teams WHERE id=?').get(applied.teamId).name, 'Eventos');
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM followup_team_members WHERE team_id=?').get(applied.teamId).n, 0);
    assert.deepEqual(applied.applications.map(row => ({ ...row })), [{ teamId: applied.teamId, templateId: 'eventos' }]);
    await assert.rejects(applyTeamTemplate(db, owner, { ...ORG, templateId: 'inexistente', operationKey: crypto.randomUUID() }), error => error.status === 400);
    await assert.rejects(applyTeamTemplate(db, owner, { ...ORG, templateId: 'eventos', operationKey: crypto.randomUUID() }), error => error.status === 409, 'a second team with the same name is refused');
    const named = await applyTeamTemplate(db, owner, { ...ORG, templateId: 'eventos', name: 'Eventos do CONPEEX', operationKey: crypto.randomUUID() });
    assert.equal(db.native.prepare('SELECT name FROM followup_teams WHERE id=?').get(named.teamId).name, 'Eventos do CONPEEX');
  } finally { db.native.close(); }
});

test('dashboard: aggregates only what each person can see, with links to the detail', async () => {
  const db = fixture();
  try {
    const owner = actor(db, 'owner'), viewer = actor(db, 'viewer', 'project-a'), operator = actor(db, 'operator', 'project-a');
    await riskAction(db, owner, { ...ORG, action: 'examples.load' });
    const full = await managementDashboard(db, owner, ORG);
    assert.equal(full.kpis.demandsOpen, 2);
    assert.equal(full.kpis.risksOpen, 7);
    assert.equal(full.kpis.lowStock, 1);
    assert.equal(full.lowStock[0].href, '/?module=materials&project=project-a');
    assert.equal(full.upcoming[0].title, 'Oficina futura');
    assert.equal(full.risks.matrix.flat().reduce((sum, value) => sum + value, 0), 7);
    await assert.rejects(managementDashboard(db, owner, { ...ORG, projectId: 'project-x' }), error => error.status === 404, 'projects from another organization are refused');
    const asViewer = await managementDashboard(db, viewer, ORG);
    assert.equal(asViewer.kpis.demandsOpen, 1);
    assert.equal(asViewer.kpis.risksOpen, 0, 'organization risks stay with the administration');
    assert.deepEqual(asViewer.byProject.map(entry => entry.project), ['Projeto A']);
    const asOperator = await managementDashboard(db, operator, ORG);
    assert.equal(asOperator.kpis.lowStock, null, 'no inventory access, no stock card');
    assert.equal(asOperator.lowStock, null);
    await assert.rejects(managementDashboard(db, viewer, { ...ORG, from: '2026-10-10', to: '2026-10-01' }), error => error.status === 400);
    assert.doesNotMatch(JSON.stringify(asViewer), /example\.invalid|Projeto B/);
  } finally { db.native.close(); }
});

test('dashboard counts a completion at 23:00 in Brasília on its civil day, not on the next UTC day', async () => {
  const db = fixture();
  try {
    const owner = actor(db, 'owner');
    db.native.prepare("INSERT INTO followup_history(id,task_id,version,snapshot_json,actor_id,created_at) VALUES('h-late','task-x',2,'{\"status\":\"completed\"}','synthetic','2026-11-10T02:00:21.000Z')").run();
    const result = await managementDashboard(db, owner, { ...ORG, from: '2026-11-01', to: '2026-11-09' });
    assert.equal(result.kpis.demandsCompleted, 1);
    assert.deepEqual(result.demandsByMonth.map(row => row.completed), [1]);
  } finally { db.native.close(); }
});
