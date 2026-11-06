import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';

/** Browser boundaries are modeled; these tests exercise the actual component handlers and effects. */
function harness(file, props, material = false) {
  let index = 0, tree, pending = false, timerId = 0;
  const slots = [], effects = [], requests = [], timers = new Map(), focused = [];
  const same = (a, b) => a && a.length === b.length && a.every((value, n) => value === b[n]);
  const hooks = {
    useState(initial) {const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => {slots[i] = typeof value === 'function' ? value(slots[i]) : value; pending = true;}];},
    useRef(initial) {const i = index++; return slots[i] ??= {current: initial};},
    useCallback(fn, deps) {const i = index++; if (!same(slots[i]?.deps, deps)) slots[i] = {deps, fn}; return slots[i].fn;},
    useEffect(fn, deps = []) {const i = index++, old = slots[i]; if (!same(old?.deps, deps)) effects.push(() => {old?.cleanup?.(); slots[i] = {deps, cleanup: fn()};});},
  };
  const schedule = fn => {timers.set(++timerId, fn); return timerId;};
  const fetcher = (url, init) => new Promise(resolve => requests.push({url, init, resolve}));
  const compiled = {exports: {}}, jsx = (type, props, key) => ({type, props, key});
  const source = readFileSync(new URL(`../components/portal/${file}.tsx`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const boundary = () => null;
  const require = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? {jsx, jsxs: jsx} : name === 'lucide-react' ? new Proxy({}, {get: (_target, key) => String(key)}) : name.endsWith('.css') ? {default: new Proxy({}, {get: (_target, key) => String(key)})} : name === 'sonner' ? {toast: {success() {}, warning() {}}} : name === '@/lib/follow-up/contracts' ? {TASK_STATES: ['open'], TASK_PRIORITIES: ['medium'], stateLabels: {open: 'Aberta'}, priorityLabels: {medium: 'Média'}, manualShareUrl: () => '#'} : name === './follow-up-api' ? {followupChanged() {}, followupApi: async (query, input, signal) => (await fetcher(`/api/follow-up?${query}`, {signal, body: input})).json()} : {default: boundary, TaskSignals: boundary, WorkTaskCard: boundary, TaskPageSummary: boundary, TaskTriageMatrix: boundary, TaskTriage: boundary};
  vm.runInNewContext(code + (material ? '\nmodule.exports.Component = MaterialDialog;' : '\nmodule.exports.Component = module.exports.default;'), {module: compiled, exports: compiled.exports, require, fetch: fetcher, URL, URLSearchParams, Date, Intl, Error, FormData, crypto, AbortController, setTimeout: schedule, clearTimeout: id => timers.delete(id), document: {body: {}, activeElement: null}, window: {location: {origin: 'http://127.0.0.1:5173'}, requestAnimationFrame: schedule, dispatchEvent() {}}});
  const nodes = () => {const result = []; const visit = node => {if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); result.push(node); visit(node.props?.children);}; visit(tree); return result;};
  const h = {
    requests, focused,
    render(patch = {}) {
      props = {...props, ...patch};
      do {pending = false; index = 0; effects.length = 0; tree = compiled.exports.Component(props);} while (pending);
      for (const node of nodes()) if (node.props?.ref && !node.props.ref.current) node.props.ref.current = {open: false, showModal() {this.open = true;}, close() {this.open = false;}, scrollIntoView() {}, focus() {focused.push(node.props.id || node.props['aria-label'] || text(node));}};
      effects.splice(0).forEach(effect => effect());
    },
    flush() {const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()); h.render();},
    node(type, predicate = () => true) {return nodes().find(node => node.type === type && predicate(node));},
    component(name) {return nodes().find(node => typeof node.type === 'function' && node.type.name === name);},
    button(label) {const node = h.node('button', node => text(node) === label || node.props['aria-label'] === label); assert.ok(node, label); return node;},
    click(label) {const node = h.button(label); node.props.onClick({currentTarget: node.props.ref?.current}); h.render();},
    view(request) {return new URL(request.url, 'http://127.0.0.1').searchParams.get('view');},
    request(view) {return view ? requests.filter(request => h.view(request) === view).at(-1) : requests.at(-1);},
    async reply(payload, view) {h.request(view).resolve({ok: true, json: async () => payload}); await tick(); h.render();},
    body() {return text(tree);},
    dispose() {slots.forEach(slot => slot?.cleanup?.());},
  };
  h.render(); h.flush(); return h;
}
const materialPayload = canManage => ({item: {id: 'item-a', project_id: 'project-a', name: 'Pasta', category: 'gift', unit: 'unidade', stock: 2, reserved: 0, version: 3, low_stock: 0, condition: 'active'}, category: null, categories: [], movements: [], photos: [], versions: [], availability: {available: 2}, permissions: {canManage, canUploadPhotos: false}, nextCursor: null});
const material = mode => harness('material-detail-drawer', {itemId: 'item-a', initialMode: mode, onClose() {}}, true);
const catalog = (project = 'project-a', canEdit = true) => ({organizations: [{id: 'org-a', name: 'Organização', canManage: true}], projects: [{id: project, organization_id: 'org-a', name: project, canEdit}], people: [], teamPeople: [], teams: [], items: [], campaigns: [], loans: [], canEdit, canManageTeams: false});
const task = (project = 'project-a', canEdit = true) => ({id: 'task-a', project_id: project, organization_id: 'org-a', title: 'Conferir pastas', body: '', status: 'open', priority: 'medium', version: 2, canEdit, canWork: !canEdit, canDelegateWork: false, assignees: []});
const taskDetail = (...args) => ({task: task(...args), checklist: null, workCandidates: [], workGrants: [], history: []});
async function demand(project = 'project-a', canEdit = true) {
  const h = harness('follow-up-panel', {defaultProjectId: 'project-a', defaultOrganizationId: 'org-a', initialTaskId: 'task-a'});
  await h.reply(catalog(), 'catalog'); await h.reply(taskDetail(project, canEdit), 'detail'); return h;
}

