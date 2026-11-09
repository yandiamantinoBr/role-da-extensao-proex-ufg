// Nomes de classe legíveis no inspetor: `ProjectsPage_grid__a1b2c` (arquivo em
// PascalCase, classe do CSS e um hash curto). O hash vem do caminho relativo ao
// projeto e da classe: é estável entre builds e igual no servidor e no navegador.
// Ver docs/GLOSSARIO.md.
import { createHash } from 'node:crypto';
import { basename, relative } from 'node:path';

/** @param {string} projectRoot */
export function readableScopedName(projectRoot) {
  /** @param {string} local @param {string} filename */
  return (local, filename) => {
    const file = filename.split('?')[0];
    const stem = basename(file).replace(/\.module\.(css|scss|sass|less)$/, '').replace(/\.(css|scss|sass|less)$/, '');
    const pascal = stem.replace(/(?:^|[-_.\s]+)([a-zA-Z0-9])/g, (_, char) => char.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '') || 'Css';
    const component = /^[0-9]/.test(pascal) ? `C${pascal}` : pascal;
    const hash = createHash('sha256').update(`${relative(projectRoot, file).split('\\').join('/')}:${local}`).digest('hex').slice(0, 5);
    return `${component}_${local}__${hash}`;
  };
}
