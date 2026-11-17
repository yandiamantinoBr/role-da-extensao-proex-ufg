import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { load } from './support/project-report-module.mjs';

const root = new URL('../', import.meta.url);
const { getActor } = await load('lib/access.ts');
const { tutorialWorkspace, tutorialAction } = await load('lib/tutorials/service.ts');
const catalog = await load('lib/tutorials/catalog.ts');
const at = '2026-11-01T12:00:00.000Z';

function fixture() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(new URL('drizzle/', root)).filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(new URL(`drizzle/${name}`, root), 'utf8'));
  native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('org-b','Organização vizinha sintética','org-b',?,?)").run(at, at);
  native.prepare("INSERT INTO projects(id,name,created_at,scope,official_url) VALUES('project-a','Projeto A',?,'internal',''),('project-b','Projeto B',?,'internal','')").run(at, at);
  native.prepare("INSERT INTO projects(id,name,organization_id,created_at,scope,official_url) VALUES('project-x','Projeto vizinho sintético','org-b',?,'internal','')").run(at);
  native.prepare("INSERT INTO campaigns(id,project_id,name,starts_at,ends_at,status,created_at) VALUES('campaign-a','project-a','Ação sintética',?,?,'active',?)").run(at, '2099-01-01T00:00:00.000Z', at);
  const statement = sql => ({ values: [], bind(...args) { this.values = args; return this; },
    async all() { return { results: native.prepare(sql).all(...this.values) }; },
    async first() { return native.prepare(sql).get(...this.values) ?? null; },
    async run() { const result = native.prepare(sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; } });
  return { native, prepare: sql => statement(sql), async batch(list) { const out = []; for (const item of list) out.push(await item.run()); return out; } };
}
/** Conta sintética com vínculos reais na tabela members; o ator vem do mesmo getActor das rotas. */
async function person(db, name, roles = [], status = 'active') {
  const userId = `user-${name}`, email = `${name}@example.invalid`;
  db.native.prepare('INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(userId, email, status, at, at);
  for (const [role, project] of roles) db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,?,NULL,?)').run(crypto.randomUUID(), userId, email, role, project, at);
  return { user: { userId, email, displayName: name }, actor: () => getActor(db, { userId, email, displayName: name }) };
}
const steps = state => Object.fromEntries(state.chapters.find(chapter => chapter.id === 'navegacao').steps.map(step => [step.id, step.available]));
const plain = value => JSON.parse(JSON.stringify(value));

test('catalog: stable unique ids, versions and resolvable requirements', () => {
  const ids = catalog.TUTORIAL_CHAPTERS.map(chapter => chapter.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes(catalog.TUTORIAL_INVITE_ID), 'the invite id is reserved');
  for (const chapter of catalog.TUTORIAL_CHAPTERS) {
    assert.ok(chapter.version >= 1 && /^[a-z0-9-]{1,40}$/.test(chapter.id));
    const stepIds = chapter.steps.map(step => step.id);
    assert.equal(new Set(stepIds).size, stepIds.length, chapter.id);
    for (const step of chapter.steps) {
      assert.match(step.id, /^[a-z0-9-]{1,40}$/);
      assert.ok(step.speech.length > 20 && step.youWillSee.length > 10, `${chapter.id}/${step.id}`);
      assert.doesNotMatch(`${step.speech} ${step.speechMobile ?? ''}`, /@|https?:|senha:|token/i, 'no contact, link or secret in scripted speech');
    }
  }
});

test('navigation: a person with mixed roles (manager in A, reader in B) gets every step; nothing is saved yet', async () => {
  const db = fixture(), mixed = await person(db, 'mixed', [['manager', 'project-a'], ['viewer', 'project-b']]);
  const state = await tutorialWorkspace(db, await mixed.actor(), { projectId: 'project-b' });
  assert.ok(Object.values(steps(state)).every(Boolean));
  assert.deepEqual(plain(state.project), { selected: true, denied: false });
  assert.equal(state.invite, 'new');
  assert.deepEqual(plain(state.progress), {});
  assert.equal(state.chapters[0].resumeAt, 0);
});

