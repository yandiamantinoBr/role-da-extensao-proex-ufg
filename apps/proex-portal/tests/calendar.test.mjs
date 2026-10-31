import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Real calendar/authorization modules and the full SQL migrations; only request identity and
// the platform binding are replaced. All fixtures are synthetic and remain in memory.
const directory = mkdtempSync(join(tmpdir(), 'proex-calendar-'));
writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${path}.js'`).replace(/@\/lib\/([A-Za-z-]+)/g, './$1.js');
}
for (const name of ['access', 'database', 'errors', 'http', 'calendar', 'mutations']) {
  writeFileSync(join(directory, `${name}.js`), compile(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8')));
}
writeFileSync(join(directory, 'session.js'), 'export async function getPortalUser(){return globalThis.__calendarUser ?? null;}');
writeFileSync(join(directory, 'platform.js'), 'export function database(){return globalThis.__calendarDb;}');
for (const [file, name] of [['../app/api/calendar/route.ts', 'route'], ['../app/api/calendar/feed/[token]/route.ts', 'feed-route']]) {
  writeFileSync(join(directory, `${name}.js`), compile(readFileSync(new URL(file, import.meta.url), 'utf8')));
}
after(() => { rmSync(directory, { recursive: true, force: true }); delete globalThis.__calendarUser; delete globalThis.__calendarDb; });
const calendar = await import(pathToFileURL(join(directory, 'calendar.js')).href);
const { getActor } = await import(pathToFileURL(join(directory, 'access.js')).href);
const route = await import(pathToFileURL(join(directory, 'route.js')).href);
const feedRoute = await import(pathToFileURL(join(directory, 'feed-route.js')).href);
const timestamp = '2026-10-20T02:30:00.000Z'; // 19 October in Brasília.
const range = calendar.calendarRange('2026-10-01', '2026-10-31');

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close()); sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'));
  function prepare(sql, values = []) { return {
    bind(...parameters) { return prepare(sql, parameters); },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
    async run() { return this.execute(); },
    execute() { const result = sqlite.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
  }; }
  const db = { prepare, async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE'); try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  } };
  function insert(table, row) { const columns = Object.keys(row); sqlite.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row)); }
  function member(role, projectId = 'project-a') {
    const user = { userId: `user-${role}`, email: `${role}@example.test`, displayName: 'Synthetic account' };
    insert('portal_users', { user_id: user.userId, email: user.email, status: 'active', created_at: timestamp, updated_at: timestamp });
    insert('members', { id: `member-${role}`, user_id: user.userId, email: user.email, role, project_id: role === 'owner' ? null : projectId, created_at: timestamp });
    return user;
  }
  for (const suffix of ['a', 'b']) {
    insert('projects', { id: `project-${suffix}`, name: suffix === 'a' ? 'Projeto A' : 'SECRET PROJECT B', starts_at: '2026-10-10T12:00:00.000Z', ends_at: '2026-10-25T12:00:00.000Z', created_at: timestamp });
    insert('items', { id: `equipment-${suffix}`, project_id: `project-${suffix}`, name: `Projetor ${suffix}`, category: 'equipment', unit: 'unidade', stock: 1, created_at: timestamp });
    insert('items', { id: `material-${suffix}`, project_id: `project-${suffix}`, name: `Material ${suffix}`, category: 'consumption', unit: 'unidades', stock: 20, created_at: timestamp });
    insert('loans', { id: `loan-${suffix}`, project_id: `project-${suffix}`, item_id: `equipment-${suffix}`, action_name: `Ação ${suffix}`, borrower_name: 'PRIVATE BORROWER', borrower_contact: 'private@example.test', note: 'PRIVATE NOTE', starts_at: Date.parse(timestamp), ends_at: Date.parse(timestamp) + 3600000, created_by: 'PRIVATE ACTOR', created_at: timestamp });
    for (const [kind, delta] of [['receive', 3], ['consume', -2]]) insert('stock_movements', { id: `movement-${suffix}-${kind}`, item_id: `material-${suffix}`, kind, delta, note: 'PRIVATE NOTE', actor_id: 'PRIVATE ACTOR', created_at: timestamp });
    insert('campaigns', { id: `campaign-${suffix}`, project_id: `project-${suffix}`, name: `Evento ${suffix}`, starts_at: timestamp, ends_at: '2026-10-20T04:00:00.000Z', status: 'active', created_at: timestamp });
    insert('records', { id: `record-${suffix}`, project_id: `project-${suffix}`, kind: 'maintenance', title: `Revisão ${suffix}`, body: 'PRIVATE RECORD BODY', occurred_at: timestamp, created_by: 'PRIVATE ACTOR', created_at: timestamp });
  }
  insert('records', { id: 'observation', project_id: 'project-a', kind: 'observation', title: 'PRIVATE OBSERVATION', body: 'PRIVATE BODY', occurred_at: timestamp, created_by: 'PRIVATE ACTOR', created_at: timestamp });
  return { db, sqlite, insert, member };
}
async function actor(f, role, projectId) { return getActor(f.db, f.member(role, projectId)); }
function observe(f, user) { globalThis.__calendarDb = f.db; globalThis.__calendarUser = user; }
function post(action, values = {}, origin = 'https://portal.example.test') { return new Request('https://portal.example.test/api/calendar', { method: 'POST', headers: { Origin: origin, 'X-Proex-Action': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...values }) }); }

