import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// Render the actual JSX and execute its actual event handlers. Only the DOM/hook scheduler
// and request identity/bindings are inert adapters; API handlers, authorization and SQLite
// transactions are the production modules. Browser geometry/keyboard checks are separate.
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url), modules = new Map();
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const hooks = moduleUrl(`export const useState=(v)=>globalThis.__orgUiHooks.state(v),useRef=(v)=>globalThis.__orgUiHooks.ref(v),useId=()=>globalThis.__orgUiHooks.id(),useCallback=(fn)=>fn,useEffect=(fn,deps)=>globalThis.__orgUiHooks.effect(fn,deps);`);
const replacements = new Map([
    ['react', hooks], ['react/jsx-runtime', pathToFileURL(require.resolve('react/jsx-runtime')).href],
    ['lucide-react', moduleUrl(`export const ${['Building2','Check','LoaderCircle','Pencil','Plus','RefreshCw','ShieldCheck','UserMinus','UserPlus','X','ArrowRight','CalendarDays','ExternalLink','FolderKanban','MapPin'].map(name => `${name}=()=>null`).join(',')};`)],
    [resolve(root, 'components/portal/use-form-draft.tsx'), moduleUrl('export function useFormDraft(){return{clear(){}}} export function DraftNotice(){return null;}')],
    [resolve(root, 'components/portal/project-detail.tsx'), moduleUrl('export default function ProjectDetail(){return null;}')],
    [resolve(root, 'lib/session.ts'), moduleUrl('export async function getPortalUser(){return globalThis.__orgUiServer.user;}')],
    [resolve(root, 'lib/platform.ts'), moduleUrl('export function database(){return globalThis.__orgUiServer.db;} export function ownerEmail(){return undefined;}')],
]);
function compile(file) {
    if (replacements.has(file)) return replacements.get(file);
    file = resolve(root, file); if (replacements.has(file)) return replacements.get(file); if (modules.has(file)) return modules.get(file);
    if (file.endsWith('.css')) return moduleUrl('export default new Proxy({},{get:(_,key)=>String(key)});');
    if (file.endsWith('.json')) return moduleUrl(`export default ${readFileSync(file, 'utf8')};`);
    let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    code = code.replace(/from (['"])([^'"]+)\1/g, (match, _quote, dependency) => {
        if (replacements.has(dependency)) return `from ${JSON.stringify(replacements.get(dependency))}`;
        if (!dependency.startsWith('.') && !dependency.startsWith('@/')) return match;
        let target = dependency.startsWith('@/') ? resolve(root, dependency.slice(2)) : resolve(dirname(file), dependency);
        if (!/\.(tsx?|json|css)$/.test(target)) target += existsSync(`${target}.tsx`) ? '.tsx' : '.ts';
        return `from ${JSON.stringify(compile(target))}`;
    }).replace(/\s+with\s+\{\s*type:\s*['"]json['"]\s*\}/g, '');
    const result = moduleUrl(`${code}\n//# sourceURL=organization-ui-${file.replace(root, '')}`); modules.set(file, result); return result;
}
const { default: OrganizationsPanel } = await import(compile('components/portal/organizations-panel.tsx'));
const { default: ProjectPanel } = await import(compile('components/portal/project-panel.tsx'));
const route = await import(compile('app/api/organizations/route.ts'));
const { getActor } = await import(compile('lib/access.ts'));
const { projectAction, projectDetail } = await import(compile('lib/projects.ts'));
const origin = 'https://synthetic-ui.example.invalid';

function renderer(Component, props) {
    const instances = new Map(); let context, cursor, dirty = true, effects = [], tree;
    const slot = create => { const index = cursor++; if (!(index in context.slots)) context.slots[index] = create(); return context.slots[index]; };
    const hooks = {
        state(initial) { const instance = context, index = cursor, value = slot(() => typeof initial === 'function' ? initial() : initial); return [value, next => { instance.slots[index] = typeof next === 'function' ? next(instance.slots[index]) : next; dirty = true; }]; },
        ref(value) { return slot(() => ({ current: value })); }, id() { return slot(() => `synthetic-label-${instances.size}-${cursor}`); },
        effect(fn, deps) { const record = slot(() => ({ deps: undefined, cleanup: null })); if (!record.deps || deps.some((value, index) => !Object.is(value, record.deps[index]))) { record.deps = deps; effects.push(() => { record.cleanup?.(); record.cleanup = fn(); }); } },
    };
    function render(node, path) {
        if (node == null || typeof node === 'boolean') return null;
        if (Array.isArray(node)) return node.map((child, index) => render(child, `${path}.${child?.key ?? index}`));
        if (typeof node !== 'object') return node;
        if (typeof node.type === 'function') {
            const key = `${path}:${node.type.name}:${node.key ?? ''}`;
            const previousContext = context, previousCursor = cursor;
            context = instances.get(key) ?? { slots: [] }; instances.set(key, context); cursor = 0;
            const output = node.type(node.props); context = previousContext; cursor = previousCursor;
            return render(output, `${key}.output`);
        }
        const children = render(node.props?.children, `${path}.children`);
        if (node.props?.ref && typeof node.props.ref === 'object') node.props.ref.current ??= { open: false, showModal() { this.open = true; }, scrollIntoView() {} };
        return { type: node.type, props: { ...node.props, children } };
    }
    async function flush() {
        globalThis.__orgUiHooks = hooks;
        for (let pass = 0; pass < 24; pass++) {
            if (dirty) { dirty = false; tree = render({ type: Component, props }, 'root'); }
            const queued = effects; effects = []; for (const effect of queued) effect();
            await new Promise(resolve => setImmediate(resolve));
            if (!dirty && !effects.length && !globalThis.__orgUiServer.pending) break;
        }
        return tree;
    }
    function all(predicate, node = tree) { if (Array.isArray(node)) return node.flatMap(child => all(predicate, child)); if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...all(predicate, node.props?.children)]; }
    return { flush, all, one(predicate) { const nodes = all(predicate); assert.equal(nodes.length, 1, `Expected one UI node, got ${nodes.length}`); return nodes[0]; }, text() { return text(tree); }, async click(label) { const button = this.one(node => node.type === 'button' && text(node).trim() === label); assert.ok(!button.props.disabled, `${label} must be enabled`); await button.props.onClick(); await flush(); } };
}
function text(node) { if (Array.isArray(node)) return node.map(text).join(' '); if (!node || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); return text(node.props?.children); }
const formWith = legend => node => node.type === 'form' && text(node).includes(legend);
async function submit(ui, predicate, values = {}) { await ui.one(predicate).props.onSubmit({ preventDefault() {}, currentTarget: new Map(Object.entries(values)) }); await ui.flush(); }
async function choose(ui, name, value) { ui.one(node => node.type === 'select' && node.props.name === name).props.onChange({ target: { value } }); await ui.flush(); }

function fixture(t) {
    const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
    for (const file of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${file}`, 'utf8'));
    const now = new Date().toISOString();
    const insert = (table, row) => { const fields = Object.keys(row); native.prepare(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`).run(...Object.values(row)); };
    const db = { prepare(sql) { let values = []; return { bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values), success: true }; }, execute() { const results = native.prepare(sql).all(...values); return { results, success: true, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; }, async run() { return this.execute(); } }; }, async batch(statements) { native.exec('BEGIN'); try { const result = statements.map(statement => statement.execute()); native.exec('COMMIT'); return result; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
    function user(id, name, role, organizationId, projectId = null) { insert('portal_users', { user_id: id, email: `${id}@example.invalid`, status: 'active', created_at: now, updated_at: now }); insert('profiles', { user_id: id, display_name: name, created_at: now, updated_at: now }); if (role) insert('members', { id: `member-${id}`, user_id: id, email: `${id}@example.invalid`, role, project_id: projectId, organization_id: organizationId, created_at: now }); return { userId: id, email: `${id}@example.invalid`, displayName: name }; }
    for (const suffix of ['a', 'b']) { insert('organizations', { id: `org-${suffix}`, name: `Organization ${suffix.toUpperCase()}`, slug: `org-${suffix}`, created_at: now, updated_at: now }); insert('projects', { id: `project-${suffix}`, name: `Project ${suffix.toUpperCase()}`, organization_id: `org-${suffix}`, created_at: now }); }
    const platform = user('platform', 'Platform owner', 'owner', null), admin = user('admin', 'Local administrator', 'owner', 'org-a'), candidate = user('candidate', 'Candidate A', 'viewer', 'org-a', 'project-a'), foreign = user('foreign', 'Foreign person B', 'viewer', 'org-b', 'project-b');
    const fetch = globalThis.fetch, FormData = globalThis.FormData, requests = [];
    const server = globalThis.__orgUiServer = { db, user: admin, pending: 0 };
    globalThis.FormData = class extends FormData { constructor(form) { super(); if (form) for (const [key, value] of form) this.append(key, value); } };
    globalThis.fetch = async (path, init = {}) => { requests.push({ path: String(path), ...init, payload: init.body ? JSON.parse(init.body) : null }); server.pending++; try { const request = new Request(`${origin}${path}`, { ...init, headers: { Origin: origin, ...init.headers } }); if (String(path).startsWith('/api/organizations')) return init.method === 'POST' ? await route.POST(request) : await route.GET(request); if (String(path).startsWith('/api/projects/')) return Response.json(await projectDetail(db, await getActor(db, server.user), String(path).split('/').at(-1))); throw new Error(`Unexpected UI endpoint ${path}`); } finally { server.pending--; } };
    t.after(() => { globalThis.fetch = fetch; globalThis.FormData = FormData; delete globalThis.__orgUiServer; delete globalThis.__orgUiHooks; native.close(); });
    return { native, db, insert, now, platform, admin, candidate, foreign, requests, server, async organizations() { return (await route.GET(new Request(`${origin}/api/organizations`))).json().then(body => body.organizations); }, projects() { return native.prepare('SELECT * FROM projects').all(); }, async mutate(action, input) { requests.push({ action, payload: input }); return projectAction(db, await getActor(db, server.user), action, input); } };
}

test('local organization UI uses scoped API detail, hides global controls/foreign people and protects the last admin', async t => {
    const f = fixture(t), ui = renderer(OrganizationsPanel, { organizations: await f.organizations(), currentActor: { userId: f.admin.userId, isPlatformOwner: false }, people: [{ userId: f.foreign.userId, displayName: f.foreign.displayName }], onChanged() {} }); await ui.flush();
    assert.match(ui.text(), /Organization A/); assert.ok(!ui.text().includes('Organization B')); assert.ok(!ui.text().includes('Foreign person B')); assert.ok(!ui.text().includes('Nova organização'));
    assert.match(ui.text(), /Candidate A/); assert.equal(ui.one(node => node.type === 'button' && node.props['aria-label'] === 'Remover administração de Local administrator').props.disabled, true);
    assert.equal(f.requests.filter(request => request.method === 'POST').length, 0);
    assert.ok(f.requests.every(request => !request.path?.includes('org-b')));
});

test('actual grant and revoke handlers require a prior confirmation and commit only one scoped change', async t => {
    const f = fixture(t), ui = renderer(OrganizationsPanel, { organizations: await f.organizations(), currentActor: { userId: f.admin.userId, isPlatformOwner: false }, onChanged() {} }); await ui.flush();
    await choose(ui, 'administratorUserId', 'candidate'); await submit(ui, formWith('Nomear administrador'));
    assert.equal(f.requests.filter(request => request.method === 'POST').length, 0); assert.equal(ui.all(node => node.type === 'dialog').length, 1);
    await ui.click('Cancelar'); assert.equal(f.requests.filter(request => request.method === 'POST').length, 0);
    await submit(ui, formWith('Nomear administrador')); const button = ui.one(node => node.type === 'button' && text(node).trim() === 'Confirmar administração'); button.props.onClick(); button.props.onClick(); await ui.flush();
    const grants = f.native.prepare("SELECT * FROM members WHERE user_id='candidate' AND role='owner' AND revoked_at IS NULL").all(); assert.equal(grants.length, 1); assert.equal(grants[0].organization_id, 'org-a');
    assert.equal(f.requests.filter(request => request.payload?.action === 'organization.admin.grant').length, 1);
    const remove = ui.one(node => node.type === 'button' && node.props['aria-label'] === 'Remover administração de Candidate A'); remove.props.onClick(); await ui.flush();
    assert.equal(f.native.prepare('SELECT revoked_at FROM members WHERE id=?').get(grants[0].id).revoked_at, null);
    await ui.click('Confirmar remoção'); assert.ok(f.native.prepare('SELECT revoked_at FROM members WHERE id=?').get(grants[0].id).revoked_at);
    assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='organization.admin.revoke'").get().n, 1);
});

test('confirmation preserves the last administrator when another grant disappears before submission', async t => {
    const f = fixture(t); f.insert('members', { id: 'second-admin', user_id: 'candidate', email: f.candidate.email, role: 'owner', project_id: null, organization_id: 'org-a', created_at: f.now });
    const ui = renderer(OrganizationsPanel, { organizations: await f.organizations(), currentActor: { userId: f.admin.userId, isPlatformOwner: false }, onChanged() {} }); await ui.flush();
    ui.one(node => node.type === 'button' && node.props['aria-label'] === 'Remover administração de Local administrator').props.onClick(); await ui.flush();
    f.native.prepare("UPDATE members SET revoked_at=? WHERE id='second-admin'").run(f.now); await ui.click('Confirmar remoção');
    assert.equal(f.native.prepare("SELECT revoked_at FROM members WHERE id='member-admin'").get().revoked_at, null); assert.match(ui.text(), /Mantenha outro administrador/);
});

test('organization forms call the real create/CAS API and let a conflict reload the current version', async t => {
    const f = fixture(t); f.server.user = f.platform;
    const ui = renderer(OrganizationsPanel, { organizations: await f.organizations(), currentActor: { userId: f.platform.userId, isPlatformOwner: true }, people: [], onChanged() {} }); await ui.flush(); await ui.click('Nova organização');
    await submit(ui, formWith('Nome da organização'), { name: 'New organization', slug: 'new-organization', status: 'active' });
    const created = f.native.prepare("SELECT * FROM organizations WHERE slug='new-organization'").get(); assert.ok(created); await ui.click('Editar organização');
    f.native.prepare('UPDATE organizations SET version=2,name=? WHERE id=?').run('External revision', created.id);
    await submit(ui, formWith('Nome da organização'), { name: 'My pending edit', status: 'active' }); assert.match(ui.text(), /organização mudou/i); assert.equal(f.native.prepare('SELECT version FROM organizations WHERE id=?').get(created.id).version, 2);
    await ui.click('Recarregar versão atual'); await submit(ui, formWith('Nome da organização'), { name: 'Reviewed organization', status: 'archived' });
    assert.equal(f.native.prepare('SELECT version FROM organizations WHERE id=?').get(created.id).version, 3); assert.equal(f.native.prepare('SELECT status FROM organizations WHERE id=?').get(created.id).status, 'archived');
    const updates = f.requests.filter(request => request.payload?.action === 'organization.update'); assert.deepEqual(updates.map(request => request.payload.expectedVersion), [1, 2]);
    assert.ok(f.requests.filter(request => request.method === 'POST').every(request => request.headers['X-Proex-Action'] === '1'));
});

const projectFields = { name: 'New scoped project', shortName: '', description: '', status: 'active', lifecycle: 'active', scope: 'internal', color: '#54216C', officialUrl: '', location: '', parentId: '', startsAt: '', endsAt: '' };
test('local project creation sends an explicit organization, hides global editors and excludes foreign parent projects', async t => {
    const f = fixture(t), organizations = await f.organizations(), ui = renderer(ProjectPanel, { projects: f.projects(), organizations, isPlatformOwner: false, canCreate: true, canEdit: () => false, mutate: f.mutate }); await ui.flush();
    assert.ok(!ui.all(node => node.type === 'button').some(node => ['Unidades', 'Tipos de iniciativa'].includes(text(node).trim()))); await ui.click('Novo projeto');
    assert.equal(ui.one(node => node.type === 'input' && node.props.name === 'organizationId').props.value, 'org-a');
    assert.ok(!text(ui.one(node => node.type === 'select' && node.props.name === 'parentId')).includes('Project B'));
    await submit(ui, node => node.type === 'form' && text(node).includes('Nome oficial do projeto'), { ...projectFields, organizationId: 'org-b' }); assert.equal(f.requests.filter(request => request.action === 'project.create').length, 0);
    await submit(ui, node => node.type === 'form' && text(node).includes('Nome oficial do projeto'), projectFields);
    const project = f.native.prepare("SELECT organization_id FROM projects WHERE name='New scoped project'").get(); assert.equal(project.organization_id, 'org-a'); assert.equal(f.requests.find(request => request.action === 'project.create').payload.organizationId, 'org-a');
});

test('platform project creation has no implicit organization; selecting one narrows hierarchy and persists the choice', async t => {
    const f = fixture(t); f.server.user = f.platform;
    const ui = renderer(ProjectPanel, { projects: f.projects(), organizations: await f.organizations(), isPlatformOwner: true, canCreate: true, canEdit: () => false, mutate: f.mutate }); await ui.flush(); await ui.click('Novo projeto');
    const selector = ui.one(node => node.type === 'select' && node.props.name === 'organizationId'); assert.equal(selector.props.value, ''); assert.equal(selector.props.required, true);
    await submit(ui, node => node.type === 'form' && text(node).includes('Nome oficial do projeto'), projectFields); assert.equal(f.requests.filter(request => request.action === 'project.create').length, 0);
    await choose(ui, 'organizationId', 'org-b'); const parents = text(ui.one(node => node.type === 'select' && node.props.name === 'parentId')); assert.match(parents, /Project B/); assert.ok(!parents.includes('Project A'));
    await submit(ui, node => node.type === 'form' && text(node).includes('Nome oficial do projeto'), { ...projectFields, organizationId: 'org-b', parentId: 'project-b' });
    assert.equal(f.native.prepare("SELECT organization_id FROM projects WHERE name='New scoped project'").get().organization_id, 'org-b');
});

test('read-only organization users cannot open management forms or create projects', async t => {
    const f = fixture(t); f.server.user = f.candidate; const organizations = await f.organizations();
    const ui = renderer(OrganizationsPanel, { organizations, currentActor: { userId: f.candidate.userId, isPlatformOwner: false }, onChanged() {} }); await ui.flush(); assert.match(ui.text(), /Organization A/); assert.ok(!ui.text().includes('Organization B')); assert.equal(ui.all(node => node.type === 'form').length, 0); assert.equal(f.requests.length, 0);
    const projects = renderer(ProjectPanel, { projects: [], organizations, isPlatformOwner: false, canCreate: true, canEdit: () => false, mutate: f.mutate }); await projects.flush(); assert.ok(!projects.all(node => node.type === 'button').some(node => text(node).trim() === 'Novo projeto'));
});

test('anonymized accounts do not count as replacement admins or expose an old profile name', async t => {
    const f = fixture(t); f.insert('members', { id: 'anonymized-admin', user_id: 'candidate', email: f.candidate.email, role: 'owner', project_id: null, organization_id: 'org-a', created_at: f.now });
    f.native.prepare("UPDATE portal_users SET anonymized_at=? WHERE user_id='candidate'").run(f.now);
    const detail = await (await route.GET(new Request(`${origin}/api/organizations?organizationId=org-a`))).json(); assert.ok(detail.members.filter(member => member.user_id === 'candidate').every(member => member.anonymized === 1 && member.display_name === null));
    const ui = renderer(OrganizationsPanel, { organizations: await f.organizations(), currentActor: { userId: f.admin.userId, isPlatformOwner: false }, onChanged() {} }); await ui.flush();
    assert.ok(!ui.text().includes('Candidate A')); assert.equal(ui.one(node => node.type === 'button' && node.props['aria-label'] === 'Remover administração de Local administrator').props.disabled, true);
});

test('project editing preserves its organization and omits organization transfer from the real mutation', async t => {
    const f = fixture(t), ui = renderer(ProjectPanel, { projects: f.projects().filter(project => project.organization_id === 'org-a'), organizations: await f.organizations(), canCreate: true, canEdit: () => true, mutate: f.mutate }); await ui.flush(); await ui.click('Editar');
    assert.equal(ui.all(node => node.type === 'select' && node.props.name === 'organizationId').length, 0);
    await submit(ui, node => node.type === 'form' && text(node).includes('Nome oficial do projeto'), { ...projectFields, name: 'Edited local project', organizationId: 'org-b' });
    const mutation = f.requests.find(request => request.action === 'project.update'); assert.ok(!Object.hasOwn(mutation.payload, 'organizationId'));
    assert.equal(f.native.prepare("SELECT organization_id FROM projects WHERE id='project-a'").get().organization_id, 'org-a'); assert.equal(f.native.prepare("SELECT version FROM projects WHERE id='project-a'").get().version, 2);
});
