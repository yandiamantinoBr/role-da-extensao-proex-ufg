import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

// Dados 100% sintéticos. A origem "Feito pelo Rolê a pedido de…" e o pedido só saem na lista da tela Registros.
const root = fileURLToPath(new URL('../', import.meta.url));
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const overrides = new Map([
  [resolve(root, 'lib/session.ts'), dataModule('export async function getPortalUser(){return globalThis.__originUser??null;}')],
  [resolve(root, 'lib/platform.ts'), dataModule('export function database(){return globalThis.__originDb;} export function bucket(){return null;}')],
]);
const modules = new Map();
function compile(file) {
  file = resolve(root, file);
  if (overrides.has(file)) return overrides.get(file);
  if (modules.has(file)) return modules.get(file);
  if (file.endsWith('.json')) { const json = dataModule(`export default ${readFileSync(file, 'utf8')}`); modules.set(file, json); return json; }
  let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, dependency) => `from ${JSON.stringify(compile(resolve(dirname(file), /\.(ts|json)$/.test(dependency) ? dependency : `${dependency}.ts`)))}`);
  const url = dataModule(`${code}\n//# sourceURL=${file.replace(root, '')}-under-test.mjs`);
  modules.set(file, url);
  return url;
}
const { listRecords, withRecordOrigins } = await import(compile('lib/records.ts'));
const route = await import(compile('app/api/records/route.ts'));
const { activityFeed } = await import(compile('lib/activity.ts'));
const { projectDetail } = await import(compile('lib/projects.ts'));
const { runRoleTool } = await import(compile('lib/assistant/role-tools.ts'));

// Relógio fixo: 10/11/2026 12:00 em Brasília.
const NOW = Date.parse('2026-11-10T15:00:00.000Z');
const at = (day, hour = 12) => new Date(Date.parse(`${day}T${String(hour + 3).padStart(2, '0')}:00:00.000Z`)).toISOString();
const PEDIDO = 'PEDIDO-SINTETICO registre a observação do turno da manhã com um texto bem comprido para a linha quebrar';
const LABEL = 'Feito pelo Rolê a pedido de Gestora Sintética';

