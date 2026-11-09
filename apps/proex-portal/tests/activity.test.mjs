import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const overrides = new Map([
  [resolve(root, 'lib/session.ts'), dataModule('export async function getPortalUser(){return globalThis.__activityUser??null;}')],
  [resolve(root, 'lib/platform.ts'), dataModule('export function database(){return globalThis.__activityDb;} export function bucket(){return null;}')],
]);
const modules = new Map();
function compile(file) {
  file = resolve(root, file);
  if (overrides.has(file)) return overrides.get(file);
  if (modules.has(file)) return modules.get(file);
  let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, dependency) => `from ${JSON.stringify(compile(resolve(dirname(file), dependency.endsWith('.ts') ? dependency : `${dependency}.ts`)))}`);
  const url = dataModule(`${code}\n//# sourceURL=${file.replace(root, '')}-under-test.mjs`);
  modules.set(file, url);
  return url;
}
const { activityFeed, activityRange, brasiliaDay } = await import(compile('lib/activity.ts'));
const route = await import(compile('app/api/activity/route.ts'));

// Relógio fixo: 10/11/2026 12:00 em Brasília.
const NOW = Date.parse('2026-11-10T15:00:00.000Z');
const at = (day, hour = 12) => new Date(Date.parse(`${day}T${String(hour + 3).padStart(2, '0')}:00:00.000Z`)).toISOString();

function fixture() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const created = at('2026-10-01');
  for (const id of ['project-a', 'project-b']) native.prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)').run(id, `Projeto ${id.slice(-1).toUpperCase()}`, created);
  native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at) VALUES('item-a','project-a','Planner','gift','unidade',50,?),('item-b','project-b','Caneca','gift','unidade',10,?),('asset-a','project-a','Projetor','equipment','unidade',1,?),('asset-a2','project-a','Caixa de som','equipment','unidade',1,?)").run(created, created, created, created);
  const prepare = sql => {
    let values = [];
    return {
      sql,
      bind(...args) { values = args; return this; },
      async first(column) { const row = native.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return { success: true, results: native.prepare(sql).all(...values) }; },
      async run() { const result = native.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
    };
  };
  return { native, prepare, async batch() { throw new Error('não usado'); } };
}
function person(db, role, { project = null, organization = null, name = role, revoked = false, anonymized = false } = {}) {
  const userId = crypto.randomUUID(), now = at('2026-10-01');
  const member = { id: crypto.randomUUID(), user_id: userId, email: `${userId}@example.invalid`, role, project_id: project, revoked_at: revoked ? now : null, created_at: now, organization_id: organization };
  db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at,organization_id) VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(member));
  db.native.prepare('INSERT INTO portal_users(user_id,email,status,created_at,updated_at,anonymized_at) VALUES(?,?,?,?,?,?)').run(userId, member.email, 'active', now, now, anonymized ? now : null);
  db.native.prepare('INSERT INTO profiles(user_id,display_name,version,created_at,updated_at) VALUES(?,?,1,?,?)').run(userId, name, now, now);
  // Igual ao getActor real: membro da organização recebe a lista de projetos dela.
  const organizationProjects = organization ? { [organization]: db.native.prepare('SELECT id FROM projects WHERE organization_id=?').all(organization).map(row => row.id) } : {};
  return { userId, email: member.email, displayName: name, members: revoked ? [] : [member], capabilities: [], organizationProjects };
}
function seed(db, actors) {
  const move = (id, item, delta, kind, actor, day, ref = null) => db.native.prepare('INSERT INTO stock_movements(id,item_id,delta,kind,note,ref_id,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, item, delta, kind, 'NOTA-PRIVADA', ref, actor, at(day));
  move('mov-a1', 'item-a', 100, 'receive', actors.inventoryA.userId, '2026-11-09');
  move('mov-a2', 'item-a', -20, 'distribute', actors.colleagueA.userId, '2026-11-10', `manual:${actors.colleagueA.userId}:ai_plan123`);
  move('mov-b1', 'item-b', -3, 'consume', actors.viewerB.userId, '2026-11-10');
  move('mov-old', 'item-a', 5, 'receive', actors.inventoryA.userId, '2026-06-01');
  db.native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,borrower_contact,starts_at,ends_at,status,created_by,created_at,checked_out_at) VALUES('loan-a','project-a','asset-a','Ação CONPEEX','Pessoa Privada','contato@privado.invalid',?,?,'out',?,?,?)")
    .run(Date.parse(at('2026-11-09')), Date.parse(at('2026-11-09', 18)), actors.manager.userId, at('2026-11-08'), at('2026-11-09', 9));
  db.native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,starts_at,ends_at,status,created_by,created_at,checked_out_at) VALUES('loan-future','project-a','asset-a2','Ação futura','Outra Pessoa',?,?,'out',?,?,?)")
    .run(Date.parse(at('2026-11-10', 8)), Date.parse('2030-01-01T12:00:00.000Z'), actors.manager.userId, at('2026-11-10', 8), at('2026-11-10', 8));
  const task = (id, project, title, created, by) => db.native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,created_by,created_at,updated_at) VALUES(?, 'org_proex', ?, ?, 'CORPO-PRIVADO', 'high', 'open', ?, ?, ?)").run(id, project, title, by, at(created), at(created));
  task('task-a', 'project-a', 'Contar planners', '2026-11-08', actors.manager.userId);
  task('task-b', 'project-b', 'Revisar canecas', '2026-11-09', actors.manager.userId);
  const history = (id, taskId, version, status, day, actor) => db.native.prepare('INSERT INTO followup_history(id,task_id,version,snapshot_json,actor_id,created_at) VALUES(?,?,?,?,?,?)').run(id, taskId, version, JSON.stringify({ status }), actor, at(day, 14));
  history('h1', 'task-a', 1, 'open', '2026-11-08', actors.manager.userId);
  history('h2', 'task-a', 2, 'completed', '2026-11-10', actors.inventoryA.userId);
  history('h3', 'task-a', 3, 'completed', '2026-11-10', actors.inventoryA.userId);
  db.native.prepare("INSERT INTO project_schedule_items(id,project_id,title,starts_at,ends_at,status,note,version,created_at,updated_at) VALUES('sched-a','project-a','Turno da manhã',?,?,'planned','NOTA-AGENDA',1,?,?)").run(at('2026-11-10', 9), at('2026-11-10', 12), at('2026-11-01'), at('2026-11-01'));
}
function setup() {
  const db = fixture();
  const actors = {
    manager: person(db, 'manager', { organization: 'org_proex', name: 'Gestora Técnica' }),
    inventoryA: person(db, 'inventory', { project: 'project-a', name: 'Bolsista A' }),
    colleagueA: person(db, 'inventory', { project: 'project-a', name: 'Colega A' }),
    viewerB: person(db, 'viewer', { project: 'project-b', name: 'Leitor B' }),
  };
  seed(db, actors);
  return { db, actors };
}
const range = { from: '2026-11-01', to: '2026-11-10' };
const projectsOf = feed => [...new Set(feed.events.map(event => event.projectId))].sort();

