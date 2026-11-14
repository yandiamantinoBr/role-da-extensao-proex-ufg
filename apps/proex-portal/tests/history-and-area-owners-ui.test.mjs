import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// R1 e R4 (revisão de 09/11): um Histórico só, atalho "Ver histórico" nas fichas, "Cronograma" no projeto e
// "Quem cuida de cada área" na ficha do projeto, com o mesmo formulário de responsáveis do painel antigo.
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const nodes = tree => { const list = []; const visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); list.push(node); visit(node.props?.children); }; visit(tree); return list; };
function component(path, modules = {}, effects = null) {
  const compiled = {exports: {}}, jsx = (type, props) => ({type, props});
  let index = 0; const slots = [];
  const react = {useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }]; }, useMemo: build => build(), useEffect(effect) { effects?.push(effect); }, useRef: current => ({current}), Fragment: 'Fragment'};
  const code = ts.transpileModule(source(path), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const fallback = new Proxy({}, {get: (_, key) => key === '__esModule' ? false : String(key)});
  vm.runInNewContext(code, {module: compiled, exports: compiled.exports, URLSearchParams, AbortController, Intl, encodeURIComponent, JSON, Object, Map, Set, Date, Promise, Error, Boolean,
    require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? {jsx, jsxs: jsx, Fragment: 'Fragment'} : modules[name] ?? (name.endsWith('.css') ? {default: fallback} : fallback)});
  return {exports: compiled.exports, render(name, props) { index = 0; return compiled.exports[name](props); }, slots};
}

test('one history component: subject links are strict, readable and built the same way everywhere', () => {
  const history = component('../components/portal/history-timeline.tsx');
  const {parseHistorySubject, historySubjectParam, historyHref, HISTORY_SUBJECTS} = history.exports;
  assert.deepEqual({...parseHistorySubject('item:item-a')}, {kind: 'item', id: 'item-a'});
  assert.deepEqual({...parseHistorySubject('task:a:b')}, {kind: 'task', id: 'a:b'});
  for (const bad of ['', null, 'item:', 'person:abc', 'item:../x', "loan:x' OR 1=1", '__proto__:x']) assert.equal(parseHistorySubject(bad), null, String(bad));
  assert.equal(historySubjectParam({kind: 'loan', id: 'loan-1'}), 'loan:loan-1');
  assert.equal(historyHref({kind: 'item', id: 'item-a'}, 'project-a'), '/?module=records&project=project-a&history=item%3Aitem-a');
  assert.equal(historyHref({kind: 'task', id: 'task-1'}, null), '/?module=records&history=task%3Atask-1');
  assert.deepEqual(Object.keys(HISTORY_SUBJECTS).sort(), ['campaign', 'item', 'loan', 'task']);

  // A linha do tempo agrupa repetidos, mostra "Ver mais" depois de 8 itens e aceita outro título (fichas).
  const event = (id, minute, extra = {}) => ({id, type: 'materials', action: 'Entrada', title: `Material ${id}`, detail: '+1 unidade', at: `2026-11-10T12:${minute}:00.000Z`, day: '2026-11-10', projectId: 'project-a', projectName: 'Projeto A', actorId: 'u', actorName: 'Pessoa', viaRole: false, href: null, quantity: 1, ...extra});
  const grouped = history.exports.groupEntries([event('a', '00'), event('b', '00'), event('c', '00'), event('d', '05')]);
  assert.deepEqual(Array.from(grouped, entry => entry.kind), ['group', 'event']);
  const many = Array.from({length: 10}, (_, index) => event(`m${index}`, String(10 + index)));
  const tree = history.render('default', {events: many, heading: 'Histórico'});
  assert.equal(tree.props['aria-label'], 'Histórico');
  assert.match(text(tree), /Ver mais 2 itens/);
  assert.match(text(history.render('default', {events: []})), /Nada registrado neste período/);
});

test('the activity panel and every sheet use that single component and the approved names', () => {
  const panel = source('../components/portal/activity-panel.tsx');
  assert.match(panel, /import HistoryTimeline, \{[^}]*\} from '\.\/history-timeline';/);
  assert.match(panel, /<HistoryTimeline events=\{events\}/);
  assert.ok(!/function EventRow|function groupEntries/.test(panel), 'a linha do tempo mora em um lugar só');
  assert.match(panel, /if \(subject\) params\.set\(SUBJECT_PARAM\[subject\.kind\], subject\.id\);/);
  for (const [file, kind] of [['../components/portal/material-detail-drawer.tsx', 'item'], ['../components/portal/follow-up-panel.tsx', 'task'], ['../app/portal-client.tsx', 'loan'], ['../app/portal-client.tsx', 'campaign']]) {
    const code = source(file);
    assert.match(code, new RegExp(`href=\\{historyHref\\(\\{ kind: '${kind}', id: [^}]+\\}, .{1,80}?\\)\\}[^>]*>Ver histórico<`), `${file}: ${kind}`);
  }
  const detail = source('../components/portal/project-detail.tsx');
  assert.match(detail, /<section id="project-timeline"[^>]*>.{0,120}<h3><CalendarDays size=\{17\}\/>Cronograma<\/h3>/s);
  assert.ok(!detail.includes('Linha do tempo'), 'o projeto mostra Cronograma, não Linha do tempo');
});

