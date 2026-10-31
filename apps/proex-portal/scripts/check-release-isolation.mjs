// Read-only production guard. No credentials, cookies, provider SDKs or writes.
const canonical = 'proex-gestao.vercel.app';
const retired = [
  'proex-gestao-k478mkttw-yannakamurabrs-projects.vercel.app',
  'proex-gestao-e450voozk-yannakamurabrs-projects.vercel.app',
];
let failures = 0;
for (const host of [canonical, ...retired]) {
  try {
    const response = await fetch(`https://${host}/api/health`, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
    const passed = host === canonical ? response.status === 200 && (await response.text()) === '{"ok":true}' : response.status === 403;
    console.log(JSON.stringify({ host, status: response.status, passed }));
    if (!passed) failures++;
  } catch { console.log(JSON.stringify({ host, passed: false, error: 'request_failed' })); failures++; }
}
if (failures) { console.error('Isolamento de releases não comprovado. Não aplique migrações de organização nem publique permissões novas.'); process.exitCode = 1; }