test('organization-wide staff see every project, every type, and never private fields', async () => {
  const { db, actors } = setup();
  const feed = await activityFeed(db, actors.manager, range, NOW);
  assert.deepEqual(projectsOf(feed), ['project-a', 'project-b']);
  assert.deepEqual([...new Set(feed.events.map(event => event.type))].sort(), ['agenda', 'demands', 'loans', 'materials']);
  assert.ok(!feed.events.some(event => event.id === 'materials:mov-old'), 'fora do período');
  const json = JSON.stringify(feed);
  for (const secret of ['Pessoa Privada', 'contato@privado.invalid', 'NOTA-PRIVADA', 'CORPO-PRIVADO', 'NOTA-AGENDA', '@example.invalid']) assert.ok(!json.includes(secret), secret);
  assert.deepEqual(feed.loansNow, { active: 2, late: 1 }, 'só o que já passou do fim conta como atraso');
  const completions = feed.events.filter(event => event.action === 'Demanda concluída');
  assert.equal(completions.length, 1, 'uma conclusão, mesmo com duas versões concluídas seguidas');
  assert.equal(completions[0].href, '/?module=demands&project=project-a&demandId=task-a');
});

test('project members see only their projects, including what colleagues did there', async () => {
  const { db, actors } = setup();
  const feed = await activityFeed(db, actors.inventoryA, range, NOW);
  assert.deepEqual(projectsOf(feed), ['project-a']);
  const colleague = feed.events.find(event => event.id === 'materials:mov-a2');
  assert.equal(colleague.actorName, 'Colega A');
  assert.equal(colleague.viaRole, true, 'pedido ao Rolê e confirmado pela pessoa');
  assert.equal(colleague.href, '/?module=materials&project=project-a&itemId=item-a');
  assert.ok(!feed.events.some(event => event.type === 'loans'), 'estoque não lê empréstimos');
  assert.ok(!feed.events.some(event => event.type === 'agenda'), 'estoque não lê a agenda do projeto');
  assert.equal(feed.loansNow, null, 'sem leitura de empréstimos, sem contagem');
  assert.ok(!feed.people.some(entry => entry.name === 'Leitor B'), 'nome de outro projeto não vaza');
});

