import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { compile, teamFixture } from './support/work-teams-fixture.mjs';

// Voluntário por ação (10/11/2026): acesso a uma única dinâmica, com data de fim. Dados sintéticos.
const { accessAction, getActor, requireCapability } = await import(compile('lib/access.ts'));
const { participationAction } = await import(compile('lib/participation.ts'));
const { cancelAttendance } = await import(compile('lib/attendance-cancel.ts'));
const { portalSnapshot } = await import(compile('lib/portal-data.ts'));
const { calendarAvailable, calendarEntries, calendarRange } = await import(compile('lib/calendar.ts'));
const { activityFeed } = await import(compile('lib/activity.ts'));
const SECRET = 'segredo-de-teste-sintetico-com-mais-de-32-caracteres';
const ORIGIN = 'https://portal.example.test';
const key = () => crypto.randomUUID();
const inHours = hours => new Date(Date.now() + hours * 3600000).toISOString();

function scenario(t) {
  const f = teamFixture(t);
  const person = (id, display) => {
    f.insert('portal_users', { user_id: id, email: `${id}@example.invalid`, status: 'active', created_at: f.now, updated_at: f.now });
    f.insert('profiles', { user_id: id, display_name: display, created_at: f.now, updated_at: f.now });
    f.users[id] = { userId: id, email: `${id}@example.invalid`, displayName: display };
  };
  person('manager-a', 'Gestora Aurora');
  f.insert('members', { id: 'member-manager-a', user_id: 'manager-a', email: 'manager-a@example.invalid', role: 'manager', project_id: 'project-a', organization_id: 'org-a', created_at: f.now });
  person('volunteer-v', 'Voluntária Teste');
  person('operator-o', 'Operador Teste');
  f.insert('members', { id: 'member-operator-o', user_id: 'operator-o', email: 'operator-o@example.invalid', role: 'operator', project_id: 'project-a', organization_id: 'org-a', created_at: f.now });
  f.native.prepare("INSERT INTO settings(name,value,updated_at) VALUES('privacyNotice','Aviso sintético de privacidade',?)").run(f.now);
  for (const [project, suffix] of [['project-a', 'a'], ['project-a2', 'h']]) {
    f.native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at) VALUES(?,?,?,'gift','unidade',100,?)").run(`pin-${suffix}`, project, `Botton ${suffix}`, f.now);
    f.native.prepare("INSERT INTO offers(id,project_id,name,kind,active) VALUES(?,?,'Um botton','brinde',1),(?,?,'Três bottons','super',1)").run(`gift-${suffix}`, project, `super-${suffix}`, project);
    f.native.prepare('INSERT INTO offer_components(offer_id,item_id,quantity) VALUES(?,?,1),(?,?,3)').run(`gift-${suffix}`, `pin-${suffix}`, `super-${suffix}`, `pin-${suffix}`);
  }
  const campaign = (id, project, suffix, name) => f.native.prepare(`INSERT INTO campaigns(id,project_id,name,location,starts_at,ends_at,status,retry_limit,brinde_offer_id,super_offer_id,rules_text,version,created_at)
    VALUES(?,?,?,'Praça sintética',?,?,'active',0,?,?,'Regras sintéticas',1,?)`).run(id, project, name, inHours(-24), inHours(24), `gift-${suffix}`, `super-${suffix}`, f.now);
  campaign('camp-a1', 'project-a', 'a', 'Ação no parque');
  campaign('camp-a2', 'project-a', 'a', 'Outra ação do projeto');
  campaign('camp-h', 'project-a2', 'h', 'Ação de outro projeto');
  const as = async name => getActor(f.db, f.users[name]);
  const invite = async (input) => accessAction(f.db, await as('manager-a'), 'invite.create', { email: 'volunteer-v@example.invalid', role: 'operator', projectId: 'project-a', operationKey: key(), ...input }, ORIGIN, SECRET);
  const token = url => new URL(url).searchParams.get('token');
  const enroll = async (endsAt = inHours(3)) => {
    const created = await invite({ campaignId: 'camp-a1', endsAt });
    return accessAction(f.db, await as('volunteer-v'), 'invite.accept', { token: token(created.inviteUrl) }, ORIGIN, SECRET);
  };
  const ticket = async (name, campaignId) => participationAction(f.db, await as(name), 'participation.ticket', { campaignId, operationKey: key() });
  return { ...f, as, invite, enroll, ticket };
}

