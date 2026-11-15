import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { compile, nativeFixture, root } from './support/traffic-fixture.mjs';

const { effortProbeStatus, runEffortProbe } = await import(compile('lib/assistant/effort-probe.ts'));
const { DEFAULT_ASSISTANT_CONFIG } = await import(compile('lib/assistant/contracts.ts'));
const { encryptProviderCredentials } = await import(compile('lib/assistant/crypto.ts'));
const secret = 'synthetic-probe-auth-testing-only';
const keys = { current: 'synthetic-probe-independent-credential-encryption-key' };
const credentials = {
  deepseek: 'synthetic-only-deepseek-test-key', groq: 'synthetic-only-groq-test-key',
  typesafe: 'synthetic-only-typesafe-test-key', openai: 'synthetic-only-openai-test-key',
};
const now = Date.parse('2026-11-15T12:44:00Z');
const clock = { now, keys };
const endpoints = {
  'https://api.deepseek.com/chat/completions': 'deepseek',
  'https://api.groq.com/openai/v1/chat/completions': 'groq',
  'https://api.typesafe.ai/v1/systemone': 'typesafe',
  'https://api.openai.com/v1/chat/completions': 'openai',
};

async function fixture(t, settings = {}, activeCredentials = credentials) {
  const f = nativeFixture();
  t.after(() => f.close());
  const owner = f.owner();
  const { organization_id: org } = f.native.prepare("SELECT organization_id FROM projects WHERE id='project-fixture'").get();
  const ciphertext = await encryptProviderCredentials(secret, activeCredentials, org, keys);
  f.native.prepare(`INSERT INTO ai_organization_settings
    (organization_id,revision,config_json,credentials_ciphertext,updated_by,updated_at) VALUES(?,7,?,?,?,?)`)
    .run(org, JSON.stringify({ ...DEFAULT_ASSISTANT_CONFIG, ...settings }), ciphertext, owner.userId, new Date(now).toISOString());
  return { ...f, owner, org };
}

async function info(f) {
  return effortProbeStatus(f.db, f.owner, f.org, secret, clock);
}

function input(status, id) {
  return { organizationId: status.organizationId, expectedRevision: status.revision, expectedDay: status.day, probeId: id,
    acceptedCostMicros: status.probes.find(probe => probe.id === id).ceilingMicros, consent: true };
}

function receipt(status, id) {
  return status.probes.find(probe => probe.id === id).receipt;
}

function goodResponse(provider, model) {
  if (provider === 'typesafe') return Response.json({
    model: model + '-20261112',
    answers: { total: { type: 'choice', choice: 'eleven', confidence: 0.99, probabilities: { eleven: 0.99 } } },
    usage: { input_tokens: 60, output_tokens: 8 },
  });
  return Response.json({
    model: provider === 'openai' ? model + '-2026-11-05' : model,
    choices: [{ finish_reason: 'stop', message: { content: '11', reasoning_content: 'INTERNAL_REASONING_MARKER' } }],
    usage: { prompt_tokens: 60, completion_tokens: 15, completion_tokens_details: { reasoning_tokens: 12 } },
  });
}