function fixture() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const created = at('2026-10-01');
  for (const id of ['project-a', 'project-b']) native.prepare("INSERT INTO projects(id,name,created_at,organization_id) VALUES(?,?,?,'org_proex')").run(id, `Projeto ${id.slice(-1).toUpperCase()}`, created);
  const prepare = sql => {
    let values = [];
    return {
      sql,
      bind(...args) { values = args; return this; },
      async first(column) { const row = native.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return { success: true, results: native.prepare(sql).all(...values) }; },
      async run() { const result = native.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
      execute() { const result = native.prepare(sql).all(...values); return { success: true, results: result, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; },
    };
  };
  return { native, prepare, async batch(statements) { native.exec('BEGIN'); try { const result = statements.map(statement => statement.execute()); native.exec('COMMIT'); return result; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
}
function person(db, role, project, name) {
  const userId = crypto.randomUUID(), now = at('2026-10-01');
  const member = { id: crypto.randomUUID(), user_id: userId, email: `${userId}@example.invalid`, role, project_id: project, revoked_at: null, created_at: now };
  db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?)').run(...Object.values(member));
  db.native.prepare('INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(userId, member.email, 'active', now, now);
  if (name) db.native.prepare('INSERT INTO profiles(user_id,display_name,version,created_at,updated_at) VALUES(?,?,1,?,?)').run(userId, name, now, now);
  return { userId, email: member.email, displayName: name ?? role, members: [member], capabilities: [], organizationProjects: {} };
}
function setup() {
  const db = fixture();
  const actors = { managerA: person(db, 'manager', 'project-a', 'Gestora Sintética'), managerB: person(db, 'manager', 'project-b', 'Gestor do B') };
  const record = (id, project, title) => db.native.prepare("INSERT INTO records(id,project_id,kind,title,body,occurred_at,created_by,created_at) VALUES(?,?,'observation',?,'Texto sintético',?,?,?)").run(id, project, title, at('2026-11-10', 9), actors.managerA.userId, at('2026-11-10', 9));
  const plan = (id, actorId, project, result, status = 'applied') => db.native.prepare("INSERT INTO ai_plans(id,actor_id,project_id,payload_json,payload_digest,expires_at,status,result_json,created_at) VALUES(?,?,?,'{}',?,0,?,?,?)").run(id, actorId, project, id, status, typeof result === 'string' ? result : JSON.stringify(result), at('2026-11-10', 9));
  record('rec-role', 'project-a', 'Registro do Rolê'); plan('plan-role', actors.managerA.userId, 'project-a', { ok: true, recordId: 'rec-role', origin: PEDIDO });
  record('rec-hand', 'project-a', 'Registro feito à mão');
  record('rec-obj', 'project-a', 'Registro com origem fora do formato'); plan('plan-obj', actors.managerA.userId, 'project-a', { ok: true, recordId: 'rec-obj', origin: { texto: 'PEDIDO-OBJETO' } });
  record('rec-old', 'project-a', 'Registro do Rolê sem pedido guardado'); plan('plan-old', actors.managerA.userId, 'project-a', { ok: true, recordId: 'rec-old' });
  record('rec-ghost', 'project-a', 'Registro de conta que não existe mais'); plan('plan-ghost', 'conta-sintetica-apagada', 'project-a', { ok: true, recordId: 'rec-ghost', origin: 'PEDIDO-FANTASMA' });
  // Nada disto marca um registro: prévia não confirmada, resultado ilegível e plano de outro projeto apontando para o registro.
  record('rec-ready', 'project-a', 'Registro com prévia não confirmada'); plan('plan-ready', actors.managerA.userId, 'project-a', { ok: true, recordId: 'rec-ready', origin: 'PEDIDO-NAO-CONFIRMADO' }, 'ready');
  plan('plan-broken', actors.managerA.userId, 'project-a', 'isto não é um resultado válido rec-hand');
  record('rec-cross', 'project-a', 'Registro apontado por plano de outro projeto'); plan('plan-cross', actors.managerB.userId, 'project-b', { ok: true, recordId: 'rec-cross', origin: 'PEDIDO-DE-OUTRO-PROJETO' });
  record('rec-b', 'project-b', 'Registro do projeto B'); plan('plan-b', actors.managerB.userId, 'project-b', { ok: true, recordId: 'rec-b', origin: 'PEDIDO-DO-B' });
  return { db, actors };
}
const byId = (records, id) => records.find(record => record.id === id);
function transport(db, actor) { globalThis.__originDb = db; globalThis.__originUser = actor ? { userId: actor.userId, email: actor.email, displayName: actor.displayName, hasPassword: false } : null; }
const get = async query => { const response = await route.GET(new Request(`https://portal.example.invalid/api/records${query}`)); return { status: response.status, body: await response.json() }; };

test('the HTTP activity response rechecks scope after enriching origin metadata',async()=>{
  const {db}=setup();
  try {
    const viewer=person(db,'viewer','project-a','Leitor sintético');
    const occurs=at('2026-11-10');
    db.native.prepare("INSERT INTO project_schedule_items(id,project_id,title,starts_at,ends_at,created_at,updated_at) VALUES('action-qa','project-a','Título privado de QA',?,?,?,?)").run(occurs,occurs,occurs,occurs);
    db.native.prepare("UPDATE records SET schedule_item_id='action-qa' WHERE id='rec-role'").run();
    let revoked=false;
    const prepare=db.prepare;
    db.prepare=sql=>{
      const statement=prepare(sql);
      if(sql.includes('FROM ai_plans a LEFT JOIN profiles p')){
        const all=statement.all;
        statement.all=async()=>{
          const result=await all();
          db.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(occurs,viewer.userId);
          revoked=true;
          return result;
        };
      }
      return statement;
    };
    transport(db,viewer);
    const result=await get('?projectId=project-a&scheduleItemId=action-qa');
    assert.equal(revoked,true);
    assert.equal(result.status,404);
    assert.equal(result.body.records,undefined);
    assert.equal(result.body.scheduleItem,undefined);
  }finally{transport(null,null);db.native.close();}
});

test('ORIGEM: registro gravado pelo Rolê lista quem pediu e o pedido; registro feito à mão não tem origem', async () => {
  const { db, actors } = setup();
  try {
    const listed = await listRecords(db, actors.managerA, { projectId: 'project-a' });
    const records = await withRecordOrigins(db, listed.records);
    assert.equal(records.length, listed.records.length, 'a origem não acrescenta nem tira registro');
    assert.deepEqual(byId(records, 'rec-role').origin, { via: 'assistant', label: LABEL, summary: PEDIDO });
    assert.ok(!('origin' in byId(records, 'rec-hand')), 'registro feito à mão segue sem origem');
    assert.equal(byId(records, 'rec-hand'), byId(listed.records, 'rec-hand'), 'registro sem origem volta como veio');
    // Origem guardada fora do formato de texto, ou plano antigo sem o pedido: só quem pediu.
    assert.deepEqual(byId(records, 'rec-obj').origin, { via: 'assistant', label: LABEL });
    assert.deepEqual(byId(records, 'rec-old').origin, { via: 'assistant', label: LABEL });
    assert.ok(!JSON.stringify(records).includes('PEDIDO-OBJETO'));
    // Conta que não existe mais: nome neutro, como nos movimentos de material.
    assert.deepEqual(byId(records, 'rec-ghost').origin, { via: 'assistant', label: 'Feito pelo Rolê a pedido de Equipe', summary: 'PEDIDO-FANTASMA' });
    assert.ok(!('origin' in byId(records, 'rec-ready')), 'prévia não confirmada não marca o registro');
    assert.ok(!('origin' in byId(records, 'rec-cross')), 'plano de outro projeto não marca o registro');
    assert.ok(!JSON.stringify(records).includes('PEDIDO-NAO-CONFIRMADO') && !JSON.stringify(records).includes('PEDIDO-DE-OUTRO-PROJETO'), 'nem empresta o pedido');
    assert.deepEqual(await withRecordOrigins(db, []), []);
    // Listas grandes são consultadas em partes; o registro do Rolê continua marcado.
    const many = [...Array.from({ length: 150 }, (_unused, index) => ({ id: `sem-plano-${index}`, project_id: 'project-a' })), { id: 'rec-role', project_id: 'project-a' }, ...Array.from({ length: 49 }, (_unused, index) => ({ id: `outro-${index}`, project_id: 'project-a' }))];
    const marked = await withRecordOrigins(db, many);
    assert.equal(marked.length, 200);
    assert.deepEqual(marked.filter(row => row.origin).map(row => row.id), ['rec-role']);
    // Registro de um projeto com o mesmo id em outro projeto não herda a origem.
    assert.ok(!('origin' in (await withRecordOrigins(db, [{ id: 'rec-role', project_id: 'project-b' }]))[0]));
  } finally { db.native.close(); }
});

test('ORIGEM: GET /api/records entrega a origem só dos registros que a pessoa já podia listar', async () => {
  const { db, actors } = setup();
  try {
    transport(db, actors.managerA);
    const mine = await get('?projectId=project-a');
    assert.equal(mine.status, 200);
    assert.deepEqual(byId(mine.body.records, 'rec-role').origin, { via: 'assistant', label: LABEL, summary: PEDIDO });
    assert.ok(!('origin' in byId(mine.body.records, 'rec-hand')));
    assert.deepEqual(byId(mine.body.records, 'rec-obj').origin, { via: 'assistant', label: LABEL });
    assert.ok(!byId(mine.body.records, 'rec-b') && !JSON.stringify(mine.body).includes('PEDIDO-DO-B'), 'nada do outro projeto');
    assert.equal(typeof mine.body.limit, 'number');
    assert.equal(mine.body.truncated, false);
    // Quem é só do projeto B: não lista o A e, sem filtro, recebe só o que é do B.
    transport(db, actors.managerB);
    assert.equal((await get('?projectId=project-a')).status, 403);
    const other = await get('');
    assert.deepEqual(other.body.records.map(record => record.id), ['rec-b']);
    assert.deepEqual(other.body.records[0].origin, { via: 'assistant', label: 'Feito pelo Rolê a pedido de Gestor do B', summary: 'PEDIDO-DO-B' });
    assert.ok(!JSON.stringify(other.body).includes('PEDIDO-SINTETICO') && !JSON.stringify(other.body).includes('Gestora Sintética'));
    transport(db, null);
    assert.ok((await get('?projectId=project-a')).status >= 400, 'sem entrar, nenhuma lista');
  } finally { db.native.close(); transport(null, null); }
});

test('ORIGEM: o histórico geral, a ficha do projeto e a consulta do Rolê não recebem o pedido', async () => {
  const { db, actors } = setup();
  try {
    // Histórico geral: marca que veio do Rolê, sem o texto do pedido.
    const feed = await activityFeed(db, actors.managerA, { from: '2026-11-01', to: '2026-11-10' }, NOW);
    assert.equal(feed.events.find(event => event.id === 'records:rec-role').viaRole, true);
    assert.equal(feed.events.find(event => event.id === 'records:rec-hand').viaRole, false);
    assert.ok(!JSON.stringify(feed).includes('PEDIDO-'), 'o pedido feito ao Rolê não sai no histórico geral');
    assert.ok(!JSON.stringify(feed).includes('Feito pelo Rolê a pedido de'));

    // listRecords continua igual para quem já a usava: sem origem e sem o texto.
    const listed = await listRecords(db, actors.managerA, { projectId: 'project-a' });
    assert.ok(listed.records.length >= 6 && listed.records.every(record => !('origin' in record)));
    assert.ok(!JSON.stringify(listed).includes('PEDIDO-'));

    // Ficha do projeto (lib/projects.ts).
    const detail = await projectDetail(db, actors.managerA, 'project-a');
    assert.ok(detail.relationships.records.some(record => record.id === 'rec-role'));
    assert.ok(detail.relationships.records.every(record => !('origin' in record)));
    assert.ok(!JSON.stringify(detail).includes('PEDIDO-') && !JSON.stringify(detail).includes('Feito pelo Rolê a pedido de'));

    // Consulta "registros_recentes" do Rolê (lib/assistant/role-tools.ts).
    const tool = await runRoleTool(db, actors.managerA, 'org_proex', 'registros_recentes', {});
    assert.ok(tool.rows > 0 && tool.content.includes('Registro do Rolê'));
    assert.ok(!tool.content.includes('PEDIDO-') && !tool.content.includes('a pedido de') && !JSON.stringify(tool.sources).includes('PEDIDO-'));
  } finally { db.native.close(); }
});
