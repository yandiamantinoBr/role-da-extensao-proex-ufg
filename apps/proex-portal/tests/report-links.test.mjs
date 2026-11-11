import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from './support/project-report-module.mjs';

const links = await load('lib/report-links.ts');
const history = await load('lib/portal-history.ts');
const scope = { modules: ['overview', 'reports', 'records'], units: [], areas: [], canSelectProject: id => id === 'project-a', canOpenRecord: () => false };

test('R3: the Exportar link opens Relatórios with subject, project, period and search', () => {
  const href = links.reportHref({ dataset: 'records', projectId: 'project-a', from: '2026-11-01', to: '2026-11-10', search: '  Manutenção\n ' });
  const params = new URL(href, 'https://portal.example.invalid').searchParams;
  assert.deepEqual(Object.fromEntries(params), { module: 'reports', project: 'project-a', report: 'records', recorte: '1', from: '2026-11-01', to: '2026-11-10', q: 'Manutenção' });
  assert.deepEqual({ ...links.readReportArrival(params) }, { from: '2026-11-01', to: '2026-11-10', search: 'Manutenção' });
  const route = history.readPortalLocation(params, scope);
  assert.deepEqual([route.tab, route.project, route.report], ['reports', 'project-a', 'records']);
});

test('R3: a link without period means the whole period; without the arrival mark the screen keeps its own period', () => {
  const team = new URL(links.reportHref({ dataset: 'demands', search: 'Equipe Sintética' }), 'https://portal.example.invalid').searchParams;
  assert.deepEqual({ ...links.readReportArrival(team) }, { from: '', to: '', search: 'Equipe Sintética' });
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

test('R3: the subject round-trips through the address and the default stays out of it', () => {
  const params = new URLSearchParams();
  history.writePortalLocation(params, { tab: 'reports', project: '', unit: '', area: '', demand: '', record: null, report: 'campaign_days' });
  assert.equal(params.get('report'), 'campaign_days');
  history.writePortalLocation(params, { tab: 'reports', project: '', unit: '', area: '', demand: '', record: null, report: 'projects' });
  assert.equal(params.has('report'), false);
});

test('R3: the legacy indicators block and its scattered downloads are gone from Relatórios; screens point to the central', () => {
  const client = readFileSync(new URL('../app/portal-client.tsx', import.meta.url), 'utf8');
  for (const gone of ['Indicadores das dinâmicas', 'p-reports-legacy-title', 'Exportar registros completos', '/api/export?kind=', 'Baixar resumo diário']) assert.equal(client.includes(gone), false, gone);
  assert.match(client, /'campaigns', 'campaign_days'/);
  const teams = readFileSync(new URL('../components/portal/work-teams-panel.tsx', import.meta.url), 'utf8');
  assert.match(teams, /<ExportLink dataset="demands"/);
  assert.equal(/ExportFormats|toXlsx|toDocx/.test(teams), false, 'teams no longer build files on their own');
  const records = readFileSync(new URL('../components/portal/records-panel.tsx', import.meta.url), 'utf8');
  assert.match(records, /<ExportLink dataset="records"/);
});