test('uses only reviewed efforts and official endpoints, accounts for all calls, and persists sanitized usage', async t => {
  const f = await fixture(t);
  const status = await info(f);
  assert.deepEqual(status.probes.map(probe => probe.id), [
    'deepseek.off', 'deepseek.low', 'deepseek.high', 'deepseek.max', 'groq.low', 'groq.medium', 'groq.high',
    'typesafe.decision', 'openai.off', 'openai.low', 'openai.medium', 'openai.high', 'openai.xhigh', 'openai.max',
  ]);
  let calls = 0, paidMicros = 0;
  for (const probe of status.probes) {
    const result = await runEffortProbe(f.db, f.owner, input(status, probe.id), secret, { ...clock, fetcher: async (url, req) => {
      calls++;
      const provider = endpoints[url], body = JSON.parse(req.body);
      assert.equal(provider, probe.provider);
      assert.equal(req.method, 'POST');
      assert.equal(req.redirect, 'error');
      assert.equal(req.headers.Authorization, 'Bearer ' + credentials[provider]);
      assert.equal(body.model, probe.model);
      assert.equal(body.tools, undefined);
      if (provider === 'typesafe') {
        assert.equal(body.questions.total.type, 'choice');
        assert.match(body.state, /teste fictício/);
        assert.equal(body.reasoning_effort, undefined);
      } else {
        assert.match(body.messages[0].content, /teste fictício/);
        assert.equal(body.reasoning_effort, probe.level === 'off' ? provider === 'openai' ? 'none' : undefined : probe.level);
        if (provider === 'deepseek') {
          assert.equal(body.thinking.type, probe.level === 'off' ? 'disabled' : 'enabled');
          assert.equal(body.max_tokens, 700);
        } else {
          assert.equal(body.max_completion_tokens, 700);
        }
        if (provider === 'groq') assert.equal(body.include_reasoning, false);
        if (provider === 'openai') assert.equal(body.store, false);
      }
      return goodResponse(provider, body.model);
    } });
    const report = receipt(result, probe.id);
    assert.equal(report.outcome, 'passed');
    assert.equal(report.inputTokens, 60);
    assert.equal(report.reasoningTokens, probe.provider === 'typesafe' ? null : 12);
    assert.ok(report.estimatedCostMicros <= report.reservedCostMicros);
    paidMicros += report.estimatedCostMicros;
  }
  assert.equal(calls, 14);
  const usage = f.native.prepare('SELECT * FROM ai_organization_usage WHERE organization_id=?').get(f.org);
  assert.equal(usage.calls, calls);
  assert.equal(usage.reserved_usd_micros, paidMicros);
  assert.equal(usage.reserved_tokens, 13 * 75 + 68);
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_calls').get().n, 0);
  const entries = f.native.prepare("SELECT details FROM audit WHERE action='assistant.effort.result'").all()
    .map(row => JSON.parse(row.details));
  assert.equal(entries.length, calls);
  assert.equal(entries.reduce((total, row) => total + row.usdMicros, 0), paidMicros);
  assert.ok(entries.every(row => row.provider && row.model && row.inputTokens === 60));
  const outgoing = JSON.stringify([await info(f), f.native.prepare("SELECT details FROM audit WHERE action LIKE 'assistant.effort.%'").all()]);
  for (const value of [...Object.values(credentials), 'INTERNAL_REASONING_MARKER', 'caixa A tem']) assert.ok(!outgoing.includes(value));
});

test('requires the administrator, current date and revision, exact consent and budget before outbound traffic', async t => {
  const f = await fixture(t, { dailyCalls: 1, roleOutputTokenLimit: 300 });
  const status = await info(f), request = input(status, 'deepseek.low');
  let calls = 0;
  const fake = { ...clock, fetcher: async () => { calls++; return goodResponse('deepseek', 'deepseek-flash'); } };
  const organizationOwner = { userId: 'org-owner', email: 'org-owner@example.invalid', members: [], capabilities: [] };
  const at = new Date(now).toISOString();
  f.native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)")
    .run(organizationOwner.userId, organizationOwner.email, at, at);
  f.native.prepare("INSERT INTO members(id,user_id,email,role,organization_id,project_id,created_at) VALUES('org-owner-member',?,?,'owner',?,NULL,?)")
    .run(organizationOwner.userId, organizationOwner.email, f.org, at);
  await assert.rejects(effortProbeStatus(f.db, organizationOwner, f.org, secret, clock), { status: 403 });
  await assert.rejects(runEffortProbe(f.db, organizationOwner, request, secret, fake), { status: 403 });
  for (const changes of [{ consent: false }, { expectedRevision: 6 }, { expectedDay: '2026-11-14' },
    { acceptedCostMicros: 1 }, { probeId: 'typesafe.high' }, { endpoint: 'https://attacker.invalid/' }]) {
    await assert.rejects(runEffortProbe(f.db, f.owner, { ...request, ...changes }, secret, fake));
  }
  assert.equal(calls, 0);
  const [one, two] = await Promise.all([
    runEffortProbe(f.db, f.owner, request, secret, fake), runEffortProbe(f.db, f.owner, request, secret, fake),
  ]);
  assert.ok([one, two].some(state => receipt(state, request.probeId).outcome === 'passed'));
  assert.equal(calls, 1);
  assert.equal(receipt(await runEffortProbe(f.db, f.owner, request, secret, fake), request.probeId).outcome, 'passed');
  await assert.rejects(runEffortProbe(f.db, f.owner, input(status, 'groq.medium'), secret, fake), { status: 429 });
  assert.equal(calls, 1);
});

