import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
function asModule(source) { return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`; }
function compile(name, dependencies = {}) {
  let code = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const [dependency, url] of Object.entries(dependencies)) code = code.replaceAll(`from './${dependency}'`, `from ${JSON.stringify(url)}`).replaceAll(`from "./${dependency}"`, `from ${JSON.stringify(url)}`);
  code=code.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_match,_quote,dependency)=>{const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),dependency));return `from ${JSON.stringify(dependencies[resolved]??compile(resolved,dependencies))}`;});
  return asModule(`${code}\n//# sourceURL=${name}-under-test.mjs`);
}
const errors = compile('errors');
const databaseModule = compile('database');
const access = asModule(`import {HttpError} from ${JSON.stringify(errors)}; export function requireCapability(actor, cap, project) { if (!actor || !actor.capabilities.includes(cap) || (project && !actor.projects.includes(project))) throw new HttpError(403,'Sem permissão.','forbidden'); }`);
const mutations = compile('mutations', { database: databaseModule, errors });
const projectAccess = compile('access', { errors, mutations });
const records = compile('records', { database: databaseModule, errors, access: projectAccess, mutations });
const projects = compile('projects', { database: databaseModule, errors, access: projectAccess, mutations, records });
const campaigns = compile('campaigns', { database: databaseModule, errors, access, mutations, projects });
const participation = compile('participation', { database: databaseModule, errors, access, campaigns });
const { campaignAction } = await import(campaigns);
const { draw, participationAction } = await import(participation);
const actor = { userId: 'operator-test', projects: ['project-test'], capabilities: ['campaigns.manage', 'participation.operate', 'inventory.deliver'] };
let serial = 0;
const key = prefix => `${prefix}-${String(++serial).padStart(10, '0')}`;

function fixture({ retryLimit = 0, stock = 10000, privacy = true, status = 'active' } = {}) {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  const migrations = readdirSync(`${root}drizzle`).filter(name => name.endsWith('.sql')).sort();
  assert.ok(migrations.length, 'Generate production migrations before running tests.');
  for (const name of migrations) native.exec(readFileSync(`${root}drizzle/${name}`, 'utf8'));
  const now = new Date().toISOString();
  native.prepare('INSERT INTO projects(id,name,description,created_at) VALUES(?,?,?,?)').run('project-test', 'Test project', '', now);
  native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at) VALUES('pin','project-test','Test pin','gift','unidade',?,?)").run(stock, now);
  native.prepare("INSERT INTO offers(id,project_id,name,kind,active) VALUES('regular','project-test','One pin','brinde',1),('special','project-test','Three pins','super',1)").run();
  native.prepare("INSERT INTO offer_components(offer_id,item_id,quantity) VALUES('regular','pin',1),('special','pin',3)").run();
  native.prepare("INSERT INTO campaigns(id,project_id,name,location,starts_at,ends_at,status,retry_limit,brinde_offer_id,super_offer_id,rules_text,version,created_at) VALUES('campaign-test','project-test','Test event','Test location',?,?,?,?, 'regular','special','Published test rules',1,?)")
    .run(new Date(Date.now() - 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString(), status, retryLimit, now);
  if (privacy) native.prepare("INSERT INTO settings(name,value,updated_at) VALUES('privacyNotice','Institution-approved test notice',?)").run(now);
  const prepare = sql => {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first(column) { const row = native.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return { success: true, results: native.prepare(sql).all(...values) }; },
      async run() { const info = native.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(info.changes) } }; },
      execute() { const results = native.prepare(sql).all(...values); return { success: true, results, meta: { changes: Number(native.prepare('SELECT changes() AS n').get().n) } }; },
    };
  };
  const db = {
    native, prepare,
    async batch(statements) {
      native.exec('BEGIN');
      try { const result = statements.map(statement => statement.execute()); native.exec('COMMIT'); return result; }
      catch (error) { native.exec('ROLLBACK'); throw error; }
    },
  };
  return db;
}
function count(db, table, where = '', params = []) { return db.native.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...params).n; }
async function findOutcome(db, wanted) {
  // Real CSPRNG is used. A bounded search exercises the actual production draw rather than replacing it.
  for (let i = 0; i < 512; i++) {
    const user = { userId: key('participant') };
    const input = { modality: i % 2 ? 'wheel' : 'dice', operationKey: key('draw') };
    const response = await draw(db, 'campaign-test', user, input);
    if (wanted(response.attempt.result)) return { user, input, response };
  }
  assert.fail('The requested outcome was not observed in 512 actual random draws.');
}

