import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from './support/project-report-module.mjs';

const links = await load('lib/report-links.ts');
const history = await load('lib/portal-history.ts');
const scope = { modules: ['overview', 'reports', 'records'], units: [], areas: [], canSelectProject: id => id === 'project-a', canOpenRecord: () => false };

test('a shared Relatórios link retains its subject, project, period and search', () => {
  const params = new URLSearchParams({ module: 'reports', project: 'project-a', report: 'records', recorte: '1', from: '2026-11-01', to: '2026-11-10', q: '  Manutenção\n ' });
  assert.deepEqual({ ...links.readReportArrival(params) }, { from: '2026-11-01', to: '2026-11-10', search: 'Manutenção' });
  const route = history.readPortalLocation(params, scope);
  assert.deepEqual([route.tab, route.project, route.report], ['reports', 'project-a', 'records']);
});

test('a link without dates means the whole period, while a link without the arrival mark keeps the current dates', () => {
  const params = new URLSearchParams({ module: 'reports', report: 'demands', recorte: '1', q: 'Equipamentos' });
  assert.deepEqual({ ...links.readReportArrival(params) }, { from: '', to: '', search: 'Equipamentos' });
  assert.equal(links.readReportArrival(new URLSearchParams('module=reports&report=demands')), null);
  assert.equal(links.readReportArrival(new URLSearchParams('module=records&recorte=1&q=x')), null);
});

test('R3: address values are validated: unknown subjects, bad dates and long or control text are dropped', () => {
  assert.equal(history.readPortalLocation(new URLSearchParams('module=reports&report=users'), scope).report, 'projects');
  assert.equal(history.readPortalLocation(new URLSearchParams('module=records&report=demands'), scope).report, 'projects', 'only the reports module reads the subject');
  for (const id of links.REPORT_DATASET_IDS) assert.equal(history.readPortalLocation(new URLSearchParams({ module: 'reports', report: id }), scope).report, id);
  const arrival = links.readReportArrival(new URLSearchParams({ module: 'reports', recorte: '1', from: '2026-02-31', to: '2026-11-10', q: `${'a'.repeat(200)}\u0000` }));
  assert.equal(arrival.from, '');
  assert.equal(arrival.to, '2026-11-10');
  assert.equal(arrival.search.length, 80);
  assert.deepEqual({ ...links.readReportArrival(new URLSearchParams('module=reports&recorte=1&from=2026-11-10&to=2026-11-01')) }, { from: '2026-11-01', to: '2026-11-10', search: '' }, 'inverted periods are put in order');
});

test('impossible dates with a valid-looking shape do not break opening a shared report', () => {
  for (const invalid of ['2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-02-29', '2026-11-31', '2026-01-01T00:00:00Z', ' 2026-01-01']) {
    const params = new URLSearchParams({ module: 'reports', recorte: '1', from: invalid, to: '2024-02-29' });
    assert.deepEqual({ ...links.readReportArrival(params) }, { from: '', to: '2024-02-29', search: '' }, invalid);
    params.set('from', '2024-02-29');
    params.set('to', invalid);
    assert.deepEqual({ ...links.readReportArrival(params) }, { from: '2024-02-29', to: '', search: '' }, invalid);
  }
});

test('R3: the subject round-trips through the address and the default stays out of it', () => {
  const params = new URLSearchParams();
  history.writePortalLocation(params, { tab: 'reports', project: '', unit: '', area: '', demand: '', record: null, report: 'campaign_days' });
  assert.equal(params.get('report'), 'campaign_days');
  history.writePortalLocation(params, { tab: 'reports', project: '', unit: '', area: '', demand: '', record: null, report: 'projects' });
  assert.equal(params.has('report'), false);
});

test('R3 removes the duplicate indicators and downloads from Relatórios', () => {
  const client = readFileSync(new URL('../app/portal-client.tsx', import.meta.url), 'utf8');
  for (const gone of ['Indicadores das dinâmicas', 'p-reports-legacy-title', 'Exportar registros completos', '/api/export?kind=', 'Baixar resumo diário']) assert.equal(client.includes(gone), false, gone);
  assert.match(client, /'campaigns', 'campaign_days'/);
});
