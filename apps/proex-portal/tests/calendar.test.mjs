import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
for (const name of ['access', 'database', 'errors', 'http', 'calendar', 'mutations', 'civil-date', 'movement-ledger']) {
  writeFileSync(join(directory, `${name}.js`), compile(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8')));
}
// A Agenda confere a leitura de turnos e prazos com a mesma regra de Demandas (lib/follow-up/scope.ts).
mkdirSync(join(directory, 'follow-up'));
writeFileSync(join(directory, 'follow-up', 'scope.js'), compile(readFileSync(new URL('../lib/follow-up/scope.ts', import.meta.url), 'utf8')).replace(/from '(\.\.\/[^']+)'/g, (_, path) => `from '${path}.js'`));
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
  let afterRead = () => {};
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'));
  function prepare(sql, values = []) { return {
    bind(...parameters) { return prepare(sql, parameters); },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { const results = sqlite.prepare(sql).all(...values); afterRead(sql); return { success: true, results }; },
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
  return { db, sqlite, insert, member, afterRead(callback) { afterRead = callback; } };
}
async function actor(f, role, projectId) { return getActor(f.db, f.member(role, projectId)); }
function observe(f, user) { globalThis.__calendarDb = f.db; globalThis.__calendarUser = user; }
function post(action, values = {}, origin = 'https://portal.example.test') { return new Request('https://portal.example.test/api/calendar', { method: 'POST', headers: { Origin: origin, 'X-Proex-Action': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...values }) }); }

test('calendar uses real dates, scopes all categories and projects, and omits personal/freeform fields', async t => {
  const f = fixture(t), manager = await actor(f, 'manager');
  const result = await calendar.calendarEntries(f.db, manager, { range });
  assert.equal(result.availableCategories.length, 5, 'inclui Prazos de demandas (R7)');
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
  assert.deepEqual((await calendar.calendarEntries(f.db, inventory, { range })).availableCategories, ['materials', 'consumption', 'deadlines']);
  assert.deepEqual((await calendar.calendarEntries(f.db, viewer, { range })).availableCategories, ['projects', 'deadlines']);
  assert.equal(calendar.calendarAvailable(operator), false, 'o operador de evento continua sem Agenda (PR89)');
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

test('date-only project activities overlap every included day and export the next day as exclusive end', async t => {
  const f = fixture(t), viewerUser = f.member('viewer'), viewer = await getActor(f.db, viewerUser);
  for (const [id, projectId, start, end] of [
    ['civil-range', 'project-a', '2026-11-09', '2026-11-13'],
    ['same-day', 'project-a', '2026-11-30', '2026-11-30'],
    ['timed', 'project-a', '2026-11-09T12:00:00.000Z', '2026-11-09T16:00:00.000Z'],
    ['foreign-civil', 'project-b', '2026-11-09', '2026-11-13'],
    ['invalid-legacy', 'project-a', '2026-11-00', '2026-11-13'],
    ['mixed-legacy', 'project-a', '2026-11-09', '2026-11-13T14:00:00.000Z'],
  ]) {
    f.insert('project_schedule_items', { id, project_id: projectId, title: id, starts_at: start, ends_at: end, status: 'planned', created_at: timestamp, updated_at: timestamp });
  }
  f.sqlite.exec('PRAGMA ignore_check_constraints=ON');
  f.insert('project_schedule_items', { id: 'inverted-legacy', project_id: 'project-a', title: 'inverted-legacy',
    starts_at: '2026-11-13', ends_at: '2026-11-09', status: 'planned', created_at: timestamp, updated_at: timestamp });
  f.sqlite.exec('PRAGMA ignore_check_constraints=OFF');
  const events = async (from, to = from) => (await calendar.calendarEntries(f.db, viewer, {
    range: calendar.calendarRange(from, to), category: 'projects',
  })).entries;
  const first = await events('2026-11-09');
  const final = await events('2026-11-13');
  assert.deepEqual(first.map(event => [event.sourceId, event.allDay, event.startsAt, event.endsAt]), [
    ['civil-range', true, '2026-11-09', '2026-11-14'],
    ['timed', false, '2026-11-09T12:00:00.000Z', '2026-11-09T16:00:00.000Z'],
  ]);
  assert.deepEqual(final, [first[0]]);
  assert.deepEqual(await events('2026-11-09', '2026-11-13'), first);
  assert.deepEqual(await events('2026-11-08'), []);
  assert.deepEqual(await events('2026-11-14'), []);
  assert.equal((await events('2026-11-30'))[0].endsAt, '2026-12-01');
  assert.deepEqual(await events('2026-12-01'), []);
  observe(f, viewerUser);
  const download = await route.GET(new Request('https://portal.example.test/api/calendar?from=2026-11-13&to=2026-11-13&category=projects&format=ics'));
  assert.equal(download.status, 200);
  const body = await download.text();
  assert.match(body, /DTSTART;VALUE=DATE:20261109\r\nDTEND;VALUE=DATE:20261114\r\n/);
  assert.equal((body.match(/BEGIN:VEVENT/g) ?? []).length, 1);
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

test('subscription and download are passive calendar data, including an empty calendar without invented events', async t => {
  const f = fixture(t), owner = await actor(f, 'owner');
  const created = await calendar.calendarAction(f.db, owner, { action: 'feed.create', category: 'projects' }, 'https://portal.example.test');
  f.sqlite.exec('DELETE FROM campaigns; DELETE FROM records; UPDATE projects SET starts_at=NULL,ends_at=NULL');
  observe(f, null);
  const response = await feedRoute.GET(new Request(created.feedUrl), { params: Promise.resolve({ token: created.feedUrl.split('/').at(-1) }) });
  assert.equal(response.status, 200);
  const ics = await response.text();
  assert.match(response.headers.get('Content-Type'), /^text\/calendar; charset=utf-8$/);
  assert.ok(!ics.includes('METHOD:'), 'A read-only subscription is not an iTIP scheduling transaction.');
  assert.match(ics, /BEGIN:VTIMEZONE\r\nTZID:UTC\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:\+0000\r\nTZOFFSETTO:\+0000\r\nTZNAME:UTC\r\nEND:STANDARD\r\nEND:VTIMEZONE/);
  assert.ok(!/BEGIN:(VEVENT|VFREEBUSY|VTODO)/.test(ics), 'No fake appointment or availability is published.');
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  observe(f, { userId: owner.userId, email: owner.email, displayName: '' });
  const download = await route.GET(new Request('https://portal.example.test/api/calendar?from=2026-10-01&to=2026-10-31&category=projects&format=ics'));
  assert.equal(download.status, 200); assert.match(await download.text(), /BEGIN:VTIMEZONE/);
});

test('an anonymous feed is fenced after its last projection when the link, account or scope is revoked', async t => {
  for (const change of ['feed', 'blocked', 'membership', 'platform-owner']) await t.test(change, async t => {
    const f = fixture(t), owner = await actor(f, 'owner');
    const created = await calendar.calendarAction(f.db, owner, { action: 'feed.create', category: 'projects', ...(change === 'platform-owner' ? {} : { projectId: 'project-a' }) }, 'https://portal.example.test');
    let changed = false;
    f.afterRead(sql => {
      if (changed || !sql.includes('FROM records r JOIN projects')) return;
      changed = true;
      if (change === 'feed') f.sqlite.prepare('UPDATE calendar_feeds SET revoked_at=? WHERE id=?').run(timestamp, created.id);
      else if (change === 'blocked') f.sqlite.prepare("UPDATE portal_users SET status='blocked' WHERE user_id=?").run(owner.userId);
      else if (change === 'membership') f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(timestamp, owner.userId);
      else f.sqlite.prepare("UPDATE members SET organization_id='org_proex' WHERE user_id=?").run(owner.userId);
    });
    observe(f, null);
    const response = await feedRoute.GET(new Request(created.feedUrl), { params: Promise.resolve({ token: created.feedUrl.split('/').at(-1) }) });
    assert.ok(changed); assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'calendar_feed_unavailable');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  });
});

test('a projects feed never releases loan-linked records after the owner loses loans.read mid-request', async t => {
  for (const timing of ['before-records', 'after-records']) await t.test(timing, async t => {
    const f = fixture(t), manager = await actor(f, 'manager');
    f.insert('records', { id: 'linked-private', project_id: 'project-a', kind: 'project', loan_id: 'loan-a',
      title: 'RESTRICTED LOAN RECORD', occurred_at: timestamp, created_by: manager.userId, created_at: timestamp });
    const created = await calendar.calendarAction(f.db, manager, { action: 'feed.create', category: 'projects', projectId: 'project-a' }, 'https://portal.example.test');
    let changed = false;
    f.afterRead(sql => {
      const matches = timing === 'before-records' ? sql.includes('FROM projects p WHERE') : sql.includes('FROM records r JOIN projects');
      if (!changed && matches) { changed = true; f.sqlite.prepare("UPDATE members SET role='viewer' WHERE user_id=?").run(manager.userId); }
    });
    observe(f, null);
    const response = await feedRoute.GET(new Request(created.feedUrl), { params: Promise.resolve({ token: created.feedUrl.split('/').at(-1) }) });
    assert.ok(changed);
    assert.ok([200, 404].includes(response.status));
    assert.ok(!(await response.text()).includes('RESTRICTED LOAN RECORD'));
  });
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


test('material calendar uses the declared occurrence and preserves separate recorded measures without exposing SEI or beneficiary',async t=>{
 const f=fixture(t),inventory=await actor(f,'inventory');
 const add=(id,unit,delta)=>{f.insert('stock_movements',{id,item_id:'material-a',kind:'consume',delta,note:'PRIVATE NOTE',actor_id:'PRIVATE ACTOR',created_at:timestamp});f.insert('stock_movement_contexts',{movement_id:id,project_id:'project-a',process_reference:'PRIVATE SEI',beneficiary_reference:'PRIVATE BENEFICIARY',occurred_at:'2026-10-12T02:00:00Z',date_source:'declared',material_name:'Material a',measurement_unit:unit,created_at:timestamp});};
 add('context-units','unidades',-2);f.sqlite.prepare("UPDATE items SET unit='caixas' WHERE id='material-a'").run();add('context-boxes','caixas',-3);
 const result=await calendar.calendarEntries(f.db,inventory,{category:'consumption',projectId:'project-a',range:calendar.calendarRange('2026-10-11','2026-10-11')});
 assert.equal(result.entries.length,2);assert.equal(new Set(result.entries.map(row=>row.uid)).size,2);
 assert.ok(result.entries.some(row=>row.title.endsWith('-2 unidades')));assert.ok(result.entries.some(row=>row.title.endsWith('-3 caixas')));
 for(const row of result.entries){assert.equal(row.startsAt,'2026-10-11');assert.equal(row.endsAt,'2026-10-12');}
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE SEI|PRIVATE BENEFICIARY|PRIVATE NOTE|PRIVATE ACTOR/);
 const registered=await calendar.calendarEntries(f.db,inventory,{category:'consumption',projectId:'project-a',range:calendar.calendarRange('2026-10-19','2026-10-19')});assert.equal(registered.entries.length,1);
});

// R7 (revisão geral de 09/11, aprovada em 10/11/2026): turnos das dinâmicas e prazos de demanda na Agenda.
function workFixture(t) {
  const f = fixture(t);
  // Os projetos sintéticos já nascem na organização padrão das migrações (org_proex).
  for (const suffix of ['a', 'b']) f.insert('campaign_planning', { campaign_id: `campaign-${suffix}`, version: 1, created_at: timestamp, updated_at: timestamp });
  const shift = (id, suffix, extra) => f.insert('campaign_sessions', { id, campaign_id: `campaign-${suffix}`, session_date: '2026-10-21', ordinal: 1, label: '', status: 'tentative', note: 'PRIVATE SHIFT NOTE', created_at: timestamp, updated_at: timestamp, ...extra });
  shift('shift-a-1', 'a', { starts_at: '13:30', ends_at: '15:00', label: 'Tarde', status: 'confirmed' });
  shift('shift-a-2', 'a', { ordinal: 2, session_date: '2026-10-22' });
  shift('shift-a-3', 'a', { ordinal: 3, starts_at: '20:00', ends_at: '22:30', status: 'cancelled' });
  shift('shift-b-1', 'b', { label: 'SECRET SHIFT' });
  const task = (id, extra) => f.insert('followup_tasks', { id, title: 'Conferir brindes', body: 'PRIVATE TASK BODY', priority: 'high', status: 'open', due_at: '2026-10-23', created_by: 'PRIVATE ACTOR', created_at: timestamp, updated_at: timestamp, ...extra });
  task('task-a', { organization_id: 'org_proex', project_id: 'project-a' });
  task('task-org', { organization_id: 'org_proex', project_id: null, title: 'Planejamento da organização' });
  task('task-b', { organization_id: 'org_proex', project_id: 'project-b', title: 'SECRET TASK' });
  task('task-late', { organization_id: 'org_proex', project_id: 'project-a', due_at: '2026-12-01' });
  task('task-done', { organization_id: 'org_proex', project_id: 'project-a', status: 'completed', title: 'Entregue' });
  return f;
}

test('dynamic shifts appear in the agenda with Brasília times, all-day without time and cancellation, without free notes', async t => {
  const f = workFixture(t), manager = await actor(f, 'manager');
  const result = await calendar.calendarEntries(f.db, manager, { range, category: 'projects' });
  const shifts = result.entries.filter(entry => entry.sourceKind === 'campaign-session');
  assert.deepEqual(shifts.map(entry => entry.title).sort(), ['Turno · 2º turno · Evento a', 'Turno · 3º turno · Evento a', 'Turno · Tarde · Evento a']);
  const afternoon = shifts.find(entry => entry.title.includes('Tarde'));
  assert.equal(afternoon.startsAt, '2026-10-21T16:30:00.000Z'); assert.equal(afternoon.endsAt, '2026-10-21T18:00:00.000Z'); assert.equal(afternoon.allDay, false);
  const allDay = shifts.find(entry => entry.title.includes('2º'));
  assert.equal(allDay.allDay, true); assert.equal(allDay.startsAt, '2026-10-22'); assert.equal(allDay.endsAt, '2026-10-23');
  const night = shifts.find(entry => entry.title.includes('3º'));
  assert.equal(night.status, 'CANCELLED'); assert.equal(night.endsAt, '2026-10-22T01:30:00.000Z', '22:30 em Brasília');
  assert.ok(!/PRIVATE|SECRET/.test(JSON.stringify(result)), 'nem nota do turno nem turno de outro projeto');
});

test('demand deadlines appear only for demands the person can already read, and org-wide ones only without a project filter', async t => {
  const f = workFixture(t), viewer = await actor(f, 'viewer'), owner = await actor(f, 'owner');
  const mine = await calendar.calendarEntries(f.db, viewer, { range, category: 'deadlines' });
  assert.deepEqual(mine.entries.map(entry => entry.title).sort(), ['Prazo · Conferir brindes', 'Prazo · Entregue']);
  const deadline = mine.entries.find(entry => entry.sourceId === 'task-a');
  assert.equal(deadline.allDay, true); assert.equal(deadline.startsAt, '2026-10-23'); assert.equal(deadline.endsAt, '2026-10-24');
  assert.equal(mine.entries.find(entry => entry.sourceId === 'task-done').state, 'done');
  assert.ok(!/PRIVATE|SECRET/.test(JSON.stringify(mine)), 'sem corpo da demanda nem demanda de outro projeto');
  // A demanda da organização inteira exige autoridade na organização: a dona da plataforma vê, quem é só do projeto não.
  const all = await calendar.calendarEntries(f.db, owner, { range, category: 'deadlines' });
  assert.ok(all.entries.some(entry => entry.sourceId === 'task-org' && entry.projectId === ''));
  assert.ok(!(await calendar.calendarEntries(f.db, owner, { range, category: 'deadlines', projectId: 'project-a' })).entries.some(entry => entry.sourceId === 'task-org'));
  assert.ok(!all.entries.some(entry => entry.sourceId === 'task-late'), 'fora do período');
  // Perdeu o vínculo: o prazo some, mesmo com a sessão antiga.
  f.sqlite.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(timestamp, viewer.userId);
  assert.deepEqual((await calendar.calendarEntries(f.db, viewer, { range, category: 'deadlines' })).entries, []);
});

test('deadlines respect the 10,000-entry limit like every other category', async t => {
  const f = workFixture(t), owner = await actor(f, 'owner');
  const insert = f.sqlite.prepare("INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,status,due_at,created_by,created_at,updated_at) VALUES(?,'org_proex','project-a','Prazo sintético','','low','open','2026-10-24','ACTOR',?,?)");
  f.sqlite.exec('BEGIN'); for (let index = 0; index < 10001; index++) insert.run(`bulk-${index}`, timestamp, timestamp); f.sqlite.exec('COMMIT');
  await assert.rejects(calendar.calendarEntries(f.db, owner, { range, category: 'deadlines' }), error => error.status === 422);
  await assert.rejects(calendar.calendarEntries(f.db, owner, { range }), error => error.status === 422, 'também com todas as categorias');
});

test('shifts of a dynamic still in draft appear, because the team plans before activating it', async t => {
  const f = workFixture(t), manager = await actor(f, 'manager'), viewer = await actor(f, 'viewer', 'project-b');
  f.sqlite.prepare("UPDATE campaigns SET status='draft' WHERE id='campaign-a'").run();
  const result = await calendar.calendarEntries(f.db, manager, { range, category: 'projects' });
  assert.equal(result.entries.filter(entry => entry.sourceKind === 'campaign-session').length, 3, 'turnos planejados da dinâmica em rascunho');
  assert.ok(!result.entries.some(entry => entry.sourceKind === 'campaign' && entry.sourceId === 'campaign-a'), 'o evento em rascunho continua fora');
  assert.ok(!(await calendar.calendarEntries(f.db, viewer, { range, category: 'projects' })).entries.some(entry => entry.sourceId.startsWith('shift-a')), 'quem é de outro projeto não vê');
});