test('calendar uses real dates, scopes all categories and projects, and omits personal/freeform fields', async t => {
  const f = fixture(t), manager = await actor(f, 'manager');
  const result = await calendar.calendarEntries(f.db, manager, { range });
  assert.equal(result.availableCategories.length, 4);
  assert.ok(result.entries.length >= 6);
  assert.ok(result.entries.every(entry => entry.projectId === 'project-a'));
  assert.ok(!/PRIVATE|SECRET|@example\.test|borrower|contact|object_key|body|note/.test(JSON.stringify(result)));
  const movement = result.entries.find(entry => entry.category === 'consumption');
  assert.equal(movement.startsAt, '2026-10-19'); assert.equal(movement.endsAt, '2026-10-20');
  assert.equal(movement.allDay, true); assert.equal(movement.transparent, true);
  const maintenance = result.entries.find(entry => entry.sourceKind === 'record');
  assert.equal(maintenance.category, 'materials'); assert.equal(maintenance.startsAt, '2026-10-19');
  await assert.rejects(calendar.calendarEntries(f.db, manager, { range, category: 'loans', projectId: 'project-b' }), error => error.status === 403);
  assert.throws(() => calendar.calendarRange('2026-02-30', '2026-03-01'), error => error.status === 400);
});

test('organizational unit filter narrows every category and the ICS download without enlarging project access',async t=>{
  const f=fixture(t),owner=await actor(f,'owner'),manager=await actor(f,'manager');
  for(const suffix of ['a','b']){f.insert('organizational_units',{id:`unit-${suffix}`,name:`Unit ${suffix}`,kind:'academic',created_at:timestamp,updated_at:timestamp});f.sqlite.prepare('UPDATE projects SET unit_id=? WHERE id=?').run(`unit-${suffix}`,`project-${suffix}`);}
  const result=await calendar.calendarEntries(f.db,owner,{range,unitId:'unit-a'});
  assert.ok(result.entries.length>=6);assert.ok(result.entries.every(entry=>entry.projectId==='project-a'));
  assert.deepEqual((await calendar.calendarEntries(f.db,manager,{range,unitId:'unit-b'})).entries,[]);
  assert.deepEqual((await calendar.calendarEntries(f.db,owner,{range,projectId:'project-a',unitId:'unit-b'})).entries,[]);
  observe(f,f.member('viewer'));
  const download=await route.GET(new Request('https://portal.example.test/api/calendar?from=2026-10-01&to=2026-10-31&unitId=unit-b&format=ics'));
  assert.equal(download.status,200);assert.ok(!(await download.text()).includes('BEGIN:VEVENT'));
  await assert.rejects(calendar.calendarEntries(f.db,owner,{range,unitId:'invalid/unit'}),error=>error.status===400);
});

test('category access follows domain capability and revoked memberships stop reads', async t => {
  const f = fixture(t), inventory = await actor(f, 'inventory'), viewer = await actor(f, 'viewer'), operator = await actor(f, 'operator');
  assert.deepEqual((await calendar.calendarEntries(f.db, inventory, { range })).availableCategories, ['materials', 'consumption']);
  assert.deepEqual((await calendar.calendarEntries(f.db, viewer, { range })).availableCategories, ['projects']);
  await assert.rejects(calendar.calendarEntries(f.db, inventory, { range, category: 'loans' }), error => error.status === 403);
  await assert.rejects(calendar.calendarEntries(f.db, operator, { range }), error => error.status === 403);
  f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(timestamp, inventory.userId);
  const revoked = await getActor(f.db, { userId: inventory.userId, email: inventory.email, displayName: '' });
  await assert.rejects(calendar.calendarEntries(f.db, revoked, { range }), error => error.status === 403);
});