test('a reader of another project gets nothing from project A, even when asking for it', async () => {
  const { db, actors } = setup();
  const feed = await activityFeed(db, actors.viewerB, range, NOW);
  assert.ok(feed.events.every(event => event.projectId === 'project-b'));
  assert.ok(feed.events.some(event => event.type === 'demands'));
  const forced = await activityFeed(db, actors.viewerB, { ...range, projectId: 'project-a' }, NOW);
  assert.equal(forced.events.length, 0);
});

test('revoked access, anonymized authors and person filter behave safely', async () => {
  const { db, actors } = setup();
  const revoked = person(db, 'manager', { organization: 'org_proex', revoked: true });
  assert.equal((await activityFeed(db, { ...revoked, members: [{ ...actors.manager.members[0], user_id: revoked.userId }] }, range, NOW)).events.length, 0, 'autoridade é conferida ao vivo no banco');
  db.native.prepare('UPDATE portal_users SET anonymized_at=? WHERE user_id=?').run(at('2026-11-10'), actors.colleagueA.userId);
  const feed = await activityFeed(db, actors.manager, range, NOW);
  const removed = feed.events.find(event => event.id === 'materials:mov-a2');
  assert.deepEqual({ name: removed.actorName, id: removed.actorId }, { name: 'Pessoa removida', id: null });
  const anonymized = await activityFeed(db, actors.manager, { ...range, person: actors.colleagueA.userId }, NOW);
  assert.equal(anonymized.events.length, 0); assert.equal(anonymized.summary.days.reduce((total, row) => total + row.materials, 0), 0);
  const mine = await activityFeed(db, actors.manager, { ...range, person: actors.inventoryA.userId }, NOW);
  assert.ok(mine.events.length > 0 && mine.events.every(event => event.actorId === actors.inventoryA.userId));
});

test('ranges are civil days in Brasília with a 92-day ceiling and strict inputs', async () => {
  const { db, actors } = setup();
  assert.equal(brasiliaDay('2026-11-10T02:30:00.000Z'), '2026-11-09');
  const window = activityRange(undefined, undefined, NOW);
  assert.equal(window.to, '2026-11-10'); assert.equal(window.days.length, 30);
  await assert.rejects(activityFeed(db, actors.manager, { from: '2026-01-01', to: '2026-11-10' }, NOW), /até 92 dias/);
  await assert.rejects(activityFeed(db, actors.manager, { from: '10/11/2026' }, NOW), /aaaa-mm-dd/);
  await assert.rejects(activityFeed(db, actors.manager, { ...range, types: 'materials,secrets' }, NOW), /tipos de registro/);
  await assert.rejects(activityFeed(db, null, range, NOW), error => error.status === 401);
});

