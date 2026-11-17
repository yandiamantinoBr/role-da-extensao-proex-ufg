import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Rolê, Fase 3: o alcance vem sozinho dos privilégios da pessoa. Sem escolha, vale tudo o que ela vê,
// recalculado a cada pergunta; "Procurar em" só estreita. Dados 100% sintéticos, sem rede e sem IA.
const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
  let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  source = source.replace(/import\(['"](pdfjs-dist\/legacy\/build\/pdf(?:\.worker)?\.mjs)['"]\)/g, (_match, dependency) => `import(${JSON.stringify(import.meta.resolve(dependency))})`);
  const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-fase3-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { runRoleTool, resolveRoleScope } = await import(compile('assistant/role-tools'));
const { calendarEntries, calendarRange } = await import(compile('calendar'));

const brasiliaDay = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const PRIVATE = ['@example.test', 'misto-qa', 'dupla-qa', 'unica-qa'];

function fixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = new Date().toISOString(), today = brasiliaDay(Date.now()), run = (sql, ...values) => native.prepare(sql).run(...values);
  run("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('org_outra','Organização Sintética Dois','sintetica-dois',?,?)", now, now);
  run("INSERT INTO organizational_units(id,name,acronym,kind,status,version,created_at,updated_at) VALUES('unit-a','Unidade Alfa','UA','proex','active',1,?,?),('unit-b','Unidade Beta','UB','proex','active',1,?,?)", now, now, now, now);
  const project = (id, name, org, unit) => run("INSERT INTO projects(id,name,short_name,description,scope,organization_id,unit_id,created_at) VALUES(?,?,?,'','external',?,?,?)", id, name, '', org, unit, now);
  project('proj-a', 'Projeto Alfa', 'org_proex', 'unit-a');
  project('proj-b', 'Projeto Beta', 'org_proex', 'unit-b');
  project('proj-c', 'Projeto Gama', 'org_proex', null);
  project('proj-d', 'Projeto Delta', 'org_outra', null);
  for (const key of ['e', 'f', 'g']) project(`proj-${key}`, `Projeto Extra ${key.toUpperCase()}`, 'org_proex', null);
  const actors = {};
  // misto: coordena A (manager) e é bolsista (viewer) em B; nada em C. dupla: estoque em A e em D (outra organização). unica: só C.
  for (const [userId, links] of [['misto-qa', [['manager', 'proj-a'], ['viewer', 'proj-b']]], ['dupla-qa', [['inventory', 'proj-a'], ['inventory', 'proj-d']]], ['unica-qa', [['inventory', 'proj-c']]],
    // chefe: coordena 6 projetos da PROEX e um da outra organização. misto2: estoque em A, só leitura na outra organização.
    ['chefe-qa', ['proj-a', 'proj-b', 'proj-c', 'proj-e', 'proj-f', 'proj-g', 'proj-d'].map(id => ['manager', id])], ['misto2-qa', [['inventory', 'proj-a'], ['viewer', 'proj-d']]]]) {
    const email = `${userId}@example.test`;
    run("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)", userId, email, now, now);
    const members = links.map(([role, projectId]) => ({ id: `${userId}-${projectId}`, user_id: userId, email, role, project_id: projectId, revoked_at: null, created_at: now }));
    for (const member of members) run('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)', member.id, userId, email, member.role, member.project_id, now);
    actors[userId] = { userId, email, displayName: userId, capabilities: [], members };
  }
  for (const [key, projectId, org] of [['alfa', 'proj-a', 'org_proex'], ['beta', 'proj-b', 'org_proex'], ['gama', 'proj-c', 'org_proex'], ['delta', 'proj-d', 'org_outra']]) {
    run("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'high','open','misto-qa',?,?)", `task-${key}`, org, projectId, `Lote QA ${key}`, `Distribuição QA ${key}`, now, now);
    run("INSERT INTO project_schedule_items(id,project_id,title,starts_at,ends_at,status,note,version,created_at,updated_at) VALUES(?,?,?,?,?,'planned','',1,?,?)", `agenda-${key}`, projectId, `Oficina QA ${key}`, today, today, now, now);
    run("INSERT INTO items(id,project_id,name,category,unit,stock,created_at,updated_at) VALUES(?,?,?,'gift','unidade',5,?,?)", `item-${key}`, projectId, `Caneta QA ${key}`, now, now);
  }
  const db = { prepare(sql) { let values = []; return { sql, bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; } }; }, async batch(statements) { return Promise.all(statements.map(statement => statement.all())); } };
  const scope = (actor, input, org = 'org_proex') => resolveRoleScope(db, actors[actor], org, input);
  // Como a conversa: o escopo é resolvido no servidor a cada pergunta e entregue à ferramenta.
  const ask = async (actor, name, args = {}, input = undefined, org = 'org_proex') => runRoleTool(db, actors[actor], org, name, args, undefined, await scope(actor, input, org));
  return { native, db, actors, scope, ask, today };
}
const found = (result, keys) => keys.filter(key => result.content.includes(`QA ${key}`));
const clean = (result, label) => { for (const text of PRIVATE) assert.ok(!result.content.includes(text), `${label}: sem "${text}"`); };

test('FASE 3: sem escolha, o Rolê cobre tudo o que a pessoa vê e o rótulo diz o recorte', async () => {
  const f = fixture();
  try {
    const misto = await f.scope('misto-qa', undefined);
    assert.equal(misto.kind, 'org');
    assert.equal(misto.projectIds, null, 'cada ferramenta reconfere o acesso no próprio SQL');
    assert.equal(misto.label, 'tudo o que você pode ver: 2 projetos em 1 organização (PROEX UFG), 2 unidades');
    assert.deepEqual(await f.scope('misto-qa', { kind: 'org' }), misto, '"Tudo o que eu posso ver" explícito é o mesmo padrão');
    assert.equal((await f.scope('unica-qa', undefined)).label, 'tudo o que você pode ver: 1 projeto em 1 organização (PROEX UFG)');
  } finally { f.native.close(); }
});

test('FASE 3: papéis mistos (coordena A, bolsista em B, nada em C) dão a cada ferramenta o que cada papel permite', async () => {
  const f = fixture();
  try {
    const demands = await f.ask('misto-qa', 'consultar_demandas', { texto: 'Lote QA' });
    assert.deepEqual(found(demands, ['alfa', 'beta', 'gama', 'delta']), ['alfa', 'beta'], 'demandas: A e B, nunca C nem outra organização');
    const agenda = await f.ask('misto-qa', 'consultar_agenda', { de: f.today, ate: f.today });
    assert.deepEqual(found(agenda, ['alfa', 'beta', 'gama', 'delta']), ['alfa', 'beta'], 'agenda (reports.read): coordenação em A e bolsista em B');
    const stock = await f.ask('misto-qa', 'buscar_no_portal', { texto: 'Caneta QA' });
    assert.deepEqual(found(stock, ['alfa', 'beta', 'gama', 'delta']), ['alfa'], 'materiais (inventory.read): só onde coordena; bolsista em B não vê o estoque');
    for (const [label, result] of [['demandas', demands], ['agenda', agenda], ['busca', stock]]) clean(result, label);
  } finally { f.native.close(); }
});

test('FASE 3: pessoa em duas organizações tem tudo de cada uma na conversa daquela organização, nunca misturado', async () => {
  const f = fixture();
  try {
    const proex = await f.scope('dupla-qa', undefined);
    assert.equal(proex.label, 'tudo o que você pode ver: 1 projeto em 1 organização (PROEX UFG), 1 unidade. A outra organização em que você tem acesso fica fora desta conversa: para ver, escolha um projeto dela em "Procurar em"');
    assert.ok(!proex.label.includes('Sintética'), 'o nome da outra organização não vai ao modelo desta');
    assert.deepEqual(found(await f.ask('dupla-qa', 'consultar_demandas', { texto: 'Lote QA' }), ['alfa', 'beta', 'gama', 'delta']), ['alfa']);
    const outra = await f.scope('dupla-qa', undefined, 'org_outra');
    assert.equal(outra.label, 'tudo o que você pode ver: 1 projeto em 1 organização (Organização Sintética Dois). A outra organização em que você tem acesso fica fora desta conversa: para ver, escolha um projeto dela em "Procurar em"');
    assert.deepEqual(found(await f.ask('dupla-qa', 'consultar_demandas', { texto: 'Lote QA' }, undefined, 'org_outra'), ['alfa', 'beta', 'gama', 'delta']), ['delta']);
    // Quem é de uma só organização não ganha nada da outra, nem pelo escopo.
    assert.equal((await f.scope('unica-qa', undefined, 'org_outra')).label, 'tudo o que você pode ver: 0 projetos em 1 organização (Organização Sintética Dois). A outra organização em que você tem acesso fica fora desta conversa: para ver, escolha um projeto dela em "Procurar em"');
    assert.equal((await f.ask('unica-qa', 'consultar_demandas', { texto: 'Lote QA' }, undefined, 'org_outra')).rows, 0);
    await assert.rejects(f.scope('unica-qa', { kind: 'project', id: 'proj-d' }, 'org_outra'), error => error.code === 'role_scope_forbidden');
  } finally { f.native.close(); }
});

test('FASE 3: "Procurar em" só estreita; recorte que a pessoa não vê e escopo do cliente que tenta ampliar são recusados', async () => {
  const f = fixture();
  try {
    const onlyA = await f.scope('misto-qa', { kind: 'project', id: 'proj-a' });
    assert.deepEqual(onlyA.projectIds, ['proj-a']);
    assert.deepEqual(found(await f.ask('misto-qa', 'consultar_demandas', { texto: 'Lote QA' }, { kind: 'project', id: 'proj-a' }), ['alfa', 'beta', 'gama', 'delta']), ['alfa']);
    assert.deepEqual(found(await f.ask('misto-qa', 'consultar_demandas', { texto: 'Lote QA', projeto: 'Projeto Beta' }, { kind: 'project', id: 'proj-a' }), ['alfa', 'beta']), [], 'nomear outro projeto não escapa do recorte');
    for (const input of [{ kind: 'project', id: 'proj-c' }, { kind: 'project', id: 'proj-d' }, { kind: 'unit', id: 'unit-x' }, { kind: 'org', id: 'org_outra' }]) {
      await assert.rejects(f.scope('misto-qa', input), error => error.status === 403 && error.code === 'role_scope_forbidden', JSON.stringify(input));
    }
    for (const input of [{ kind: 'org', projectIds: ['proj-c', 'proj-d'] }, { kind: 'project', id: 'proj-a', projectIds: ['proj-c'] }, { kind: 'org', organizationId: 'org_outra' }, { kind: 'org', role: 'owner' }]) {
      await assert.rejects(f.scope('misto-qa', input), error => error.status === 400 && error.code === 'role_scope', JSON.stringify(input));
    }
    assert.equal((await f.scope('misto-qa', { kind: 'org', id: 'org_proex' })).kind, 'org', 'a própria organização é aceita');
    assert.equal((await f.scope('misto-qa', { kind: 'org', id: undefined })).kind, 'org', 'id ausente (como nas sugestões) é aceito');
  } finally { f.native.close(); }
});

test('FASE 3: acesso revogado no meio da conversa vale na pergunta seguinte', async () => {
  const f = fixture();
  try {
    assert.deepEqual(found(await f.ask('misto-qa', 'consultar_demandas', { texto: 'Lote QA' }), ['alfa', 'beta']), ['alfa', 'beta']);
    f.native.prepare("UPDATE members SET revoked_at=? WHERE id='misto-qa-proj-a'").run(new Date().toISOString());
    const next = await f.scope('misto-qa', undefined);
    assert.equal(next.label, 'tudo o que você pode ver: 1 projeto em 1 organização (PROEX UFG), 1 unidade');
    assert.deepEqual(found(await f.ask('misto-qa', 'consultar_demandas', { texto: 'Lote QA' }), ['alfa', 'beta']), ['beta'], 'a próxima pergunta não vê A');
    assert.deepEqual(found(await f.ask('misto-qa', 'consultar_agenda', { de: f.today, ate: f.today }), ['alfa', 'beta']), ['beta']);
    await assert.rejects(f.scope('misto-qa', { kind: 'project', id: 'proj-a' }), error => error.code === 'role_scope_forbidden', 'o recorte de A guardado no cliente passa a ser recusado');
  } finally { f.native.close(); }
});

test('FASE 3: a tela abre em "Tudo o que eu posso ver", primeira opção, e não guarda o recorte do projeto da tela', () => {
  const tsx = readFileSync(`${root}components/portal/role-assistant.tsx`, 'utf8');
  assert.ok(/const \[scopeValue, setScopeValue\] = useState\('org'\);/.test(tsx), 'o padrão não é mais o projeto aberto na tela');
  assert.ok(/<select value=\{scopeValue\}[\s\S]*?\}\}>\s*<option value="org">Tudo o que eu posso ver<\/option>\s*\{!!status\?\.scopes\?\.units\.length/.test(tsx), '"Tudo o que eu posso ver" é a primeira opção');
  assert.ok(!tsx.includes('Toda a PROEX'), 'o rótulo antigo saiu');
});

