export function localHarnessUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('O harness exige um portal local descartável em HTTP.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('O harness só pode executar em um portal local descartável; produção e servidores remotos são proibidos.');
  }
  return url;
}
