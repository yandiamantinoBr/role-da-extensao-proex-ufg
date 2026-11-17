import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Rolê Fase 2d: "abrir esta tela". O servidor confere a tela e o alvo pelos privilégios da pessoa e devolve o
// endereço exato do portal; a tela do Rolê mostra um botão e só o toque navega. Dados 100% sintéticos, sem rede e sem IA.
const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
  let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  source = source.replace(/import\(['"](pdfjs-dist\/legacy\/build\/pdf(?:\.worker)?\.mjs)['"]\)/g, (_match, dependency) => `import(${JSON.stringify(import.meta.resolve(dependency))})`);
  const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-fase2d-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { runRoleTool, ROLE_TOOL_NAMES, ROLE_TOOLS_ACTUAL_SCHEMA_BYTES } = await import(compile('assistant/role-tools'));
const { ROLE_TOOLS_SCHEMA_BYTES, ROLE_SYSTEM_PROMPT_TOOLS, ROLE_SYSTEM_PROMPT_BYTES, roleEstimate, roleConversationBytes } = await import(compile('assistant/role-contracts'));
const { readPortalLocation } = await import(compile('portal-history'));
const { DEFAULT_ASSISTANT_CONFIG, safeRequest } = await import(compile('assistant/contracts'));
const { configureAssistant } = await import(compile('assistant/service'));
const { manageAssistantCredential } = await import(compile('assistant/credential-vault'));
const { roleChat } = await import(compile('assistant/role'));

const NO_ACCESS = 'Você não tem acesso a esta tela.';
const DAY = 86400000;

function fixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = new Date().toISOString(), t = Date.now(), run = (sql, ...values) => native.prepare(sql).run(...values);
  run("INSERT INTO projects(id,name,short_name,description,scope,organization_id,created_at) VALUES('project-a','Projeto A','PA','','external','org_proex',?),('project-b','Projeto B','','SEGREDO-B','external','org_proex',?),('project-host','Rolê da Extensão','RE','','external','org_proex',?)", now, now, now);
  const actors = {};
  // owner: administração geral; coordA: coordenação do A e do Rolê; bolsista: só leitura no A; estoque: estoque do A;
  // coordB: coordenação do B; nobody: conta sem acesso.
  for (const [key, role, projects, name] of [['owner', 'owner', [null], 'Coordenação QA'], ['coordA', 'manager', ['project-a', 'project-host'], 'Ana Coordena'], ['bolsista', 'viewer', ['project-a'], 'Bruno Bolsista'],
    ['estoque', 'inventory', ['project-a'], 'Edu Estoque'], ['coordB', 'manager', ['project-b'], 'Carla Externa'], ['nobody', null, [], 'Sem Acesso']]) {
    const userId = `${key.toLowerCase()}-qa`, email = `${key.toLowerCase()}@example.test`;
    run("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)", userId, email, now, now);
    run('INSERT INTO profiles(user_id,display_name,created_at,updated_at) VALUES(?,?,?,?)', userId, name, now, now);
    const members = role ? projects.map(project => ({ id: `${userId}-${project ?? 'org'}`, user_id: userId, email, role, project_id: project, revoked_at: null, created_at: now })) : [];
    for (const member of members) run('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)', member.id, userId, email, role, member.project_id, now);
    actors[key] = { userId, email, displayName: name, capabilities: [], members };
  }
  // Estoque também lê o Rolê da Extensão (só leitura): vê o projeto, mas não os materiais dele.
  run("INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES('estoque-host','estoque-qa','estoque@example.test','viewer','project-host',?)", now);
  actors.estoque.members.push({ id: 'estoque-host', user_id: 'estoque-qa', email: 'estoque@example.test', role: 'viewer', project_id: 'project-host', revoked_at: null, created_at: now });
  const task = (id, project, title, status = 'open') => run("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,due_at,created_by,created_at,updated_at) VALUES(?, 'org_proex', ?, ?, 'Texto sintético', 'high', ?, '2020-01-10', 'owner-qa', ?, ?)", id, project, title, status, now, now);
  task('ta-final', 'project-a', 'Relatório final do semestre');
  task('tb-secret', 'project-b', 'Plano SEGREDO-B');
  task('ta-priv', 'project-a', 'Despacho reservado da coordenação');
  run("INSERT INTO followup_task_privacy(task_id,visibility,created_by,created_at,updated_at) VALUES('ta-priv','participants','owner-qa',?,?)", now, now);
  run("INSERT INTO followup_assignees(id,task_id,user_id,team_id,created_at) VALUES('as-priv','ta-priv','coorda-qa',NULL,?)", now);
  const item = (id, project, name, category = 'gift') => run("INSERT INTO items(id,project_id,name,category,unit,stock,reserved,low_stock,created_at,updated_at) VALUES(?,?,?,?,'unidade',?,0,?,?,?)", id, project, name, category, category === 'equipment' ? 1 : 5, category === 'equipment' ? 0 : 1, now, now);
  item('caneta', 'project-a', 'Caneta');
  item('projetor', 'project-a', 'Projetor QA', 'equipment');
  item('camera-2', 'project-a', 'Câmera QA 2', 'equipment');
  item('camera-3', 'project-a', 'Câmera QA 3', 'equipment');
  item('planner-b', 'project-b', 'Planner SEGREDO-B');
  // Nome com controle, marca de direção (bidi) e largura zero: o rótulo do botão nunca pode sumir.
  item('faixa', 'project-a', 'Faixa\u202e\u200b\u0007 Lilás\u2066');
  task('ta-long', 'project-a', `Cronograma ${'longo '.repeat(20)}fim`);
  run("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,borrower_contact,starts_at,ends_at,status,created_by,created_at) VALUES('loan-old','project-a','projetor','Ação antiga','Pessoa Privada','contato@privado.invalid',?,?,'returned','owner-qa',?),('loan-out','project-a','projetor','Ação atual','Pessoa Privada','contato@privado.invalid',?,?,'out','owner-qa',?)", t - 10 * DAY, t - 9 * DAY, now, t - DAY, t + DAY, now);
  run("INSERT INTO campaigns(id,project_id,name,starts_at,ends_at,status,created_at) VALUES('camp-conpeex','project-host','Dinâmica CONPEEX 2026',?,?,'draft',?),('camp-b','project-b','Dinâmica SEGREDO-B',?,?,'draft',?)", now, now, now, now, now, now);
  const db = { prepare(sql) { let values = []; return { sql, bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; }, execute() { const results = native.prepare(sql).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; } }; }, async batch(statements) { native.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); native.exec('COMMIT'); return results; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
  const call = (who, args, scope = null) => runRoleTool(db, actors[who], 'org_proex', 'abrir_tela', args, undefined, scope);
  return { native, db, actors, call };
}
const note = result => JSON.parse(result.content).observacao ?? '';
const revoke = (f, who) => f.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(new Date().toISOString(), f.actors[who].userId);
function noPersonalData(result) {
  assert.doesNotMatch(result.content, /@example\.test|@privado|-qa\b|Pessoa Privada|Ana Coordena|Bruno|Carla|Edu Estoque/, 'sem e-mail, identificador ou nome de pessoa');
}
async function opens(f, who, args, href, label, scope = null) {
  const result = await f.call(who, args, scope);
  assert.deepEqual(result.navigation, { href, label }, `${who} ${JSON.stringify(args)}`);
  assert.equal(result.rows, 1);
  assert.ok(note(result).includes(`Abrir ${label}`) && note(result).includes('só o toque'), 'o modelo sabe que só o toque abre');
  assert.ok(!result.content.includes(href), 'o endereço não vai para o modelo');
  noPersonalData(result);
  return result;
}
async function denied(f, who, args, scope = null) {
  const result = await f.call(who, args, scope);
  assert.equal(result.navigation, undefined, `${who} ${JSON.stringify(args)} sem botão`);
  assert.equal(result.rows, 0);
  assert.equal(note(result), NO_ACCESS, `${who} ${JSON.stringify(args)}`);
  return result;
}
async function notFound(f, who, args, scope = null) {
  const result = await f.call(who, args, scope);
  assert.equal(result.navigation, undefined, `${who} ${JSON.stringify(args)} sem botão`);
  assert.equal(result.sources.length, 0);
  assert.match(note(result), /^Não encontrei .* visível para você com esse nome\. Nada foi aberto\.$/, `${who} ${JSON.stringify(args)}`);
  assert.doesNotMatch(result.content, /SEGREDO|project-b|tb-secret|ta-priv|Despacho/, 'nada do que a pessoa não vê');
  return result;
}

test('abrir_tela registrada; esquema e texto de sistema dentro dos tetos', () => {
  assert.ok(ROLE_TOOL_NAMES.includes('abrir_tela'));
  assert.ok(ROLE_TOOLS_ACTUAL_SCHEMA_BYTES <= ROLE_TOOLS_SCHEMA_BYTES, `esquema ${ROLE_TOOLS_ACTUAL_SCHEMA_BYTES} <= ${ROLE_TOOLS_SCHEMA_BYTES}`);
  assert.ok(ROLE_SYSTEM_PROMPT_TOOLS.includes('abrir_tela') && ROLE_SYSTEM_PROMPT_TOOLS.includes('só o toque da pessoa abre'));
  assert.ok(new TextEncoder().encode(JSON.stringify(ROLE_SYSTEM_PROMPT_TOOLS)).byteLength + 200 <= ROLE_SYSTEM_PROMPT_BYTES);
});

test('URL EXATA: cada tela e cada ficha saem no endereço que o portal abre (readPortalLocation)', async () => {
  const f = fixture();
  try {
    const cases = [
      ['coordA', { tela: 'emprestimos' }, '/?module=loans', 'Empréstimos'],
      ['coordA', { tela: 'projetos', alvo: 'Projeto A' }, '/?module=projects&project=project-a&detailProject=project-a', 'ficha do projeto Projeto A'],
      // "abra a ficha do projeto CONPEEX": CONPEEX é a dinâmica; abre o projeto que a hospeda.
      ['coordA', { tela: 'projetos', projeto: 'CONPEEX' }, '/?module=projects&project=project-host&detailProject=project-host', 'ficha do projeto Rolê da Extensão'],
      // "me leve para as demandas atrasadas"
      ['coordA', { tela: 'demandas', atrasadas: true }, '/?module=my-work&workStatus=overdue', 'Meu trabalho: atrasadas'],
      ['coordA', { tela: 'demandas', alvo: 'relatório final' }, '/?module=demands&project=project-a&demandId=ta-final', 'demanda “Relatório final do semestre”'],
      ['coordA', { tela: 'demandas', projeto: 'PA' }, '/?module=demands&project=project-a', 'Demandas · Projeto A'],
      ['coordA', { tela: 'materiais', alvo: 'Caneta' }, '/?module=materials&project=project-a&itemId=caneta', 'material Caneta'],
      ['coordA', { tela: 'emprestimos', alvo: 'Projetor' }, '/?module=loans&project=project-a&loanId=loan-out', 'empréstimo de Projetor QA'],
      ['coordA', { tela: 'dinamicas', alvo: 'CONPEEX' }, '/?module=events&project=project-host&campaignId=camp-conpeex', 'dinâmica Dinâmica CONPEEX 2026'],
      ['coordA', { tela: 'relatorios', alvo: 'empréstimos' }, '/?module=reports&report=loans', 'Relatórios: Empréstimos'],
      ['coordA', { tela: 'agenda', projeto: 'Projeto A' }, '/?module=calendar&project=project-a', 'Agenda · Projeto A'],
      ['coordA', { tela: 'registros', alvo: 'Projeto A' }, '/?module=records&project=project-a', 'Registros · Projeto A'],
      ['coordA', { tela: 'equipes' }, '/?module=work-teams', 'Equipes e organograma'],
      ['coordA', { tela: 'gestao' }, '/?module=management', 'Gestão'],
      ['coordA', { tela: 'guia' }, '/?module=management&gestao=guide', 'Guia da organização'],
      ['coordA', { tela: 'comunidade' }, '/?module=community', 'Comunidade'],
      ['coordA', { tela: 'inicio' }, '/?module=overview', 'Início'],
      ['owner', { tela: 'configuracoes' }, '/?module=settings', 'Configurações'],
    ];
    const scope = { modules: ['overview', 'my-work', 'projects', 'demands', 'work-teams', 'calendar', 'materials', 'loans', 'events', 'records', 'community', 'reports', 'management', 'settings'], units: [], areas: [], canSelectProject: () => true, canOpenRecord: () => true };
    for (const [who, args, href, label] of cases) {
      await opens(f, who, args, href, label);
      const location = readPortalLocation(new URLSearchParams(href.slice(2)), scope), asked = new URLSearchParams(href.slice(2));
      assert.equal(location.tab, asked.get('module'), `${href}: abre o módulo`);
      assert.equal(location.project, asked.get('project') ?? '', `${href}: filtro de projeto`);
      if (asked.has('demandId')) assert.equal(location.demand, asked.get('demandId'));
      if (asked.has('workStatus')) assert.equal(location.workStatus, 'overdue');
      if (asked.has('report')) assert.equal(location.report, asked.get('report'));
      for (const [key, module] of [['detailProject', 'projects'], ['itemId', 'materials'], ['loanId', 'loans'], ['campaignId', 'events']]) if (asked.has(key)) assert.deepEqual(location.record, { module, projectId: asked.get('project'), recordId: asked.get(key) }, `${href}: ficha aberta`);
    }
  } finally { f.native.close(); }
});

test('PERMISSÃO POR PERFIL: a mesma regra do menu do portal; sem acesso, "Você não tem acesso a esta tela." e nenhum botão', async () => {
  const f = fixture();
  try {
    // Bolsista (leitura): vê projetos, agenda e relatórios; não vê Materiais, Empréstimos, Dinâmicas, Pessoas nem Configurações.
    await opens(f, 'bolsista', { tela: 'projetos', alvo: 'PA' }, '/?module=projects&project=project-a&detailProject=project-a', 'ficha do projeto Projeto A');
    await opens(f, 'bolsista', { tela: 'agenda' }, '/?module=calendar', 'Agenda');
    await opens(f, 'bolsista', { tela: 'relatorios' }, '/?module=reports', 'Relatórios');
    for (const tela of ['materiais', 'emprestimos', 'dinamicas', 'pessoas', 'configuracoes']) await denied(f, 'bolsista', { tela });
    await denied(f, 'bolsista', { tela: 'materiais', alvo: 'Caneta' });
    // Estoque: Materiais sim; Empréstimos e Dinâmicas não.
    await opens(f, 'estoque', { tela: 'materiais', alvo: 'Caneta' }, '/?module=materials&project=project-a&itemId=caneta', 'material Caneta');
    for (const tela of ['emprestimos', 'dinamicas']) await denied(f, 'estoque', { tela });
    // Coordenação: Pessoas sim, Configurações não (só administração ou quem recebeu a delegação de IA).
    await opens(f, 'coordA', { tela: 'pessoas', projeto: 'Projeto A' }, '/?module=team&project=project-a', 'Pessoas e acessos · Projeto A');
    await denied(f, 'coordA', { tela: 'configuracoes' });
    await opens(f, 'owner', { tela: 'pessoas' }, '/?module=team', 'Pessoas e acessos');
    // Tela permitida em geral, mas não no projeto pedido: estoque vê Materiais do A, não os do Rolê da Extensão (só lê o projeto).
    await opens(f, 'estoque', { tela: 'materiais', projeto: 'PA' }, '/?module=materials&project=project-a', 'Materiais · Projeto A');
    await denied(f, 'estoque', { tela: 'materiais', projeto: 'Rolê da Extensão' });
    await notFound(f, 'estoque', { tela: 'materiais', projeto: 'Projeto B' });
    // Pessoa sem nenhum acesso: nenhuma tela.
    for (const tela of ['projetos', 'demandas', 'agenda', 'materiais', 'comunidade', 'configuracoes']) await denied(f, 'nobody', { tela });
    // Início, Meu trabalho e Conta sempre aparecem no menu; Configurações tem regra própria, antes do portão da organização.
    await opens(f, 'nobody', { tela: 'inicio' }, '/?module=overview', 'Início');
    await opens(f, 'nobody', { tela: 'meu_trabalho' }, '/?module=my-work', 'Meu trabalho');
    await opens(f, 'nobody', { tela: 'conta' }, '/?module=profile', 'Conta');
  } finally { f.native.close(); }
});

test('ALVO FORA DO ESCOPO: projeto, demanda, material, empréstimo e dinâmica de quem não vê respondem como inexistentes', async () => {
  const f = fixture();
  try {
    await notFound(f, 'coordA', { tela: 'projetos', alvo: 'Projeto B' });
    await notFound(f, 'coordA', { tela: 'demandas', alvo: 'Plano SEGREDO-B' });
    await notFound(f, 'coordA', { tela: 'materiais', alvo: 'Planner SEGREDO-B' });
    await notFound(f, 'coordA', { tela: 'dinamicas', alvo: 'SEGREDO-B' });
    await notFound(f, 'coordA', { tela: 'agenda', projeto: 'Projeto B' });
    await notFound(f, 'coordB', { tela: 'emprestimos', alvo: 'Projetor' });
    // Escopo da conversa: com "Procurar em" no Projeto B, a coordenação geral não abre a ficha do A pelo Rolê.
    const scopeB = { kind: 'project', id: 'project-b', label: 'o projeto Projeto B', projectIds: ['project-b'] };
    await notFound(f, 'owner', { tela: 'projetos', alvo: 'Projeto A' }, scopeB);
    await notFound(f, 'owner', { tela: 'demandas', alvo: 'Relatório final' }, scopeB);
    await opens(f, 'owner', { tela: 'demandas', alvo: 'Plano SEGREDO-B' }, '/?module=demands&project=project-b&demandId=tb-secret', 'demanda “Plano SEGREDO-B”', scopeB);
    // Mais de uma opção: nenhum botão; as opções vão como links, só do que a pessoa vê.
    const many = await f.call('coordA', { tela: 'materiais', alvo: 'Câmera' });
    assert.equal(many.navigation, undefined);
    assert.deepEqual(many.sources.map(source => source.href).sort(), ['/?module=materials&project=project-a&itemId=camera-2', '/?module=materials&project=project-a&itemId=camera-3']);
    assert.match(note(many), /Pergunte qual abrir/);
    // O modelo recebe só número e rótulo: nenhum identificador nem endereço.
    assert.deepEqual(JSON.parse(many.content).resultados, [{ opcao: 1, rotulo: 'Câmera QA 2 · Projeto A' }, { opcao: 2, rotulo: 'Câmera QA 3 · Projeto A' }]);
    assert.doesNotMatch(many.content, /camera-|project-a|module=|itemId/);
    // Busca de reserva pelo nome da dinâmica: só quem vê a dinâmica na tela Dinâmicas chega ao projeto que a hospeda.
    await notFound(f, 'estoque', { tela: 'projetos', projeto: 'CONPEEX' });
    // Entrada inválida não abre nada.
    await assert.rejects(f.call('coordA', { tela: 'planilhas' }), /Escolha uma tela/);
    await assert.rejects(f.call('coordA', { tela: 'agenda', url: 'https://example.test' }), /campos não permitidos/);
  } finally { f.native.close(); }
});

test('RÓTULO LIMPO: sem controles, bidi nem largura zero; demanda longa encurtada; nunca passa de 120', async () => {
  const f = fixture();
  try {
    const faixa = await opens(f, 'coordA', { tela: 'materiais', alvo: 'Faixa' }, '/?module=materials&project=project-a&itemId=faixa', 'material Faixa Lilás');
    assert.doesNotMatch(faixa.content, /[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/);
    const long = await f.call('coordA', { tela: 'demandas', alvo: 'Cronograma longo' });
    assert.ok(long.navigation.label.length <= 120 && long.navigation.label.endsWith('…”'), long.navigation.label);
    assert.equal(long.navigation.href, '/?module=demands&project=project-a&demandId=ta-long');
  } finally { f.native.close(); }
});

test('DEMANDA PRIVADA nunca é alvo, nem para quem participa dela nem para a administração', async () => {
  const f = fixture();
  try {
    for (const who of ['coordA', 'owner']) await notFound(f, who, { tela: 'demandas', alvo: 'Despacho reservado da coordenação' });
    // A pública do mesmo projeto continua abrindo.
    await opens(f, 'coordA', { tela: 'demandas', alvo: 'Relatório final' }, '/?module=demands&project=project-a&demandId=ta-final', 'demanda “Relatório final do semestre”');
  } finally { f.native.close(); }
});

test('REVOGAR NO MEIO: a próxima chamada já não abre nada; conteúdo sem dado pessoal', async () => {
  const f = fixture();
  try {
    await opens(f, 'coordA', { tela: 'emprestimos', alvo: 'Projetor' }, '/?module=loans&project=project-a&loanId=loan-out', 'empréstimo de Projetor QA');
    revoke(f, 'coordA');
    for (const args of [{ tela: 'emprestimos' }, { tela: 'emprestimos', alvo: 'Projetor' }, { tela: 'projetos', alvo: 'Projeto A' }, { tela: 'demandas' }]) noPersonalData(await denied(f, 'coordA', args));
    // Só a permissão de empréstimos sai (troca de papel): a tela some, as outras continuam.
    f.native.prepare("UPDATE members SET revoked_at=NULL, role='viewer' WHERE user_id='coorda-qa'").run();
    await denied(f, 'coordA', { tela: 'emprestimos' });
    await opens(f, 'coordA', { tela: 'agenda' }, '/?module=calendar', 'Agenda');
  } finally { f.native.close(); }
});

test('CONVERSA: o modelo chama abrir_tela e a resposta do chat leva o destino em "navigation", sem gravar nada', async () => {
  const f = fixture();
  try {
    const secret = 'test-only-role-auth-secret-no-production-access', keys = { current: 'synthetic-only-independent-key-for-role-tests-000' };
    const vault = await manageAssistantCredential(f.db, f.actors.owner, { action: 'save', organizationId: 'org_proex', provider: 'deepseek', expectedRevision: 0, label: 'Chave deepseek de teste', secret: 'sk-CANARIO-fase2d-synthetic-0000-ZZ99' }, secret, keys);
    await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: vault.revision, config: { ...DEFAULT_ASSISTANT_CONFIG, usageScope: 'organization', roleEnabled: true } }, secret, undefined, keys);
    const calls = [], steps = [{ tools: [{ name: 'abrir_tela', args: { tela: 'emprestimos' } }] }, { reply: { reply: 'Pronto: toque no botão para abrir Empréstimos.', operation: null } }];
    const fetcher = async (_url, init) => {
      const body = JSON.parse(init.body); calls.push(body);
      const step = steps[Math.min(calls.length - 1, steps.length - 1)];
      const message = step.tools ? { content: '', tool_calls: step.tools.map((tool, index) => ({ id: `call-${index}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } })) } : { content: JSON.stringify(step.reply) };
      return Response.json({ model: body.model, choices: [{ finish_reason: step.tools ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 1500, completion_tokens: 90 } });
    };
    const message = 'Abra a tela de empréstimos';
    const estimate = roleEstimate({ textProvider: 'deepseek', textBytes: roleConversationBytes([], safeRequest(message), 'Projeto A'), hasImage: false, tools: true });
    const before = f.native.prepare('SELECT (SELECT COUNT(*) FROM loans)+(SELECT COUNT(*) FROM followup_tasks) n').get().n;
    const answer = await roleChat(f.db, f.actors.coordA, { action: 'chat', projectId: 'project-a', operationKey: 'role-fase2d-0001', consent: true, message, acceptedCostMicros: estimate.costMicros }, secret, { keys, fetcher });
    assert.ok(calls[0].tools.some(tool => tool.function.name === 'abrir_tela'), 'a ferramenta é oferecida');
    assert.deepEqual(answer.navigation, { href: '/?module=loans', label: 'Empréstimos' }, 'só abrir_tela: sem aviso');
    assert.equal(f.native.prepare('SELECT (SELECT COUNT(*) FROM loans)+(SELECT COUNT(*) FROM followup_tasks) n').get().n, before, 'nada gravado');
    // Outra consulta com resultado na mesma resposta (conteúdo de terceiros): o botão vem marcado como sugestão.
    steps.splice(0, steps.length, { tools: [{ name: 'consultar_estoque', args: { material: 'Caneta' } }, { name: 'abrir_tela', args: { tela: 'materiais', alvo: 'Caneta' } }] }, { reply: { reply: 'Toque no botão.', operation: null } });
    calls.length = 0;
    const mixed = await roleChat(f.db, f.actors.coordA, { action: 'chat', projectId: 'project-a', operationKey: 'role-fase2d-0003', consent: true, message, acceptedCostMicros: estimate.costMicros }, secret, { keys, fetcher });
    assert.deepEqual(mixed.navigation, { href: '/?module=materials&project=project-a&itemId=caneta', label: 'material Caneta', afterUntrusted: true });
    steps.splice(0, steps.length, { tools: [{ name: 'abrir_tela', args: { tela: 'emprestimos' } }] }, { reply: { reply: 'Sem acesso.', operation: null } });
    // Estoque usa o Rolê, mas não abre Empréstimos: a mesma frase volta sem botão e o modelo recebe a recusa.
    calls.length = 0;
    const refused = await roleChat(f.db, f.actors.estoque, { action: 'chat', projectId: 'project-a', operationKey: 'role-fase2d-0002', consent: true, message, acceptedCostMicros: estimate.costMicros }, secret, { keys, fetcher });
    assert.ok(refused.reply, 'resposta normal');
    assert.equal(refused.navigation, undefined, 'sem botão');
    assert.ok(calls[1].messages.find(entry => entry.role === 'tool').content.includes(NO_ACCESS), 'o modelo recebe "Você não tem acesso a esta tela."');
  } finally { f.native.close(); }
});

/* ---------- Tela do Rolê: botão "Abrir {rótulo}" ---------- */
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
function loadButton() {
  const mod = { exports: {} };
  const source = ts.transpileModule(readFileSync(`${root}components/portal/role-navigation-button.tsx`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const css = new Proxy({}, { get: (_target, name) => name === 'default' ? css : name === '__esModule' ? false : String(name) });
  const required = { 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }, 'lucide-react': { ArrowRight: () => null }, './role-assistant.module.css': css };
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: name => required[name] });
  return mod.exports;
}

test('BOTÃO NA TELA: "Abrir {rótulo}" é um link interno do portal, alvo de 44 px nos dois temas; só o toque navega', () => {
  const { default: RoleNavigationButton, roleNavigationFrom } = loadButton();
  assert.deepEqual(JSON.parse(JSON.stringify(roleNavigationFrom({ href: '/?module=loans', label: 'Empréstimos' }))), { href: '/?module=loans', label: 'Empréstimos' });
  assert.ok(roleNavigationFrom({ href: '/?module=projects&project=project-a&detailProject=project-a', label: 'ficha do projeto Projeto A' }));
  assert.ok(roleNavigationFrom({ href: '/?module=demands&project=project-a&demandId=ta-final', label: 'demanda “Relatório final do semestre”' }));
  for (const href of ['https://example.test/?module=loans', '//example.test/?module=loans', 'javascript:alert(1)', '/?module=loans&next=https://example.test', '/?module=work-teams&teamId=x', '/?module=loans&project=a&project=b&project=c&project=d&project=e', '/api/assistant/role', '/?module=loans#x', ''])
    assert.equal(roleNavigationFrom({ href, label: 'Empréstimos' }), undefined, `recusa ${href}`);
  for (const label of ['', '   ', 'x'.repeat(121), 'linha\nquebrada', 'oculto\u202e', 12]) assert.equal(roleNavigationFrom({ href: '/?module=loans', label }), undefined);
  assert.equal(roleNavigationFrom(null), undefined);
  const opened = [];
  const node = RoleNavigationButton({ navigation: { href: '/?module=loans', label: 'Empréstimos' }, onOpen: () => opened.push(true) });
  assert.equal(node.type, 'a', 'link: o roteamento do portal (followModuleLink) cuida do clique, como nas fontes');
  assert.equal(node.props.href, '/?module=loans');
  assert.equal(text(node), 'Abrir Empréstimos');
  assert.match(node.props.className, /\bp-button\b/); assert.match(node.props.className, /\bp-button-primary\b/); assert.match(node.props.className, /\bnavigation\b/);
  assert.equal(node.props.target, undefined, 'abre no próprio portal');
  assert.deepEqual(opened, [], 'nada acontece antes do toque');
  node.props.onClick(); assert.deepEqual(opened, [true], 'o toque fecha o painel');
  // Depois de conteúdo de terceiros: "Sugestão do Rolê" em texto pequeno, acima do botão.
  const marked = roleNavigationFrom({ href: '/?module=loans', label: 'Empréstimos', afterUntrusted: true });
  assert.equal(marked.afterUntrusted, true);
  assert.equal(roleNavigationFrom({ href: '/?module=loans', label: 'Empréstimos', afterUntrusted: 'sim' }).afterUntrusted, undefined);
  const box = RoleNavigationButton({ navigation: marked });
  assert.equal(box.props.children[0].type, 'small'); assert.equal(text(box.props.children[0]), 'Sugestão do Rolê');
  assert.equal(box.props.children[1].type, 'a'); assert.equal(text(box.props.children[1]), 'Abrir Empréstimos');
  const css = readFileSync(`${root}components/portal/role-assistant.module.css`, 'utf8'), rule = css.match(/\.navigation\{[^}]*\}/)?.[0] ?? '';
  assert.match(rule, /min-height:44px/, 'alvo de 44 px');
  assert.doesNotMatch(rule, /(?:^|;|\{)(?:color|background)\s*:/, 'cores do .p-button-primary global, que já tem tema claro e escuro');
  assert.match(css, /\.navigation:focus-visible\{outline:3px solid var\(--focus\)/);
  // A tela do Rolê lê o campo da resposta, valida e mostra o botão; o roteamento do portal leva a aba da Gestão.
  const panel = readFileSync(`${root}components/portal/role-assistant.tsx`, 'utf8');
  assert.match(panel, /navigation = roleNavigationFrom\(result\.navigation\)/);
  assert.match(panel, /\{message\.navigation && <RoleNavigationButton navigation=\{message\.navigation\} onOpen=\{\(\) => close\(\)\}\/>\}/);
  const portal = readFileSync(`${root}app/portal-client.tsx`, 'utf8');
  assert.match(portal, /managementTab\.current = wantedTab;/);
  assert.match(portal, /url\.searchParams\.set\('gestao', managementTab\.current\)/);
  // Gestão já aberta: grava a aba com replaceState e avisa o painel antes do return.
  const early = portal.slice(portal.indexOf('const wantedTab = '), portal.indexOf('if (portalLocationKey(next) === routeKey) return;'));
  assert.match(early, /window\.history\.replaceState/); assert.match(early, /dispatchEvent\(new CustomEvent\(MANAGEMENT_TAB_EVENT/);
  assert.match(readFileSync(`${root}components/portal/management/management-panel.tsx`, 'utf8'), /addEventListener\(MANAGEMENT_TAB_EVENT/);
});
