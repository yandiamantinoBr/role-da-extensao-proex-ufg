import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = fileURLToPath(new URL('../', import.meta.url));
const modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  let code = ts.transpileModule(readFileSync(`${directory}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])(\.\/[^'"]+)\1/g, (_match, _quote, dependency) => `from ${JSON.stringify(compile(dependency.slice(2).replace(/\.ts$/, '')))}`);
  const url = `data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=${name}-under-test.mjs`).toString('base64')}`;
  modules.set(name, url);
  return url;
}
const { campaignAction } = await import(compile('campaigns'));
function actor(db, role, projectId) {
  const member = { id: crypto.randomUUID(), user_id: crypto.randomUUID(), email: `${role}@example.invalid`, role, project_id: projectId, revoked_at: null, created_at: new Date().toISOString() };
  db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?)').run(...Object.values(member));
  return { userId: member.user_id, email: member.email, displayName: role, members: [member], capabilities: ['projects.manage', 'campaigns.manage'] };
}
function database() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${directory}drizzle`).filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(`${directory}drizzle/${migration}`, 'utf8'));
  for (const id of ['project-a', 'project-b']) native.prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)').run(id, id, new Date().toISOString());
  const prepare = sql => {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first(column) { const row = native.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return { success: true, results: native.prepare(sql).all(...values) }; },
      async run() { const result = native.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
      execute() { return { success: true, results: native.prepare(sql).all(...values), meta: { changes: Number(native.prepare('SELECT changes() AS n').get().n) } }; },
    };
  };
  return {
    native, prepare,
    async batch(statements) {
      native.exec('BEGIN');
      try { const result = statements.map(value => value.execute()); native.exec('COMMIT'); return result; }
      catch (error) { native.exec('ROLLBACK'); throw error; }
    },
  };
}
const createInput = () => ({ name: 'A'.repeat(120), shortName: 'PROEX', description: 'An institutional project', status: 'active', color: '#54216c', officialUrl: 'https://example.invalid/project', startsAt: '2026-10-20T10:00:00-03:00', endsAt: '2027-10-20T10:00:00-03:00', location: 'Campus', operationKey: crypto.randomUUID() });

test('global owner creates complete project metadata without truncating a 120-character name', async () => {
  const db = database();
  try {
    const owner = actor(db, 'owner', null);
    const result = await campaignAction(db, owner, 'project.create', createInput());
    assert.equal(result.project.name.length, 120);
    assert.equal(result.project.short_name, 'PROEX');
    assert.equal(result.project.color, '#54216C');
    assert.equal(result.project.starts_at, '2026-10-20T13:00:00.000Z');
    assert.equal(result.project.official_url, 'https://example.invalid/project');
    assert.equal(result.project.version, 1);
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='project.create'").get().n, 1);
  } finally { db.native.close(); }
});

test('project managers edit their scope while creation remains global and forged capability arrays grant nothing', async () => {
  const db = database();
  try {
    const manager = actor(db, 'manager', 'project-a');
    await assert.rejects(campaignAction(db, manager, 'project.create', createInput()), error => error.status === 403);
    await assert.rejects(campaignAction(db, manager, 'project.update', { id: 'project-b', expectedVersion: 1, name: 'Unauthorized' }), error => error.status === 403);
    const updated = await campaignAction(db, manager, 'project.update', { id: 'project-a', expectedVersion: 1, name: 'Revised project', shortName: 'REV', status: 'archived' });
    assert.equal(updated.project.name, 'Revised project');
    assert.equal(updated.project.status, 'archived');
    assert.equal(updated.project.version, 2);
    const operator = actor(db, 'operator', 'project-a');
    await assert.rejects(campaignAction(db, operator, 'project.update', { id: 'project-a', expectedVersion: 2, name: 'Forged privilege' }), error => error.status === 403);
  } finally { db.native.close(); }
});

test('invalid project names, URLs, colors and intervals are rejected without silent changes', async () => {
  const db = database();
  try {
    const owner = actor(db, 'owner', null), good = createInput();
    for (const invalid of [
      { name: 'A'.repeat(121) }, { shortName: 'X'.repeat(41) }, { color: '#xyzxyz' },
      { officialUrl: 'javascript:alert(1)' }, { officialUrl: 'https://user:password@example.invalid/' },
      { startsAt: '2026-02-30T10:00:00Z' }, { startsAt: '2026-10-20T10:00' },
      { startsAt: '2028-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' },
    ]) await assert.rejects(campaignAction(db, owner, 'project.create', { ...good, ...invalid }), error => error.status === 400);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM projects').get().n, 2);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM audit').get().n, 0);
  } finally { db.native.close(); }
});

test('project edits use optimistic concurrency and recheck a revoked membership inside SQL', async () => {
  const db = database();
  try {
    const manager = actor(db, 'manager', 'project-a');
    const results = await Promise.allSettled([
      campaignAction(db, manager, 'project.update', { id: 'project-a', expectedVersion: 1, name: 'First revision' }),
      campaignAction(db, manager, 'project.update', { id: 'project-a', expectedVersion: 1, name: 'Other revision' }),
    ]);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(db.native.prepare("SELECT version FROM projects WHERE id='project-a'").get().version, 2);
    db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), manager.members[0].id);
    await assert.rejects(campaignAction(db, manager, 'project.update', { id: 'project-a', expectedVersion: 2, name: 'Revoked revision' }), error => error.status === 409);
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='project.update'").get().n, 1);
  } finally { db.native.close(); }
});

test('failed project audit rolls back the complete metadata update', async () => {
  const db = database();
  try {
    const manager = actor(db, 'manager', 'project-a');
    db.native.exec("CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'test_audit_failure'); END");
    await assert.rejects(campaignAction(db, manager, 'project.update', { id: 'project-a', expectedVersion: 1, name: 'Must roll back' }));
    const project = db.native.prepare("SELECT name,version FROM projects WHERE id='project-a'").get();
    assert.equal(project.name, 'project-a');
    assert.equal(project.version, 1);
  } finally { db.native.close(); }
});

test('project creation retries and concurrent requests share one claim, entity and audit', async () => {
  const db = database();
  try {
    const owner = actor(db, 'owner', null), input = createInput();
    const [first, replay] = await Promise.all([campaignAction(db, owner, 'project.create', input), campaignAction(db, owner, 'project.create', input)]);
    assert.equal(first.id, replay.id);
    assert.equal((await campaignAction(db, owner, 'project.create', input)).id, first.id);
    await assert.rejects(campaignAction(db, owner, 'project.create', { ...input, name: 'Changed request' }), error => error.code === 'operation_changed');
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM projects').get().n, 3);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n, 1);
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='project.create'").get().n, 1);
  } finally { db.native.close(); }
});

test('a revoked owner cannot leave an orphan creation claim or create a project', async () => {
  const db = database();
  try {
    const owner = actor(db, 'owner', null);
    db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), owner.members[0].id);
    await assert.rejects(campaignAction(db, owner, 'project.create', createInput()));
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM projects').get().n, 2);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n, 0);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM audit').get().n, 0);
  } finally { db.native.close(); }
});

test('draft campaign editing rejects missing and stale client versions without overwriting another revision', async () => {
  const db = database();
  try {
    const manager = actor(db, 'manager', 'project-a');
    const request = { projectId: 'project-a', name: 'Draft event', location: 'Campus', rulesText: 'Draft rules', startsAt: '2030-01-10T10:00:00Z', endsAt: '2030-01-10T18:00:00Z', retryLimit: 0, brindeOfferId: null, superOfferId: null };
    const created = await campaignAction(db, manager, 'campaign.create', request);
    await assert.rejects(campaignAction(db, manager, 'campaign.update', { ...request, id: created.id, name: 'Missing version' }), error => error.status === 400);
    await campaignAction(db, manager, 'campaign.update', { ...request, id: created.id, expectedVersion: 1, name: 'First revision' });
    await assert.rejects(campaignAction(db, manager, 'campaign.update', { ...request, id: created.id, expectedVersion: 1, name: 'Stale revision' }), error => error.status === 409 && error.code === 'campaign_changed');
    const row = db.native.prepare('SELECT name,version FROM campaigns WHERE id=?').get(created.id);
    assert.equal(row.name, 'First revision'); assert.equal(row.version, 2);
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='campaign.update'").get().n, 1);
  } finally { db.native.close(); }
});