test('material opens in view by default; explicit edit focuses the form and Escape returns to its button without discarding the form', async () => {
  const h = material(); try {
    await h.reply(materialPayload(true));
    assert.equal(h.node('section', n => n.props.id === 'material-edit-panel').props.hidden, true);
    h.click('Editar cadastro');
    assert.equal(h.node('section', n => n.props.id === 'material-edit-panel').props.hidden, false);
    assert.equal(h.button('Editar cadastro').props['aria-expanded'], true);
    assert.equal(h.focused.at(-1), 'material-edit-title');
    const form = h.node('form', n => text(n).includes('Salvar cadastro')); assert.ok(form); assert.equal(form.key, 3);
    let prevented = false;
    h.node('section', n => n.props.id === 'material-edit-panel').props.onKeyDown({key: 'Escape', preventDefault() {prevented = true;}, stopPropagation() {}}); h.render();
    assert.equal(prevented, true); assert.equal(h.focused.at(-1), 'Editar cadastro');
    assert.equal(h.node('section', n => n.props.id === 'material-edit-panel').props.hidden, true);
    assert.ok(h.node('form', n => n.key === form.key), 'form stays mounted while collapsed');
  } finally {h.dispose();}
});

test('initial edit/move waits for live permission and a read-only response never exposes a mutation form', async () => {
  for (const mode of ['edit', 'move']) {
    const h = material(mode); try {
      assert.equal(h.node('form'), undefined); await h.reply(materialPayload(false));
      assert.equal(h.node('form'), undefined); assert.equal(h.node('button', n => text(n) === 'Editar cadastro'), undefined);
      assert.match(h.body(), /Alerta de estoque/);
    } finally {h.dispose();}
    const writable = material(mode); try {
      await writable.reply(materialPayload(true));
      assert.equal(writable.focused.at(-1), mode === 'edit' ? 'material-edit-title' : 'Registrar uma movimentação');
      if (mode === 'edit') assert.equal(writable.node('section', n => n.props.id === 'material-edit-panel').props.hidden, false);
      else assert.ok(writable.node('form', n => text(n).includes('Confirmar movimentação')));
      writable.click('Atualizar material'); await writable.reply(materialPayload(false));
      assert.equal(writable.node('form'), undefined, 'revocation removes every mutation form');
    } finally {writable.dispose();}
  }
});

test('demand header edit opens and focuses the existing editor; Escape collapses it and retains its versioned form', async () => {
  const h = await demand(); try {
    const controls = h.button('Editar demanda').props['aria-controls'];
    h.click('Editar demanda');
    assert.equal(h.node('details', n => n.props.id === controls).props.open, true);
    assert.equal(h.focused.at(-1), 'Editar demanda');
    const editor = h.component('TaskEditor'); assert.equal(editor.props.task.version, 2);
    h.node('details', n => n.props.id === controls).props.onKeyDown({key: 'Escape', preventDefault() {}, stopPropagation() {}}); h.render();
    assert.equal(h.node('details', n => n.props.id === controls).props.open, false);
    assert.equal(h.button('Editar demanda').props['aria-expanded'], false);
    assert.equal(h.component('TaskEditor').key, editor.key);
    assert.ok(h.node('h3', n => text(n) === 'Conferir pastas'), 'demand stays open');
  } finally {h.dispose();}
});

test('demand edit follows the actual task context and waits for its authorized catalog; limited workers have no editor button', async () => {
  const h = await demand('project-b'); try {
    assert.equal(h.component('TaskEditor'), undefined); h.click('Editar demanda');
    assert.equal(new URL(h.request('catalog').url, 'http://127.0.0.1').searchParams.get('projectId'), 'project-b');
    assert.equal(h.component('TaskEditor'), undefined);
    await h.reply(catalog('project-b'), 'catalog'); assert.equal(h.component('TaskEditor').props.projectId, 'project-b');
  } finally {h.dispose();}
  const worker = await demand('project-a', false); try {
    assert.equal(worker.node('button', n => text(n) === 'Editar demanda'), undefined);
    assert.equal(worker.component('TaskEditor'), undefined);
  } finally {worker.dispose();}
});
