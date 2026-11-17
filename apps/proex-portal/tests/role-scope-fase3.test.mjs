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
  const actors = {};
  // misto: coordena A (manager) e é bolsista (viewer) em B; nada em C. dupla: estoque em A e em D (outra organização). unica: só C.
  for (const [userId, links] of [['misto-qa', [['manager', 'proj-a'], ['viewer', 'proj-b']]], ['dupla-qa', [['inventory', 'proj-a'], ['inventory', 'proj-d']]], ['unica-qa', [['inventory', 'proj-c']]]]) {
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
