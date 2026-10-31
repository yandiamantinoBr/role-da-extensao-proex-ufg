import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';

/** Executes the actual component, effects, handlers, helper and canonical validators. No HTTP server. */
function harness(file = 'meu-trabalho-panel', initialProps = {}) {
  let index = 0, tree, props = {userId: 'user-a', organizationId: 'org-a', projectId: 'project-a', ...initialProps};
  const slots = [], effects = [], requests = [], listeners = new Map(), modules = new Map();
  const hooks = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => slots[i] = typeof next === 'function' ? next(slots[i]) : next]; },
    useRef(initial) { const i = index++; slots[i] ??= {current: initial}; return slots[i]; },
    useEffect(fn, deps) { const i = index++, old = slots[i]; if (!old || deps.some((value, n) => value !== old.deps[n])) effects.push(() => { old?.cleanup?.(); slots[i] = {deps, cleanup: fn()}; }); },
  };
  const jsx = {jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props})};
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const compiledModule = {exports: {}}; modules.set(file, compiledModule.exports);
    const require = name => {
      if (name.endsWith('.module.css')) return {default: new Proxy({}, {get: (_target, key) => String(key)})};
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'lucide-react') return new Proxy({}, {get: (_target, key) => String(key)});
      let target = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      target = [target, target + '.ts', target + '.tsx'].find(existsSync);
      assert.ok(target, name); return load(target);
    };
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
    vm.runInNewContext(code, {module: compiledModule, exports: compiledModule.exports, require, URLSearchParams, Intl, Date, JSON, Error, Event, AbortController, crypto, window: {addEventListener(name, fn) {listeners.set(name, fn);}, removeEventListener(name) {listeners.delete(name);}, dispatchEvent(event) {listeners.get(event.type)?.();}}, fetch: (url, init) => new Promise(resolve => requests.push({url, init, resolve}))});
    return compiledModule.exports;
  }
  const Component = load(path.join(root, 'components/portal', file + '.tsx')).default;
  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return {...node, props: {...node.props, children: expand(node.props?.children)}};
  };
  function nodes() { const result = []; const visit = node => {if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); result.push(node); visit(node.props?.children);}; visit(tree); return result; }
  const h = {
    requests,
    render(patch = {}, flush = true) {props = {...props, ...patch}; index = 0; tree = expand(Component(props)); if (flush) h.effects();},
    effects() {effects.splice(0).forEach(effect => effect());},
    body() {return text(tree);},
    find(type, predicate = () => true) {return nodes().find(node => node.type === type && predicate(node));},
    button(label) {const button = nodes().find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label)); assert.ok(button, label); return button;},
    click(label) {h.button(label).props.onClick();},
    last() {return requests.at(-1);},
    reply(request, data, status = 200) {request.resolve({ok: status >= 200 && status < 300, status, json: typeof data === 'function' ? data : async () => data});},
    async ready(data = response()) {h.reply(h.last(), data); await tick(); h.render();},
    changeStatus(value) {h.find('select').props.onChange({target: {value}});},
    event(name) {listeners.get(name)?.();},
    dispose() {slots.forEach(slot => slot?.cleanup?.());},
  };
  h.render(); return h;
}
const counts = (changes = {}) => ({total: 101, pending: 90, attention: 8, overdue: 7, dueToday: 3, inProgress: 20, blocked: 2, completed: 10, cancelled: 1, ...changes});
const target = (changes = {}) => ({kind: 'materials', id: 'material-a', name: 'Material permitido', canOpen: true, href: '/?module=inventory&itemId=material-a', ...changes});
const task = (changes = {}) => ({id: 'task-a', organization_id: 'org-a', project_id: 'project-a', organization_name: 'Organização A', project_name: 'Projeto A', title: 'Recontar material A', priority: 'high', status: 'blocked', due_at: '2026-10-31', version: 2, canEdit: false, canWork: true, canDelegateWork: false, assignees: [{user_id: 'user-a', team_id: null, name: 'Pessoa A'}, {user_id: null, team_id: 'team-a', name: 'Equipe A'}], assignmentVia: 'both', area: 'materials', href: '/?module=demands&demandId=task-a', target: target(), ...changes});
const responsibility = (changes = {}) => ({id: 'responsibility-a', organization_id: 'org-a', project_id: 'project-a', organization_name: 'Organização A', project_name: 'Projeto A', area: 'materials', item_id: 'material-a', loan_id: null, campaign_id: null, status: 'active', version: 1, created_at: '2026-10-31T12:00:00Z', updated_at: '2026-10-31T12:00:00Z', assignees: [{user_id: 'user-a', team_id: null, name: 'Pessoa A'}], assignmentVia: 'direct', canEdit: true, target: target(), ...changes});
function response(changes = {}) {
  return {version: 1, viewerId: 'user-a', asOf: '2026-10-31T12:00:00Z', today: '2026-10-31', timeZone: 'America/Sao_Paulo', scope: {organizationId: 'org-a', projectId: 'project-a', assignment: 'all', status: 'pending'}, totalsScope: 'organization-project-assignment', totals: {tasks: counts(), responsibilities: {total: 12}}, areas: [{area: 'materials', taskCounts: counts(), responsibilityCount: 12}], tasks: {items: [task()], total: 90, hasMore: true, nextOffset: 6}, responsibilities: {items: [responsibility()], total: 12, hasMore: true, nextOffset: 6}, ...changes};
}

