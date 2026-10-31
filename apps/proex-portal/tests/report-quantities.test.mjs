import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('../lib/report-quantities.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { quantityTotal } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('physical report totals never add kilograms, pieces or unknown units together', () => {
  assert.equal(quantityTotal([{ unidade_medida: 'kg', quantidade: 3 }, { unidade_medida: 'unidade', quantidade: 10 }], 'quantidade'), null);
  assert.equal(quantityTotal([{ quantidade: 3 }], 'quantidade'), null);
  assert.equal(quantityTotal([], 'quantidade'), 0);
  const rows = [{ unidade_medida: 'unidade', quantidade: 10 }, { unidade_medida: ' Unidade ', quantidade: -3 }];
  assert.equal(quantityTotal(rows, 'quantidade'), 7);
  assert.equal(quantityTotal(rows, 'quantidade', 'in'), 10);
  assert.equal(quantityTotal(rows, 'quantidade', 'out'), 3);
});
