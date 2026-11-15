import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { roleVideoFixture } from './support/role-video-fixture.mjs';

const library = fileURLToPath(new URL('../lib/', import.meta.url));
const modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  const filename = path.join(library, name + '.ts');
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const resolved = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_match, _quote, dependency) => {
    return 'from ' + JSON.stringify(compile(path.posix.join(path.posix.dirname(name), dependency)));
  });
  const url = 'data:text/javascript;base64,' + Buffer.from(resolved).toString('base64');
  modules.set(name, url);
  return url;
}

const { dispatchRoleVideo, parseRoleVideo } = await import(compile('assistant/role-video'));
const { roleVideoEstimate, roleVideoCostMicros, ROLE_VIDEO_ENDPOINT } = await import(compile('assistant/role-video-contracts'));
const { requireProviderEndpoint } = await import(compile('assistant/provider-transport'));

test('accepts a verified short MP4 and rejects disguised, overlong, fragmented and oversized files', () => {
  const video = parseRoleVideo(roleVideoFixture());
  assert.equal(video.seconds, 4);
  assert.equal(video.bytes, Buffer.from(video.data, 'base64').length);
  assert.equal(parseRoleVideo(undefined), null);
  assert.throws(() => parseRoleVideo('data:video/mp4;base64,AAAA'), { code: 'role_video_format' });
  assert.throws(() => parseRoleVideo(roleVideoFixture({ fragmented: true })), { code: 'role_video_format' });
  assert.throws(() => parseRoleVideo(roleVideoFixture({ kind: 'soun' })), { code: 'role_video_format' });
  assert.throws(() => parseRoleVideo(roleVideoFixture({ seconds: 13 })), { code: 'role_video_duration' });
  assert.throws(() => parseRoleVideo(roleVideoFixture({ sampleSeconds: 23 })), { code: 'role_video_duration' });
  assert.throws(() => parseRoleVideo('data:video/mp4;base64,' + 'A'.repeat(2_666_672)), { code: 'role_video_size' });
});

test('video reserve covers audio and documented default sampling, and prices switch in January', () => {
  const now = Date.UTC(2026, 10, 15);
  const exact = roleVideoEstimate({ textBytes: 30, maxOutputTokens: 300, seconds: 4, now });
  const browser = roleVideoEstimate({ textBytes: 30, maxOutputTokens: 300, now });
  assert.ok(exact.inputTokens > 400 * 4);
  assert.ok(browser.costMicros > exact.costMicros);
  assert.equal(browser.tokens, browser.inputTokens + 300);
  assert.equal(roleVideoCostMicros(400, 100, now), 675);
  assert.equal(roleVideoCostMicros(400, 100, now, 'gemini-4-hydrogen'), 1350);
  assert.equal(roleVideoCostMicros(400, 100, Date.UTC(2027, 0, 1)), 1350);
  assert.equal(requireProviderEndpoint(ROLE_VIDEO_ENDPOINT).href, ROLE_VIDEO_ENDPOINT);
});

const apiKey = 'GEMINI-TEST-KEY-ONLY';
const dispatch = fetcher => dispatchRoleVideo({
  apiKey, video: parseRoleVideo(roleVideoFixture()), message: 'Quais são as duas cores?', maxOutputTokens: 300,
  inputCeiling: 3000, signal: AbortSignal.timeout(1_000), now: Date.UTC(2026, 10, 15), fetcher,
});
const metered = {
  model: 'gemini-3.8-flash',
  status: 'completed',
  steps: [
    { type: 'thought', content: [{ type: 'text', text: 'Raciocínio privado' }] },
    { type: 'model_output', content: [{ type: 'text', text: 'Vermelho, depois azul.' }] },
  ],
  usage: { total_input_tokens: 400, total_output_tokens: 15, total_thought_tokens: 60 },
};

test('uses one fixed, inline Google request and bills thought tokens without displaying them', async () => {
  let calls = 0;
  const result = await dispatch(async (url, options) => {
    calls++;
    assert.equal(url, ROLE_VIDEO_ENDPOINT);
    assert.equal(options.headers['x-goog-api-key'], apiKey);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gemini-3.8-flash');
    assert.equal(body.store, false);
    assert.equal(body.background, false);
    assert.equal(body.stream, false);
    assert.equal(body.tools, undefined);
    assert.equal(body.input.length, 2);
    assert.deepEqual(body.input[0].processing, { type: 'static', fps: 1, end_offset: '4s' });
    assert.equal(body.input[0].resolution, 'low');
    assert.equal(body.input[0].uri, undefined);
    assert.deepEqual(body.generation_config, { thinking_level: 'low', thinking_summaries: 'none', max_output_tokens: 300 });
    return Response.json(metered);
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { reply: 'Vermelho, depois azul.', operation: null, inputTokens: 400, outputTokens: 75, reasoningTokens: 60, costMicros: 582 });
});

test('blocks input over the limit and retains metered cost on incomplete or censored output', async () => {
  await assert.rejects(dispatchRoleVideo({
    apiKey, video: parseRoleVideo(roleVideoFixture()), message: 'Pergunta', maxOutputTokens: 300, inputCeiling: 100,
    signal: AbortSignal.timeout(1000), fetcher: () => assert.fail('must reject before sending'),
  }), { code: 'role_input_limit' });
  await assert.rejects(dispatch(async () => Response.json({ ...metered, status: 'incomplete' })), { chargedMicros: 582, chargedTokens: 475 });
  await assert.rejects(dispatch(async () => Response.json({
    ...metered, steps: [{ type: 'model_output', content: [{ type: 'text', text: apiKey }] }],
  })), { chargedMicros: 582 });
  await assert.rejects(dispatch(async () => Response.json({
    ...metered, usage: { total_input_tokens: 400, total_output_tokens: 15, total_thought_tokens: 300 },
  })), { chargedTokens: 715 });
});
