import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../components/portal/management/management.module.css', import.meta.url), 'utf8');
const rule = selector => {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `regra ${selector}`);
  return css.slice(start, css.indexOf('}', start));
};

// Conferência em produção com login (11/11/2026): o link do projeto em "Demandas por projeto"
// media 18 px de altura no computador e 38 px no celular, abaixo do alvo mínimo de 44 px do portal.
test('Gestão: links inside the dashboard table keep the 44 px touch target', () => {
  const link = rule('.table a');
  assert.match(link, /display:\s*inline-flex/);
  assert.match(link, /min-height:\s*44px/);
});

test('Gestão: the other clickable pieces of the module declare the 44 px target', () => {
  for (const selector of ['.tabs button', '.linkButton', '.roleMore > summary', '.levels button', '.attention a, .attention button']) {
    assert.match(rule(selector), /min-height:\s*44px/, selector);
  }
});
