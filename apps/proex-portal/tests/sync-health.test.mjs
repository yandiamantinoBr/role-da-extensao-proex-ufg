import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('../lib/sync-health.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { syncVerificationState } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const checkedAt = Date.parse('2026-10-31T15:00:00Z');

test('old completed runs stay stale despite a newer failed or running attempt', () => {
  const runs = [{ status: 'running' }, { status: 'failed', finished_at: '2026-10-31T14:59:00Z' }, { status: 'completed', finished_at: '2026-10-25T23:17:59.564Z' }];
  assert.deepEqual(syncVerificationState(runs, checkedAt), { state: 'stale', lastVerifiedAt: '2026-10-25T23:17:59.564Z' });
});
test('configuration or invalid timestamps alone never establish a verified synchronization', () => {
  for (const runs of [[], [{ status: 'completed' }], [{ status: 'completed', finished_at: 'invalid' }], [{ status: 'completed', finished_at: '2026-11-01T00:00:00Z' }]]) {
    assert.deepEqual(syncVerificationState(runs, checkedAt), { state: 'unverified', lastVerifiedAt: null });
  }
});
test('recent completion is reported only for its time, with a defined stale boundary', () => {
  assert.equal(syncVerificationState([{ status: 'completed', finished_at: '2026-10-31T14:31:00Z' }], checkedAt).state, 'recent');
  assert.equal(syncVerificationState([{ status: 'completed', finished_at: '2026-10-31T13:30:00Z' }], checkedAt).state, 'stale');
});
