import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const cjs = (file, require, extra = {}) => {
  const exports = {}, compiled = { exports };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module: compiled, exports, require, URL, URLSearchParams, JSON, Error, Promise, Set, Map, Object, Array, Number, String, Boolean, Intl, Date, ...extra });
  return compiled.exports;
};
const catalog = cjs('lib/tutorials/catalog.ts', () => ({}));
// Onde os rótulos e as âncoras dos passos precisam existir de fato.
const SOURCES = ['app/portal-client.tsx', 'components/portal/portal-navigation.tsx', 'components/portal/navigation-model.ts', 'components/portal/dashboard-panel.tsx', 'components/portal/account-access-panel.tsx', 'components/portal/meu-trabalho-panel.tsx', 'components/portal/project-panel.tsx', 'components/portal/project-detail.tsx', 'components/portal/tutorials/tutorial-layer.tsx', 'components/portal/tutorials/tutorial-help-card.tsx'];
const source = SOURCES.map(read).join('\n');

test('every label a step cites exists in the Portal interface code', () => {
  for (const chapter of catalog.TUTORIAL_CHAPTERS) for (const step of chapter.steps) for (const label of step.labels) {
    const quoted = new RegExp(`['"\`>]\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    assert.match(source, quoted, `${chapter.id}/${step.id}: rótulo “${label}” não está na interface`);
    assert.ok(`${step.speech} ${step.speechMobile ?? ''} ${step.youWillSee} ${step.youWillSeeMobile ?? ''}`.includes(label), `${chapter.id}/${step.id}: “${label}” listado mas não citado`);
  }
});

test('every highlighted control exists: data-tutorial anchors and ids are in the components', () => {
  for (const chapter of catalog.TUTORIAL_CHAPTERS) for (const step of chapter.steps) for (const selector of [step.target, step.targetMobile].filter(Boolean)) {
    const anchor = /^\[data-tutorial="([a-z-]+)"\]$/.exec(selector), id = /^#([a-z-]+)$/.exec(selector);
    assert.ok(anchor || id, `${step.id}: use âncora data-tutorial ou id (${selector})`);
    if (anchor) assert.match(source, new RegExp(`data-tutorial(=|=\\{[^}]*)["']${anchor[1]}["']`), `${step.id}: âncora ${anchor[1]} ausente`);
    if (id) assert.match(source, new RegExp(`id="${id[1]}"`), `${step.id}: id ${id[1]} ausente`);
  }
  const modules = [...read('components/portal/navigation-model.ts').matchAll(/id: '([a-z-]+)'/g)].map(match => match[1]);
  for (const chapter of catalog.TUTORIAL_CHAPTERS) for (const step of chapter.steps) for (const target of [step.module, step.moduleMobile].filter(Boolean)) assert.ok(modules.includes(target), `${step.id}: módulo ${target}`);
});

test('the Portal offers the tutorial from the Início invite, the account menu, Mais and Conta, and mounts the guide once', () => {
  const client = read('app/portal-client.tsx');
  assert.match(client, /\{tab === 'overview' && <TutorialInvite\/>\}/);
  assert.match(client, /role="menuitem" onClick=\{\(\) => \{ setAccountOpen\(false\);.*openTutorialChooser\(\); \}\}>Ajuda e tutoriais/);
  assert.match(client, /onHelp=\{openTutorialChooser\}/);
  assert.match(client, /<AccountAccessPanel[^>]*\/><TutorialHelpCard\/>/);
  assert.equal(client.match(/<TutorialLayer /g)?.length, 1);
  assert.match(read('components/portal/portal-navigation.tsx'), /Ajuda e tutoriais/);
});

test('the tutorial never calls work routes and does not depend on the Rolê chat, keys or inventory access', () => {
  for (const file of ['components/portal/tutorials/tutorial-store.ts', 'components/portal/tutorials/tutorial-layer.tsx', 'components/portal/tutorials/chapter-list.tsx', 'components/portal/tutorials/tutorial-invite.tsx', 'components/portal/tutorials/tutorial-help-card.tsx']) {
    const code = read(file);
    for (const url of code.matchAll(/['"`](\/api\/[a-z-]+)/g)) assert.equal(url[1], '/api/tutorials', `${file} chama ${url[1]}`);
    assert.doesNotMatch(code, /inventory\.read|assistant|role-assistant|apiKey|provider/i, file);
  }
  const client = read('app/portal-client.tsx');
  const mount = /<TutorialLayer [^\n]*\/>/.exec(client)[0];
  assert.doesNotMatch(mount, /assistantProjects|inventory/, 'the guide is mounted for every team account');
});

/** Estado da tela com fetch simulado: prova pular passo sem acesso, revogação, pausa e conclusão. */
function store() {
  const requests = [];
  const responses = [];
  const fetch = (url, init = {}) => new Promise(resolve => requests.push({ url, body: init.body ? JSON.parse(init.body) : null, resolve }));
  const require = name => name === 'react' ? { useSyncExternalStore: () => null } : name === '@/lib/tutorials/catalog' ? catalog : {};
  const doc = { activeElement: null, body: {}, getElementById: () => null };
  const api = cjs('components/portal/tutorials/tutorial-store.ts', require, { fetch, document: doc, HTMLElement: class {} });
  const answer = async (data, ok = true, status = 200) => { for (let wait = 0; wait < 20 && !requests.length; wait++) await new Promise(resolve => setImmediate(resolve)); const request = requests.shift(); request.resolve({ ok, status, json: async () => data }); await new Promise(resolve => setImmediate(resolve)); return request; };
  return { api, requests, answer, responses };
}
const workspace = (available = {}, extra = {}) => ({
  chapters: [{ id: 'navegacao', version: 1, resumeAt: 0, outdated: false, steps: catalog.chapterById('navegacao').steps.map(step => ({ id: step.id, available: available[step.id] ?? true })) }],
  progress: {}, invite: 'new', project: { selected: false, denied: false }, ...extra,
});
const flush = () => new Promise(resolve => setImmediate(resolve));

test('store: starting saves the first step; Next skips a step the access does not allow; the last step saves completion', async () => {
  const { api, requests, answer } = store();
  const loading = api.loadTutorials('project-a'); await answer(workspace({ projeto: false })); await loading;
  assert.match(requests.length ? '' : 'ok', /ok/);
  const start = api.startChapter('navegacao'); await flush();
  let saved = await answer(workspace({ projeto: false })); await start;
  assert.deepEqual(saved.body, { action: 'progress.save', chapterId: 'navegacao', stepId: 'boas-vindas', status: 'in_progress', projectId: 'project-a' });
  const steps = catalog.chapterById('navegacao').steps.map(step => step.id);
  for (let index = 1; index < steps.indexOf('projeto'); index++) { api.nextStep(); await answer(workspace({ projeto: false })); }
  api.nextStep(); saved = await answer(workspace({ projeto: false }));
  assert.equal(saved.body.stepId, 'conta', 'the project step is skipped for an account without projects');
  api.nextStep(); await answer(workspace({ projeto: false }));
  api.nextStep(); saved = await answer(workspace({ projeto: false }));
  assert.deepEqual([saved.body.stepId, saved.body.status], ['fim', 'completed']);
  api.previousStep(); saved = await answer(workspace({ projeto: false }));
  assert.equal(saved.body.status, 'in_progress');
});

test('store: a project change that removes the current step moves forward with a notice; 401 closes everything', async () => {
  const { api, answer } = store();
  const loading = api.loadTutorials(''); await answer(workspace()); await loading;
  const start = api.startChapter('navegacao'); await flush(); await answer(workspace()); await start;
  const steps = catalog.chapterById('navegacao').steps.map(step => step.id);
  while (api.getTutorialState().active.index < steps.indexOf('projeto')) { api.nextStep(); await answer(workspace()); }
  const reload = api.loadTutorials('project-x'); await answer(workspace({ projeto: false })); await reload;
  assert.equal(steps[api.getTutorialState().active.index], 'conta');
  assert.match(api.getTutorialState().notice, /acesso mudou/);
  const revoked = api.loadTutorials('project-a'); await answer({ error: { message: 'Seu acesso mudou. Entre novamente.' } }, false, 403); await revoked;
  assert.equal(api.getTutorialState().active, null);
  assert.equal(api.getTutorialState().data, null, 'nothing from the previous access stays on screen');
});

test('store: Pausar saves paused at the current step and Agora não dismisses the invite', async () => {
  const { api, answer } = store();
  const loading = api.loadTutorials(''); await answer(workspace()); await loading;
  const start = api.startChapter('navegacao'); await flush(); await answer(workspace()); await start;
  api.nextStep(); await answer(workspace());
  api.pauseTutorial(); const paused = await answer(workspace());
  assert.deepEqual([paused.body.stepId, paused.body.status], ['inicio', 'paused']);
  assert.equal(api.getTutorialState().active, null);
  const later = api.answerInvite('later'); const dismissed = await answer(workspace({}, { invite: 'dismissed' })); await later;
  assert.equal(dismissed.body.action, 'invite.dismiss');
  assert.equal(api.getTutorialState().data.invite, 'dismissed');
});
