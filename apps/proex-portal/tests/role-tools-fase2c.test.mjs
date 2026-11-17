import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Rolê · Fase 2c: equipes, organograma, registros, relatório do projeto e Gestão, pelos privilégios de quem pergunta.
// Dados 100% sintéticos, banco em memória com as migrações, sem rede e sem IA.
const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
  let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  source = source.replace(/import\(['"](pdfjs-dist\/legacy\/build\/pdf(?:\.worker)?\.mjs)['"]\)/g, (_match, dependency) => `import(${JSON.stringify(import.meta.resolve(dependency))})`);
  const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-fase2c-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { runRoleTool, resolveRoleScope, ROLE_TOOL_NAMES, ROLE_TOOLS_ACTUAL_SCHEMA_BYTES } = await import(compile('assistant/role-tools'));
const { ROLE_TOOLS_SCHEMA_BYTES } = await import(compile('assistant/role-contracts'));

const DAY = 86400000;
function fixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = new Date().toISOString(), recent = new Date(Date.now() - 2 * DAY).toISOString(), old = new Date(Date.now() - 60 * DAY).toISOString();
  native.prepare("INSERT INTO projects(id,name,description,scope,organization_id,created_at) VALUES('project-a','Projeto A','','external','org_proex',?),('project-b','Projeto B','','external','org_proex',?)").run(now, now);
  const actors = {};
  // owner: administração geral; coordA/coordB: coordenação de cada projeto; bolsista: só leitura do A; semAcesso: nenhum vínculo.
  for (const [key, role, project, name] of [['owner', 'owner', null, 'Coordenação Geral QA'], ['coordA', 'manager', 'project-a', 'Ana Coordenadora'], ['bolsista', 'viewer', 'project-a', 'Bruno Bolsista'], ['coordB', 'manager', 'project-b', 'Carla Beta'], ['semAcesso', null, null, 'Davi Sem Vínculo']]) {
    const userId = `${key}-qa`, email = `${key}@example.test`;
    native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId, email, now, now);
    native.prepare('INSERT INTO profiles(user_id,display_name,phone,created_at,updated_at) VALUES(?,?,?,?,?)').run(userId, name, '+55 62 90000-0000', now, now);
    const members = role ? [{ id: userId, user_id: userId, email, role, project_id: project, revoked_at: null, created_at: now }] : [];
    if (role) native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run(userId, userId, email, role, project, now);
    actors[key] = { userId, email, displayName: name, capabilities: [], members };
  }
  // Equipes: Alfa (A) com Ana e Bruno; Beta (B) com Carla. Cada uma ligada por uma demanda do seu projeto.
  for (const [team, label] of [['team-alfa', 'Equipe Alfa'], ['team-beta', 'Equipe Beta']]) native.prepare("INSERT INTO followup_teams(id,organization_id,name,created_by,created_at,updated_at) VALUES(?,'org_proex',?,'owner-qa',?,?)").run(team, label, now, now);
  for (const [team, user] of [['team-alfa', 'coordA-qa'], ['team-alfa', 'bolsista-qa'], ['team-beta', 'coordB-qa']]) native.prepare("INSERT INTO followup_team_members(id,team_id,user_id,added_by,created_at) VALUES(?,?,?,'owner-qa',?)").run(`${team}-${user}`, team, user, now);
  native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,due_at,created_by,created_at,updated_at) VALUES('task-a1','org_proex','project-a','Comprar Botton azul','','high','open',?,'coordA-qa',?,?),('task-b1','org_proex','project-b','Demanda secreta B','','medium','open',NULL,'coordB-qa',?,?)").run(old.slice(0, 10), now, now, now, now);
  native.prepare("INSERT INTO followup_assignees(id,task_id,team_id,created_at) VALUES('as-a1','task-a1','team-alfa',?),('as-b1','task-b1','team-beta',?)").run(now, now);
  // Organograma: PROEX > Coordenação de Ações (CAE), com as duas equipes ligadas.
  native.prepare("INSERT INTO institutional_structures(organization_id,version,source_label,source_revision,created_at,updated_at) VALUES('org_proex',1,'Organograma sintético','1.0',?,?)").run(now, now);
  native.prepare("INSERT INTO institutional_nodes(id,organization_id,parent_id,name,acronym,kind,relation,position,created_at,updated_at) VALUES('node-root','org_proex',NULL,'Pró-Reitoria de Extensão','PROEX','office','root',0,?,?)").run(now, now);
  native.prepare("INSERT INTO institutional_nodes(id,organization_id,parent_id,name,acronym,kind,relation,position,created_at,updated_at) VALUES('node-cae','org_proex','node-root','Coordenação de Ações','CAE','coordination','subordination',1,?,?)").run(now, now);
  native.prepare("INSERT INTO institutional_team_links(organization_id,node_id,team_id,created_at) VALUES('org_proex','node-cae','team-alfa',?),('org_proex','node-cae','team-beta',?)").run(now, now);
  // Registros: dois do A (um antigo, de outro tipo) e um do B.
  native.prepare("INSERT INTO records(id,project_id,kind,title,body,occurred_at,created_by,created_at) VALUES('rec-a1','project-a','project','Oficina na escola A','',?,'coordA-qa',?),('rec-a2','project-a','observation','Observação antiga A','',?,'coordA-qa',?),('rec-b1','project-b','project','Registro do B','',?,'coordB-qa',?)").run(recent, now, old, now, recent, now);
  // Riscos: um de cada projeto e um da organização (só a administração vê). O responsável é texto livre e não sai.
  native.prepare("INSERT INTO org_risks(id,organization_id,project_id,title,category,probability,impact,owner_label,mitigation,status,created_by,updated_by,created_at,updated_at) VALUES('risk-a','org_proex','project-a','Chuva no evento A','operacional',3,4,'Fulano Responsável','Ter local coberto.','open','owner-qa','owner-qa',?,?),('risk-b','org_proex','project-b','Risco do B','operacional',2,2,'','','open','owner-qa','owner-qa',?,?),('risk-org','org_proex',NULL,'Risco da organização','tecnologia',4,5,'','','open','owner-qa','owner-qa',?,?)").run(now, now, now, now, now, now);
  const db = { prepare(sql) { let values = []; return { sql, bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; }, execute() { const results = native.prepare(sql).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; } }; }, async batch(statements) { native.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); native.exec('COMMIT'); return results; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
  const revoke = key => native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(new Date().toISOString(), `${key}-qa`);
  return { native, db, actors, revoke };
}
const run = (f, who, name, args = {}, scope = null) => runRoleTool(f.db, f.actors[who], 'org_proex', name, args, undefined, scope);
/** Nada de e-mail, telefone ou identificador de pessoa no que vai ao modelo nem nas fontes. */
function privateFree(result) {
  const all = JSON.stringify(result);
  for (const leak of ['@example.test', '-qa', '90000', 'Fulano']) assert.ok(!all.includes(leak), `sem dado pessoal (${leak})`);
}
const data = result => JSON.parse(result.content);

