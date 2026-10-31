import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const projects = [{id: 'project-a', name: 'Projeto A'}, {id: 'project-b', name: 'Projeto B'}];
const ProjectDetailBoundary = 'ProjectDetailBoundary';
function harness(file, props = {}, internalMaterial = false) {
  let index = 0, tree, pendingRender = false;
  const slots = [], effects = [], requests = [], compiledModule = {exports: {}};
  const sameDeps = (a, b) => a && a.length === b.length && a.every((value, n) => value === b[n]);
  const hooks = {
    useState(initial) {const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => {slots[i] = typeof value === 'function' ? value(slots[i]) : value; pendingRender = true;}];},
    useRef(initial) {const i = index++; return slots[i] ??= {current: initial};},
    useCallback(fn, deps) {const i = index++; if (!sameDeps(slots[i]?.deps, deps)) slots[i] = {deps, fn}; return slots[i].fn;},
    useEffect(fn, deps = []) {const i = index++, old = slots[i]; if (!sameDeps(old?.deps, deps)) effects.push(() => {old?.cleanup?.(); slots[i] = {deps, cleanup: fn()};});},
  };
  const jsx = (type, props) => ({type, props});
  const source = readFileSync(new URL(`../components/portal/${file}.tsx`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code + (internalMaterial ? '\nmodule.exports.MaterialDialogForTest = MaterialDialog;' : ''), {
    module: compiledModule, exports: compiledModule.exports, require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? {jsx, jsxs: jsx} : name === 'lucide-react' ? new Proxy({}, {get: (_target, key) => String(key)}) : name.endsWith('.css') ? {default: new Proxy({}, {get: (_target, key) => String(key)})} : name === './project-detail' ? {default: ProjectDetailBoundary} : name === '@/lib/extension-catalog' ? {areaLabel: value => value, lineLabel: value => value, groupUnits: () => [], EXTENSION_LINES: [], THEMATIC_AREAS: []} : {default: () => null, useFormDraft: () => ({clear() {}}), DraftNotice: () => null},
    URL, Date, Intl, Error, AbortController, FormData, crypto, fetch: (url, init) => new Promise(resolve => requests.push({url, init, resolve})),
  });
  const Component = internalMaterial ? compiledModule.exports.MaterialDialogForTest : compiledModule.exports.default;
  function nodes() {const result = []; const visit = node => {if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); result.push(node); visit(node.props?.children);}; visit(tree); return result;}
  const h = {
    requests,
    render(patch = {}, flush = true) {props = {...props, ...patch}; let count = 0; do {pendingRender = false; index = 0; effects.length = 0; tree = Component(props); assert.ok(++count < 5, 'render converges after a controlled target change');} while (pendingRender); for (const node of nodes()) if (node.props?.ref && !node.props.ref.current) node.props.ref.current = {open: false, showModal() {this.open = true;}, close() {this.open = false;}, scrollIntoView() {}}; if (flush) h.effects();},
    effects() {effects.splice(0).forEach(effect => effect());},
    body() {return text(tree);},
    node(type, predicate = () => true) {return nodes().find(node => node.type === type && predicate(node));},
    button(label) {const node = h.node('button', node => text(node).trim() === label || node.props['aria-label'] === label); assert.ok(node, label); return node;},
    detail() {return h.node(ProjectDetailBoundary);},
    click(label) {h.button(label).props.onClick();},
    reply(request, payload, status = 200) {request.resolve({ok: status >= 200 && status < 300, json: async () => payload});},
    async ready(payload, status = 200) {h.reply(requests.at(-1), payload, status); await tick(); h.render();},
    dispose() {slots.forEach(slot => slot?.cleanup?.());},
  };
  h.render(); return h;
}
const panel = props => harness('project-panel', {projects, projectTypes: [], organizationalUnits: [], organizations: [{id: 'org-a', name: 'Organização A', status: 'active', canManage: true}], canCreate: true, canEdit: () => true, mutate: async () => ({}), ...props});
const projectPayload = id => ({project: {id, name: `Projeto ${id}`, status: 'active', lifecycle: 'active', scope: 'internal'}, links: [], calls: [], schedule: [], relatedProjects: [], versions: [], permissions: {canEdit: false}, relationships: {}});
const detail = props => harness('project-detail', {projectId: 'project-a', projects, mutate: async () => ({}), onBack() {}, onEdit() {}, ...props});
const materialPayload = (id = 'item-a', projectId = 'authorized-project') => ({item: {id, project_id: projectId, name: 'Material autorizado', category: 'gift', stock: 1, reserved: 0, unit: 'unidade', version: 1, low_stock: 0, condition: 'active'}, category: null, categories: [], movements: [], photos: [], versions: [], availability: {available: 1}, permissions: {canManage: false, canUploadPhotos: false}, nextCursor: null});
const material = props => harness('material-detail-drawer', {itemId: 'item-a', onClose() {}, ...props}, true);

