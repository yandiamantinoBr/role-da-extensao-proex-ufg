import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Rolê Fase 2a: Projetos, Demandas (comigo/atrasadas) e Minha agenda, pelos privilégios de cada pessoa.
// Dados 100% sintéticos, banco em memória com as migrações, sem rede e sem IA.
const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
  let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  source = source.replace(/import\(['"](pdfjs-dist\/legacy\/build\/pdf(?:\.worker)?\.mjs)['"]\)/g, (_match, dependency) => `import(${JSON.stringify(import.meta.resolve(dependency))})`);
  const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-fase2a-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { runRoleTool, ROLE_TOOL_NAMES, ROLE_TOOLS_ACTUAL_SCHEMA_BYTES } = await import(compile('assistant/role-tools'));
const { ROLE_TOOLS_SCHEMA_BYTES } = await import(compile('assistant/role-contracts'));

const migrations = readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort();
/** Demandas privadas entre pares (PR #212): o teste de privacidade liga sozinho quando a tabela existir nas migrações. */
const HAS_PRIVATE_TASKS = migrations.some(file => readFileSync(`${root}drizzle/${file}`, 'utf8').includes('followup_task_privacy'));
const todayBr = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const PAST = '2020-01-10', FUTURE = '2099-01-10';

function fixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrations) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = new Date().toISOString();
  native.prepare("INSERT INTO organizational_units(id,name,acronym,kind,created_at,updated_at) VALUES('unit-qa','Unidade fictícia','UFQ','academic',?,?)").run(now, now);
  native.prepare("INSERT INTO project_types(id,key,label,created_at,updated_at) VALUES('type-qa','project-qa','Projeto de extensão',?,?)").run(now, now);
  native.prepare("INSERT INTO projects(id,name,short_name,description,scope,organization_id,unit_id,type_id,created_at) VALUES('project-a','Projeto A','PA','Descrição sintética do A','external','org_proex','unit-qa','type-qa',?),('project-b','Projeto B','','SEGREDO-B descrição','external','org_proex',NULL,NULL,?),('project-bem','Projeto Bem-Estar','','','external','org_proex',NULL,NULL,?)").run(now, now, now);
  const actors = {};
  // owner: administração geral; coordA: coordenação do A; bolsista: só leitura no A; editor: estoque no A (sem Agenda);
  // coordB: coordenação do B; nobody: conta sem nenhum acesso.
  for (const [key, role, project, name] of [['owner', 'owner', null, 'Coordenação QA'], ['coordA', 'manager', 'project-a', 'Ana Coordena'], ['bolsista', 'viewer', 'project-a', 'Bruno Bolsista'],
    ['editor', 'inventory', 'project-a', 'Edu Estoque'], ['coordB', 'manager', 'project-b', 'Carla Externa'], ['nobody', null, null, 'Sem Acesso']]) {
    const userId = `${key.toLowerCase()}-qa`, email = `${key.toLowerCase()}@example.test`;
    native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId, email, now, now);
    native.prepare('INSERT INTO profiles(user_id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run(userId, name, now, now);
    if (role) native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run(userId, userId, email, role, project, now);
    actors[key] = { userId, email, displayName: name, capabilities: [], members: role ? [{ id: userId, user_id: userId, email, role, project_id: project, revoked_at: null, created_at: now }] : [] };
  }
  const task = (id, project, title, status, due) => native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,due_at,created_by,created_at,updated_at) VALUES(?, 'org_proex', ?, ?, 'Texto sintético', 'high', ?, ?, 'owner-qa', ?, ?)").run(id, project, title, status, due, now, now);
  task('ta-late', 'project-a', 'A atrasada com bolsista', 'open', PAST);
  task('ta-team', 'project-a', 'A da equipe', 'in_progress', FUTURE);
  task('ta-week', 'project-a', 'A vence hoje', 'open', todayBr);
  task('ta-done', 'project-a', 'A concluída', 'completed', PAST);
  task('ta-free', 'project-a', 'A sem responsável', 'open', FUTURE);
  task('tb-late', 'project-b', 'B atrasada SEGREDO-B', 'open', PAST);
  task('tbem', 'project-bem', 'Bem-Estar aberta', 'open', FUTURE);
  task('org-late', null, 'Geral da organização atrasada', 'open', PAST);
  native.prepare("INSERT INTO followup_teams(id,organization_id,name,created_by,created_at,updated_at) VALUES('team-a','org_proex','Equipe A','owner-qa',?,?)").run(now, now);
  native.prepare("INSERT INTO followup_team_members(id,team_id,user_id,added_by,created_at) VALUES('tm-1','team-a','bolsista-qa','owner-qa',?)").run(now);
  native.prepare("INSERT INTO followup_assignees(id,task_id,user_id,team_id,created_at) VALUES('as-1','ta-late','bolsista-qa',NULL,?),('as-2','ta-team',NULL,'team-a',?),('as-3','ta-week','bolsista-qa',NULL,?),('as-4','tb-late','coordb-qa',NULL,?),('as-5','org-late','owner-qa',NULL,?),('as-6','ta-done','bolsista-qa',NULL,?)").run(now, now, now, now, now, now);
  native.prepare("INSERT INTO work_responsibility_scopes(id,organization_id,project_id,area,target_key,created_by,created_at,updated_at) VALUES('resp-a','org_proex','project-a','projects','','owner-qa',?,?)").run(now, now);
  native.prepare("INSERT INTO work_responsibility_assignees(id,scope_id,user_id,created_at) VALUES('resp-a-1','resp-a','coorda-qa',?)").run(now);
  native.prepare("INSERT INTO project_schedule_items(id,project_id,title,starts_at,ends_at,status,note,version,created_at,updated_at) VALUES('s-a','project-a','Oficina A',?,?,'planned','NOTA-PRIVADA',1,?,?),('s-b','project-b','Oficina B SEGREDO-B',?,?,'planned','',1,?,?)").run(todayBr, todayBr, now, now, todayBr, todayBr, now, now);
  const db = { prepare(sql) { let values = []; return { sql, bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; }, execute() { const results = native.prepare(sql).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; } }; }, async batch(statements) { native.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); native.exec('COMMIT'); return results; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
  return { native, db, actors };
}
const call = (f, who, name, args = {}, scope = null) => runRoleTool(f.db, f.actors[who], 'org_proex', name, args, undefined, scope);
const data = result => JSON.parse(result.content);
const titles = result => data(result).resultados.map(item => item.demanda ?? item.projeto ?? item.titulo);
function noPersonalData(result) {
  assert.doesNotMatch(result.content, /@example\.test|-qa\b|Bruno|Ana Coordena|Carla|NOTA-PRIVADA/, 'sem e-mail, identificador ou nome de pessoa');
}
const revoke = (f, who) => f.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(new Date().toISOString(), f.actors[who].userId);

