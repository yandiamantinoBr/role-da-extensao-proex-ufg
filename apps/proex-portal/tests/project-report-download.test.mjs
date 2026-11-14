import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { compile, nativeFixture, root } from './support/traffic-fixture.mjs';
import { fontBytes, syntheticReportData } from './support/project-report-module.mjs';

const { downloadProjectPdf, prepareProjectReport, readProjectReport } = await import(compile('components/portal/project-report/api.ts'));
const { reportDocumentDigest } = await import(compile('components/portal/project-report/fingerprint.ts'));
const { buildReportDocument } = await import(compile('components/portal/project-report/document.ts'));
const { defaultReportConfig } = await import(compile('lib/project-report-config.ts'));
const { GET, POST } = await import(compile('app/api/projects/[id]/report/route.ts', new Map([
  [resolve(root, 'lib/platform.ts'), 'export function database(){return globalThis.__proexTraffic.db;} export function portalOrigin(){return "https://proex.example.invalid";}'],
  [resolve(root, 'lib/session.ts'), 'export async function getPortalUser(){return globalThis.__reportViewer?.()??null;}'],
])));

test('the PDF action renders the confirmed preview without browser assets and refuses changed data or access', async t => {
  const f = nativeFixture();
  const viewer = f.owner();
  const origin = 'https://proex.example.invalid';
  const route = '/api/projects/project-fixture/report';
  const context = { params: Promise.resolve({ id: 'project-fixture' }) };
  const config = { ...defaultReportConfig(), title: 'Relatório de conferência' };
  const session = { 'X-Proex-Viewer': viewer.userId };
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; delete globalThis.__reportViewer; f.close(); });
  globalThis.__reportViewer = () => viewer;
  const initial = await (await GET(new Request(origin + route, { headers: session }), context)).json();
  const doc = buildReportDocument(initial, config, new Date(initial.generatedAt));
  const submit = (extra = {}, headers = {}) => POST(new Request(origin + route, {
    method: 'POST',
    headers: { ...session, 'X-Proex-Action': '1', Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ action: 'export.pdf', config, digest: '', generatedAt: doc.generatedIso, ...extra }),
  }), context);
  let disconnectDuringRender = false;
  globalThis.fetch = async (target, options) => {
    if (target === route) return POST(new Request(origin + route, { ...options, headers: { ...options.headers, Origin: origin } }), context);
    assert.equal(new URL(target).origin, origin);
    if (!String(target).endsWith('.ttf')) return new Response(null, { status: 404 });
    if (disconnectDuringRender) globalThis.__reportViewer = () => null;
    return new Response(fontBytes);
  };
  const signal = new AbortController().signal;
  const digest = await reportDocumentDigest(doc);
  assert.equal((await submit({ digest }, { Origin: 'https://elsewhere.invalid' })).status, 403);
  assert.equal((await submit({ digest }, { 'X-Proex-Viewer': '' })).status, 400);
  assert.equal((await submit({ digest, config: { ...config, title: 'Outra prévia' } })).status, 409);
  disconnectDuringRender = true;
  assert.equal((await submit({ digest })).status, 401);
  disconnectDuringRender = false;
  globalThis.__reportViewer = () => viewer;
  const response = await submit({ digest });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const pdf = await downloadProjectPdf(viewer.userId, 'project-fixture', config, doc, signal);
  assert.equal(await pdf.slice(0, 5).text(), '%PDF-');
  assert.ok(pdf.size > 1000);
  f.native.prepare("UPDATE projects SET name=? WHERE id='project-fixture'").run('Outro nome');
  await assert.rejects(downloadProjectPdf(viewer.userId, 'project-fixture', config, doc, signal), { status: 409 });
});

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
