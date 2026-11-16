import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Decisão de 2026-11-16: o papel `inventory` se chama "Responsável por materiais" (a palavra do menu).
// Só o rótulo muda: a chave `inventory` no banco e no código continua a mesma.
const root = fileURLToPath(new URL('../', import.meta.url));
function files(dir) {
  return readdirSync(join(root, dir)).flatMap(name => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? files(path) : /\.(tsx?|mjs|gs|md)$/.test(name) ? [path] : [];
  });
}

test('no screen, invite, export or doc still calls the inventory role "Responsável por estoque"', () => {
  const offenders = ['app', 'components', 'lib', 'public', 'docs'].flatMap(files).concat(['README.md'])
    .filter(path => /Respons[aá]vel por estoque/i.test(readFileSync(join(root, path), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('the header role name reuses the single list of access labels', () => {
  const client = readFileSync(join(root, 'app/portal-client.tsx'), 'utf8');
  assert.match(client, /const roleNames: Row = \{ owner: 'Responsável institucional', \.\.\.projectAccessRoleLabels \};/);
  const labels = readFileSync(join(root, 'lib/team-access-labels.ts'), 'utf8');
  assert.match(labels, /inventory: 'Responsável por materiais'/);
  const templates = readFileSync(join(root, 'lib/management/team-templates.ts'), 'utf8');
  assert.match(templates, /inventory: 'Materiais'/, 'modelos de equipe usam a mesma palavra');
  const glossary = readFileSync(join(root, 'docs/GLOSSARIO.md'), 'utf8');
  assert.match(glossary, /Responsável por materiais/);
});