test('ferramentas registradas e esquema dentro do teto', () => {
  for (const name of ['consultar_projetos', 'filtrar_demandas', 'minha_agenda']) assert.ok(ROLE_TOOL_NAMES.includes(name), name);
  assert.ok(ROLE_TOOLS_ACTUAL_SCHEMA_BYTES <= ROLE_TOOLS_SCHEMA_BYTES, `esquema ${ROLE_TOOLS_ACTUAL_SCHEMA_BYTES} <= ${ROLE_TOOLS_SCHEMA_BYTES}`);
});

test('NOME DE PROJETO: "Projeto B" devolve B e só B, também nas ferramentas antigas; sigla de uma letra e "Projeto A" funcionam', async () => {
  const f = fixture();
  const b = await call(f, 'owner', 'consultar_projetos', { projeto: 'Projeto B' });
  assert.deepEqual(titles(b), ['Projeto B']);
  assert.deepEqual(titles(await call(f, 'owner', 'consultar_projetos', { projeto: 'B' })), ['Projeto B']);
  assert.deepEqual(titles(await call(f, 'owner', 'consultar_projetos', { projeto: 'Projeto A' })), ['Projeto A']);
  assert.deepEqual(titles(await call(f, 'owner', 'consultar_projetos', { projeto: 'bem estar' })), ['Projeto Bem-Estar']);
  // Ferramenta antiga (consultar_demandas) usa o mesmo filtro de projeto: "demandas do Projeto B" não traz as do A.
  const old = data(await call(f, 'owner', 'consultar_demandas', { projeto: 'Projeto B' })).resultados;
  assert.deepEqual(old.map(item => item.projeto), ['Projeto B']);
  // Outras buscas por palavra continuam como antes.
  assert.ok(data(await call(f, 'owner', 'consultar_demandas', { texto: 'atrasada' })).resultados.length >= 2);
});