test('project schedule metadata appears in the central agenda with source revision and cancelled tombstones', async t => {
  const f=fixture(t),viewer=await actor(f,'viewer'),inventory=await actor(f,'inventory');
  for(const suffix of ['a','b'])f.insert('project_schedule_items',{id:`schedule-${suffix}`,project_id:`project-${suffix}`,title:`Schedule ${suffix}`,starts_at:timestamp,ends_at:timestamp,status:'cancelled',note:'PRIVATE SCHEDULE NOTE',url:'https://proex.ufg.br/',version:4,created_at:timestamp,updated_at:timestamp});
  const result=await calendar.calendarEntries(f.db,viewer,{range,category:'projects'}),event=result.entries.find(entry=>entry.sourceKind==='project-schedule');
  assert.equal(event.sourceId,'schedule-a');assert.equal(event.revision,4);assert.equal(event.status,'CANCELLED');assert.equal(event.allDay,true);assert.equal(event.startsAt,'2026-10-19');
  assert.ok(!JSON.stringify(result).includes('PRIVATE SCHEDULE NOTE'));assert.ok(!result.entries.some(entry=>entry.sourceId==='schedule-b'));
  assert.ok(!(await calendar.calendarEntries(f.db,inventory,{range})).entries.some(entry=>entry.sourceKind==='project-schedule'));
});

test('records linked to loans require loan permission in the same project in agenda and anonymous feeds', async t => {
  const f = fixture(t), inventoryUser = f.member('inventory'), viewerUser = f.member('viewer'), manager = await actor(f, 'manager');
  for (const kind of ['project', 'maintenance', 'consumption']) f.insert('records', {
    id: `linked-${kind}`, project_id: 'project-a', kind, loan_id: 'loan-a', title: `RESTRICTED LOAN ${kind}`,
    body: 'PRIVATE LINKED BODY', occurred_at: timestamp, created_by: 'PRIVATE ACTOR', created_at: timestamp,
  });
  // A loan role in another project must not expand the inventory role's scope in project A.
  f.insert('members', { id: 'other-project-loans', user_id: inventoryUser.userId, email: inventoryUser.email,
    role: 'loans', project_id: 'project-b', created_at: timestamp });
  for (const [user, category] of [[viewerUser, 'projects'], [inventoryUser, 'materials'], [inventoryUser, 'consumption']]) {
    const restricted = await getActor(f.db, user);
    const agenda = await calendar.calendarEntries(f.db, restricted, { range, category, projectId: 'project-a' });
    assert.ok(!JSON.stringify(agenda).includes('RESTRICTED LOAN'));
    const feed = await calendar.calendarAction(f.db, restricted, { action: 'feed.create', category, projectId: 'project-a' }, 'https://portal.example.test');
    const payload = await calendar.calendarFeed(f.db, feed.feedUrl.split('/').at(-1));
    assert.ok(!calendar.serializeCalendar(payload.entries).includes('RESTRICTED LOAN'));
  }
  const authorized = await calendar.calendarEntries(f.db, manager, { range });
  assert.equal(authorized.entries.filter(entry => entry.title.includes('RESTRICTED LOAN')).length, 3);
});

test('feed stores only a hash, returns URL once, and rechecks owner scope/account on every anonymous fetch', async t => {
  const f = fixture(t), user = f.member('manager'), manager = await getActor(f.db, user);
  const created = await calendar.calendarAction(f.db, manager, { action: 'feed.create', category: 'loans', projectId: 'project-a' }, 'https://portal.example.test');
  const token = created.feedUrl.split('/').at(-1);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const row = f.sqlite.prepare('SELECT * FROM calendar_feeds WHERE id=?').get(created.id);
  assert.equal(row.token_hash, await calendar.calendarTokenHash(token));
  assert.ok(!JSON.stringify(row).includes(token));
  assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), 365 * 86400000);
  assert.ok(!/token|hash|feedUrl/.test(JSON.stringify(await calendar.calendarFeeds(f.db, manager))));
  observe(f, null);
  const response = await feedRoute.GET(new Request(created.feedUrl), { params: Promise.resolve({ token }) });
  assert.equal(response.status, 200); assert.match(await response.text(), /BEGIN:VCALENDAR/);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const payload = await calendar.calendarFeed(f.db, token);
  assert.ok(payload.entries.every(entry => entry.projectId === 'project-a' && entry.category === 'loans'));
  f.sqlite.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(user.userId);
  await assert.rejects(calendar.calendarFeed(f.db, token), error => error.status === 404);
  f.sqlite.prepare("UPDATE portal_users SET status='active' WHERE user_id=?").run(user.userId);
  f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(timestamp, user.userId);
  await assert.rejects(calendar.calendarFeed(f.db, token), error => error.status === 404);
});

