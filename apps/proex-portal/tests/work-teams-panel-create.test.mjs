import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// Equipes: onde se cria e edita (relato do Yan, 09/11/2026: "não consegui registrar uma equipe").
const source = readFileSync(new URL('../components/portal/work-teams-panel.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const accessLabels = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/team-access-labels.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: accessLabels.exports, encodeURIComponent });
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const tick = () => new Promise(resolve => setImmediate(resolve));
const counts = { open: 0, in_progress: 0, blocked: 0, completed: 0, cancelled: 0, total: 0, high: 0, overdue: 0 };
const workspace = (query, teams) => ({ viewerId: 'owner', scope: { organizationId: 'org-a', organizationName: 'Organização A', projectId: query.get('projectId'), projectName: query.get('projectId') ? 'Projeto A' : 'Toda a organização', canManage: true }, teams, people: [], teamsTruncated: false, selectedTeamId: teams[0]?.id ?? '', tasks: [], hasMore: false, nextOffset: null, today: '2026-11-09', asOf: '2026-11-09T12:00:00Z' });

function harness(props = {}, teams = []) {
  const slots = [], effects = [], requests = []; let index = 0, tree, dirty = false;
  const same = (a, b) => a && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = index++, old = slots[i]; if (!old || !same(old.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, p) => ({ type, props: p }), compiledModule = { exports: {} };
  const api = { workTeamsApi: async query => { requests.push(new URLSearchParams(query)); return workspace(new URLSearchParams(query), teams); }, saveWorkTeam: async () => ({ teamId: 'new' }), TeamsApiError: class extends Error {} };
  vm.runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, JSON, Date, URLSearchParams, AbortController, Promise, Error,
    window: { addEventListener() {}, removeEventListener() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name === './work-teams-api' ? api : name === './follow-up-api' ? { followupChanged() {}, FOLLOWUP_CHANGED: 'followup' } : name === './use-form-draft' ? { useFormDraft: () => ({}), DraftNotice: 'DraftNotice' } : name === 'sonner' ? { toast: { success() {}, error() {} } } : name === '@/lib/follow-up/contracts' ? { priorityLabels: {}, stateLabels: {}, TASK_STATES: [] } : name === '@/lib/follow-up/teams-contract' ? { TEAM_TASK_PAGE_SIZE: 6 } : name === '@/lib/team-access-labels' ? accessLabels.exports : name.endsWith('.css') ? { default: new Proxy({}, { get: (_t, key) => String(key) }) } : new Proxy({}, { get: (_t, key) => key === 'default' ? 'Component' : String(key) }) });
  const base = { userId: 'owner', defaultProjectId: 'project-a', organizations: [{ id: 'org-a', name: 'Organização A', canManage: true }], projects: [{ id: 'project-a', name: 'Projeto A', organization_id: 'org-a' }], onOpenDemand() {} };
  const h = {
    requests,
    render() { let guard = 0; do { dirty = false; index = 0; tree = compiledModule.exports.default({ ...base, ...props }); } while (dirty && ++guard < 6); },
    async settle() { for (let round = 0; round < 4; round++) { h.render(); effects.splice(0).forEach(effect => effect()); await tick(); } h.render(); },
    nodes() { const result = []; const visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); result.push(node); visit(node.props?.children); }; visit(tree); return result; },
    button(label) { return h.nodes().find(node => node.type === 'button' && text(node).trim() === label); },
    body() { return text(tree); },
  };
  return h;
}

test('a manager sees "Nova equipe" even with a project selected, and it switches to the organization view to create', async () => {
  const h = harness();
  await h.settle();
  assert.equal(h.requests.at(-1).get('projectId'), 'project-a');
  const create = h.button('Nova equipe');
  assert.ok(create, 'antes, o botão sumia quando um projeto estava selecionado');
  assert.ok(h.button('Criar equipe'), 'sem equipes, o vazio oferece criar a primeira');
  assert.match(h.body(), /Equipes como TI, Comunicação ou Eventos organizam quem faz o trabalho/);
  create.props.onClick(); await h.settle();
  assert.equal(h.requests.at(-1).get('projectId'), null, 'equipes são da organização inteira');
  assert.ok(h.nodes().some(node => node.type === 'section' && node.props['aria-label'] === 'Nova equipe'), 'o formulário de nova equipe abre');
});

test('the shortcut to manage people keeps the team project and requires access in that context', async () => {
  const link = h => h.nodes().find(node => node.type === 'a' && text(node) === 'Pessoas e acessos');
  const allowed = harness({ canOpenAccess: project => project === 'project-a' });
  await allowed.settle();
  assert.equal(link(allowed)?.props.href, '?module=team&project=project-a');
  const denied = harness({ canOpenAccess: project => project === 'project-b' });
  await denied.settle();
  assert.equal(link(denied), undefined);
});

test('a request from a loan opens the new-team form directly, and a pinned team opens selected', async () => {
  const fromLoan = harness({ intent: { kind: 'new', organizationId: 'org-a' } });
  await fromLoan.settle();
  assert.equal(fromLoan.requests.at(-1).get('projectId'), null);
  assert.ok(fromLoan.nodes().some(node => node.type === 'section' && node.props['aria-label'] === 'Nova equipe'));
  const team = { id: 'team-x', name: 'Comunicação', status: 'active', version: 1, isMine: true, members: [], counts };
  const pins = [];
  const fromMenu = harness({ intent: { kind: 'open', teamId: 'team-x', organizationId: 'org-a' }, pinnedTeamIds: [], onTogglePin: async (id, pinned) => { pins.push([id, pinned]); } }, [team]);
  await fromMenu.settle();
  assert.equal(fromMenu.requests[0].get('teamId'), 'team-x');
  const pin = fromMenu.button('Fixar no menu');
  assert.ok(pin, 'a equipe aberta pode ser fixada no menu');
  pin.props.onClick(); await tick(); fromMenu.render();
  assert.deepEqual(pins, [['team-x', true]]);
  assert.match(fromMenu.body(), /Comunicação fixada/);
});

test('the panel reports which team is shown, so the side menu marks the right pinned team', async () => {
  const teams = [{ id: 'team-x', name: 'Comunicação', status: 'active', version: 1, isMine: true, members: [], counts }, { id: 'team-y', name: 'Logística', status: 'active', version: 1, isMine: true, members: [], counts }];
  const shown = [];
  const h = harness({ intent: { kind: 'open', teamId: 'team-x', organizationId: 'org-a' }, onTeamShown: id => shown.push(id) }, teams);
  await h.settle();
  assert.equal(shown.at(-1), 'team-x');
});