test('PROJETOS: coordenação do A vê A e não B; ficha com responsável, contagens e próximos eventos; bolsista vê A; sem acesso nada; revogar zera', async () => {
  const f = fixture();
  const a = await call(f, 'coordA', 'consultar_projetos');
  const list = data(a).resultados;
  assert.deepEqual(list.map(item => item.projeto), ['Projeto A']);
  const [ficha] = list;
  assert.equal(ficha.responsavel, 'definido');
  assert.equal(ficha.tipo, 'Projeto de extensão');
  assert.equal(ficha.unidade, 'UFQ — Unidade fictícia');
  assert.equal(ficha.fase, 'em andamento');
  assert.equal(ficha.demandasAbertas, 4);
  assert.equal(ficha.demandasAtrasadas, 1);
  assert.ok(ficha.proximosEventos.some(entry => entry.titulo === 'Oficina A'));
  assert.equal(ficha.link, '/?module=projects&project=project-a&detailProject=project-a');
  assert.deepEqual(a.sources.map(source => source.href), [ficha.link]);
  assert.doesNotMatch(a.content, /SEGREDO-B/);
  noPersonalData(a);
  const owner = data(await call(f, 'owner', 'consultar_projetos')).resultados;
  assert.equal(owner.find(item => item.projeto === 'Projeto B').responsavel, 'não definido');
  assert.deepEqual(titles(await call(f, 'bolsista', 'consultar_projetos')), ['Projeto A']);
  assert.deepEqual(titles(await call(f, 'coordB', 'consultar_projetos', { projeto: 'Projeto A' })), []);
  assert.equal((await call(f, 'nobody', 'consultar_projetos')).rows, 0);
  revoke(f, 'coordA');
  assert.equal((await call(f, 'coordA', 'consultar_projetos')).rows, 0);
});

test('DEMANDAS: comigo (direto e pela equipe), atrasadas, por projeto e situação, com link; isolamento entre projetos; revogar zera', async () => {
  const f = fixture();
  const mine = await call(f, 'bolsista', 'filtrar_demandas', { comigo: true });
  assert.deepEqual(titles(mine).sort(), ['A atrasada com bolsista', 'A da equipe', 'A vence hoje']);
  const items = data(mine).resultados;
  assert.equal(items.find(item => item.demanda === 'A da equipe').comigo, 'pela equipe');
  assert.equal(items.find(item => item.demanda === 'A atrasada com bolsista').comigo, 'direto');
  assert.equal(items.find(item => item.demanda === 'A atrasada com bolsista').link, '/?module=demands&project=project-a&demandId=ta-late');
  assert.equal(items[0].demanda, 'A atrasada com bolsista', 'atrasadas primeiro');
  noPersonalData(mine);
  assert.deepEqual(titles(await call(f, 'bolsista', 'filtrar_demandas', { comigo: true, atrasadas: true })), ['A atrasada com bolsista']);
  assert.deepEqual(titles(await call(f, 'coordA', 'filtrar_demandas', { atrasadas: true })), ['A atrasada com bolsista']);
  assert.deepEqual(titles(await call(f, 'coordB', 'filtrar_demandas', { atrasadas: true })), ['B atrasada SEGREDO-B']);
  assert.deepEqual(titles(await call(f, 'coordA', 'filtrar_demandas', { situacao: 'concluidas' })), ['A concluída']);
  assert.deepEqual(titles(await call(f, 'owner', 'filtrar_demandas', { atrasadas: true, projeto: 'Projeto B' })), ['B atrasada SEGREDO-B']);
  // Demandas gerais da organização: só o dono da organização, só sem filtro de projeto e no escopo da organização.
  assert.ok(titles(await call(f, 'owner', 'filtrar_demandas', { atrasadas: true })).includes('Geral da organização atrasada'));
  assert.ok(!titles(await call(f, 'owner', 'filtrar_demandas', { atrasadas: true }, { kind: 'project', id: 'project-a', label: 'o projeto Projeto A', projectIds: ['project-a'] })).includes('Geral da organização atrasada'));
  assert.ok(!titles(await call(f, 'coordA', 'filtrar_demandas', { atrasadas: true })).includes('Geral da organização atrasada'));
  assert.equal(data(await call(f, 'coordA', 'filtrar_demandas', { atrasadas: true })).resultados[0].responsavel, 'definido');
  assert.equal((await call(f, 'nobody', 'filtrar_demandas', { comigo: true })).rows, 0);
  revoke(f, 'bolsista');
  assert.equal((await call(f, 'bolsista', 'filtrar_demandas', { comigo: true })).rows, 0);
  await assert.rejects(call(f, 'owner', 'filtrar_demandas', { comigo: 'sim' }), /verdadeiro ou falso/);
  await assert.rejects(call(f, 'owner', 'filtrar_demandas', { texto: 'x' }), /campos não permitidos/);
});