test('fase 2c: as ferramentas novas entram no esquema dentro do teto', () => {
  for (const name of ['registros_recentes', 'consultar_equipes', 'consultar_organograma', 'resumir_relatorio_projeto', 'consultar_gestao']) assert.ok(ROLE_TOOL_NAMES.includes(name), name);
  assert.ok(ROLE_TOOLS_ACTUAL_SCHEMA_BYTES <= ROLE_TOOLS_SCHEMA_BYTES, `esquema ${ROLE_TOOLS_ACTUAL_SCHEMA_BYTES} cabe no teto ${ROLE_TOOLS_SCHEMA_BYTES}`);
});

test('registros_recentes: filtro de tipo e período, link e o mesmo alcance da tela Registros', async () => {
  const f = fixture();
  try {
    const coord = await run(f, 'coordA', 'registros_recentes', { projeto: 'Projeto A' });
    assert.ok(coord.content.includes('Oficina na escola A') && coord.content.includes('Observação antiga A'));
    assert.ok(!coord.content.includes('Registro do B'), 'coordenação de A não vê B');
    assert.ok(coord.sources.every(source => source.href === '/?module=records&project=project-a'));
    const typed = await run(f, 'coordA', 'registros_recentes', { tipo: 'observacao' });
    assert.equal(typed.rows, 1); assert.ok(typed.content.includes('Observação antiga A') && typed.content.includes('observação'));
    const today = new Date().toISOString().slice(0, 10), weekAgo = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
    const period = await run(f, 'coordA', 'registros_recentes', { de: weekAgo, ate: today });
    assert.equal(period.rows, 1); assert.ok(period.content.includes('Oficina na escola A'));
    // "Projeto B" é o B, nunca o A (sigla de uma letra conta).
    const onlyB = await run(f, 'owner', 'registros_recentes', { projeto: 'Projeto B' });
    assert.equal(onlyB.rows, 1); assert.ok(onlyB.content.includes('Registro do B') && !onlyB.content.includes('escola A'));
    assert.ok((await run(f, 'bolsista', 'registros_recentes', {})).rows >= 1, 'bolsista vê os registros do projeto, como a tela');
    assert.equal((await run(f, 'semAcesso', 'registros_recentes', {})).rows, 0);
    await assert.rejects(run(f, 'coordA', 'registros_recentes', { tipo: 'qualquer' }), /tipo/);
    privateFree(coord);
    f.revoke('bolsista');
    assert.equal((await run(f, 'bolsista', 'registros_recentes', {})).rows, 0, 'acesso revogado no meio da conversa');
  } finally { f.native.close(); }
});

