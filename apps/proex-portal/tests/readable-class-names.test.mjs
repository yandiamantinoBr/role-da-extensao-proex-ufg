import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { readableScopedName } from '../scripts/vite/readable-class-names.mjs';

const root = join('C:', 'proex-portal');
const name = readableScopedName(root);

test('CSS Module classes read as File_class__hash in the inspector', () => {
  assert.match(name('grid', join(root, 'components', 'portal', 'projects-page.module.css')), /^ProjectsPage_grid__[0-9a-f]{5}$/);
  assert.match(name('shell', join(root, 'app', 'scope-filters.module.css?used')), /^ScopeFilters_shell__[0-9a-f]{5}$/);
  assert.match(name('noteDisclosure', join(root, 'components', 'activity_checklist.module.css')), /^ActivityChecklist_noteDisclosure__[0-9a-f]{5}$/);
  assert.match(name('x', join(root, '2fa.module.css')), /^C2fa_x__[0-9a-f]{5}$/);
});

test('names are stable, independent of the machine path, and unique per file and class', () => {
  const file = join(root, 'components', 'a.module.css');
  assert.equal(name('grid', file), name('grid', file));
  const elsewhere = readableScopedName(join('D:', 'build', 'other'));
  assert.equal(elsewhere('grid', join('D:', 'build', 'other', 'components', 'a.module.css')), name('grid', file));
  assert.notEqual(name('grid', file), name('grid', join(root, 'app', 'a.module.css')));
  assert.notEqual(name('grid', file), name('list', file));
});
