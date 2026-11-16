import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Configurações (pendência antiga, rodada de 16/11): todos os grupos e os blocos que abrem dentro deles usam a
// mesma seta do portal, um chevron à direita que gira ao abrir, em vez do triângulo do navegador ou do "›".
const css = readFileSync(new URL('../app/settings-groups.module.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');
const vault = readFileSync(new URL('../components/portal/credential-vault-panel.tsx', import.meta.url), 'utf8');
const client = readFileSync(new URL('../app/portal-client.tsx', import.meta.url), 'utf8');

test('settings groups and the blocks inside them share the portal chevron', () => {
  for (const rule of [
    /\.group > summary, \.group details > summary \{ list-style: none; display: grid;/,
    /\.group > summary::-webkit-details-marker, \.group details > summary::-webkit-details-marker \{ display: none; \}/,
    /\.group > summary::before, \.group details > summary::before \{ content: none;/,
    /\.group > summary::after, \.group details > summary::after \{ content: ""; grid-column: 2;[^}]*background: var\(--brand-ink\);[^}]*mask: url\("data:image\/svg\+xml,[^"]*m6 9 6 6 6-6/,
    /\.group\[open\] > summary::after, \.group details\[open\] > summary::after \{ transform: rotate\(180deg\); \}/,
    /@media \(prefers-reduced-motion: reduce\) \{ \.group > summary::after, \.group details > summary::after \{ transition: none; \} \}/,
  ]) assert.match(css, rule);
  // Os grupos são os mesmos <details> com a classe do módulo, inclusive o da central de chaves.
  assert.ok((client.match(/<details id="settings-[a-z-]+" className=\{settingsStyles\.group\}>/g) ?? []).length >= 5);
  assert.match(client, /<CredentialVaultSettings [^>]*groupClass=\{settingsStyles\.group\}/);
  assert.match(vault, /className=\{`\$\{groupClass\} \$\{styles\.anchor\}`\}/);
});
