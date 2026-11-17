import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Crítica visual independente de 16/11 (Conta, nota 7,4): o cartão do Google Drive encostava em "Meu perfil", a mesma tela
// tinha "Atualizar" e "Recarregar dados" para a mesma ação e a ajuda da foto ocupava quatro linhas.
const client = readFileSync(new URL('../app/portal-client.tsx', import.meta.url), 'utf8');
const profile = readFileSync(new URL('../components/portal/profile-panel.tsx', import.meta.url), 'utf8');

test('Conta opens with the profile, then access and connections, with the same 20px gap (crítica de 16/11)', () => {
  assert.match(client, /\{tab === 'profile' && <><ProfilePanel onUpdated=\{\(\) => \{ void refresh\(\); \}\}\/><div className="mt-5 grid gap-5"><AccountAccessPanel /);
});

test('Conta keeps one refresh per page: the profile card no longer has its own (crítica de 16/11)', () => {
  assert.doesNotMatch(profile, /Recarregar dados|Atualizar meu perfil/);
  assert.equal((profile.match(/onClick=\{\(\) => void refreshProfile\(\)\}/g) ?? []).length, 1, 'só a tela de erro mantém "Tentar novamente"');
});

test('the profile summary lists only filled values, the photo rules sit under the photo buttons and the name is below the page title size', () => {
  assert.doesNotMatch(profile, /'Não informada'\}|\|\| 'Não informado'\}/, 'nada de "Não informado" repetido no resumo');
  assert.match(profile, /Escolher foto<\/button>\s*<\/div>\s*<p className=\{styles\.photoHelp\}>/);
  const css = readFileSync(new URL('../components/portal/profile-panel.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.name\{font-size:clamp\(22px,2\.4vw,27px\)\}/);
  const mcp = readFileSync(new URL('../components/portal/mcp-connections-panel.tsx', import.meta.url), 'utf8');
  assert.match(mcp, /<ChevronDown size=\{18\} className=\{styles\.chevron\} aria-hidden="true"\/><\/summary>/, '"Conectar uma IA" segue o padrão da linha "Google Drive"');
});

test('the photo help is one short sentence and the iPhone tip moves to the error that needs it', () => {
  const help = /<p className=\{styles\.photoHelp\}>([^<]*)<\/p>/.exec(profile)?.[1] ?? '';
  assert.ok(help.length > 0 && help.length <= 120, `ajuda com ${help.length} caracteres`);
  assert.doesNotMatch(help, /HEIC|iPhone/);
  assert.match(profile, /O navegador não conseguiu abrir esta foto\.[^']*Mais compatível/);
});

test('choices say "Não informar" and the summary says "Não informado(a)"; the access refresh stays on the title row on phones', () => {
  assert.match(profile, /Object\.entries\(affiliations\)\.map\(\(\[value, label\]\) => <option key=\{value\} value=\{value\}>\{value \? label : 'Não informar'\}<\/option>\)\}/);
  const access = readFileSync(new URL('../components/portal/account-access-panel.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../components/portal/account-access-panel.module.css', import.meta.url), 'utf8');
  assert.match(access, /aria-label="Atualizar meus acessos"><RefreshCw size=\{16\} aria-hidden="true"\/><span className=\{styles\.refreshLabel\}>Atualizar<\/span>/);
  assert.match(css, /@container \(max-width:440px\) \{[^}]*\.header \{ align-items:flex-start; flex-wrap:nowrap; \}[\s\S]*\.refreshLabel \{ display:none; \}/);
});

test('photo buttons and rules sit in the name column, and the IA and Drive rows have dark titles (quarta crítica de 16/11)', () => {
  assert.match(profile, /<div className=\{styles\.photoRow\}>\s*<div className=\{styles\.photoActions\}>/);
  assert.doesNotMatch(profile.slice(profile.indexOf('styles.avatarColumn'), profile.indexOf('styles.heroBody')), /photoActions|photoHelp/, 'a coluna da foto fica só com a foto');
  for (const file of ['mcp-connections-panel.module.css', 'google-drive.module.css']) {
    assert.match(readFileSync(new URL(`../components/portal/${file}`, import.meta.url), 'utf8'), /\.summary strong \{ color: var\(--text-strong\); \}/, file);
  }
});