test('volunteer invite is scoped to one action of the project, with a valid end, and never creates a membership', async t => {
  const s = scenario(t);
  await assert.rejects(s.invite({ campaignId: 'camp-h', endsAt: inHours(3) }), error => error.status === 404, 'action of another project');
  await assert.rejects(s.invite({ role: 'viewer', campaignId: 'camp-a1', endsAt: inHours(3) }), error => error.status === 400, 'only the attendance role');
  await assert.rejects(s.invite({ campaignId: 'camp-a1', endsAt: inHours(-1) }), error => error.code === 'invalid_volunteer_end');
  await assert.rejects(s.invite({ campaignId: 'camp-a1', endsAt: inHours(24 * 200) }), error => error.code === 'invalid_volunteer_end');
  await assert.rejects(accessAction(s.db, await s.as('viewer-a'), 'invite.create', { email: 'x@example.invalid', role: 'operator', projectId: 'project-a', campaignId: 'camp-a1', endsAt: inHours(3), operationKey: key() }, ORIGIN, SECRET), error => error.status === 403, 'a report reader cannot invite');
  const endsAt = inHours(3), created = await s.invite({ campaignId: 'camp-a1', endsAt });
  assert.ok(Date.parse(created.expiresAt) <= Date.parse(endsAt), 'the link never outlives the access');
  const accepted = await accessAction(s.db, await s.as('volunteer-v'), 'invite.accept', { token: new URL(created.inviteUrl).searchParams.get('token') }, ORIGIN, SECRET);
  assert.equal(accepted.campaignId, 'camp-a1');
  assert.equal(s.native.prepare("SELECT COUNT(*) n FROM members WHERE user_id='volunteer-v'").get().n, 0, 'a volunteer is not a team member');
  const actor = await s.as('volunteer-v');
  assert.deepEqual(actor.members, []);
  assert.deepEqual(actor.volunteers.map(grant => grant.campaignId), ['camp-a1']);
  assert.throws(() => requireCapability(actor, 'participation.operate', 'project-a'), 'no project-wide authority');
  // The grant cannot be stretched or moved afterwards.
  assert.throws(() => s.native.prepare("UPDATE campaign_volunteers SET ends_at=? WHERE user_id='volunteer-v'").run(inHours(500)), /campaign_volunteer_immutable/);
  assert.throws(() => s.native.prepare("UPDATE campaign_volunteers SET campaign_id='camp-a2' WHERE user_id='volunteer-v'").run(), /campaign_volunteer_immutable/);
  assert.throws(() => s.native.prepare("DELETE FROM campaign_volunteers WHERE user_id='volunteer-v'").run(), /campaign_volunteer_immutable/);
});

test('volunteer sees and operates only their own action', async t => {
  const s = scenario(t);
  const other = await s.ticket('manager-a', 'camp-a2');
  await s.enroll();
  const own = await s.ticket('volunteer-v', 'camp-a1');
  await assert.rejects(s.ticket('volunteer-v', 'camp-a2'), error => error.status === 403, 'another action of the same project');
  await assert.rejects(s.ticket('volunteer-v', 'camp-h'), error => error.status === 403, 'an action of another project');
  const volunteer = await s.as('volunteer-v');
  await assert.rejects(participationAction(s.db, volunteer, 'participation.physical', { attemptId: other.attemptId, result: 'brinde', operationKey: key() }), error => error.status === 403);
  await assert.rejects(cancelAttendance(s.db, volunteer, { attemptId: other.attemptId, reason: 'abandoned' }), error => error.status === 403);
  await participationAction(s.db, volunteer, 'participation.physical', { attemptId: own.attemptId, result: 'brinde', operationKey: key() });
  const code = s.native.prepare('SELECT id FROM entitlements WHERE attempt_id=?').get(own.attemptId).id;
  const second = await s.ticket('volunteer-v', 'camp-a1');
  assert.deepEqual(await cancelAttendance(s.db, volunteer, { attemptId: second.attemptId, reason: 'staff_error' }), { cancelled: true });

  // Snapshot: only the action, its desk and its prizes; nothing else of the project or the organization.
  const third = await s.ticket('volunteer-v', 'camp-a1');
  const otherPrize = await participationAction(s.db, await s.as('manager-a'), 'participation.physical', { attemptId: other.attemptId, result: 'brinde', operationKey: key() });
  assert.ok(otherPrize);
  const snapshot = await portalSnapshot(s.db, volunteer);
  assert.equal(snapshot.role, '');
  assert.deepEqual(snapshot.capabilities, []);
  assert.deepEqual(snapshot.projects, []);
  assert.deepEqual(snapshot.campaigns, []);
  assert.deepEqual(snapshot.items, []);
  assert.deepEqual(snapshot.members, []);
  assert.deepEqual(snapshot.invites, []);
  assert.deepEqual(snapshot.volunteers, []);
  assert.equal(snapshot.calendarAvailable, false);
  assert.deepEqual(snapshot.volunteerAccess.map(row => [row.campaign_id, row.campaign_name, row.project_name]), [['camp-a1', 'Ação no parque', 'Projeto Aurora']]);
  assert.deepEqual([...new Set(snapshot.physicalTickets.map(row => row.campaign_id))], ['camp-a1']);
  assert.ok(snapshot.physicalTickets.some(row => row.attempt_id === third.attemptId));
  assert.deepEqual(snapshot.pendingPrizes.map(row => row.campaign_id), ['camp-a1']);
  const otherCode = s.native.prepare('SELECT id FROM entitlements WHERE attempt_id=?').get(other.attemptId).id;
  await assert.rejects(participationAction(s.db, volunteer, 'prize.redeem', { code: otherCode, operationKey: key() }), error => error.status === 403, 'prize of another action');
  assert.equal((await participationAction(s.db, volunteer, 'prize.redeem', { code, operationKey: key() })).delivered, true);

  // Other modules stay closed: agenda, team access and project-wide reads.
  assert.equal(calendarAvailable(volunteer), false);
  await assert.rejects(calendarEntries(s.db, volunteer, { range: calendarRange() }), error => error.status === 403);
  await assert.rejects(accessAction(s.db, volunteer, 'invite.create', { email: 'y@example.invalid', role: 'operator', projectId: 'project-a', operationKey: key() }, ORIGIN, SECRET), error => error.status === 403);
});