test('missing keys, rejected responses and rotation after dispatch never expose credentials or retry', async t => {
  const f = await fixture(t, {}, { deepseek: credentials.deepseek });
  const status = await info(f);
  assert.equal(status.probes.find(probe => probe.id === 'groq.low').available, false);
  await assert.rejects(runEffortProbe(f.db, f.owner, input(status, 'groq.low'), secret, {
    ...clock, fetcher: async () => assert.fail('a request left without a key'),
  }), { code: 'assistant_credentials' });
  const rejected = await runEffortProbe(f.db, f.owner, input(status, 'deepseek.low'), secret, {
    ...clock, fetcher: async () => Response.json({ error: credentials.deepseek }, { status: 402 }),
  });
  assert.equal(receipt(rejected, 'deepseek.low').outcome, 'no_credit');
  assert.equal(receipt(rejected, 'deepseek.low').estimatedCostMicros, null);
  assert.ok(!JSON.stringify(rejected).includes(credentials.deepseek));
  await assert.rejects(runEffortProbe(f.db, f.owner, input(status, 'deepseek.high'), secret, {
    ...clock, fetcher: async () => {
      f.native.exec('UPDATE ai_organization_settings SET revision=revision+1');
      return goodResponse('deepseek', 'deepseek-flash');
    },
  }), { code: 'assistant_configuration_changed' });
  assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='assistant.effort.result'").get().n, 1);
  assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls, 2);
});

test('rejects a probe that exceeds the daily token or cost budget and accounts for reported overrun', async t => {
  for (const config of [{ dailyTokens: 1_000 }, { dailyUsdMicros: 1_000 }]) {
    const f = await fixture(t, config);
    const status = await info(f);
    await assert.rejects(runEffortProbe(f.db, f.owner, input(status, 'deepseek.max'), secret, {
      ...clock, fetcher: async () => assert.fail('a request left above the daily ceiling'),
    }), { status: 429 });
    assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='assistant.effort.started'").get().n, 0);
  }
  const f = await fixture(t);
  const status = await info(f), probe = 'deepseek.high';
  const result = await runEffortProbe(f.db, f.owner, input(status, probe), secret, {
    ...clock, fetcher: async () => Response.json({
      model: 'deepseek-flash',
      choices: [{ finish_reason: 'length', message: { content: '' } }],
      usage: { prompt_tokens: 769, completion_tokens: 701 },
    }),
  });
  const observed = receipt(result, probe);
  assert.equal(observed.outcome, 'usage_limit');
  assert.ok(observed.estimatedCostMicros > observed.reservedCostMicros);
  const { reserved_tokens: tokenCount, reserved_usd_micros: cost } = f.native.prepare('SELECT * FROM ai_organization_usage').get();
  assert.equal(tokenCount, 1_470);
  assert.equal(cost, observed.estimatedCostMicros);
});

test('HTTP rejects cross-origin paid requests and serves owner receipts without cache', async t => {
  const f = await fixture(t);
  const replacements = new Map([
    [resolve(root, 'lib/platform.ts'), `export function database(){return globalThis.__effortFixture.db;}
      export function inviteSecret(){return ${JSON.stringify(secret)};}
      export function assistantCredentialKeys(){return ${JSON.stringify(keys)};}`],
    [resolve(root, 'lib/session.ts'), 'export async function getPortalUser(){return globalThis.__effortFixture.actor;}'],
  ]);
  const route = await import(compile('app/api/assistant/effort-probe/route.ts', replacements));
  globalThis.__effortFixture = { db: f.db, actor: null };
  t.after(() => { delete globalThis.__effortFixture; });
  const address = 'https://synthetic.invalid/api/assistant/effort-probe';
  const read = () => route.GET(new Request(address + '?organizationId=' + f.org));
  assert.equal((await read()).status, 401);
  globalThis.__effortFixture.actor = f.owner;
  const out = await read();
  assert.equal(out.status, 200);
  assert.equal(out.headers.get('cache-control'), 'private, no-store');
  const reply = await route.POST(new Request(address, {
    method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'X-Proex-Action': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify(input(await out.json(), 'deepseek.high')),
  }));
  assert.equal(reply.status, 403);
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_organization_usage').get().n, 0);
});