test('ProjectPanel accepts only a visible initial target and preserves the list when no target exists', () => {
  for (const initialProjectId of [undefined, '', 'hidden-project']) {
    const h = panel({initialProjectId}); try {assert.equal(h.detail(), undefined); assert.match(h.body(), /Projetos da equipe/); assert.equal(h.requests.length, 0);} finally {h.dispose();}
  }
  const slot = id => `work:${id}`, h = panel({initialProjectId: 'project-a', renderWorkContext: slot}); try {assert.equal(h.detail().props.projectId, 'project-a'); assert.equal(h.detail().props.renderWorkContext, slot); h.render({projects: [projects[1]]}); assert.equal(h.detail(), undefined);} finally {h.dispose();}
});

test('manual open/back notifies URL state once and its echo does not reopen the detail or discard a new form', () => {
  const seen = [], h = panel({onDetailChange: id => seen.push(id)}); try {
    h.click('Acessar projeto'); h.render({initialProjectId: 'project-a'}); assert.equal(h.detail().props.projectId, 'project-a'); assert.deepEqual(seen, ['project-a']);
    h.detail().props.onBack(); h.render({initialProjectId: ''}); assert.equal(h.detail(), undefined); assert.deepEqual(seen, ['project-a', null]);
    h.render({initialProjectId: 'project-b'}); assert.equal(h.detail().props.projectId, 'project-b'); assert.deepEqual(seen, ['project-a', null], 'incoming targets are not echoed back');
    h.click('Novo projeto'); h.render({initialProjectId: ''}); assert.match(h.body(), /Criar projeto/); assert.equal(h.detail(), undefined); assert.equal(seen.at(-1), null);
    h.render({initialProjectId: 'project-a'}); assert.equal(h.detail().props.projectId, 'project-a'); assert.ok(!h.body().includes('Criar projeto'));
  } finally {h.dispose();}
});

test('an incoming project target replaces an editing context, while edit/cancel keeps the current detail', async () => {
  const h = panel({initialProjectId: 'project-a'}); try {
    h.detail().props.onEdit(projects[0]); await h.ready({...projectPayload('project-a'), types: [], organizationalUnits: [], permissions: {canEdit: true}}); assert.match(h.body(), /Editar Projeto project-a/); assert.equal(h.detail().props.projectId, 'project-a');
    h.click('Fechar formulário de projeto'); h.render(); assert.equal(h.detail().props.projectId, 'project-a'); assert.ok(!h.body().includes('Editar Projeto project-a'));
    h.render({initialProjectId: 'project-b'}); assert.equal(h.detail().props.projectId, 'project-b');
  } finally {h.dispose();}
});