test('the real panel shows full server totals, separate units and explicit assignment without deriving counts from its page', async () => {
  const h = harness(); try {
    assert.match(h.body(), /Consultando atribuições/); assert.ok(!h.body().includes('Atenção0'));
    await h.ready(); assert.match(h.body(), /Atenção8/); assert.match(h.body(), /Concluídas10/); assert.match(h.body(), /101 demandas · 12 designações/); assert.match(h.body(), /Direta e pela equipe/); assert.match(h.body(), /Responsáveis: Pessoa A, Equipe A/);
    h.click('Concluídas10Demandas finalizadas'); h.render(); const query = new URL(h.last().url, 'http://fixture').searchParams; assert.equal(query.get('status'), 'completed'); assert.equal(query.get('taskOffset'), '0');
    await h.ready(response({scope: {...response().scope, status: 'completed'}, tasks: {...response().tasks, total: 10}})); assert.match(h.body(), /Atenção8/); assert.match(h.body(), /Demandas · 10/);
  } finally {h.dispose();}
});

test('direct/team and both pagers change the server query and keep the other page offset', async () => {
  const h = harness(); try {
    await h.ready(); h.click('Diretas'); h.render(); assert.equal(new URL(h.last().url, 'http://fixture').searchParams.get('assignment'), 'direct');
    await h.ready(response({scope: {...response().scope, assignment: 'direct'}}));
    h.find('nav', n => n.props['aria-label'] === 'Páginas de demandas').props.children[1].props.children[1].props.onClick(); h.render(); let query = new URL(h.last().url, 'http://fixture').searchParams; assert.equal(query.get('taskOffset'), '6'); assert.equal(query.get('responsibilityOffset'), '0');
    await h.ready(response({scope: {...response().scope, assignment: 'direct'}, tasks: {...response().tasks, nextOffset: 12}}));
    h.find('nav', n => n.props['aria-label'] === 'Páginas de responsabilidades').props.children[1].props.children[1].props.onClick(); h.render(); query = new URL(h.last().url, 'http://fixture').searchParams; assert.equal(query.get('taskOffset'), '6'); assert.equal(query.get('responsibilityOffset'), '6');
  } finally {h.dispose();}
});

