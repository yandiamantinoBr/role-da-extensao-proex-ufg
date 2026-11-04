import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/integracoes/proex-planilha.gs', import.meta.url), 'utf8');
const operation = {
  changeKey: 'fixture-operation-1234',
  action: 'stock.move',
  input: { itemId: 'fixture-material', delta: 2, kind: 'receive' },
};

function connector() {
  const context = vm.createContext({ Utilities: { getUuid: () => 'fixture-conflict-id' } });
  vm.runInContext(source, context);
  return context;
}

test('a changed operation key is rejected without stopping a one-row sync batch', () => {
  const context = connector();
  const error = Object.assign(new Error('Esta chave já tem outro conteúdo.'), { code: 'sync_operation_changed' });
  let calls = 0;
  context.chamar_ = (tool, args) => {
    calls++;
    assert.equal(tool, 'proex_sync_apply');
    assert.equal(args.runId, 'fixture-run');
    assert.deepEqual(args.changes, [operation]);
    throw error;
  };
  const result = context.aplicar_([operation], 'fixture-run')[operation.changeKey];
  assert.equal(calls, 1);
  assert.equal(result?.status, 'rejected');
  assert.equal(result?.code, 'sync_operation_changed');
});

test('permission and transport failures still stop a sync batch', () => {
  const context = connector();
  for (const code of ['sync_forbidden', 'transport_failed']) {
    const error = Object.assign(new Error('Falha sintética.'), { code });
    context.chamar_ = () => { throw error; };
    assert.throws(() => context.aplicar_([operation], 'fixture-run'), candidate => candidate === error);
  }
});

test('a receipt cannot confirm changed operation cells after the request left', () => {
  const context = connector();
  const cells = [[operation.changeKey, operation.action, JSON.stringify(operation.input), '', '', '']];
  const sheet = {
    getLastRow: () => 2,
    getRange(row, column, height, width) {
      const range = {
        getDisplayValues: () => cells.slice(row - 2, row - 2 + height).map(line => line.slice(column - 1, column - 1 + width)),
        setNumberFormat() { return range; },
        setValues(values) {
          for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
            cells[row - 2 + r][column - 1 + c] = values[r][c];
          }
          return range;
        },
      };
      return range;
    },
  };
  const workbook = { getSheetByName: () => sheet };
  const { rows, changes } = context.coletarOperacoes_(workbook);
  const changed = JSON.stringify({ ...operation.input, delta: 9 });
  cells[0][2] = changed;
  assert.equal(changes[0].input.delta, 2);
  const conflicts = context.gravarRetornoOperacoes_(workbook, rows, {
    [operation.changeKey]: { status: 'applied', entityId: 'fixture-movement' },
  });
  assert.deepEqual(cells[0].slice(0, 3), [operation.changeKey, operation.action, changed]);
  assert.ok(cells[0][3] && cells[0][3] !== 'applied', 'o conteúdo novo precisa de revisão');
  assert.equal(cells[0][4], '', 'o recibo anterior fica só em Conflitos');
  assert.equal(cells[0][5], 'operation_row_changed');
  assert.equal(conflicts[0][2], 'fixture-movement');
  assert.equal(context.coletarOperacoes_(workbook).changes.length, 0, 'a linha deve aguardar revisão em vez de reenviar');
});