test('a neighbor project in another organization counts as no project and is never named', async () => {
  const db = fixture(), reader = await person(db, 'reader', [['viewer', 'project-a']]);
  const state = await tutorialWorkspace(db, await reader.actor(), { projectId: 'project-x' });
  assert.deepEqual(plain(state.project), { selected: false, denied: true });
  assert.equal(JSON.stringify(state).includes('vizinh'), false);
  assert.equal(steps(state).projeto, true, 'the project step still applies to the projects the person has');
  await assert.rejects(tutorialWorkspace(db, await reader.actor(), { projectId: 'x'.repeat(300) }).then(result => assert.equal(result.project.denied, false)).then(() => { throw new Error('ok'); }), /ok/, 'malformed ids are ignored, not echoed');
});

test('a volunteer whose access ended (no project, no grant) still sees the account steps, without the project step', async () => {
  const db = fixture(), volunteer = await person(db, 'volunteer');
  const actor = await volunteer.actor();
  // Acesso de voluntário encerrado = sem concessão vigente (getActor só carrega concessões dentro do prazo).
  assert.deepEqual(plain(actor.volunteers), []);
  const state = await tutorialWorkspace(db, actor, {});
  const available = steps(state);
  assert.equal(available.projeto, false);
  assert.equal(state.chapters[0].steps.find(step => step.id === 'projeto').reason, 'Este passo aparece quando sua conta tiver um projeto.');
  assert.equal(available['meus-acessos'], true);
  await assert.rejects(tutorialAction(db, actor, { action: 'progress.save', chapterId: 'navegacao', stepId: 'projeto', status: 'in_progress' }), error => error.status === 409 && error.code === 'tutorial_step_unavailable');
  const saved = await tutorialAction(db, actor, { action: 'progress.save', chapterId: 'navegacao', stepId: 'conta', status: 'paused' });
  assert.equal(saved.progress.navegacao.stepId, 'conta');
});

test('revoked or blocked accounts: no actor means 401; a stale actor of a blocked account cannot read or write', async () => {
  const db = fixture(), gone = await person(db, 'gone', [['viewer', 'project-a']]);
  const stale = await gone.actor();
  db.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='user-gone'").run();
  assert.equal(await gone.actor(), null, 'getActor refuses the blocked account');
  await assert.rejects(tutorialWorkspace(db, null, {}), error => error.status === 401);
  await assert.rejects(tutorialWorkspace(db, stale, {}), error => error.status === 403);
  await assert.rejects(tutorialAction(db, stale, { action: 'progress.save', chapterId: 'navegacao', stepId: 'inicio', status: 'in_progress' }), error => error.status === 403);
  assert.equal(db.native.prepare('SELECT COUNT(*) n FROM user_tutorials').get().n, 0);
  // Vínculo revogado com a tela aberta: a próxima consulta já não oferece o passo do projeto.
  const revoked = await person(db, 'revoked', [['manager', 'project-a']]);
  assert.equal(steps(await tutorialWorkspace(db, await revoked.actor(), {})).projeto, true);
  db.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='user-revoked'").run(at);
  assert.equal(steps(await tutorialWorkspace(db, await revoked.actor(), {})).projeto, false);
});

test('an account still pending activation cannot read or write tutorial progress', async () => {
  const db = fixture(), pending = await person(db, 'pending', [['viewer', 'project-a']]);
  db.native.prepare("UPDATE portal_users SET activation_pending=1 WHERE user_id='user-pending'").run();
  const actor = await pending.actor();
  assert.deepEqual(plain(actor.members), [], 'pending accounts carry no role');
  await assert.rejects(tutorialWorkspace(db, actor, {}), error => error.status === 403);
  await assert.rejects(tutorialAction(db, actor, { action: 'invite.dismiss' }), error => error.status === 403);
  assert.equal(db.native.prepare('SELECT COUNT(*) n FROM user_tutorials').get().n, 0);
});