test('ProjectDetail mounts work only after an authorized matching response; target changes and 403 cannot reuse the previous slot', async () => {
  const calls = [], h = detail({renderWorkContext: id => {calls.push(id); return `work:${id}`;}}); try {
    assert.deepEqual(calls, []); await h.ready(projectPayload('project-a')); assert.equal(calls.at(-1), 'project-a'); assert.match(h.body(), /work:project-a/);
    const before = calls.length; h.render({projectId: 'project-b'}, false); assert.equal(calls.length, before); assert.ok(!h.body().includes('work:project-a')); h.effects(); await h.ready({}, 403); assert.equal(calls.length, before); assert.ok(!h.body().includes('work:'));
    h.render({projectId: 'project-a'}); await h.ready(projectPayload('project-b')); assert.match(h.body(), /não corresponde ao projeto/); assert.equal(calls.length, before);
  } finally {h.dispose();}
});

test('a late project response cannot create a work slot for a different requested detail', async () => {
  const calls = [], h = detail({renderWorkContext: id => {calls.push(id); return 'work';}}); try {
    const old = h.requests[0]; h.render({projectId: 'project-b'}); assert.equal(old.init.signal.aborted, true); h.reply(old, projectPayload('project-a')); await tick(); h.render(); assert.deepEqual(calls, []); await h.ready(projectPayload('project-b')); assert.deepEqual(calls, ['project-b']);
  } finally {h.dispose();}
});

test('the material work tab is optional and uses only the item/project from its authorized detail response', async () => {
  const calls = [], h = material({renderWorkContext: context => {calls.push(context); return `work:${context.itemId}:${context.projectId}`;}}); try {
    assert.equal(h.node('button', node => text(node) === 'Acompanhamento'), undefined); assert.deepEqual(calls, []); await h.ready(materialPayload()); assert.deepEqual(calls, []); h.click('Acompanhamento'); h.render(); assert.equal(calls.at(-1).itemId, 'item-a'); assert.equal(calls.at(-1).projectId, 'authorized-project'); assert.match(h.body(), /work:item-a:authorized-project/);
    h.click('Atualizar material'); await h.ready({}, 403); assert.ok(!h.body().includes('work:')); assert.equal(h.node('button', node => text(node) === 'Acompanhamento'), undefined);
  } finally {h.dispose();}
  const absent = material(); try {await absent.ready(materialPayload()); assert.equal(absent.node('button', node => text(node) === 'Acompanhamento'), undefined);} finally {absent.dispose();}
});

test('missing/mismatched material identity cannot mount the slot, and no selected item mounts no dialog', async () => {
  for (const payload of [materialPayload('item-b'), {...materialPayload(), item: {...materialPayload().item, project_id: null}}]) {
    const calls = [], h = material({renderWorkContext: context => calls.push(context)}); try {await h.ready(payload); assert.deepEqual(calls, []); assert.equal(h.node('button', node => text(node) === 'Acompanhamento'), undefined); assert.match(h.body(), /não corresponde ao material/);} finally {h.dispose();}
  }
  const h = harness('material-detail-drawer', {itemId: null, onClose() {}, renderWorkContext() {assert.fail('no target');}}); try {assert.equal(h.body(), ''); assert.equal(h.requests.length, 0);} finally {h.dispose();}
});

test('material target replacement hides the old slot before cleanup and discards a late response', async () => {
  const calls = [], h = material({renderWorkContext: context => {calls.push(context.itemId); return `work:${context.itemId}`;}}); try {
    await h.ready(materialPayload()); h.click('Acompanhamento'); h.render(); const before = calls.length; h.click('Atualizar material'); const old = h.requests.at(-1); h.render({itemId: 'item-b'}, false); assert.ok(!h.body().includes('work:item-a')); assert.equal(calls.length, before); h.effects(); h.reply(old, materialPayload()); await tick(); h.render(); assert.equal(calls.length, before); await h.ready(materialPayload('item-b', 'project-b')); assert.equal(calls.at(-1), 'item-b'); assert.ok(!h.body().includes('work:item-a'));
  } finally {h.dispose();}
});