test('AGENDA: minha semana com atividades do projeto e prazos das minhas demandas; período livre cruza com prazo citado; sem Agenda só prazos', async () => {
  const f = fixture();
  const week = await call(f, 'bolsista', 'minha_agenda');
  const list = data(week).resultados;
  assert.ok(list.some(item => item.tipo === 'atividade' && item.titulo === 'Oficina A' && item.link === '/?module=calendar&project=project-a'));
  assert.ok(list.some(item => item.tipo === 'prazo de demanda' && item.titulo === 'A vence hoje'));
  assert.doesNotMatch(week.content, /SEGREDO-B/);
  noPersonalData(week);
  // Prazo citado (já passado): a mesma ferramenta cruza o período.
  const cited = data(await call(f, 'bolsista', 'minha_agenda', { de: '2020-01-01', ate: '2020-01-31' }));
  assert.deepEqual(cited.resultados.map(item => item.titulo), ['A atrasada com bolsista']);
  assert.equal(cited.periodo, '01/01/2020 a 31/01/2020');
  // Estoque não tem a Agenda dos projetos: vê só os próprios prazos (nenhum aqui) e o aviso.
  const editor = data(await call(f, 'editor', 'minha_agenda'));
  assert.equal(editor.resultados.length, 0);
  assert.match(editor.observacao, /não está disponível/);
  assert.ok(!titles(await call(f, 'coordB', 'minha_agenda')).includes('Oficina A'));
  assert.equal((await call(f, 'nobody', 'minha_agenda')).rows, 0);
  await assert.rejects(call(f, 'owner', 'minha_agenda', { de: '2026-01-01', ate: '2026-06-01' }), /até 62 dias/);
  revoke(f, 'bolsista');
  assert.equal((await call(f, 'bolsista', 'minha_agenda')).rows, 0);
});

test('DEMANDA PRIVADA ENTRE PARES nunca vai para o Rolê, nem para quem participa', { skip: HAS_PRIVATE_TASKS ? false : 'Liga sozinho quando a migração de demandas privadas (PR #212, tabela followup_task_privacy) estiver na main; então troque roleTaskVisible por publicTaskAuthority.' }, async () => {
  const f = fixture(), now = new Date().toISOString();
  const privateTask = (id, project) => {
    f.native.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,due_at,created_by,created_at,updated_at) VALUES(?, 'org_proex', ?, 'PRIVADA-PARES', 'PRIVADA-PARES', 'high', 'open', ?, 'owner-qa', ?, ?)").run(id, project, PAST, now, now);
    f.native.prepare("INSERT INTO followup_task_privacy(task_id,visibility,created_by,created_at,updated_at) VALUES(?,'participants','owner-qa',?,?)").run(id, now, now);
    f.native.prepare('INSERT INTO followup_assignees(id,task_id,user_id,created_at) VALUES(?,?,?,?),(?,?,?,?)').run(`${id}-o`, id, 'owner-qa', now, `${id}-b`, id, 'bolsista-qa', now);
    try { f.native.prepare('INSERT INTO followup_task_participants(id,task_id,user_id,added_by,created_at) VALUES(?,?,?,?,?),(?,?,?,?,?)').run(`${id}-po`, id, 'owner-qa', 'owner-qa', now, `${id}-pb`, id, 'bolsista-qa', 'owner-qa', now); } catch { /* participantes podem ter outro formato */ }
  };
  privateTask('priv-org', null);
  try { privateTask('priv-a', 'project-a'); } catch { /* privada pode ser só da organização */ }
  for (const who of ['owner', 'bolsista']) {
    for (const [name, args] of [['filtrar_demandas', { comigo: true }], ['filtrar_demandas', { atrasadas: true }], ['filtrar_demandas', { situacao: 'todas' }], ['minha_agenda', { de: '2020-01-01', ate: '2020-01-31' }], ['consultar_demandas', { texto: 'PRIVADA' }], ['buscar_no_portal', { texto: 'PRIVADA' }]]) {
      const result = await call(f, who, name, args);
      assert.doesNotMatch(result.content, /PRIVADA-PARES/, `${who} ${name}`);
    }
    // A contagem da ficha do projeto também não conta a privada.
    if (who === 'owner') assert.equal(data(await call(f, who, 'consultar_projetos', { projeto: 'Projeto A' })).resultados[0].demandasAtrasadas, 1);
  }
});