test('progress: pause, resume, complete, repeat and restart keep the first completion; each person sees only their own', async () => {
  const db = fixture(), ana = await person(db, 'ana', [['manager', 'project-a']]), bia = await person(db, 'bia', [['viewer', 'project-b']]);
  const actor = await ana.actor();
  let state = await tutorialAction(db, actor, { action: 'progress.save', chapterId: 'navegacao', stepId: 'menu', status: 'paused' });
  assert.equal(state.chapters[0].resumeAt, catalog.chapterById('navegacao').steps.findIndex(step => step.id === 'menu'));
  state = await tutorialAction(db, actor, { action: 'progress.save', chapterId: 'navegacao', stepId: 'fim', status: 'completed' });
  const firstCompletion = state.progress.navegacao.completedAt;
  assert.ok(firstCompletion);
  assert.equal(state.chapters[0].resumeAt, 0, 'a finished chapter starts again from the beginning');
  state = await tutorialAction(db, actor, { action: 'progress.save', chapterId: 'navegacao', stepId: 'inicio', status: 'in_progress' });
  assert.equal(state.progress.navegacao.completedAt, firstCompletion, 'repeating keeps the completion');
  state = await tutorialAction(db, actor, { action: 'progress.restart', chapterId: 'navegacao' });
  assert.deepEqual([state.progress.navegacao.stepId, state.progress.navegacao.status, state.progress.navegacao.completedAt], ['', 'in_progress', firstCompletion]);
  assert.deepEqual(plain((await tutorialWorkspace(db, await bia.actor(), {})).progress), {}, 'progress is personal');
});

test('the Rolê invite is offered once: dismissing or starting is remembered per person', async () => {
  const db = fixture(), ana = await person(db, 'ana', [['manager', 'project-a']]);
  assert.equal((await tutorialAction(db, await ana.actor(), { action: 'invite.dismiss' })).invite, 'dismissed');
  assert.equal((await tutorialAction(db, await ana.actor(), { action: 'invite.start' })).invite, 'started');
  assert.deepEqual(plain((await tutorialWorkspace(db, await ana.actor(), {})).progress), {}, 'the invite is not a chapter');
});

test('invalid chapter, step or status is refused and nothing is written', async () => {
  const db = fixture(), ana = await person(db, 'ana', [['manager', 'project-a']]), actor = await ana.actor();
  await assert.rejects(tutorialAction(db, actor, { action: 'progress.save', chapterId: 'emprestimos-secretos', stepId: 'inicio', status: 'in_progress' }), error => error.status === 400);
  await assert.rejects(tutorialAction(db, actor, { action: 'progress.save', chapterId: 'navegacao', stepId: 'nao-existe', status: 'in_progress' }), error => error.status === 400);
  await assert.rejects(tutorialAction(db, actor, { action: 'progress.save', chapterId: 'navegacao', stepId: 'inicio', status: 'dismissed' }), error => error.status === 400);
  await assert.rejects(tutorialAction(db, actor, { action: 'progress.save', chapterId: catalog.TUTORIAL_INVITE_ID, stepId: 'inicio', status: 'in_progress' }), error => error.status === 400);
  await assert.rejects(tutorialAction(db, actor, { action: 'apagar.tudo', chapterId: 'navegacao' }), error => error.status === 400);
  assert.equal(db.native.prepare('SELECT COUNT(*) n FROM user_tutorials').get().n, 0);
});

