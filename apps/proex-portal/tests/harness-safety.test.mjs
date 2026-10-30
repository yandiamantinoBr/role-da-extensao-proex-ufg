import test from 'node:test';
import assert from 'node:assert/strict';
import { localHarnessUrl } from '../scripts/local-harness-url.mjs';

test('the connector harness cannot be pointed at production or a remote service', () => {
  for (const value of ['https://proex-gestao.vercel.app', 'http://example.test', 'http://localhost.example.test', 'http://localhost@proex-gestao.vercel.app', 'http://localhost:5173/?token=example', 'http://localhost:5173/api', 'file:///test']) {
    assert.throws(() => localHarnessUrl(value));
  }
  for (const value of ['http://127.0.0.1:5173', 'http://localhost:5173/', 'http://[::1]:5173']) {
    assert.equal(localHarnessUrl(value).protocol, 'http:');
  }
});