test('consultar_equipes: integrantes como a tela Equipes mostra, sem e-mail nem demandas', async () => {
  const f = fixture();
  try {
    const coord = await run(f, 'coordA', 'consultar_equipes', { projeto: 'Projeto A' });
    const alfa = data(coord).resultados.find(item => item.equipe === 'Equipe Alfa');
    assert.ok(alfa && alfa.minha === true);
    assert.deepEqual(alfa.integrantes, ['Ana Coordenadora', 'Bruno Bolsista']);
    assert.ok(alfa.link.startsWith('/?module=work-teams&teamId=team-alfa&organizationId=org_proex'));
    assert.ok(!coord.content.includes('Equipe Beta') && !coord.content.includes('Carla'), 'coordenação de A não vê a equipe de B');
    assert.ok(!coord.content.includes('Botton') && !coord.content.includes('secreta'), 'sem demandas');
    assert.ok((await run(f, 'coordA', 'consultar_equipes', { projeto: 'Projeto B' })).rows === 0, 'projeto que não vê');
    const bolsista = await run(f, 'bolsista', 'consultar_equipes', {});
    assert.equal(bolsista.rows, 1); assert.ok(bolsista.content.includes('Equipe Alfa'));
    const owner = await run(f, 'owner', 'consultar_equipes', {});
    assert.ok(owner.content.includes('Equipe Alfa') && owner.content.includes('Equipe Beta'), 'administração vê a organização inteira');
    assert.equal((await run(f, 'semAcesso', 'consultar_equipes', {})).rows, 0);
    privateFree(coord); privateFree(owner);
    f.revoke('coordA');
    assert.equal((await run(f, 'coordA', 'consultar_equipes', { projeto: 'Projeto A' })).rows, 0, 'acesso revogado no meio da conversa');
  } finally { f.native.close(); }
});

test('consultar_organograma: unidades e só as equipes que a pessoa vê', async () => {
  const f = fixture();
  try {
    const coord = await run(f, 'coordA', 'consultar_organograma', {});
    const units = data(coord).resultados;
    assert.deepEqual(units.map(unit => unit.sigla), ['PROEX', 'CAE']);
    const cae = units.find(unit => unit.sigla === 'CAE');
    assert.equal(cae.superior, 'Pró-Reitoria de Extensão'); assert.equal(cae.tipo, 'Coordenação');
    assert.deepEqual(cae.equipes, ['Equipe Alfa'], 'equipe de B fica de fora');
    assert.equal(coord.sources[0].href, '/?module=work-teams&project=project-a');
    const search = await run(f, 'bolsista', 'consultar_organograma', { texto: 'CAE' });
    assert.equal(search.rows, 1);
    const owner = await run(f, 'owner', 'consultar_organograma', { texto: 'coordenação de ações' });
    assert.deepEqual(data(owner).resultados[0].equipes.sort(), ['Equipe Alfa', 'Equipe Beta']);
    assert.equal((await run(f, 'semAcesso', 'consultar_organograma', {})).rows, 0);
    privateFree(coord);
    f.revoke('bolsista');
    assert.equal((await run(f, 'bolsista', 'consultar_organograma', {})).rows, 0, 'acesso revogado no meio da conversa');
  } finally { f.native.close(); }
});

