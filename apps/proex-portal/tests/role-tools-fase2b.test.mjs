import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Rolê, Fase 2b: estoque (saldo baixo e projeto que hospeda a dinâmica), empréstimos, níveis e
// "quem cuida". Dados 100% sintéticos, sem rede e sem IA: só as ferramentas de leitura.
const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
  let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  source = source.replace(/import\(['"](pdfjs-dist\/legacy\/build\/pdf(?:\.worker)?\.mjs)['"]\)/g, (_match, dependency) => `import(${JSON.stringify(import.meta.resolve(dependency))})`);
  const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-fase2b-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { runRoleTool, resolveRoleScope, ROLE_TOOLS_ACTUAL_SCHEMA_BYTES, ROLE_TOOL_NAMES } = await import(compile('assistant/role-tools'));
const { ROLE_TOOLS_SCHEMA_BYTES, ROLE_TOOL_RESULT_BYTES } = await import(compile('assistant/role-contracts'));

const DAY = 86400000;
const brasiliaDay = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
// Nada disto pode chegar ao modelo.
const PRIVATE = ['Pessoa Privada', 'contato@privado.invalid', '@example.test', 'coord-a', 'bolsista-a', 'SEGREDO-B'];

function fixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = new Date().toISOString(), t = Date.now(), run = (sql, ...values) => native.prepare(sql).run(...values);
  run("INSERT INTO projects(id,name,short_name,description,scope,organization_id,created_at) VALUES('proj-role','Rolê da Extensão','RE','','external','org_proex',?),('proj-conpeex','CONPEEX','CPX','','external','org_proex',?),('proj-b','Projeto B','B','','external','org_proex',?)", now, now, now);
  const actors = {};
  for (const [userId, role, projects] of [['coord-a', 'manager', ['proj-role', 'proj-conpeex']], ['bolsista-a', 'viewer', ['proj-role']], ['coord-b', 'manager', ['proj-b']], ['sem-acesso', null, []]]) {
    const email = `${userId}@example.test`;
    run("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)", userId, email, now, now);
    const members = projects.map(project => ({ id: `${userId}-${project}`, user_id: userId, email, role, project_id: project, organization_id: 'org_proex', revoked_at: null, created_at: now }));
    for (const member of members) run('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)', member.id, userId, email, role, member.project_id, now);
    actors[userId] = { userId, email, displayName: userId, capabilities: [], members };
  }
  run("INSERT INTO profiles(user_id,display_name,created_at,updated_at) VALUES('coord-a','Coordenação Sintética',?,?)", now, now);
  const item = (id, project, name, category, stock, reserved, low) => run('INSERT INTO items(id,project_id,name,category,unit,stock,reserved,low_stock,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', id, project, name, category, 'unidade', stock, reserved, low, now, now);
  item('planner', 'proj-role', 'Planner', 'gift', 0, 0, 5);
  item('caneta', 'proj-role', 'Caneta', 'gift', 50, 0, 10);
  item('botton', 'proj-role', 'Botton', 'gift', 8, 2, 10);
  item('projetor', 'proj-role', 'Projetor QA', 'equipment', 1, 0, 0);
  for (const n of [2, 3, 4]) item(`camera-${n}`, 'proj-role', `Câmera QA ${n}`, 'equipment', 1, 0, 0);
  item('planner-b', 'proj-b', 'Planner SEGREDO-B', 'gift', 3, 0, 5);
  item('projetor-b', 'proj-b', 'Projetor SEGREDO-B', 'equipment', 1, 0, 0);
  run("INSERT INTO campaigns(id,project_id,name,starts_at,ends_at,status,created_at) VALUES('camp-conpeex','proj-role','Dinâmica CONPEEX 2026',?,?,'draft',?),('camp-b','proj-b','Dinâmica SEGREDO-B',?,?,'draft',?)", now, now, now, now, now, now);
  run("INSERT INTO offers(id,project_id,name,kind,active) VALUES('of-meio','proj-role','Meio planner','brinde',1),('of-kit','proj-role','Kit agenda','super',1),('of-fora','proj-role','Atividade de outro campus','super',1)");
  run("INSERT INTO offer_components(offer_id,item_id,quantity) VALUES('of-meio','planner',1),('of-kit','botton',2)");
  run("INSERT INTO campaign_prize_settings(campaign_id,super_super_percent,version,updated_by,updated_at) VALUES('camp-conpeex',25,1,'coord-a',?)", now);
  run("INSERT INTO campaign_prize_tiers(campaign_id,offer_id,tier,updated_by,updated_at) VALUES('camp-conpeex','of-meio','brinde','coord-a',?),('camp-conpeex','of-kit','super','coord-a',?)", now, now);
  const loan = (id, project, itemId, status, start, end) => run("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,borrower_contact,starts_at,ends_at,status,created_by,created_at) VALUES(?,?,?,?,'Pessoa Privada','contato@privado.invalid',?,?,?,'coord-a',?)", id, project, itemId, `Ação ${id}`, start, end, status, now);
  loan('atrasado', 'proj-role', 'projetor', 'out', t - 2 * 3600000, t - 3600000);
  loan('longo', 'proj-role', 'camera-2', 'out', t - 5 * DAY, t + 5 * DAY);
  loan('reserva', 'proj-role', 'camera-3', 'reserved', t + 2 * DAY, t + 3 * DAY);
  loan('devolvido', 'proj-role', 'camera-4', 'returned', t - 10 * DAY, t - 8 * DAY);
  loan('segredo', 'proj-b', 'projetor-b', 'out', t - DAY, t + DAY);
  run("INSERT INTO followup_teams(id,organization_id,name,created_by,created_at,updated_at) VALUES('team-estoque','org_proex','Equipe Estoque QA','coord-a',?,?),('team-b','org_proex','Equipe SEGREDO-B','coord-b',?,?)", now, now, now, now);
  run("INSERT INTO work_responsibility_scopes(id,organization_id,project_id,area,created_by,created_at,updated_at) VALUES('resp-estoque','org_proex','proj-role','materials','coord-a',?,?),('resp-b','org_proex','proj-b','materials','coord-b',?,?)", now, now, now, now);
  run("INSERT INTO work_responsibility_assignees(id,scope_id,team_id,user_id,created_at) VALUES('as-1','resp-estoque','team-estoque',NULL,?),('as-2','resp-estoque',NULL,'coord-a',?),('as-3','resp-b','team-b',NULL,?)", now, now, now);
  const db = { prepare(sql) { let values = []; return { sql, bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; }, execute() { const results = native.prepare(sql).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; } }; }, async batch(statements) { native.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); native.exec('COMMIT'); return results; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
  const call = (actor, name, args = {}, scope = null, budget = undefined) => runRoleTool(db, actors[actor], 'org_proex', name, args, budget, scope);
  return { native, db, actors, call };
}
const parse = result => JSON.parse(result.content);
const clean = (result, label) => { for (const text of PRIVATE) assert.ok(!result.content.includes(text), `${label}: sem "${text}"`); assert.ok(new TextEncoder().encode(result.content).byteLength <= ROLE_TOOL_RESULT_BYTES, `${label}: cabe no orçamento`); };

test('FASE 2b: estoque com limite de alerta real, resumo por projeto e link para Materiais', async () => {
  const f = fixture();
  try {
    const low = await f.call('coord-a', 'consultar_estoque', { saldo_baixo: true });
    const body = parse(low);
    assert.deepEqual(body.resultados.map(row => [row.material, row.disponivel, row.alerta, row.situacao]).sort(), [['Botton', 6, 10, 'saldo baixo'], ['Planner', 0, 5, 'sem saldo (atingiu o alerta)']]);
    assert.deepEqual(body.porProjeto, [{ projeto: 'Rolê da Extensão', materiais: 2, saldoBaixo: 2, link: '/?module=materials&project=proj-role' }]);
    assert.ok(low.sources.some(source => source.href === '/?module=materials&project=proj-role'), 'a tela Materiais filtrada pelo projeto entra nas fontes');
    assert.ok(low.sources.some(source => source.href === '/?module=materials&project=proj-role&itemId=planner'));
    clean(low, 'saldo baixo');
    const everything = await f.call('coord-a', 'consultar_estoque');
    assert.equal(parse(everything).resultados.find(row => row.material === 'Caneta').situacao, 'ok');
    assert.equal(parse(everything).resultados.find(row => row.material === 'Projetor QA').alerta, null, 'equipamento não tem alerta de saldo');
    clean(everything, 'estoque');
    assert.equal((await f.call('coord-a', 'consultar_estoque', { projeto: 'Projeto B' })).rows, 0, 'coordenação de A não abre B pelo nome');
    assert.equal((await f.call('coord-a', 'consultar_estoque', { projeto: 'B' })).rows, 0, 'nem pela sigla');
    const b = await f.call('coord-b', 'consultar_estoque', { projeto: 'B' });
    assert.ok(b.content.includes('Planner SEGREDO-B') && !b.content.includes('Rolê da Extensão'), 'a sigla de uma letra acha o projeto de quem o vê');
    await assert.rejects(f.call('coord-a', 'consultar_estoque', { saldo_baixo: 'sim' }), error => error.code === 'role_tool_input');
    await assert.rejects(f.call('coord-a', 'consultar_estoque', { sql: 'DROP' }), error => error.code === 'role_tool_input');
  } finally { f.native.close(); }
});

test('FASE 2b: "quantos planners no CONPEEX" acha o item no projeto que hospeda a dinâmica', async () => {
  const f = fixture();
  try {
    const result = await f.call('coord-a', 'consultar_estoque', { material: 'planners', projeto: 'CONPEEX' });
    const body = parse(result);
    assert.equal(body.resultados.length, 1);
    assert.deepEqual([body.resultados[0].material, body.resultados[0].projeto, body.resultados[0].saldo], ['Planner', 'Rolê da Extensão', 0]);
    assert.deepEqual(body.hospedagem, [{ projeto: 'Rolê da Extensão', dinamicas: ['Dinâmica CONPEEX 2026'] }]);
    assert.ok(!body.observacao.includes('Rolê') && !body.observacao.includes('CONPEEX'), 'observação só com texto fixo, sem nomes cadastrados');
    clean(result, 'planners CONPEEX');
    assert.equal(parse(await f.call('coord-a', 'consultar_estoque', { material: 'planner', projeto: 'evento do CONPEEX' })).resultados.length, 1, 'palavras genéricas não atrapalham');
    const event = await resolveRoleScope(f.db, f.actors['coord-a'], 'org_proex', { kind: 'event', id: 'camp-conpeex' });
    assert.equal((await f.call('coord-a', 'consultar_estoque', { material: 'planner' }, event)).rows, 1, 'no escopo do evento, o estoque é o do projeto que o hospeda');
  } finally { f.native.close(); }
});

test('FASE 2b: níveis exatamente como cadastrados; nível vazio dito assim, sem "sem nível"', async () => {
  const f = fixture();
  try {
    for (const args of [{ dinamica: 'CONPEEX' }, { projeto: 'CONPEEX' }]) {
      const result = await f.call('coord-a', 'consultar_niveis_dinamica', args);
      const [row] = parse(result).resultados;
      assert.deepEqual(row.niveis, [
        { nivel: 'Brinde', opcoes: [{ opcao: 'Meio planner', componentes: ['Planner × 1'] }] },
        { nivel: 'Super', opcoes: [{ opcao: 'Kit agenda', componentes: ['Botton × 2'] }] },
        { nivel: 'Super Super', opcoes: 'nenhuma opção cadastrada neste nível' },
      ], JSON.stringify(args));
      assert.deepEqual(row.foraDestaDinamica, ['Atividade de outro campus']);
      assert.equal(row.situacao, 'rascunho');
      assert.ok(!('semNivel' in row) && !('sorteioSuperSuper' in row), 'sem nível inventado nem sorteio de nível vazio');
      assert.deepEqual(result.sources, [{ label: 'Dinâmica CONPEEX 2026 · níveis', href: '/?module=events&project=proj-role&campaignId=camp-conpeex' }]);
      clean(result, 'níveis');
    }
    const search = await f.call('coord-a', 'buscar_no_portal', { texto: 'CONPEEX' });
    const dynamic = parse(search).resultados.find(row => row.tipo === 'dinâmica');
    assert.deepEqual(dynamic.niveis, [{ nivel: 'Brinde', opcoes: ['Meio planner'] }, { nivel: 'Super', opcoes: ['Kit agenda'] }, { nivel: 'Super Super', opcoes: 'nenhuma opção cadastrada neste nível' }], 'a busca geral usa a mesma forma');
    const viewer = await f.call('bolsista-a', 'consultar_niveis_dinamica', { dinamica: 'CONPEEX' });
    assert.equal(viewer.rows, 1, 'bolsista vê os níveis, como no painel (somente consulta)');
    assert.equal((await f.call('coord-a', 'consultar_niveis_dinamica', { dinamica: 'SEGREDO' })).rows, 0);
  } finally { f.native.close(); }
});

test('FASE 2b: empréstimos com situação, atrasos e critério de sobreposição, sem quem pegou', async () => {
  const f = fixture();
  try {
    const open = await f.call('coord-a', 'consultar_emprestimos');
    const body = parse(open);
    assert.deepEqual(body.contagem, { retirados: 2, emAtraso: 1, reservados: 1 });
    assert.deepEqual(body.resultados.map(row => row.situacao).sort(), ['Em atraso', 'Reservado', 'Retirado']);
    assert.equal(open.sources[0].href, '/?module=loans&project=proj-role&loanId=atrasado');
    clean(open, 'empréstimos');
    assert.deepEqual(parse(await f.call('coord-a', 'consultar_emprestimos', { situacao: 'atrasados' })).resultados.map(row => row.acao), ['Ação atrasado']);
    assert.deepEqual(parse(await f.call('coord-a', 'consultar_emprestimos', { situacao: 'reservados' })).resultados.map(row => row.acao), ['Ação reserva']);
    const today = parse(await f.call('coord-a', 'consultar_emprestimos', { situacao: 'todos', de: brasiliaDay(Date.now()), ate: brasiliaDay(Date.now()) }));
    assert.ok(today.resultados.some(row => row.acao === 'Ação longo'), 'começou antes e termina depois do período: entra');
    assert.ok(!today.resultados.some(row => row.acao === 'Ação reserva' || row.acao === 'Ação devolvido'));
    assert.match(today.observacao, /em curso em algum momento/);
    const past = parse(await f.call('coord-a', 'consultar_emprestimos', { situacao: 'todos', de: brasiliaDay(Date.now() - 9 * DAY), ate: brasiliaDay(Date.now() - 9 * DAY) }));
    assert.deepEqual(past.resultados.map(row => [row.acao, row.situacao]), [['Ação devolvido', 'Devolvido']]);
    await assert.rejects(f.call('coord-a', 'consultar_emprestimos', { de: '2026-11-20', ate: '2026-11-10' }), error => error.code === 'role_tool_input');
    await assert.rejects(f.call('coord-a', 'consultar_emprestimos', { situacao: 'perdidos' }), error => error.code === 'role_tool_input');
    assert.equal((await f.call('bolsista-a', 'consultar_emprestimos')).rows, 0, 'bolsista não vê empréstimos, como na tela');
  } finally { f.native.close(); }
});

test('FASE 2b: "quem cuida do estoque no evento" usa as designações da ficha do projeto', async () => {
  const f = fixture();
  try {
    const result = await f.call('coord-a', 'consultar_responsaveis', { projeto: 'CONPEEX', area: 'estoque' });
    const body = parse(result);
    assert.equal(body.resultados.length, 1);
    const [row] = body.resultados;
    assert.deepEqual([row.projeto, row.papel, row.alvo, row.situacao, row.voceEstaEntre], ['Rolê da Extensão', 'cuida do estoque', 'toda a área', 'responsável definido', true]);
    assert.deepEqual(row.responsaveis.sort(), ['Coordenação Sintética', 'Equipe Estoque QA (equipe)'], 'nomes como a ficha mostra a quem vê o projeto');
    assert.equal(row.link, '/?module=materials&project=proj-role', 'leva à tela Materiais, onde fica o painel de quem cuida');
    assert.deepEqual(body.semResponsavelDefinido, ['Estoque · CONPEEX'], 'o projeto CONPEEX não tem quem cuide do estoque');
    clean(result, 'responsáveis');
    const viewer = await f.call('bolsista-a', 'consultar_responsaveis', {});
    assert.equal(viewer.rows, 1, 'bolsista vê quem cuida, como na ficha do projeto');
    assert.ok(!viewer.content.includes('voceEstaEntre'));
    assert.equal((await f.call('coord-a', 'consultar_responsaveis', { projeto: 'Projeto B' })).rows, 0);
    await assert.rejects(f.call('coord-a', 'consultar_responsaveis', { area: 'tudo' }), error => error.code === 'role_tool_input');
  } finally { f.native.close(); }
});

test('FASE 2b: sem acesso nada sai; revogar no meio da conversa zera a próxima chamada', async () => {
  const f = fixture();
  try {
    const calls = [['consultar_estoque', {}], ['consultar_niveis_dinamica', { dinamica: 'CONPEEX' }], ['consultar_emprestimos', {}], ['consultar_responsaveis', {}]];
    for (const [name, args] of calls) assert.equal((await f.call('sem-acesso', name, args)).rows, 0, `${name} sem acesso`);
    for (const [name, args] of calls) assert.ok((await f.call('coord-a', name, args)).rows > 0, `${name} antes de revogar`);
    for (const [name, args] of calls) { const outsider = await f.call('coord-b', name, args); assert.ok(!outsider.content.includes('Rolê da Extensão') && !outsider.content.includes('CONPEEX 2026'), `${name}: B não vê A`); }
    // O objeto da pessoa continua com os vínculos antigos: a revogação vale porque cada consulta reconfere no SQL.
    f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='coord-a'").run(new Date().toISOString());
    for (const [name, args] of calls) assert.equal((await f.call('coord-a', name, args)).rows, 0, `${name} depois de revogar`);
  } finally { f.native.close(); }
});

test('FASE 2b: ferramentas registradas e esquema dentro do teto', () => {
  for (const name of ['consultar_estoque', 'consultar_niveis_dinamica', 'consultar_emprestimos', 'consultar_responsaveis']) assert.equal(ROLE_TOOL_NAMES.filter(entry => entry === name).length, 1, name);
  assert.ok(ROLE_TOOLS_ACTUAL_SCHEMA_BYTES <= ROLE_TOOLS_SCHEMA_BYTES, `esquema ${ROLE_TOOLS_ACTUAL_SCHEMA_BYTES} <= ${ROLE_TOOLS_SCHEMA_BYTES}`);
});

// Revisão independente (P2/P3): orçamento, listas cortadas, ordem e contagem, período, filtros e escopo.
test('REVISÃO 2b: o orçamento vale mesmo sem itens; hospedagem estruturada com no máximo 5 projetos', async () => {
  const f = fixture();
  try {
    const now = new Date().toISOString();
    for (let n = 1; n <= 6; n++) {
      f.native.prepare("INSERT INTO projects(id,name,description,scope,organization_id,created_at) VALUES(?,?,'','external','org_proex',?)").run(`proj-h${n}`, `Projeto Hospedeiro ${n} com nome bem comprido para ocupar espaço`, now);
      f.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run(`coord-a-h${n}`, 'coord-a', 'coord-a@example.test', 'manager', `proj-h${n}`, now);
      f.native.prepare("INSERT INTO campaigns(id,project_id,name,starts_at,ends_at,status,created_at) VALUES(?,?,?,?,?,'draft',?)").run(`camp-h${n}`, `proj-h${n}`, `CONPEEX extra ${n}`, now, now, now);
    }
    const body = parse(await f.call('coord-a', 'consultar_estoque', { projeto: 'CONPEEX' }));
    assert.equal(body.hospedagem.length, 5, 'no máximo 5 projetos');
    assert.equal(body.maisProjetosHospedeiros, 2, '"e mais N"');
    for (const budget of [260, 400]) {
      const small = await f.call('coord-a', 'consultar_estoque', { projeto: 'CONPEEX' }, null, budget);
      assert.ok(new TextEncoder().encode(small.content).byteLength <= budget, `cabe em ${budget} bytes: ${small.content}`);
      JSON.parse(small.content);
    }
  } finally { f.native.close(); }
});

test('REVISÃO 2b: lista de designações cortada em 50 não inventa "sem responsável"', async () => {
  const f = fixture();
  try {
    const now = new Date().toISOString();
    for (let n = 0; n < 55; n++) {
      f.native.prepare("INSERT INTO campaigns(id,project_id,name,starts_at,ends_at,status,created_at) VALUES(?,?,?,?,?,'closed',?)").run(`oficina-${n}`, 'proj-role', `Oficina ${n}`, now, now, now);
      f.native.prepare("INSERT INTO work_responsibility_scopes(id,organization_id,project_id,area,campaign_id,target_key,created_by,created_at,updated_at) VALUES(?,'org_proex','proj-role','campaigns',?,?,'coord-a',?,?)").run(`resp-of-${n}`, `oficina-${n}`, `oficina-${n}`, now, now);
      f.native.prepare("INSERT INTO work_responsibility_assignees(id,scope_id,team_id,created_at) VALUES(?,?,'team-estoque',?)").run(`as-of-${n}`, `resp-of-${n}`, now);
    }
    const body = parse(await f.call('coord-a', 'consultar_responsaveis', { projeto: 'Rolê' }));
    assert.ok(!(body.semResponsavelDefinido ?? []).includes('Estoque · Rolê da Extensão'), 'o estoque tem responsável, mesmo fora das 50 primeiras');
    assert.ok((body.semResponsavelDefinido ?? []).includes('Empréstimos · Rolê da Extensão'));
    assert.deepEqual(body.maisDesignacoes, [{ projeto: 'Rolê da Extensão', total: 56 }]);
    assert.match(body.observacao, /mais designações/);
  } finally { f.native.close(); }
});

test('REVISÃO 2b: "todos" mais recentes primeiro, contagem completa; período inclui retirados em atraso', async () => {
  const f = fixture();
  try {
    const t = Date.now(), now = new Date().toISOString();
    for (let n = 0; n < 205; n++) f.native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,borrower_contact,starts_at,ends_at,status,created_by,created_at) VALUES(?,'proj-role','camera-4',?,'Pessoa Privada','',?,?,'returned','coord-a',?)").run(`antigo-${n}`, `Antigo ${n}`, t - (30 + n) * DAY, t - (30 + n) * DAY + 3600000, now);
    const every = parse(await f.call('coord-a', 'consultar_emprestimos', { situacao: 'todos' }));
    assert.equal(every.resultados[0].acao, 'Ação longo', 'o mais recente primeiro');
    assert.deepEqual(every.contagem, { retirados: 2, emAtraso: 1, reservados: 1, devolvidos: 206 }, 'contagem de tudo, além das 200 linhas');
    const tomorrow = brasiliaDay(t + DAY);
    const week = parse(await f.call('coord-a', 'consultar_emprestimos', { de: tomorrow, ate: tomorrow }));
    assert.ok(week.resultados.some(row => row.acao === 'Ação atrasado'), 'retirado em atraso continua emprestado no período');
    assert.ok(week.resultados.some(row => row.acao === 'Ação longo') && !week.resultados.some(row => row.acao === 'Ação reserva'));
  } finally { f.native.close(); }
});

test('REVISÃO 2b: saldo baixo filtrado no SQL e limite avisado; filtros sem herança de objeto', async () => {
  const f = fixture();
  try {
    const now = new Date().toISOString(), insert = f.native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,reserved,low_stock,created_at,updated_at) VALUES(?,'proj-role',?,'gift','unidade',100,0,1,?,?)");
    f.native.exec('BEGIN'); for (let n = 0; n < 2000; n++) insert.run(`aaa-${n}`, `Aaa ${String(n).padStart(4, '0')}`, now, now); f.native.exec('COMMIT');
    const low = parse(await f.call('coord-a', 'consultar_estoque', { saldo_baixo: true }));
    assert.deepEqual(low.resultados.map(row => row.material).sort(), ['Botton', 'Planner'], 'os em alerta aparecem mesmo depois de 2.000 itens');
    const everything = parse(await f.call('coord-a', 'consultar_estoque'));
    assert.notEqual(everything.resultados[0].situacao, 'ok', 'os em alerta vêm primeiro');
    assert.match(everything.observacao, /limite de 2\.000/);
    for (const situacao of ['constructor', '__proto__', 'toString']) await assert.rejects(f.call('coord-a', 'consultar_emprestimos', { situacao }), error => error.code === 'role_tool_input', situacao);
    for (const area of ['constructor', 'toString', 'hasOwnProperty']) await assert.rejects(f.call('coord-a', 'consultar_responsaveis', { area }), error => error.code === 'role_tool_input', area);
  } finally { f.native.close(); }
});

test('REVISÃO 2b: no escopo de um evento, sem dinâmica, os níveis são os da dinâmica do escopo', async () => {
  const f = fixture();
  try {
    f.native.prepare("INSERT INTO campaigns(id,project_id,name,starts_at,ends_at,status,created_at) VALUES('camp-verao','proj-role','Oficina de Verão','2099-01-01','2099-01-02','draft',?)").run(new Date().toISOString());
    const event = await resolveRoleScope(f.db, f.actors['coord-a'], 'org_proex', { kind: 'event', id: 'camp-conpeex' });
    const result = await f.call('coord-a', 'consultar_niveis_dinamica', {}, event);
    assert.deepEqual(parse(result).resultados.map(row => row.dinamica), ['Dinâmica CONPEEX 2026']);
  } finally { f.native.close(); }
});
