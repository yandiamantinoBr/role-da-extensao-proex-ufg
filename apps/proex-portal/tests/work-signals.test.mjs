import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const module = { exports: {} };
const source = readFileSync(new URL('../lib/follow-up/presentation.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(code, { module, exports: module.exports, Date, Number, Math });
const { taskDeadline } = module.exports;

test('calendar-day attention distinguishes overdue, today and coming deadlines without changing priority', () => {
 assert.equal(taskDeadline('2026-10-30', 'open', '2026-10-31').kind, 'overdue');
 assert.equal(taskDeadline('2026-10-31', 'blocked', '2026-10-31').kind, 'today');
 assert.equal(taskDeadline('2026-11-01', 'in_progress', '2026-10-31').days, 1);
 assert.equal(taskDeadline('2026-11-03', 'open', '2026-10-31').kind, 'soon');
 assert.equal(taskDeadline('2026-11-04', 'open', '2026-10-31').kind, 'scheduled');
 assert.ok(taskDeadline('2026-10-29', 'open', '2026-10-31').label.includes('há 2 dias'));
});

test('closed tasks never appear overdue and missing or malformed dates never invent urgency', () => {
 for (const status of ['completed', 'cancelled']) assert.equal(taskDeadline('2020-01-01', status, '2026-10-31').kind, 'closed');
 assert.equal(taskDeadline(null, 'open', '2026-10-31').kind, 'none');
 for (const due of ['2026-02-30', 'invalid', '2026-1-01']) assert.equal(taskDeadline(due, 'open', '2026-10-31').kind, 'invalid');
 const unknown = taskDeadline('2026-10-31', 'open', 'invalid');
 assert.equal(unknown.kind, 'unknown');
 assert.equal(unknown.tone, 'neutral');
 assert.ok(unknown.label.includes('31/10/2026'));
});

test('calendar day arithmetic is stable across month, year, leap day and daylight saving boundaries', () => {
 for (const [due, today] of [['2027-01-01','2026-12-31'], ['2028-02-29','2028-02-28'], ['2026-11-02','2026-11-01']]) assert.equal(taskDeadline(due, 'open', today).days, 1);
});