// Revisão da Fase 3: no "tudo" padrão, nenhuma leitura pode varrer outra organização nem perder resultado em silêncio.
const bulk = (f, count, sql, ...values) => f.native.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${count}) ${sql}`).run(...values);

test('REVISÃO 1: minha_agenda no "tudo" não varre a agenda de outra organização (antes: 422 e agenda indisponível)', async () => {
  const f = fixture(), now = new Date().toISOString();
  try {
    bulk(f, 10001, "INSERT INTO project_schedule_items(id,project_id,title,starts_at,ends_at,status,note,version,created_at,updated_at) SELECT 'delta-' || i,'proj-d','Lote outra ' || i,?,?,'planned','',1,?,? FROM n", f.today, f.today, now, now);
    const result = await f.ask('chefe-qa', 'minha_agenda', { de: f.today, ate: f.today });
    assert.ok(result.content.includes('Oficina QA alfa'), 'a agenda da organização da conversa aparece');
    assert.ok(!result.content.includes('não está disponível'), 'sem o aviso de agenda indisponível');
    assert.ok(!result.content.includes('Lote outra'), 'nada da outra organização');
    const proex = await calendarEntries(f.db, f.actors['chefe-qa'], { category: 'projects', organizationId: 'org_proex', range: calendarRange(f.today, f.today) });
    assert.ok(proex.entries.length > 0 && proex.entries.every(entry => entry.projectId !== 'proj-d'), 'o filtro de organização vale no próprio serviço');
    await assert.rejects(calendarEntries(f.db, f.actors['chefe-qa'], { category: 'projects', range: calendarRange(f.today, f.today) }), error => error.status === 422, 'quem chama sem organização continua como antes');
  } finally { f.native.close(); }
});

test('REVISÃO 2: registros_recentes sem projeto filtra a organização da conversa antes de limitar', async () => {
  const f = fixture(), old = new Date(Date.now() - 3 * 86400000).toISOString(), now = new Date().toISOString();
  try {
    f.native.prepare("INSERT INTO records(id,project_id,kind,title,body,occurred_at,created_by,created_at) VALUES('rec-alfa','proj-a','project','Registro QA alfa','',?,'chefe-qa',?)").run(old, old);
    bulk(f, 501, "INSERT INTO records(id,project_id,kind,title,body,occurred_at,created_by,created_at) SELECT 'rec-delta-' || i,'proj-d','project','Registro outra ' || i,'',strftime('%Y-%m-%dT%H:%M:%fZ','now','-' || i || ' seconds'),'chefe-qa',? FROM n", now);
    const result = await f.ask('chefe-qa', 'registros_recentes');
    assert.ok(result.content.includes('Registro QA alfa'), 'o registro da organização da conversa não é empurrado para fora pelos da outra');
    assert.ok(!result.content.includes('Registro outra'));
    const outra = await f.ask('chefe-qa', 'registros_recentes', {}, undefined, 'org_outra');
    assert.ok(outra.content.includes('Registro outra') && !outra.content.includes('Registro QA alfa'), 'e vice-versa');
  } finally { f.native.close(); }
});

test('REVISÃO 3: demandas além das 600 mais recentes ainda são achadas pelo termo; no limite, a consulta avisa', async () => {
  const f = fixture(), now = new Date().toISOString();
  try {
    f.native.prepare("UPDATE followup_tasks SET updated_at='2020-01-01T00:00:00.000Z' WHERE id='task-alfa'").run();
    bulk(f, 600, "INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,created_by,created_at,updated_at) SELECT 'comum-' || i,'org_proex','proj-a','Tarefa comum ' || i,'','low','open','misto-qa',?,? FROM n", now, now);
    const demands = await f.ask('misto-qa', 'consultar_demandas', { texto: 'Lote QA alfa' });
    assert.deepEqual(found(demands, ['alfa']), ['alfa'], 'a demanda antiga com o termo volta');
    const search = await f.ask('misto-qa', 'buscar_no_portal', { texto: 'Distribuição QA alfa' });
    assert.ok(search.content.includes('Lote QA alfa'), 'a busca geral também acha (acento tolerado no SQL)');
    bulk(f, 600, "INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,created_by,created_at,updated_at) SELECT 'lote-' || i,'org_proex','proj-a','Lote QA extra ' || i,'','low','open','misto-qa',?,? FROM n", now, now);
    const full = await f.ask('misto-qa', 'consultar_demandas', { texto: 'Lote QA' });
    assert.match(JSON.parse(full.content).observacao ?? '', /limite/, 'no limite, avisa e pede o projeto');
  } finally { f.native.close(); }
});

test('REVISÃO 4: o rótulo só conta outra organização onde a pessoa consegue conversar (inventory.read)', async () => {
  const f = fixture();
  try {
    assert.equal((await f.scope('misto2-qa', undefined)).label, 'tudo o que você pode ver: 1 projeto em 1 organização (PROEX UFG), 1 unidade');
    assert.match((await f.scope('dupla-qa', undefined)).label, /A outra organização/);
  } finally { f.native.close(); }
});

test('REVISÃO 5: "quem cuida" sem projeto e com escopo amplo olha até 3 projetos e pede qual', async () => {
  const f = fixture(), now = new Date().toISOString();
  try {
    for (const id of ['proj-a', 'proj-b', 'proj-c', 'proj-e', 'proj-f', 'proj-g']) {
      f.native.prepare("INSERT INTO work_responsibility_scopes(id,organization_id,project_id,area,created_by,created_at,updated_at) VALUES(?,'org_proex',?,'materials','chefe-qa',?,?)").run(`resp-${id}`, id, now, now);
      f.native.prepare("INSERT INTO work_responsibility_assignees(id,scope_id,team_id,user_id,created_at) VALUES(?,?,NULL,'chefe-qa',?)").run(`as-${id}`, `resp-${id}`, now);
    }
    const body = JSON.parse((await f.ask('chefe-qa', 'consultar_responsaveis')).content);
    assert.ok(new Set(body.resultados.map(row => row.projeto)).size <= 3, 'até 3 projetos');
    assert.match(body.observacao, /Mostrando 3 de 6 projetos/);
    assert.match(body.observacao, /qual projeto/);
    const one = JSON.parse((await f.ask('chefe-qa', 'consultar_responsaveis', { projeto: 'Projeto Extra G' })).content);
    assert.deepEqual([...new Set(one.resultados.map(row => row.projeto))], ['Projeto Extra G'], 'com projeto, segue normal');
  } finally { f.native.close(); }
});

test('REVISÃO 6: com mais de 400 projetos, o rótulo avisa que as consultas cobrem os primeiros 400', async () => {
  const f = fixture(), now = new Date().toISOString();
  try {
    bulk(f, 401, "INSERT INTO projects(id,name,short_name,description,scope,organization_id,created_at) SELECT 'massa-' || i,'Projeto Massa ' || i,'','','external','org_proex',? FROM n", now);
    f.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES('chefe-org','chefe-qa','chefe-qa@example.test','manager',NULL,'org_proex',?)").run(now);
    const label = (await f.scope('chefe-qa', undefined)).label;
    assert.match(label, /^tudo o que você pode ver: 407 projetos em 1 organização \(PROEX UFG\), 2 unidades; as consultas cobrem os primeiros 400 em ordem alfabética/);
  } finally { f.native.close(); }
});

test('REVISÃO 7: caminhos que não usam o rótulo só validam o formato (sem contar projetos)', async () => {
  const f = fixture();
  try {
    let queries = 0;
    const counting = { ...f.db, prepare(sql) { queries++; return f.db.prepare(sql); } };
    const quick = await resolveRoleScope(counting, f.actors['misto-qa'], 'org_proex', undefined, { label: false });
    assert.equal(queries, 0, 'nenhuma consulta para o "tudo" sem rótulo');
    assert.deepEqual([quick.kind, quick.projectIds], ['org', null]);
    await assert.rejects(resolveRoleScope(counting, f.actors['misto-qa'], 'org_proex', { kind: 'org', projectIds: ['proj-c'] }, { label: false }), error => error.code === 'role_scope');
    await assert.rejects(resolveRoleScope(counting, f.actors['misto-qa'], 'org_proex', { kind: 'project', id: 'proj-c' }, { label: false }), error => error.code === 'role_scope_forbidden', 'recorte que a pessoa não vê continua recusado');
    const role = readFileSync(`${root}lib/assistant/role.ts`, 'utf8');
    assert.equal((role.match(/resolveRoleScope\(db, current, organizationId, input\.scope, \{ label: false \}\)/g) ?? []).length, 4, 'sugestões, planilha de brindes, resposta sem IA e leitura de PDF');
  } finally { f.native.close(); }
});

test('REVISÃO 8: rascunho de demanda sem projeto usa o projeto da conversa quando ele é visível', async () => {
  const f = fixture();
  try {
    const base = await f.scope('misto-qa', undefined), args = { titulo: 'Conferir canetas' };
    const draft = await runRoleTool(f.db, f.actors['misto-qa'], 'org_proex', 'preparar_rascunho_demanda', args, undefined, { ...base, conversationProjectId: 'proj-a' });
    assert.equal(draft.taskDraft?.projectId, 'proj-a');
    const unseen = await runRoleTool(f.db, f.actors['misto-qa'], 'org_proex', 'preparar_rascunho_demanda', args, undefined, { ...base, conversationProjectId: 'proj-c' });
    assert.equal(unseen.taskDraft, undefined, 'projeto da conversa fora do que a pessoa vê não vale');
    assert.match(unseen.content, /Pergunte em qual projeto/);
    assert.ok(/conversationProjectId: project/.test(readFileSync(`${root}lib/assistant/role.ts`, 'utf8')), 'a conversa passa o projeto dela');
  } finally { f.native.close(); }
});
