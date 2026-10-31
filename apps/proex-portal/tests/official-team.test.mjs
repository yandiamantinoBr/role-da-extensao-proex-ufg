import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const temporary = mkdtempSync(join(realpathSync(tmpdir()), 'proex-official-team-'));
after(() => { const target = realpathSync(temporary); if (dirname(target) === realpathSync(tmpdir()) && basename(target).startsWith('proex-official-team-')) rmSync(target, { recursive: true, force: true }); });
writeFileSync(join(temporary, 'package.json'), '{"type":"module"}');
const url = name => pathToFileURL(join(temporary, name)).href;
const catalogCode = ts.transpileModule(readFileSync(new URL('../lib/catalog/proex-team.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
writeFileSync(join(temporary, 'catalog.js'), catalogCode);
const { PROEX_TEAM, PROEX_TEAM_SOURCE, officialTeamPrefill, searchOfficialTeam, isPublishedInstitutionalEmail } = await import(url('catalog.js'));

test('verified snapshot contains only sourced professional fields, with unique people and honest provenance', () => {
  assert.equal(PROEX_TEAM_SOURCE.url, 'https://proex.ufg.br/p/equipe-proex');
  assert.equal(PROEX_TEAM_SOURCE.mode, 'verified_local_snapshot'); assert.equal(PROEX_TEAM_SOURCE.verifiedAt, '2026-10-31'); assert.equal(PROEX_TEAM_SOURCE.publishedUpdate, '2026-10-05');
  assert.equal(PROEX_TEAM.length, 31); assert.equal(new Set(PROEX_TEAM.map(person => person.id)).size, 31); assert.equal(new Set(PROEX_TEAM.map(person => person.email)).size, 31);
  for (const person of PROEX_TEAM) assert.deepEqual(Object.keys(person).sort(), ['id', 'name', 'sector', 'position', 'email', 'contactStatus'].sort());
  assert.ok(Object.isFrozen(PROEX_TEAM) && PROEX_TEAM.every(Object.isFrozen));
  assert.ok(PROEX_TEAM.filter(person => person.sector.startsWith('ExeCult')).every(person => person.position === null), 'missing published positions are not inferred from names or email');
});
test('accent-insensitive multiword search and sector filter keep similarly named people distinct', () => {
  assert.deepEqual(searchOfficialTeam('helio nucleo').map(person => person.id), ['helio-batista']);
  assert.deepEqual(searchOfficialTeam('ingles', 'Revista UFG').map(person => person.id), ['weller-dias']);
  assert.equal(searchOfficialTeam('Nathalia').length, 3);
  assert.equal(searchOfficialTeam('', 'Coordenações').length, 4);
  assert.equal(searchOfficialTeam('not a published person').length, 0);
  assert.notEqual(searchOfficialTeam('mateus')[0].email, searchOfficialTeam('matheus')[0].email);
});
test('published typo is preserved without correction or prefill, and another person’s email is not substituted', () => {
  const uncertain = PROEX_TEAM.find(person => person.id === 'nathalia-magalhaes');
  assert.equal(uncertain.email, 'nathalia_rezende@discete.ufg.br'); assert.equal(uncertain.contactStatus, 'needs-review'); assert.equal(officialTeamPrefill(uncertain.id), null);
  assert.equal(officialTeamPrefill('heliza-sousa').email, 'helizasousa@discente.ufg.br');
  assert.notEqual(officialTeamPrefill('heliza-sousa').email, officialTeamPrefill('helio-batista').email);
});
test('institutional domains confer no role or identity and prefills are a pure explicit contact projection', () => {
  for (const address of ['synthetic@ufg.br', 'synthetic@discente.ufg.br']) assert.equal(isPublishedInstitutionalEmail(address), true);
  for (const address of ['synthetic@ufg.br.evil.invalid', 'synthetic@discete.ufg.br', 'synthetic@other.ufg.br', 'A <synthetic@ufg.br>', 'synthetic@ufg.br\n', 'synthetic@ufg.br,other@ufg.br']) assert.equal(isPublishedInstitutionalEmail(address), false);
  assert.equal(officialTeamPrefill('synthetic@ufg.br'), null); assert.equal(officialTeamPrefill('__proto__'), null);
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = () => { calls++; throw new Error('prefill must not call any API'); };
  try {
    for (const person of PROEX_TEAM.filter(person => person.contactStatus === 'published')) {
      const prefill = officialTeamPrefill(person.id);
      assert.deepEqual(Object.keys(prefill).sort(), ['id', 'name', 'email', 'sourceUrl', 'verifiedAt'].sort());
      assert.equal(prefill.name, person.name); assert.equal(prefill.email, person.email);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

// Execute the real component event handlers with inert hooks and JSX nodes.
// This verifies selection/submission behavior, not browser layout or hydration.
writeFileSync(join(temporary, 'react.js'), 'export const useState=value=>[typeof value==="function"?value():value,()=>{}];export const useRef=value=>({current:value});');
writeFileSync(join(temporary, 'jsx.js'), 'export const Fragment="fragment";export const jsx=(type,props,key)=>({type,props:props??{},key});export const jsxs=jsx;');
writeFileSync(join(temporary, 'css.js'), 'export default new Proxy({},{get:(_target,key)=>String(key)});');
function component(name) {
  let code = ts.transpileModule(readFileSync(new URL(`../components/portal/${name}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  code = code.replace(/from ['"]react['"]/g, `from ${JSON.stringify(url('react.js'))}`).replace(/from ['"]react\/jsx-runtime['"]/g, `from ${JSON.stringify(url('jsx.js'))}`)
    .replace(/from ['"]\.\.\/\.\.\/lib\/catalog\/proex-team['"]/g, `from ${JSON.stringify(url('catalog.js'))}`)
    .replace(/from ['"]\.\/[^'"]+\.css['"]/g, `from ${JSON.stringify(url('css.js'))}`)
    .replace(/import TeamPersonDetail from ['"]\.\/team-person-detail['"];?/, 'const TeamPersonDetail=()=>null;')
    .replace(/import \{ useFormDraft, DraftNotice \} from ['"]\.\/use-form-draft['"];?/, 'const useFormDraft=(_ref,key)=>{globalThis.__officialDraftKeys.push(key);return{clear(){},savedAt:null}};const DraftNotice=()=>null;')
    .replace(/import \{([^}]+)\} from ['"]lucide-react['"];?/, (_all, names) => names.split(',').map(name => `const ${name.trim()}="icon";`).join(''));
  writeFileSync(join(temporary, `${name}.js`), code); return import(url(`${name}.js`));
}
const { default: OfficialTeamDirectory } = await component('official-team-directory');
const { default: TeamPanel } = await component('team-panel');
function nodes(tree, predicate) { if (Array.isArray(tree)) return tree.flatMap(value => nodes(value, predicate)); if (!tree || typeof tree !== 'object') return []; return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)]; }

test('directory selection invokes only the local prefill callback, never an invite or account request', () => {
  let selected; const original = globalThis.fetch; let network = 0;
  globalThis.fetch = () => { network++; throw new Error('no network permitted for catalog selection'); };
  try {
    const tree = OfficialTeamDirectory({ onSelect: value => { selected = value; } });
    assert.equal(selected, undefined);
    const buttons = nodes(tree, node => node.type === 'button'); assert.equal(buttons.length, 30);
    buttons[0].props.onClick();
    assert.equal(selected.email, officialTeamPrefill('luana-ribeiro').email); assert.equal(typeof selected.selectionKey, 'string');
    assert.equal('role' in selected, false); assert.equal('projectId' in selected, false); assert.equal(network, 0);
    const readonly = OfficialTeamDirectory({}); assert.equal(nodes(readonly, node => node.type === 'button').length, 0);
  } finally { globalThis.fetch = original; }
});
test('TeamPanel uses only the verified contact, resets scope choices and does not issue anything before submission', async () => {
  let mutations = 0, payload; globalThis.__officialDraftKeys = [];
  const selected = { ...officialTeamPrefill('luana-ribeiro'), selectionKey: 'synthetic-selection', email: 'forged@outside.invalid', name: 'forged name' };
  const props = { now: 0, officialSuggestion: selected, users: [], members: [], invites: [], projects: [{ id: 'synthetic-project', name: 'Synthetic project' }], selectedProjectId: 'synthetic-project', globalAdmin: true, canProject: () => true,
    mutate: async (_action, value) => { mutations++; payload = value; return { inviteUrl: 'https://synthetic.invalid/convite?token=synthetic-only' }; } };
  const tree = TeamPanel(props), form = nodes(tree, node => node.type === 'form')[0];
  assert.equal(nodes(tree, node => node.type === 'input' && node.props.name === 'email')[0].props.defaultValue, officialTeamPrefill('luana-ribeiro').email);
  const name = nodes(tree, node => node.type === 'input' && node.props['aria-label'] === 'Nome na fonte oficial')[0]; assert.equal(name.props.name, undefined); assert.equal(name.props.readOnly, true);
  for (const field of ['role', 'projectId']) { const select = nodes(tree, node => node.type === 'select' && node.props.name === field)[0]; assert.equal(select.props.value ?? select.props.defaultValue, ''); assert.equal(select.props.required, true); }
  assert.equal(nodes(tree, node => node.type === 'option' && node.props.value === '__global__').length, 0);
  assert.equal(nodes(tree, node => typeof node.type === 'function' && node.type.name === 'DraftNotice').length, 0, 'a stale manual draft discard cannot overwrite the official prefill');
  assert.deepEqual(globalThis.__officialDraftKeys, [null], 'no previous person’s project or role draft is inherited'); assert.equal(mutations, 0);
  const original = globalThis.FormData; let values = {};
  globalThis.FormData = class { get(name) { return values[name] ?? ''; } };
  const event = { preventDefault() {}, currentTarget: { reset() {} } };
  try {
    for (const scope of [{}, { role: 'viewer' }, { role: 'viewer', projectId: '__global__' }]) { values = scope; await form.props.onSubmit(event); assert.equal(mutations, 0); }
    values = { email: 'synthetic@outside.invalid', role: 'viewer', projectId: 'synthetic-project' }; await form.props.onSubmit(event);
    assert.equal(mutations, 1); assert.deepEqual(Object.keys(payload).sort(), ['email', 'role', 'projectId', 'globalAccess', 'operationKey'].sort()); assert.equal(payload.projectId, 'synthetic-project'); assert.equal(payload.role, 'viewer');
  } finally { globalThis.FormData = original; delete globalThis.__officialDraftKeys; }
});

test('manual external invitations remain possible with an explicit role and scope', async () => {
  globalThis.__officialDraftKeys = []; let payload;
  const props = { now: 0, users: [], members: [], invites: [], projects: [{ id: 'synthetic-project', name: 'Synthetic project' }], globalAdmin: true, canProject: () => true,
    mutate: async (_action, value) => { payload = value; return {}; } };
  const form = nodes(TeamPanel(props), node => node.type === 'form')[0];
  const original = globalThis.FormData;
  let selectedScope = '__global__';
  globalThis.FormData = class { get(name) { return { email: 'synthetic@external.invalid', role: 'viewer', projectId: selectedScope }[name]; } };
  try {
    assert.equal(payload, undefined); await form.props.onSubmit({ preventDefault() {}, currentTarget: { reset() {} } });
    assert.equal(payload, undefined, 'global invitation requires an explicit additional scope confirmation');
    selectedScope = 'synthetic-project'; await form.props.onSubmit({ preventDefault() {}, currentTarget: { reset() {} } });
    assert.equal(payload.email, 'synthetic@external.invalid'); assert.equal(payload.projectId, 'synthetic-project'); assert.equal(payload.globalAccess, false); assert.equal(payload.role, 'viewer');
    const restricted = TeamPanel({ ...props, globalAdmin: false });
    assert.equal(nodes(restricted, node => node.type === 'option' && node.props.value === '__global__').length, 0);
  } finally { globalThis.FormData = original; delete globalThis.__officialDraftKeys; }
});