test('the route is private and refuses anonymous reads', async () => {
  const { db } = setup();
  globalThis.__activityDb = db; globalThis.__activityUser = null;
  const response = await route.GET(new Request('https://portal.test/api/activity?from=2026-11-01&to=2026-11-10'));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('chart totals come from the database and stay exact when the list is cut', async () => {
  const { db, actors } = setup();
  const feed = await activityFeed(db, actors.manager, range, NOW);
  const day10 = feed.summary.days.find(row => row.day === '2026-11-10');
  assert.deepEqual({ materials: day10.materials, completed: day10.demandsCompleted, agenda: day10.agenda }, { materials: 2, completed: 1, agenda: 1 });
  const planner = feed.summary.stock.find(row => row.name === 'Planner');
  assert.deepEqual({ entradas: planner.entradas, saidas: planner.saidas, href: planner.href }, { entradas: 100, saidas: 20, href: '/?module=materials&project=project-a&itemId=item-a' });
  const insert = db.native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at) VALUES(?,?,?,?,'',?,?)");
  for (let n = 0; n < 700; n++) insert.run(`bulk-${n}`, 'item-a', 1, 'receive', actors.inventoryA.userId, at('2026-11-05', 10));
  const big = await activityFeed(db, actors.manager, range, NOW);
  assert.equal(big.truncated, true);
  assert.equal(big.summary.days.find(row => row.day === '2026-11-05').materials, 700);
  const scoped = await activityFeed(db, actors.viewerB, range, NOW);
  assert.ok(scoped.summary.stock.every(row => row.projectId === 'project-b'), 'totais também respeitam o projeto');
  assert.equal(scoped.summary.days.reduce((total, row) => total + row.materials, 0), 0, 'leitor sem estoque não vê movimentos');
});

test('each role keeps the read rule of its own module, across organizations and manual records', async () => {
  const { db, actors } = setup();
  const created = at('2026-10-01');
  db.native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('org-b','Outra organização','outra',?,?)").run(created, created);
  db.native.prepare("INSERT INTO projects(id,name,created_at,organization_id) VALUES('project-x','Projeto X',?, 'org-b')").run(created);
  db.native.prepare("UPDATE projects SET organization_id='org-b' WHERE id='project-x'").run();
  db.native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at) VALUES('item-x','project-x','Item X','gift','unidade',10,?)").run(created);
  db.native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at) VALUES('mov-x','item-x',5,'receive','',?,?)").run(actors.manager.userId, at('2026-11-10'));
  db.native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,created_by,created_at,updated_at) VALUES('task-org','org_proex',NULL,'Demanda geral','','medium','open',?,?,?)").run(actors.manager.userId, at('2026-11-10'), at('2026-11-10'));
  const record = (id, kind, title) => db.native.prepare('INSERT INTO records(id,project_id,kind,title,body,occurred_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, 'project-a', kind, title, 'TEXTO-PRIVADO', at('2026-11-10', 9), actors.manager.userId, at('2026-11-10', 9));
  record('rec-obs', 'observation', 'Observação do turno'); record('rec-maint', 'maintenance', 'Manutenção do projetor');
  const owner = person(db, 'owner', { name: 'Dona' }), loansA = person(db, 'loans', { project: 'project-a', name: 'Empréstimos A' }), operatorA = person(db, 'operator', { project: 'project-a', name: 'Operador A' });
  const managerX = person(db, 'manager', { organization: 'org-b', name: 'Gestor X' });

  const staff = await activityFeed(db, actors.manager, range, NOW);
  assert.ok(!staff.events.some(event => event.projectId === 'project-x'), 'gestor da PROEX não vê outra organização');
  assert.ok(!staff.events.some(event => event.title === 'Demanda geral'), 'demanda sem projeto: só a dona da organização, como em Demandas');
  assert.ok(staff.events.some(event => event.id === 'records:rec-obs') && staff.events.some(event => event.id === 'records:rec-maint'));
  assert.ok(!JSON.stringify(staff).includes('TEXTO-PRIVADO'), 'texto do registro não sai no histórico');
  const other = await activityFeed(db, managerX, range, NOW);
  assert.deepEqual([...new Set(other.events.map(event => event.projectId))], ['project-x']);
  const platform = await activityFeed(db, owner, range, NOW);
  assert.ok(platform.events.some(event => event.projectId === 'project-x') && platform.events.some(event => event.title === 'Demanda geral'));

  const loans = await activityFeed(db, loansA, range, NOW);
  assert.ok(loans.events.length > 0 && loans.events.every(event => event.projectId === 'project-a'));
  assert.ok(loans.events.some(event => event.type === 'loans') && !loans.events.some(event => event.type === 'materials'));
  assert.deepEqual(loans.loansNow, { active: 2, late: 1 });
  assert.ok(!JSON.stringify(loans).includes('Pessoa Privada'));
  const operator = await activityFeed(db, operatorA, range, NOW);
  assert.deepEqual([...new Set(operator.events.map(event => event.type))], ['demands'], 'operador só lê demandas, como hoje');
  assert.equal(operator.loansNow, null);
  assert.equal(operator.summary.stock.length, 0);
});

test('stock exits, loan returns and demand completions all reach the history (auditoria U8)', async () => {
  const { db, actors } = setup();
  db.native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,starts_at,ends_at,status,created_by,created_at,checked_out_at,returned_at) VALUES('loan-back','project-a','asset-a2','Ação devolvida','Pessoa X',?,?,'returned',?,?,?,?)")
    .run(Date.parse(at('2026-11-03', 8)), Date.parse(at('2026-11-03', 18)), actors.manager.userId, at('2026-11-02'), at('2026-11-03', 8), at('2026-11-03', 17));
  const feed = await activityFeed(db, actors.manager, range, NOW);
  const actions = new Set(feed.events.map(event => event.action));
  for (const action of ['Distribuição', 'Consumo', 'Devolução', 'Retirada', 'Demanda concluída']) assert.ok(actions.has(action), action);
  assert.equal(feed.events.find(event => event.id === 'materials:mov-a2').detail, '-20 unidades');
});