test('the address keeps the subject only in Registros and refuses malformed values', () => {
  const load = (file, dependencies = {}) => { const compiled = {exports: {}}; vm.runInNewContext(ts.transpileModule(source(`../lib/${file}.ts`), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {module: compiled, exports: compiled.exports, URL, URLSearchParams, require: name => dependencies[name]}); return compiled.exports; };
  const {readPortalLocation, portalLocationKey} = load('portal-history', {'./work-navigation': load('work-navigation'), './my-work/contracts': load('my-work/contracts')});
  const scope = {modules: ['overview', 'records', 'materials'], units: [], areas: [], canSelectProject: id => id === 'project-a', canOpenRecord: () => true};
  const read = query => readPortalLocation(new URLSearchParams(query), scope);
  assert.equal(read('module=records&project=project-a&history=item:item-a').history, 'item:item-a');
  assert.equal(read('module=materials&project=project-a&history=item:item-a').history, '', 'só Registros lê o assunto');
  for (const bad of ['person:1', 'item:', 'item:a b', 'loan:<x>']) assert.equal(read(`module=records&history=${encodeURIComponent(bad)}`).history, '', bad);
  assert.equal(portalLocationKey(read('module=records&project=project-a&history=loan:loan-1')), 'module=records&project=project-a&history=loan%3Aloan-1');
  assert.notEqual(portalLocationKey(read('module=records&history=loan:loan-1')), portalLocationKey(read('module=records')), 'trocar de assunto é uma navegação');
});

test('project sheet and old top panel mount the same responsibility form for the whole area (R4)', async () => {
  const row = (area, extra = {}) => ({project_id: 'project-a', area, status: 'active', item_id: null, loan_id: null, campaign_id: null, assignees: [{user_id: 'u1', team_id: null, name: 'Pessoa sintética'}], ...extra});
  const requests = [];
  // A tela consulta a lista de áreas do projeto e o catálogo leve (em quais projetos a pessoa gerencia responsáveis).
  const mount = (canManage, rows = [row('materials')], response = {}) => {
    const effects = [];
    const sheet = component('../components/portal/project-area-owners.tsx', {'@/lib/my-work/contracts': {isResponsibilityList: () => true, isResponsibilityCatalog: () => true}, './responsibility-manager': {default: 'ResponsibilityManager'},
      './my-work-api': {workApi: async url => { requests.push(url); return url.includes('view=catalog')
        ? {viewerId: 'user-a', projectId: null, projects: [{id: 'project-a', canManage}, {id: 'project-b', canManage: true}], ...response.catalog}
        : {viewerId: 'user-a', projectId: 'project-a', items: rows, ...response.list}; }}}, effects);
    return {sheet, async load(props) { sheet.render('default', props); for (const effect of effects.splice(0)) effect(); await new Promise(resolve => setImmediate(resolve)); return sheet.render('default', props); }};
  };
  const props = {userId: 'user-a', projectId: 'project-a', areas: ['materials', 'loans', 'campaigns']};
  const manager = mount(true), {OWNED_AREAS, areaOwners} = manager.sheet.exports;
  assert.deepEqual(Array.from(OWNED_AREAS, entry => [entry.area, entry.label]), [['materials', 'Estoque'], ['loans', 'Empréstimos'], ['campaigns', 'Dinâmicas']]);

  // Só a designação da área inteira conta; a de um material, empréstimo ou dinâmica específica não.
  assert.deepEqual(Array.from(areaOwners([row('materials', {item_id: 'item-a', assignees: [{name: 'Só do material'}]}), row('materials')], 'project-a', 'materials')), ['Pessoa sintética']);
  assert.deepEqual(Array.from(areaOwners([row('materials', {status: 'revoked'}), row('loans', {project_id: 'project-b'})], 'project-a', 'loans')), []);

  let tree = await manager.load(props);
  assert.deepEqual(requests.map(url => new URLSearchParams(url.split('?')[1]).get('view')).sort(), ['catalog', 'list']);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(requests.find(url => url.includes('view=list')).split('?')[1])), {view: 'list', projectId: 'project-a', target: 'area', status: 'active', limit: '50'});
  assert.match(text(tree), /Quem cuida de cada área/);
  assert.match(text(tree), /não dá acesso a nada/);
  assert.match(text(tree), /Pessoa sintética/);
  assert.equal(text(tree).match(/Ninguém indicado/g).length, 2, 'empréstimos e dinâmicas sem ninguém');
  const buttons = current => nodes(current).filter(node => node.type === 'button' && node.props['aria-controls']);
  assert.deepEqual(buttons(tree).map(node => text(node)), ['Alterar quem cuida de estoque', 'Indicar quem cuida de empréstimos', 'Indicar quem cuida de dinâmicas']);
  assert.equal(nodes(tree).filter(node => node.type === 'ResponsibilityManager').length, 0, 'o formulário só é montado quando a pessoa abre a área');
  const mounted = {};
  for (const {area} of OWNED_AREAS) {
    tree = manager.sheet.render('default', props);
    buttons(tree).find(node => node.props['aria-controls'] === `project-area-owners-${area}`).props.onClick();
    tree = manager.sheet.render('default', props);
    const [form, ...others] = nodes(tree).filter(node => node.type === 'ResponsibilityManager');
    assert.equal(others.length, 0);
    mounted[area] = form.props;
  }
  // O painel antigo, sem material/empréstimo/dinâmica, monta o mesmo componente com o mesmo alvo.
  const top = component('../components/portal/work-context-panel.tsx', {'./responsibility-manager': {default: 'ResponsibilityManager'}});
  const target = value => [value.userId, value.projectId, value.area, value.itemId ?? null, value.loanId ?? null, value.campaignId ?? null];
  for (const {area} of OWNED_AREAS) {
    const panelProps = {userId: 'user-a', projectId: 'project-a', area, compact: true, onPersonal() {}};
    let panel = top.render('default', panelProps);
    panel.props.onToggle({currentTarget: {open: true}});
    panel = top.render('default', panelProps);
    const [form] = nodes(panel).filter(node => node.type === 'ResponsibilityManager');
    assert.deepEqual(target(mounted[area]), target(form.props), area);
    assert.deepEqual(target(mounted[area]), ['user-a', 'project-a', area, null, null, null]);
  }

  // Quem só lê continua vendo os nomes, sem botão que termine em "seu acesso não permite".
  const reader = mount(false);
  tree = await reader.load({...props, areas: ['materials']});
  assert.match(text(tree), /Pessoa sintética/);
  assert.equal(buttons(tree).length, 0);
  assert.match(text(tree), /Só quem gerencia este projeto pode indicar ou trocar/);
  assert.ok(!text(tree).includes('Empréstimos'), 'área que a pessoa não abre no módulo não aparece na ficha');
  // Um retorno de outra sessão ou projeto descarta os nomes e fecha a edição, inclusive na atualização após salvar.
  for (const mismatch of [
    {list: {viewerId: 'user-b'}},
    {catalog: {viewerId: 'user-b'}},
    {list: {projectId: 'project-b'}},
  ]) {
    const staleResponse = {};
    const instance = mount(true, [row('materials')], staleResponse);
    const authorized = await instance.load(props);
    buttons(authorized)[0].props.onClick();
    const opened = instance.sheet.render('default', props);
    const editor = nodes(opened).find(node => node.type === 'ResponsibilityManager');
    assert.ok(editor);
    Object.assign(staleResponse, mismatch);
    editor.props.onChanged();
    const denied = await instance.load(props);
    assert.match(text(denied), /A sessão ou o projeto da resposta mudou/);
    assert.doesNotMatch(text(denied), /Pessoa sintética/);
    assert.equal(buttons(denied).length, 0);
    assert.equal(nodes(denied).filter(node => node.type === 'ResponsibilityManager').length, 0);
    for (const key of Object.keys(mismatch)) delete staleResponse[key];
    const recovered = await instance.load(props);
    assert.match(text(recovered), /Pessoa sintética/);
    assert.equal(nodes(recovered).filter(node => node.type === 'ResponsibilityManager').length, 0);
  }

  // Sem nenhuma área, a seção some e nada é consultado.
  const before = requests.length, none = mount(true);
  assert.equal(await none.load({...props, areas: []}), null);
  assert.equal(requests.length, before);

  // A ficha mostra cada área a quem já abre o módulo dela; o painel do topo continua no lugar até a conferência da auditoria.
  const client = source('../app/portal-client.tsx');
  assert.match(client, /\['materials', \['inventory\.read', 'inventory\.manage', 'inventory\.deliver'\]\], \['loans', \['loans\.read', 'loans\.manage', 'loans\.checkout'\]\], \['campaigns', \['campaigns\.manage', 'participation\.operate', 'inventory\.deliver'\]\]/);
  assert.match(client, /renderAreaOwners=\{areaOwners\}/);
  assert.match(client, /\(\['materials','loans','events'\] as string\[\]\)\.includes\(tab\) && workContext\(/, 'retirada do painel do topo fica para depois da conferência');
});