test('access ends by itself at the deadline, even for a session loaded before it, and the end goes to Registros', async t => {
  const s = scenario(t);
  const { volunteerId } = await s.enroll();
  const stale = await s.as('volunteer-v');
  // Simulate the clock passing the deadline (the trigger otherwise forbids moving the end).
  s.native.exec('DROP TRIGGER campaign_volunteer_update');
  s.native.prepare('UPDATE campaign_volunteers SET ends_at=? WHERE id=?').run(inHours(-1), volunteerId);
  await assert.rejects(s.ticket('volunteer-v', 'camp-a1').catch(error => { throw error; }), error => error.status === 403);
  await assert.rejects(participationAction(s.db, stale, 'participation.ticket', { campaignId: 'camp-a1', operationKey: key() }), error => error.status === 403 && error.code === 'access_changed', 'SQL rechecks the deadline');
  const row = s.native.prepare('SELECT revoked_at,revoke_reason,ends_at FROM campaign_volunteers WHERE id=?').get(volunteerId);
  assert.equal(row.revoke_reason, 'expired');
  assert.equal(row.revoked_at, row.ends_at);
  const audit = s.native.prepare("SELECT actor_id,project_id,details FROM audit WHERE action='volunteer.expired' AND entity_id=?").all(volunteerId);
  assert.equal(audit.length, 1, 'recorded once');
  assert.equal(audit[0].project_id, 'project-a');
  await getActor(s.db, s.users['volunteer-v']);
  assert.equal(s.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='volunteer.expired'").get().n, 1, 'the sweep is idempotent');
  const actor = await s.as('volunteer-v');
  assert.deepEqual(actor.volunteers, []);
  await assert.rejects(portalSnapshot(s.db, actor), error => error.status === 403, 'no portal after the end');
  const feed = await activityFeed(s.db, await s.as('manager-a'), { types: 'access' });
  const actions = feed.events.map(event => [event.action, event.title, event.actorName]);
  assert.ok(actions.some(([action, title, actorName]) => action === 'Acesso de voluntário venceu' && title === 'Ação no parque' && actorName === 'Prazo do acesso'), JSON.stringify(actions));
  assert.ok(actions.some(([action, , actorName]) => action === 'Voluntário recebeu acesso' && actorName === 'Gestora Aurora'));
  const outsider = await activityFeed(s.db, await s.as('other-a2'), { types: 'access' });
  assert.deepEqual(outsider.events, [], 'only who manages the project sees it');
});

test('manager can end a volunteer access early; the person can be invited again afterwards', async t => {
  const s = scenario(t);
  const { volunteerId } = await s.enroll();
  const manager = await s.as('manager-a');
  const listed = await portalSnapshot(s.db, manager);
  assert.deepEqual(listed.volunteers.map(row => [row.id, row.campaign_name, row.display_name, row.revoked_at]), [[volunteerId, 'Ação no parque', 'Voluntária Teste', null]]);
  assert.ok(listed.invites.some(row => row.volunteer_campaign_id === 'camp-a1' && row.volunteer_campaign_name === 'Ação no parque'));
  await assert.rejects(accessAction(s.db, await s.as('other-a2'), 'volunteer.revoke', { id: volunteerId }, ORIGIN, SECRET), error => error.status === 403);
  assert.deepEqual(await accessAction(s.db, manager, 'volunteer.revoke', { id: volunteerId }, ORIGIN, SECRET), { revoked: true, id: volunteerId });
  assert.equal(s.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='volunteer.revoke' AND entity_id=?").get(volunteerId).n, 1);
  await assert.rejects(s.ticket('volunteer-v', 'camp-a1'), error => error.status === 403);
  await s.enroll();
  assert.equal(s.native.prepare("SELECT COUNT(*) n FROM campaign_volunteers WHERE user_id='volunteer-v' AND revoked_at IS NULL").get().n, 1);
});

test('volunteer home offers only what the access opens: no links, no agenda, only the own action', () => {
  const nodes = [];
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const stub = name => Object.assign(() => null, { displayName: name });
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'lucide-react': new Proxy({}, { get: (_target, name) => name }),
    './physical-attendance': { default: stub('PhysicalAttendance') },
    './pending-prizes': { default: stub('PendingPrizes') },
    './volunteer-home.module.css': { default: new Proxy({}, { get: (_target, name) => String(name) }) },
  };
  const code = ts.transpileModule(readFileSync(new URL('../components/portal/volunteer-home.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require: name => modules[name], Intl, Date, Set });
  const { VolunteerDesk, volunteerAccessFrom } = loaded.exports;
  const access = volunteerAccessFrom([{ id: 'grant-1', campaign_id: 'camp-a1', campaign_name: 'Ação no parque', status: 'active', location: 'Praça sintética', starts_at: inHours(-1), campaign_ends_at: inHours(5), project_id: 'project-a', project_name: 'Projeto Aurora', ends_at: inHours(4) }]);
  const tree = VolunteerDesk({ access, tickets: [{ campaign_id: 'camp-a1', attempt_id: 'a' }, { campaign_id: 'camp-a2', attempt_id: 'b' }], prizes: [{ id: 'p1', campaign_id: 'camp-a1' }, { id: 'p2', campaign_id: 'camp-h' }], mutate: async () => ({}), redeemForm: jsx('form', { children: 'Código' }) });
  const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; nodes.push(node); visit(node.props.children); };
  visit(tree);
  const text = nodes.flatMap(node => Object.values(node.props).filter(value => typeof value === 'string')).join(' ') + ' ' + JSON.stringify(tree, (_key, value) => typeof value === 'function' ? undefined : value);
  assert.equal(nodes.filter(node => node.type === 'a' || node.props.href).length, 0, 'no link at all in the volunteer home');
  assert.doesNotMatch(text, /Agenda|calendar|Projetos|Registros/);
  const desk = nodes.find(node => node.type?.displayName === 'PhysicalAttendance');
  assert.deepEqual(desk.props.campaigns.map(campaign => campaign.id), ['camp-a1']);
  assert.deepEqual(desk.props.tickets.map(ticket => ticket.attempt_id), ['a']);
  assert.deepEqual(nodes.find(node => node.type?.displayName === 'PendingPrizes').props.prizes.map(prize => prize.id), ['p1']);
  assert.match(text, /Seu acesso vai até/);

  // The portal renders this page, with no navigation, before the team shell; Agenda only appears for whoever can read it.
  const portal = readFileSync(new URL('../app/portal-client.tsx', import.meta.url), 'utf8');
  const volunteerBranch = portal.indexOf('if (!role && volunteerAccess.length)'), shell = portal.indexOf('<DesktopSidebar');
  assert.ok(volunteerBranch > 0 && volunteerBranch < shell, 'volunteer page returns before the navigation shell');
  assert.doesNotMatch(portal.slice(volunteerBranch, portal.indexOf('if (!role || !capabilities.length)')), /href=|navigate\(|DesktopSidebar|MobileNavigation/);
  assert.match(portal, /t\.id === 'calendar' && data\.calendarAvailable !== false/);
});

test('event operators do not get an Agenda they cannot open', async t => {
  const s = scenario(t);
  assert.equal(calendarAvailable(await s.as('operator-o')), false);
  assert.equal((await portalSnapshot(s.db, await s.as('operator-o'))).calendarAvailable, false);
  assert.equal(calendarAvailable(await s.as('manager-a')), true);
});
