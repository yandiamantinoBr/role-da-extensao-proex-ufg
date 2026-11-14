import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { compile, nativeFixture, root } from './support/traffic-fixture.mjs';
import { syntheticReportData } from './support/project-report-module.mjs';

const { prepareProjectReport, readProjectReport } = await import(compile('components/portal/project-report/api.ts'));
const { GET } = await import(compile('app/api/projects/[id]/report/route.ts', new Map([
  [resolve(root, 'lib/platform.ts'), 'export function database(){return globalThis.__proexTraffic.db;} export function portalOrigin(){return "https://proex.example.invalid";}'],
  [resolve(root, 'lib/session.ts'), 'export async function getPortalUser(){return globalThis.__reportViewer?.()??null;}'],
])));

test('report API binds the refreshed data to the authenticated account without changing legacy reads', async () => {
  const f = nativeFixture();
  const viewer = f.owner();
  globalThis.__reportViewer = () => viewer;
  const url = 'https://proex.example.invalid/api/projects/project-fixture/report';
  const path = { params: Promise.resolve({id: 'project-fixture'}) };
  const report = id => GET(new Request(url, id ? { headers: {'X-Proex-Viewer': id} } : {}), path);
  try {
    const legacy = await report();
    assert.equal(legacy.status, 200);
    assert.equal((await legacy.json()).project.id, 'project-fixture');
    const response = await report(viewer.userId);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Proex-Viewer'), viewer.userId);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    const wrongViewer = await report('someone-else');
    assert.equal(wrongViewer.status, 403);
    assert.equal(Object.hasOwn(await wrongViewer.json(), 'sections'), false);
    let checks = 0;
    globalThis.__reportViewer = () => checks++ === 0 ? viewer : null;
    assert.equal((await report(viewer.userId)).status, 401);
    globalThis.__reportViewer = () => viewer;
    f.native.prepare("UPDATE members SET revoked_at=? WHERE id='member-fixture'").run(new Date().toISOString());
    assert.equal((await report(viewer.userId)).status, 404);
  } finally {
    delete globalThis.__reportViewer;
    f.close();
  }
});

test('fresh client read rejects the wrong account, period or project on an otherwise successful response', async t => {
  const query = { viewerId: 'viewer-a', projectId: 'synthetic-project', from: '', to: '' };
  const report = { ...syntheticReportData(), templates: [] };
  const signal = new AbortController().signal;
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let current = report, viewer = query.viewerId;
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/api/projects/synthetic-project/report?');
    assert.equal(options.headers['X-Proex-Viewer'], 'viewer-a');
    assert.equal(options.cache, 'no-store');
    return Response.json(current, { headers: {'X-Proex-Viewer': viewer} });
  };
  assert.deepEqual(await readProjectReport(query, signal), report);
  viewer = 'viewer-b';
  await assert.rejects(readProjectReport(query, signal), {status: 403});
  viewer = query.viewerId;
  current = {...report, period:{from:'2026-11-01', to:'2026-11-14'}};
  await assert.rejects(readProjectReport(query, signal), {status: 403});
  current = {...report, project:{...report.project,id:'another-project'}};
  await assert.rejects(readProjectReport(query, signal), {status: 403});
});

test('a change before or during export never delivers a file and refreshes the preview', async () => {
  const preview = { ...syntheticReportData(), templates: [] };
  const fresh = { ...preview, generatedAt:'2026-11-09T15:00:03Z' };
  const changed = { ...fresh, sections:{ ...fresh.sections, materials:null, history:null } };
  const signal = new AbortController().signal;
  let rendered = false, refreshed = null;
  const render = async () => { rendered = true; return 'artifact'; };
  const refresh = update => { refreshed = update; };
  assert.equal(await prepareProjectReport(preview, async () => fresh, render, refresh, signal), 'artifact');
  rendered = false;
  await assert.rejects(prepareProjectReport(preview, async () => changed, render, refresh, signal), {status: 409});
  assert.equal(refreshed, changed);
  assert.equal(rendered, false);
  const reordered = {...fresh, sections:{...fresh.sections, demands:{...fresh.sections.demands, rows:[...fresh.sections.demands.rows].reverse()}}};
  let reads = 0;
  await assert.rejects(prepareProjectReport(preview, async () => reads++ === 0 ? fresh : reordered, render, refresh, signal), {status: 409});
  assert.equal(rendered, true);
  assert.equal(refreshed, reordered);
});

test('cancelling the active context while the PDF is prepared prevents the final read and download', async () => {
  const preview = { ...syntheticReportData(), templates: [] };
  const controller = new AbortController();
  let reads = 0;
  const read = async () => { reads++; return preview; };
  const render = async () => { controller.abort(); return 'artifact'; };
  await assert.rejects(prepareProjectReport(preview, read, render, () => assert.fail('Preview updated'), controller.signal), {name: 'AbortError'});
  assert.equal(reads, 1);
});