test('account/context changes hide old data before effects; late responses, wrong viewer and wrong context cannot populate it', async () => {
  const h = harness(); try {
    await h.ready(); h.click('Atualizar meu trabalho'); h.render(); const old = h.last();
    h.render({userId: 'user-b', organizationId: 'org-b', projectId: 'project-b'}, false); assert.ok(!h.body().includes('Recontar material A')); assert.ok(!h.body().includes('Pessoa A')); h.effects();
    h.reply(old, response()); await tick(); h.render(); assert.ok(!h.body().includes('Recontar material A'));
    await h.ready(response({viewerId: 'user-b'})); assert.match(h.body(), /contexto da resposta mudou/); assert.ok(!h.body().includes('Pessoa A'));
    h.click('Atualizar meu trabalho'); h.render(); await h.ready(response({scope: {organizationId: 'org-b', projectId: 'project-b', assignment: 'all', status: 'pending'}})); assert.match(h.body(), /sessão ou o contexto/);
  } finally {h.dispose();}
});

test('an old response between filter handler and cleanup cannot replace the new query; 403 clears totals and names', async () => {
  const h = harness(); try {
    await h.ready(); h.click('Atualizar meu trabalho'); h.render(); const old = h.last(); h.click('Por equipe'); h.reply(old, response()); await tick(); h.render(); assert.equal(old.init.signal.aborted, true); assert.ok(!h.body().includes('Pessoa A'));
    await h.ready(response({scope: {...response().scope, assignment: 'team'}})); assert.match(h.body(), /Pessoa A/);
    h.click('Atualizar meu trabalho'); h.render(); h.reply(h.last(), {}, 403); await tick(); h.render(); assert.match(h.body(), /Seu acesso mudou/); assert.ok(!h.body().includes('Pessoa A')); assert.ok(!h.body().includes('Atenção8'));
  } finally {h.dispose();}
});

test('restricted targets never display a supplied hidden title or link; valid task callbacks preserve explicit context', async () => {
  const seen = [], h = harness('meu-trabalho-panel', {onOpenTask: (...args) => seen.push(args)}); try {
    await h.ready(response({tasks: {...response().tasks, items: [task({target: target({name: 'Hidden entity', canOpen: false, href: '/?module=forbidden'})})]}, responsibilities: {...response().responsibilities, items: [responsibility({target: target({name: 'Hidden entity', canOpen: false, href: '/?module=forbidden'})})]}}));
    assert.ok(!h.body().includes('Hidden entity')); assert.ok(!h.find('a', n => n.props.href === '/?module=forbidden')); assert.match(h.body(), /A designação não amplia/);
    h.click('Recontar material A'); assert.equal(seen[0][0], 'task-a'); assert.equal(seen[0][1].projectId, 'project-a');
  } finally {h.dispose();}
});

test('malformed JSON and nested DTOs show an error rather than false empty results; unmounted requests are cancelled', async () => {
  for (const data of [{}, response({tasks: {...response().tasks, items: [null]}}), async () => {throw new SyntaxError('truncated');}]) {
    const h = harness(); try {h.reply(h.last(), data); await tick(); h.render(); assert.ok(h.find('p', n => n.props.role === 'alert')); assert.ok(!h.body().includes('Nenhuma demanda neste recorte'));} finally {h.dispose();}
  }
  const h = harness(), request = h.last(); h.dispose(); assert.equal(request.init.signal.aborted, true); h.reply(request, response()); await tick();
});

test('refresh events preserve the selected filters, without polling or storing personal data', async () => {
  const h = harness(); try {await h.ready(); h.changeStatus('overdue'); h.render(); await h.ready(response({scope: {...response().scope, status: 'overdue'}, asOf: 'invalid'})); assert.match(h.body(), /horário não informado/); h.event('proex:followup-changed'); h.render(); assert.equal(new URL(h.last().url, 'http://fixture').searchParams.get('status'), 'overdue'); assert.equal(h.last().init.cache, 'no-store');} finally {h.dispose();}
});
