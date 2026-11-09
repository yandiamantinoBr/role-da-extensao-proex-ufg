import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// Aviso do DevTools "A form field element should have an id or name attribute" (09/11/2026).
// Todo campo nestas telas precisa de id ou name. Prefira id (useId) dentro de <form>: name entra no FormData.
const FILES = [
  'components/portal/calendar-panel.tsx',
  'components/portal/work-teams-panel.tsx',
  'components/portal/team-panel.tsx',
  'components/portal/team-person-detail.tsx',
  'components/portal/official-team-directory.tsx',
  'components/portal/responsibility-manager.tsx',
  'components/portal/export-formats.tsx',
  'components/portal/settings-layout.tsx',
  'components/portal/material-catalog.tsx',
  'components/portal/dynamics-explainer.tsx',
  'components/portal/project-panel.tsx',
  'components/portal/institutional-structure-panel.tsx',
];
export function fieldsWithoutIdentity(file) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), missing = [];
  const visit = node => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ['input', 'select', 'textarea'].includes(node.tagName.getText(source))) {
      const names = node.attributes.properties.map(attribute => ts.isJsxAttribute(attribute) ? attribute.name.getText(source) : '...');
      if (!names.some(name => name === 'id' || name === 'name' || name === '...')) missing.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} <${node.tagName.getText(source)}>`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return missing;
}

test('every form field in these screens has an id or a name', () => {
  assert.deepEqual(FILES.flatMap(fieldsWithoutIdentity), []);
});

test('loans and the other portal-client fields have an id or a name', () => {
  assert.deepEqual(fieldsWithoutIdentity('app/portal-client.tsx'), []);
});

test('date fields without a name still give the hidden value field an id', () => {
  for (const file of ['components/portal/date-field.tsx', 'components/portal/date-time-field.tsx']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(text, /type="hidden" name=\{name\} id=\{name \? undefined : `\$\{inputId\}-valor`\}/, file);
  }
});
