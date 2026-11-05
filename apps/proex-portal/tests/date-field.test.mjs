import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const sources = ['civil-date', 'date-field'].map(name => readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '')).join('\n');
const output = ts.transpileModule(sources, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
const { displayCivilDate, parseBrazilianDate, dateFieldError, calendarOpeningDay } = await import(moduleUrl);

test('Brazilian date editing keeps ISO values and rejects ambiguous or impossible dates', () => {
  assert.equal(displayCivilDate('2026-11-05'), '05/11/2026');
  assert.equal(parseBrazilianDate('05/11/2026'), '2026-11-05');
  assert.equal(parseBrazilianDate('05112026'), '2026-11-05', 'numeric mobile keyboards do not need a slash key');
  assert.equal(parseBrazilianDate('29/02/2028'), '2028-02-29');
  for (const value of ['29/02/2026', '31/04/2026', '00/11/2026', '05/00/2026', '05/13/2026', '2026-11-05', '5/11/26', '05/11', '']) assert.equal(parseBrazilianDate(value), '', value);
  for (const value of ['', 'invalid', '2026-02-29', '2026-11-05T13:30:00Z']) assert.equal(displayCivilDate(value), '', value);
});

test('required, optional and bounded date fields have Portuguese validation without truncating years', () => {
  assert.equal(dateFieldError(''), '');
  assert.match(dateFieldError('31/04/2026'), /data válida.*dia\/mês\/ano/);
  assert.match(dateFieldError('04/11/2026', '2026-11-05'), /05\/11\/2026.*posterior/);
  assert.match(dateFieldError('06/11/2026', undefined, '2026-11-05'), /05\/11\/2026.*anterior/);
  assert.equal(dateFieldError('05/11/2026', '2026-11-05', '2026-11-05'), '');
  assert.equal(parseBrazilianDate('01/01/0099'), '0099-01-01');
});

test('calendar conversion does not move civil dates in Brazilian, positive or negative timezones', () => {
  const code = `const {calendarDate,calendarCivilDate}=await import(${JSON.stringify(moduleUrl)}); for(const iso of ['2026-11-05','2018-11-04','2028-02-29','0099-01-01']) { if(calendarCivilDate(calendarDate(iso))!==iso) throw new Error(iso); }`;
  for (const zone of ['America/Sao_Paulo', 'Pacific/Kiritimati', 'America/Los_Angeles']) execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: zone }, stdio: 'pipe', windowsHide: true });
});

test('empty calendars open in the current month and clamp future or past bounds',()=>{
  const today='2026-11-05';
  assert.equal(calendarOpeningDay('','2000-01-01','2200-12-31',today),today);
  assert.equal(calendarOpeningDay('',undefined,undefined,today),today);
  assert.equal(calendarOpeningDay('','2027-02-01',undefined,today),'2027-02-01');
  assert.equal(calendarOpeningDay('',undefined,'2025-12-31',today),'2025-12-31');
  assert.equal(calendarOpeningDay('2026-12-08','2000-01-01','2200-12-31',today),'2026-12-08');
});