test('resumir_relatorio_projeto: totais do relatório que a pessoa pode gerar, com link para o PDF', async () => {
  const f = fixture();
  try {
    const coord = await run(f, 'coordA', 'resumir_relatorio_projeto', { projeto: 'Projeto A' });
    const summary = data(coord).resultados[0];
    assert.equal(summary.projeto, 'Projeto A');
    assert.equal(summary.demandas.total, 1); assert.equal(summary.demandas.atrasadas, 1); assert.equal(summary.demandas.altaPrioridadeAbertas, 1);
    assert.equal(summary.demandas.proximas[0].demanda, 'Comprar Botton azul');
    assert.equal(summary.registros, 2);
    assert.ok(!coord.content.includes('secreta') && !coord.content.includes('Registro do B'), 'nada do B');
    assert.deepEqual(coord.sources.map(source => source.href), ['/?module=projects&project=project-a&detailProject=project-a', '/?module=reports&project=project-a']);
    assert.equal((await run(f, 'coordA', 'resumir_relatorio_projeto', { projeto: 'Projeto B' })).rows, 0, 'projeto que não vê');
    const ask = await run(f, 'owner', 'resumir_relatorio_projeto', {});
    assert.equal(ask.rows, 0); assert.deepEqual(data(ask).projetos, ['Projeto A', 'Projeto B'], 'com vários projetos, pergunta qual');
    const onlyB = await run(f, 'owner', 'resumir_relatorio_projeto', { projeto: 'projeto b' });
    assert.equal(data(onlyB).resultados[0].projeto, 'Projeto B');
    const bolsista = await run(f, 'bolsista', 'resumir_relatorio_projeto', {});
    assert.equal(bolsista.rows, 1); assert.equal(data(bolsista).resultados[0].projeto, 'Projeto A');
    assert.equal((await run(f, 'semAcesso', 'resumir_relatorio_projeto', {})).rows, 0);
    privateFree(coord);
    f.revoke('coordA');
    assert.equal((await run(f, 'coordA', 'resumir_relatorio_projeto', { projeto: 'Projeto A' })).rows, 0, 'acesso revogado no meio da conversa');
  } finally { f.native.close(); }
});

test('consultar_gestao: indicadores e riscos só de quem vê a Gestão daquele recorte', async () => {
  const f = fixture();
  try {
    const coord = await run(f, 'coordA', 'consultar_gestao', {});
    const body = data(coord);
    assert.equal(body.indicadores.demandasAbertas, 1, 'só as demandas de A');
    assert.deepEqual(body.resultados.map(risk => risk.risco), ['Chuva no evento A']);
    assert.equal(body.resultados[0].responsavel, 'definido'); assert.equal(body.resultados[0].nivel, 'alto');
    assert.ok(!coord.content.includes('Risco do B') && !coord.content.includes('Risco da organização'));
    assert.deepEqual(coord.sources.map(source => source.href), ['/?module=management&gestao=dashboard', '/?module=management&gestao=risks']);
    const owner = await run(f, 'owner', 'consultar_gestao', {});
    assert.equal(data(owner).indicadores.demandasAbertas, 2);
    assert.ok(owner.content.includes('Risco da organização') && owner.content.includes('Risco do B'));
    const scope = await resolveRoleScope(f.db, f.actors.owner, 'org_proex', { kind: 'project', id: 'project-a' });
    const scoped = await run(f, 'owner', 'consultar_gestao', {}, scope);
    assert.equal(data(scoped).recorte, 'Projeto A'); assert.ok(!scoped.content.includes('Risco do B') && !scoped.content.includes('Risco da organização'), 'respeita o escopo da conversa');
    const bolsista = await run(f, 'bolsista', 'consultar_gestao', {});
    assert.ok(bolsista.content.includes('Chuva no evento A') && !bolsista.content.includes('Risco do B'));
    assert.equal((await run(f, 'semAcesso', 'consultar_gestao', {})).rows, 0);
    privateFree(coord); privateFree(owner);
    f.revoke('coordA');
    assert.equal((await run(f, 'coordA', 'consultar_gestao', {})).rows, 0, 'acesso revogado no meio da conversa');
  } finally { f.native.close(); }
});