test('concurrent identical draws replay one attempt and reserve once', async () => {
  const db = fixture();
  try {
    const user = { userId: 'same-account' }, input = { modality: 'wheel', operationKey: 'same-operation-0001' };
    const responses = await Promise.all([draw(db, 'campaign-test', user, input), draw(db, 'campaign-test', user, input)]);
    assert.equal(responses[0].attempt.id, responses[1].attempt.id);
    assert.equal(responses[0].attempt.result, responses[1].attempt.result);
    assert.equal(count(db, 'participations'), 1);
    assert.equal(count(db, 'attempts'), 1);
    assert.equal(count(db, 'audit', "WHERE action='participation.draw'"), 1);
    const expected = responses[0].attempt.result === 'brinde' ? 1 : responses[0].attempt.result === 'super' ? 3 : 0;
    assert.equal(db.native.prepare("SELECT reserved FROM items WHERE id='pin'").get().reserved, expected);
  } finally { db.native.close(); }
});

test('one account shares its limit between wheel and dice, including concurrent requests', async () => {
  const db = fixture();
  try {
    const user = { userId: 'one-identity' };
    const results = await Promise.allSettled([
      draw(db, 'campaign-test', user, { modality: 'wheel', operationKey: 'identity-wheel-0001' }),
      draw(db, 'campaign-test', user, { modality: 'dice', operationKey: 'identity-dice-0001' }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(count(db, 'participations'), 1);
    assert.equal(count(db, 'attempts'), 1);
    const participation = db.native.prepare('SELECT * FROM participations').get();
    assert.equal(participation.attempt_count, 1);
    await assert.rejects(draw(db, 'campaign-test', user, { modality: participation.modality === 'wheel' ? 'dice' : 'wheel', operationKey: 'identity-another-0001' }));
    assert.equal(count(db, 'attempts'), 1);
  } finally { db.native.close(); }
});

test('retry outcome at the configured limit becomes terminal and cannot add another attempt', async () => {
  const db = fixture({ retryLimit: 0 });
  try {
    const { user, input, response } = await findOutcome(db, result => result === 'retry_exhausted');
    assert.equal(response.participation.attempt_count, 1);
    assert.ok(!['ready', 'retry_ready'].includes(response.participation.state));
    assert.equal(response.entitlement, null);
    assert.equal((await draw(db, 'campaign-test', user, input)).attempt.id, response.attempt.id);
    await assert.rejects(draw(db, 'campaign-test', user, { ...input, operationKey: key('exhausted') }));
    assert.equal(count(db, 'attempts', 'WHERE participation_id=?', [response.participation.id]), 1);
  } finally { db.native.close(); }
});

test('insufficient inventory rolls back identity, attempt, reservations and audit together', async () => {
  const db = fixture({ stock: 2 });
  try {
    await assert.rejects(draw(db, 'campaign-test', { userId: 'stock-limited' }, { modality: 'dice', operationKey: 'stock-limit-0001' }));
    for (const table of ['participations', 'attempts', 'reservations', 'entitlements', 'audit']) assert.equal(count(db, table), 0, table);
    const item = db.native.prepare("SELECT stock,reserved FROM items WHERE id='pin'").get();
    assert.equal(item.stock, 2);
    assert.equal(item.reserved, 0);
  } finally { db.native.close(); }
});

test('concurrent prize delivery consumes stock and writes audit exactly once', async () => {
  const db = fixture();
  try {
    const { response } = await findOutcome(db, result => ['brinde', 'super'].includes(result));
    assert.ok(response.entitlement?.id);
    const before = db.native.prepare("SELECT stock,reserved FROM items WHERE id='pin'").get();
    const quantity = response.attempt.result === 'brinde' ? 1 : 3;
    const delivery = { code: response.entitlement.id, operationKey: 'prize-delivery-0001' };
    const result = await Promise.all([
      participationAction(db, actor, 'prize.redeem', delivery),
      participationAction(db, actor, 'prize.redeem', { ...delivery, operationKey: 'prize-delivery-0002' }),
    ]);
    assert.ok(result.every(value => value.delivered));
    const after = db.native.prepare("SELECT stock,reserved FROM items WHERE id='pin'").get();
    assert.equal(after.stock, before.stock - quantity);
    assert.equal(after.reserved, before.reserved - quantity);
    assert.equal(count(db, 'stock_movements', "WHERE kind='redeem'"), 1);
    assert.equal(count(db, 'audit', "WHERE action='prize.redeem'"), 1);
    const replay = await participationAction(db, actor, 'prize.redeem', delivery);
    assert.equal(replay.alreadyDelivered, true);
  } finally { db.native.close(); }
});

test('physical ticket retry uses one identity and resolved outcomes replay without duplicate delivery', async () => {
  const db = fixture({ retryLimit: 1 });
  try {
    const created = await participationAction(db, actor, 'participation.ticket', { campaignId: 'campaign-test', operationKey: 'physical-start-0001' });
    assert.ok(created.attemptId);
    const retry = await participationAction(db, actor, 'participation.physical', { attemptId: created.attemptId, result: 'retry' });
    assert.equal(retry.attempt.result, 'retry');
    assert.equal(retry.participation.state, 'retry_ready');
    const second = await participationAction(db, actor, 'participation.ticket', { campaignId: 'campaign-test', participationId: created.participationId, operationKey: 'physical-retry-0001' });
    assert.equal(second.participationId, created.participationId);
    const resolved = await participationAction(db, actor, 'participation.physical', { attemptId: second.attemptId, result: 'brinde' });
    const replay = await participationAction(db, actor, 'participation.physical', { attemptId: second.attemptId, result: 'super' });
    assert.equal(replay.attempt.id, resolved.attempt.id);
    assert.equal(replay.attempt.result, 'brinde');
    assert.equal(replay.entitlement.id, resolved.entitlement.id);
    assert.equal(count(db, 'participations'), 1);
    assert.equal(count(db, 'attempts'), 2);
    assert.equal(count(db, 'entitlements'), 1);
    const pending = db.native.prepare("SELECT reserved FROM items WHERE id='pin'").get().reserved;
    assert.equal(pending, 1);
  } finally { db.native.close(); }
});

test('physical ticket creation is idempotent when the mobile request is retried', async () => {
  const db = fixture();
  try {
    const input = { campaignId: 'campaign-test', operationKey: 'physical-idem-0001' };
    const [first, replay] = await Promise.all([
      participationAction(db, actor, 'participation.ticket', input),
      participationAction(db, actor, 'participation.ticket', input),
    ]);
    assert.equal(replay.participationId, first.participationId);
    assert.equal(replay.attemptId, first.attemptId);
    assert.equal(count(db, 'participations'), 1);
    assert.equal(count(db, 'attempts'), 1);
    assert.equal(db.native.prepare("SELECT reserved FROM items WHERE id='pin'").get().reserved, 4);
    db.native.prepare("UPDATE campaigns SET status='paused' WHERE id='campaign-test'").run();
    const pausedReplay = await participationAction(db, actor, 'participation.ticket', input);
    assert.equal(pausedReplay.attemptId, first.attemptId);
    assert.equal(pausedReplay.participationId, first.participationId);
    assert.equal(count(db, 'attempts'), 1);
  } finally { db.native.close(); }
});

test('campaign activation requires published privacy notice and operator scope is enforced', async () => {
  const db = fixture({ status: 'draft', privacy: false });
  try {
    await assert.rejects(campaignAction(db, actor, 'campaign.status', { id: 'campaign-test', status: 'active' }), error => error.status === 400 && error.message.includes('privacidade'));
    assert.equal(db.native.prepare("SELECT status FROM campaigns WHERE id='campaign-test'").get().status, 'draft');
    assert.equal(count(db, 'audit'), 0);
    const denied = { ...actor, projects: ['another-project'] };
    await assert.rejects(campaignAction(db, denied, 'campaign.status', { id: 'campaign-test', status: 'closed' }), error => error.status === 403);
  } finally { db.native.close(); }
});

test('authenticated physical attendance shares the account limit with wheel and dice', async () => {
  const db = fixture({ retryLimit: 1 });
  try {
    const user = { userId: 'authenticated-physical' };
    const input = { modality: 'physical', operationKey: 'account-physical-0001' };
    const [first, replay] = await Promise.all([
      draw(db, 'campaign-test', user, input),
      draw(db, 'campaign-test', user, input),
    ]);
    assert.equal(first.attempt.result, 'pending');
    assert.equal(first.participation.state, 'physical_pending');
    assert.equal(first.participation.identity_method, 'account');
    assert.equal(first.participation.modality, 'physical');
    assert.equal(first.entitlement, null);
    assert.equal(replay.attempt.id, first.attempt.id);
    assert.equal(count(db, 'participations'), 1);
    assert.equal(count(db, 'attempts'), 1);
    assert.equal(db.native.prepare("SELECT reserved FROM items WHERE id='pin'").get().reserved, 4);
    for (const modality of ['wheel', 'dice']) {
      await assert.rejects(draw(db, 'campaign-test', user, { modality, operationKey: key('switch-from-physical') }));
    }
    const retry = await participationAction(db, actor, 'participation.physical', { attemptId: first.attempt.id, result: 'retry' });
    assert.equal(retry.participation.state, 'retry_ready');
    await assert.rejects(draw(db, 'campaign-test', user, { modality: 'wheel', operationKey: key('retry-other-modality') }));
    const second = await draw(db, 'campaign-test', user, { modality: 'physical', operationKey: 'account-physical-0002' });
    assert.equal(second.participation.id, first.participation.id);
    assert.equal(second.attempt.number, 2);
    const complete = await participationAction(db, actor, 'participation.physical', { attemptId: second.attempt.id, result: 'miss' });
    assert.equal(complete.participation.state, 'complete');
    await assert.rejects(draw(db, 'campaign-test', user, { modality: 'physical', operationKey: 'account-physical-0003' }));
    assert.equal(count(db, 'participations'), 1);
    assert.equal(count(db, 'attempts'), 2);
    assert.equal(db.native.prepare("SELECT reserved FROM items WHERE id='pin'").get().reserved, 0);
  } finally { db.native.close(); }
});
