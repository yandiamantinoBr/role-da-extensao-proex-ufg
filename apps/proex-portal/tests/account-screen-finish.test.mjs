import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Crítica visual independente de 16/11 (Conta, nota 7,4): o cartão do Google Drive encostava em "Meu perfil", a mesma tela
// tinha "Atualizar" e "Recarregar dados" para a mesma ação e a ajuda da foto ocupava quatro linhas.
const client = readFileSync(new URL('../app/portal-client.tsx', import.meta.url), 'utf8');
const profile = readFileSync(new URL('../components/portal/profile-panel.tsx', import.meta.url), 'utf8');

test('the profile card keeps the same 20px gap as the cards above it on the Conta tab', () => {
  assert.match(client, /<GoogleDriveConnectionPanel key=\{`drive-\$\{string\(user\.userId\)\}`\}\/><div className="mt-5"><ProfilePanel /);
});

test('refresh buttons on Conta use the same word, with a distinct accessible name', () => {
  assert.doesNotMatch(profile, /Recarregar dados/);
  assert.match(profile, /aria-label="Atualizar meu perfil"><RefreshCw size=\{16\} aria-hidden="true" \/>Atualizar</);
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