test('management view: team activity only for people managers, deadlines for everyone who reads demands', async () => {
  const { db, actors } = setup();
  db.native.prepare("UPDATE followup_tasks SET due_at='2026-11-09', status='completed' WHERE id='task-a'").run();
  db.native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,due_at,created_by,created_at,updated_at) VALUES('task-late','org_proex','project-a','Vencida','','low','open','2026-11-05',?,?,?)").run(actors.manager.userId, at('2026-11-01'), at('2026-11-01'));
  const staff = await activityFeed(db, actors.manager, range, NOW);
  assert.deepEqual(staff.deadlines, { onTime: 0, late: 1, noDue: 0, overdueNow: 1 });
  assert.ok(staff.team && staff.team.activePeople >= 2);
  const bolsista = staff.team.people.find(entry => entry.name === 'Bolsista A');
  assert.ok(bolsista.days >= 1 && bolsista.actions >= 1);
  assert.equal(staff.team.perDay.length, staff.range.days.length);
  const inventory = await activityFeed(db, actors.inventoryA, range, NOW);
  assert.equal(inventory.team, null, 'bolsista não vê a atividade dos colegas como painel');
  assert.ok(inventory.deadlines, 'bolsista vê os prazos das demandas que pode ler');
  const viewer = await activityFeed(db, actors.viewerB, range, NOW);
  assert.equal(viewer.team, null);
  assert.equal((await activityFeed(db, actors.manager, { ...range, types: 'materials' }, NOW)).deadlines, null);
});

test('AI configuration history shows before and after only to whoever can configure the organization', async () => {
  const { db, actors } = setup();
  const owner = person(db, 'owner', { organization: 'org_proex', name: 'Coordenação' });
  const audit = (id, action, details, day) => db.native.prepare("INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,NULL,'org_proex',?,'org_proex',?,?)").run(id, owner.userId, action, JSON.stringify(details), at(day));
  audit('cfg-1', 'assistant.configure', { revision: 5, changes: [{ field: 'dailyTokens', before: 100000, after: 1000000 }, { field: 'dailyUsdMicros', before: 1000000, after: 3000000 }, { field: 'dailyMs', before: 300000, after: 3600000 }] }, '2026-11-09');
  audit('cfg-2', 'assistant.configure', { revision: 6, testMode: true, changes: [{ field: 'testMode', before: false, after: true }, { field: 'dailyCalls', before: 100, after: 500 }] }, '2026-11-10');
  audit('cfg-3', 'assistant.configure', { revision: 4, enabled: true }, '2026-11-08');
  audit('cfg-key', 'assistant.credential.save', { provider: 'deepseek' }, '2026-11-10');
  const feed = await activityFeed(db, owner, range, NOW);
  assert.equal(feed.aiVisible, true);
  const ai = feed.events.filter(event => event.type === 'ai');
  assert.deepEqual(ai.map(event => event.id), ['ai:cfg-2', 'ai:cfg-1', 'ai:cfg-3']);
  assert.equal(ai[1].title, 'Limites alterados');
  assert.equal(ai[1].detail.replace(/ /g, ' '), 'Limite de tokens por dia: 100.000 → 1.000.000 · Limite de custo por dia: US$ 1,00 → US$ 3,00 · Limite de tempo por dia: 5 min → 1 h');
  assert.equal(ai[0].title, 'Modo de testes ligado');
  assert.equal(ai[0].actorName, 'Coordenação');
  assert.equal(ai[2].detail, 'Registro anterior ao histórico detalhado');
  for (const reader of [actors.manager, actors.inventoryA, actors.viewerB]) {
    const other = await activityFeed(db, reader, range, NOW);
    assert.equal(other.aiVisible, false);
    assert.ok(!other.events.some(event => event.type === 'ai'), 'sem permissão de configurar, sem histórico de IA');
  }
  const project = await activityFeed(db, owner, { ...range, projectId: 'project-a' }, NOW);
  assert.ok(!project.events.some(event => event.type === 'ai'), 'configuração da organização não aparece no filtro de projeto');
});