test('resume rules: removed or forbidden saved steps continue at the next allowed one', () => {
  const chapter = catalog.chapterById('navegacao');
  const all = chapter.steps.map(step => ({ id: step.id, available: true }));
  const noProject = all.map(step => step.id === 'projeto' ? { ...step, available: false } : step);
  const index = id => chapter.steps.findIndex(step => step.id === id);
  assert.equal(catalog.resumeIndex(chapter, all, 'conta'), index('conta'));
  assert.equal(catalog.resumeIndex(chapter, noProject, 'projeto'), index('conta'), 'a step lost with the access moves forward');
  assert.equal(catalog.resumeIndex(chapter, all, 'passo-de-versao-antiga'), 0, 'a step removed in a new version restarts at the first');
  assert.equal(catalog.resumeIndex(chapter, all.map(step => ({ ...step, available: false })), 'inicio'), -1);
  const needsLoans = { ...chapter, steps: [{ ...chapter.steps[0], id: 'operar', requires: { capability: 'loans.checkout', scope: 'selected' } }] };
  const access = { projectScope: ['project-a', 'project-b'], selectedProject: 'project-b', capabilityScope: capability => capability === 'loans.checkout' ? ['project-a'] : [] };
  assert.deepEqual(plain(catalog.resolveSteps(needsLoans, access)), [{ id: 'operar', available: false, reason: 'Seu acesso no projeto escolhido não inclui esta parte.' }], 'capability in a neighbor project does not count');
  assert.equal(catalog.resolveSteps(needsLoans, { ...access, selectedProject: 'project-a' })[0].available, true);
});

test('anonymization removes tutorial progress', () => {
  assert.match(readFileSync(new URL('lib/privacy.ts', root), 'utf8'), /DELETE FROM user_tutorials WHERE user_id=\?/);
});

test('Meu trabalho: open to every team account; the project step follows the projects; progress is kept per chapter', async () => {
  const db = fixture(), reader = await person(db, 'mw-reader', [['viewer', 'project-a']]), none = await person(db, 'mw-none');
  const chapterSteps = (state, id) => Object.fromEntries(state.chapters.find(chapter => chapter.id === id).steps.map(step => [step.id, step.available]));
  const withProject = chapterSteps(await tutorialWorkspace(db, await reader.actor(), { projectId: 'project-a' }), 'meu-trabalho');
  assert.ok(Object.values(withProject).every(Boolean), 'a reader sees the whole chapter (Meu trabalho is not gated by a capability)');
  const actor = await none.actor(), noProject = chapterSteps(await tutorialWorkspace(db, actor, {}), 'meu-trabalho');
  assert.equal(noProject.projeto, false);
  assert.equal(noProject.origem && noProject.totais && noProject.demandas && noProject.responsabilidades, true);
  await tutorialAction(db, actor, { action: 'progress.save', chapterId: 'navegacao', stepId: 'fim', status: 'completed' });
  const state = await tutorialAction(db, actor, { action: 'progress.save', chapterId: 'meu-trabalho', stepId: 'totais', status: 'paused' });
  assert.equal(state.progress.navegacao.status, 'completed');
  assert.deepEqual([state.progress['meu-trabalho'].stepId, state.progress['meu-trabalho'].status], ['totais', 'paused']);
  assert.equal(state.chapters.find(chapter => chapter.id === 'meu-trabalho').resumeAt, catalog.chapterById('meu-trabalho').steps.findIndex(step => step.id === 'totais'));
});

test('Projetos: open to every team account; the steps that need a project disappear without one', async () => {
  const db = fixture(), reader = await person(db, 'pj-reader', [['viewer', 'project-a']]), none = await person(db, 'pj-none');
  const chapterSteps = state => Object.fromEntries(state.chapters.find(chapter => chapter.id === 'projetos').steps.map(step => [step.id, step.available]));
  assert.ok(Object.values(chapterSteps(await tutorialWorkspace(db, await reader.actor(), {}))).every(Boolean));
  const empty = chapterSteps(await tutorialWorkspace(db, await none.actor(), {}));
  assert.deepEqual(Object.entries(empty).filter(([, available]) => available).map(([id]) => id), ['abrir', 'fim']);
});

