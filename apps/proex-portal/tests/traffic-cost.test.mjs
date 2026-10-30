import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeFixture, trafficModules } from './support/traffic-fixture.mjs';

const { event, connector, rate, tokens, contracts } = await trafficModules();
const context = id => ({ params: Promise.resolve({ id }) });
const post = authorization => new Request('https://portal.example.invalid/api/sync/connector', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
  body: JSON.stringify({ tool: 'ping' }),
});

test('public event reads preserve existing visits without any persistent writes', async () => {
  const f = nativeFixture();
  try {
    f.native.prepare("INSERT INTO visits(campaign_id,day,hits) VALUES('event-fixture','2026-10-20',7)").run();
    for (let i = 0; i < 100; i++) {
      const response = await event.GET(new Request('https://portal.example.invalid/api/events/event-fixture'), context('event-fixture'));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const body = await response.json(); assert.equal(body.campaign.name, 'Synthetic event'); assert.equal(body.authenticated, false);
    }
    assert.equal(f.stats.commits, 0);
    assert.equal(f.native.prepare('SELECT SUM(hits) hits FROM visits').get().hits, 7);
    assert.equal((await event.GET(new Request('https://portal.example.invalid/event'), context('missing'))).status, 404);
    f.native.prepare("UPDATE campaigns SET status='draft'").run();
    assert.equal((await event.GET(new Request('https://portal.example.invalid/event'), context('event-fixture'))).status, 404);
    assert.equal(f.stats.commits, 0);
  } finally { f.close(); }
});

test('missing and forged connector keys cannot create rate buckets or invoke tools', async () => {
  const f = nativeFixture();
  try {
    for (const authorization of [null, 'Bearer invalid', `Bearer pxs_${'x'.repeat(43)}`]) {
      for (let i = 0; i < 10; i++) assert.equal((await connector.POST(post(authorization))).status, 401);
    }
    assert.equal(f.native.prepare('SELECT COUNT(*) n FROM portal_rate_limits').get().n, 0);
    assert.equal(f.context.toolCalls, 0); assert.equal(f.stats.commits, 0);
  } finally { f.close(); }
});

test('authenticated connector remains rate limited and revocation is checked on every request', async () => {
  const f = nativeFixture();
  try {
    const owner = f.owner(), key = await tokens.createSyncToken(f.db, owner, {}), authorization = `Bearer ${key.token}`;
    assert.equal((await connector.POST(post(authorization))).status, 200);
    const bucket = `sync-connector:${(await contracts.syncDigest(authorization)).slice(0, 32)}`;
    const hash = await contracts.syncDigest(bucket);
    f.native.prepare('UPDATE portal_rate_limits SET count=2000 WHERE bucket_key=?').run(hash);
    assert.equal((await connector.POST(post(authorization))).status, 429);
    assert.equal(f.context.toolCalls, 1);
    await tokens.revokeSyncToken(f.db, owner, { id: key.id });
    f.resetStats();
    assert.equal((await connector.POST(post(authorization))).status, 401);
    assert.equal(f.stats.commits, 0); assert.equal(f.context.toolCalls, 1);
  } finally { f.close(); }
});

test('rate-limit cleanup removes only expired buckets in the same commit as the increment', async t => {
  const f = nativeFixture(), now = Date.now();
  t.mock.method(Date, 'now', () => now);
  try {
    f.native.prepare("INSERT INTO portal_rate_limits(bucket_key,count,reset_at) VALUES('old',99,?),('boundary',99,?),('active',3,?)").run(now - 1, now, now + 1);
    await rate.rateLimit(f.db, 'fixture-bucket', 2, 1000);
    assert.deepEqual(f.native.prepare("SELECT bucket_key,count FROM portal_rate_limits WHERE bucket_key IN ('old','boundary','active')").all().map(row => ({ ...row })), [{ bucket_key: 'active', count: 3 }]);
    assert.equal(f.stats.commits, 1);
    await rate.rateLimit(f.db, 'fixture-bucket', 2, 1000);
    await assert.rejects(rate.rateLimit(f.db, 'fixture-bucket', 2, 1000), error => error.status === 429);
    assert.equal(f.stats.commits, 3);
    t.mock.method(Date, 'now', () => now + 1000);
    await rate.rateLimit(f.db, 'fixture-bucket', 2, 1000);
    assert.equal(f.native.prepare('SELECT count FROM portal_rate_limits').get().count, 1);
  } finally { f.close(); }
});

test('sync key activity updates at most once per minute while expiry remains immediate', async t => {
  const f = nativeFixture(), now = Date.now(); t.mock.method(Date, 'now', () => now);
  try {
    const owner = f.owner(), key = await tokens.createSyncToken(f.db, owner, {}), authorization = `Bearer ${key.token}`;
    f.resetStats();
    for (let i = 0; i < 20; i++) await tokens.actorFromSyncToken(f.db, authorization);
    assert.equal(f.stats.commits, 1);
    assert.equal(f.native.prepare('SELECT last_used_at FROM sync_tokens').get().last_used_at, new Date(now).toISOString());
    t.mock.method(Date, 'now', () => now + tokens.SYNC_TOKEN_ACTIVITY_INTERVAL_MS);
    await tokens.actorFromSyncToken(f.db, authorization); assert.equal(f.stats.commits, 2);
    f.native.prepare('UPDATE sync_tokens SET expires_at=?').run(new Date(now + tokens.SYNC_TOKEN_ACTIVITY_INTERVAL_MS).toISOString());
    f.resetStats();
    await assert.rejects(tokens.actorFromSyncToken(f.db, authorization), error => error.status === 401);
    assert.equal(f.stats.commits, 0);
  } finally { f.close(); }
});