test('global feed requires global scope; owner revocation/expiration and cross-owner mutation are enforced', async t => {
  const f = fixture(t), manager = await actor(f, 'manager'), owner = await actor(f, 'owner');
  await assert.rejects(calendar.calendarAction(f.db, manager, { action: 'feed.create', category: 'loans' }, 'https://portal.example.test'), error => error.status === 403);
  const created = await calendar.calendarAction(f.db, owner, { action: 'feed.create', category: 'loans' }, 'https://portal.example.test');
  const token = created.feedUrl.split('/').at(-1);
  assert.equal((await calendar.calendarFeed(f.db, token)).entries.length, 2);
  await assert.rejects(calendar.calendarAction(f.db, manager, { action: 'feed.revoke', id: created.id }, 'https://portal.example.test'), error => error.status === 404);
  await calendar.calendarAction(f.db, owner, { action: 'feed.revoke', id: created.id }, 'https://portal.example.test');
  await assert.rejects(calendar.calendarFeed(f.db, token), error => error.status === 404);
  const second = await calendar.calendarAction(f.db, owner, { action: 'feed.create', category: 'projects' }, 'https://portal.example.test');
  await assert.rejects(calendar.calendarFeed(f.db, second.feedUrl.split('/').at(-1), new Date(Date.now() + 366 * 86400000)), error => error.status === 404);
});

test('ICS has stable IDs, cancellation tombstones, valid date boundaries, escaping and UTF-8 folding', async t => {
  const f = fixture(t), manager = await actor(f, 'manager');
  let result = await calendar.calendarEntries(f.db, manager, { range, category: 'loans' });
  const uid = result.entries[0].uid, revision = result.entries[0].revision;
  f.sqlite.prepare("UPDATE loans SET status='cancelled',updated_at=? WHERE id='loan-a'").run('2026-10-20T04:30:00.000Z');
  f.insert('audit', { id: 'cancel-audit', actor_id: 'PRIVATE ACTOR', project_id: 'project-a', action: 'loan.cancel', entity_id: 'loan-a', details: 'PRIVATE DETAILS', created_at: timestamp });
  result = await calendar.calendarEntries(f.db, manager, { range, category: 'loans' });
  assert.equal(result.entries[0].uid, uid); assert.equal(result.entries[0].status, 'CANCELLED'); assert.ok(result.entries[0].revision > revision);
  result.entries[0].title = 'Extensão; café, ação\\teste\n' + 'á🙂'.repeat(80);
  const ics = calendar.serializeCalendar(result.entries);
  assert.ok(ics.endsWith('\r\n')); assert.ok(!/(?<!\r)\n/.test(ics));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  assert.match(ics, /STATUS:CANCELLED/); assert.match(ics, /DTSTART:20261020T023000Z/);
  assert.match(ics, /Extensão\\; café\\, ação\\\\teste\\n/);
  assert.equal(calendar.serializeCalendar(result.entries), ics, 'Rendering does not invent new revisions or timestamps.');
});

test('HTTP routes protect reads/writes, bound date ranges, and serve authorized ICS without caching', async t => {
  const f = fixture(t), user = f.member('manager'); observe(f, null);
  assert.equal((await route.GET(new Request('https://portal.example.test/api/calendar'))).status, 401);
  observe(f, user);
  assert.equal((await route.POST(post('feed.create', { category: 'loans', projectId: 'project-a' }, 'https://evil.example.test'))).status, 403);
  assert.equal((await route.POST(new Request('https://portal.example.test/api/calendar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: '{}' }))).status, 403);
  assert.equal((await route.GET(new Request('https://portal.example.test/api/calendar?from=2020-01-01&to=2026-10-31'))).status, 400);
  const response = await route.GET(new Request('https://portal.example.test/api/calendar?from=2026-10-01&to=2026-10-31&category=materials&format=ics'));
  assert.equal(response.status, 200); assert.match(response.headers.get('Content-Type'), /^text\/calendar/);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const body = await response.text(); assert.ok(!/PRIVATE (BORROWER|NOTE|RECORD|ACTOR|OBSERVATION)|SECRET|example\.test/.test(body)); assert.match(body, /DTSTART;VALUE=DATE:20261019/); assert.match(body, /DTEND;VALUE=DATE:20261020/);
  const missing = await feedRoute.GET(new Request('https://portal.example.test/api/calendar/feed/invalid'), { params: Promise.resolve({ token: 'invalid' }) });
  assert.equal(missing.status, 404); assert.equal(missing.headers.get('Referrer-Policy'), 'no-referrer');
});

test('calendar JSON, ICS and subscription creation reject a foreign project even with claimed identity headers', async t => {
  const f = fixture(t), user = f.member('manager'); observe(f, user);
  for (const format of ['json','ics']) {
    const response = await route.GET(new Request(`https://portal.example.test/api/calendar?from=2026-10-01&to=2026-10-31&category=loans&projectId=project-b&format=${format}`, { headers: { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@ufg.br' } }));
    assert.equal(response.status, 403); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.ok(!(await response.text()).includes('SECRET PROJECT B'));
  }
  assert.equal((await route.POST(post('feed.create', { category: 'loans', projectId: 'project-b' }))).status, 403);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM calendar_feeds').get().n, 0);
});
