import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, teamScenario } from './support/work-teams-fixture.mjs';
// Fixados por conta (0038) sobre SQLite migrado. Equipes e pessoas são sintéticas.
const { preferencesAction, preferencesFor, PIN_LIMIT } = await import(compile('lib/preferences.ts'));
const plain = value => JSON.parse(JSON.stringify(value));

test('each account pins its own projects and teams; the order is kept and unpinning removes one', async t => {
  const f = await teamScenario(t), owner = await f.actor('owner-a'), viewer = await f.actor('viewer-a');
  assert.deepEqual(plain(await preferencesFor(f.db, owner)), { projectPins: [], teamPins: [], version: 0, teams: [] });
  await preferencesAction(f.db, owner, { action: 'pin', kind: 'project', id: 'project-a2', pinned: true });
  const saved = await preferencesAction(f.db, owner, { action: 'pin', kind: 'project', id: 'project-a', pinned: true });
  assert.deepEqual(plain(saved.projectPins), ['project-a2', 'project-a']);
  assert.equal(saved.version, 2);
  // Repetir o mesmo pedido não duplica.
  assert.deepEqual(plain((await preferencesAction(f.db, owner, { action: 'pin', kind: 'project', id: 'project-a', pinned: true })).projectPins), ['project-a2', 'project-a']);
  assert.deepEqual(plain((await preferencesFor(f.db, viewer)).projectPins), [], 'outra conta não vê os fixados da primeira');
  assert.deepEqual(plain((await preferencesAction(f.db, owner, { action: 'pin', kind: 'project', id: 'project-a2', pinned: false })).projectPins), ['project-a']);
  await preferencesAction(f.db, owner, { action: 'pin', kind: 'team', id: f.a, pinned: true });
  const current = await preferencesFor(f.db, owner);
  assert.deepEqual(plain(current.teamPins), [f.a]);
  assert.deepEqual(plain(current.teams), [{ id: f.a, name: 'Comunicação e Design', organizationId: 'org-a' }]);
});

test('pinned teams only reveal names the person can still see', async t => {
  const f = await teamScenario(t), viewer = await f.actor('viewer-a'), other = await f.actor('other-a2');
  // viewer-a participa de "Comunicação e Design", mas não da equipe interna nem da equipe de outra organização.
  for (const id of [f.a, f.hidden, f.b]) await preferencesAction(f.db, viewer, { action: 'pin', kind: 'team', id, pinned: true });
  const view = await preferencesFor(f.db, viewer);
  assert.deepEqual(plain(view.teamPins), [f.a, f.hidden, f.b], 'os ids continuam guardados');
  assert.deepEqual(view.teams.map(team => team.name), ['Comunicação e Design'], 'nomes de equipes sem acesso nunca aparecem');
  assert.doesNotMatch(JSON.stringify(view), /interna Horizonte|reservada B/);
  // Quem integra a equipe interna vê o nome dela.
  await preferencesAction(f.db, other, { action: 'pin', kind: 'team', id: f.hidden, pinned: true });
  assert.deepEqual((await preferencesFor(f.db, other)).teams.map(team => team.name), ['Equipe interna Horizonte']);
  // Perdeu o vínculo com a organização: o nome some, mesmo continuando na lista da equipe.
  f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='other-a2'").run(f.now);
  assert.deepEqual(plain((await preferencesFor(f.db, other)).teams), [], 'a consulta confere o vínculo atual, não o da sessão antiga');
  f.native.prepare("UPDATE members SET revoked_at=NULL WHERE user_id='other-a2'").run();
  f.native.prepare('UPDATE followup_team_members SET removed_at=? WHERE team_id=? AND user_id=?').run(f.now, f.hidden, 'other-a2');
  assert.deepEqual(plain((await preferencesFor(f.db, other)).teams), [], 'saiu da equipe: o nome some');
});

test('limit, import from the old browser storage and invalid input', async t => {
  const f = await teamScenario(t), owner = await f.actor('owner-a');
  const ids = Array.from({ length: PIN_LIMIT }, (_, index) => `project-${index}`);
  const imported = await preferencesAction(f.db, owner, { action: 'import', projectPins: [...ids, 'project-extra'] });
  assert.equal(imported.projectPins.length, PIN_LIMIT);
  await assert.rejects(preferencesAction(f.db, owner, { action: 'pin', kind: 'project', id: 'project-13', pinned: true }), /até 12 projetos/);
  // A importação une, não apaga o que já está na conta.
  await preferencesAction(f.db, owner, { action: 'pin', kind: 'project', id: 'project-0', pinned: false });
  assert.deepEqual(plain((await preferencesAction(f.db, owner, { action: 'import', projectPins: ['project-0'] })).projectPins).at(-1), 'project-0');
  for (const input of [
    { action: 'pin', kind: 'unit', id: 'x', pinned: true },
    { action: 'pin', kind: 'project', id: '../segredo', pinned: true },
    { action: 'pin', kind: 'project', id: 'project-a', pinned: 'sim' },
    { action: 'import', projectPins: 'project-a' },
    { action: 'pin', kind: 'project', id: 'project-a', pinned: true, userId: 'viewer-a' },
    { action: 'apagar' },
  ]) await assert.rejects(preferencesAction(f.db, owner, input), error => error.status === 400);
  await assert.rejects(preferencesFor(f.db, null), error => error.status === 401);
  // A tabela recusa listas inválidas mesmo por fora do serviço.
  assert.throws(() => f.native.prepare("INSERT INTO user_preferences(user_id,project_pins,updated_at) VALUES('viewer-a','{\"a\":1}',?)").run(f.now), /CHECK/);
});

test('account anonymization removes the navigation preferences row', () => {
  const source = readFileSync(new URL('../lib/privacy.ts', import.meta.url), 'utf8');
  assert.match(source, /DELETE FROM user_preferences WHERE user_id=\?/);
});