test('Demandas: needs a project; the general-demands step only for whoever manages an organization', async () => {
  const db = fixture(), manager = await person(db, 'dm-manager', [['manager', 'project-a']]), none = await person(db, 'dm-none');
  const admin = await person(db, 'dm-admin');
  db.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,revoked_at,created_at) VALUES(?,?,?,'owner',NULL,'org-b',NULL,?)").run(crypto.randomUUID(), 'user-dm-admin', 'dm-admin@example.invalid', at);
  const chapterSteps = state => Object.fromEntries(state.chapters.find(chapter => chapter.id === 'demandas').steps.map(step => [step.id, step.available]));
  const managerSteps = chapterSteps(await tutorialWorkspace(db, await manager.actor(), {}));
  assert.equal(managerSteps.gerais, false, 'a project manager does not get Somente demandas gerais');
  assert.ok(Object.entries(managerSteps).filter(([id]) => id !== 'gerais').every(([, available]) => available));
  assert.ok(Object.values(chapterSteps(await tutorialWorkspace(db, await none.actor(), {}))).every(available => !available), 'no project, no Demandas');
  const adminSteps = chapterSteps(await tutorialWorkspace(db, await admin.actor(), {}));
  assert.equal(adminSteps.gerais, true);
  assert.equal(adminSteps.abrir, true);
});

test('Agenda: follows the same rule that shows the module (an event operator alone has no Agenda)', async () => {
  const db = fixture(), reader = await person(db, 'ag-reader', [['viewer', 'project-a']]), operator = await person(db, 'ag-operator', [['operator', 'project-a']]);
  const chapterSteps = state => Object.values(Object.fromEntries(state.chapters.find(chapter => chapter.id === 'agenda').steps.map(step => [step.id, step.available])));
  const { calendarAvailable } = await load('lib/calendar.ts');
  const readerActor = await reader.actor(), operatorActor = await operator.actor();
  assert.equal(chapterSteps(await tutorialWorkspace(db, readerActor, {})).every(Boolean), calendarAvailable(readerActor));
  assert.equal(chapterSteps(await tutorialWorkspace(db, operatorActor, {})).some(Boolean), calendarAvailable(operatorActor));
  assert.equal(calendarAvailable(operatorActor), false, 'the synthetic operator has no Agenda, so the chapter has no steps');
});

test('Materiais: any of read, manage or deliver opens the chapter; Registrar movimento only for inventory.manage', async () => {
  const db = fixture(), reader = await person(db, 'mt-reader', [['viewer', 'project-a']]), stock = await person(db, 'mt-stock', [['inventory', 'project-a']]), none = await person(db, 'mt-none');
  const chapterSteps = state => Object.fromEntries(state.chapters.find(chapter => chapter.id === 'materiais').steps.map(step => [step.id, step.available]));
  const stockSteps = chapterSteps(await tutorialWorkspace(db, await stock.actor(), {}));
  assert.ok(Object.values(stockSteps).every(Boolean), 'the materials role gets every step');
  const readerSteps = chapterSteps(await tutorialWorkspace(db, await reader.actor(), {}));
  assert.equal(readerSteps.registrar, false, 'a reader never gets Registrar movimento');
  assert.ok(Object.values(chapterSteps(await tutorialWorkspace(db, await none.actor(), {}))).every(available => !available));
});

test('Dinâmicas: each step follows its own capability (operate, deliver, manage)', async () => {
  const db = fixture(), operator = await person(db, 'dn-operator', [['operator', 'project-a']]), manager = await person(db, 'dn-manager', [['manager', 'project-a']]), reader = await person(db, 'dn-reader', [['viewer', 'project-a']]);
  const chapterSteps = state => Object.fromEntries(state.chapters.find(chapter => chapter.id === 'dinamicas').steps.map(step => [step.id, step.available]));
  const op = chapterSteps(await tutorialWorkspace(db, await operator.actor(), {}));
  assert.deepEqual([op.acoes, op.atendimento, op.retirada, op.situacao, op.preparar], [true, true, true, false, false], 'the operator attends and delivers, but does not manage');
  const mg = chapterSteps(await tutorialWorkspace(db, await manager.actor(), {}));
  assert.equal(mg.situacao && mg.preparar, true);
  assert.ok(Object.values(chapterSteps(await tutorialWorkspace(db, await reader.actor(), {}))).every(available => !available), 'a reader has no Dinâmicas');
});
