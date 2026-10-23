// Função única da Vercel: sobe o servidor de produção do vinext dentro da instância
// (porta efêmera em 127.0.0.1) e encaminha cada requisição para ele, preservando
// método, corpo, cabeçalhos e cookies. Arquivos estáticos (dist/client) são servidos
// pela própria CDN da Vercel antes de chegar aqui (veja vercel.json).
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Dependências que o bundle do servidor mantém externas (dist/server/vinext-externals.json).
// Importá-las aqui faz o rastreador da Vercel incluí-las na função.
import 'react';
import 'react/jsx-runtime';
import 'react-dom';
import 'react-dom/server.edge';
import 'ipaddr.js';

// A Vercel informa o protocolo e o host públicos; o portal compara Origin com eles.
process.env.VINEXT_TRUST_PROXY ??= '1';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let upstream;
function start() {
  upstream ??= import('vinext/server/prod-server')
    .then(({ startProdServer }) => startProdServer({ port: 0, host: '127.0.0.1', outDir: path.join(root, 'dist'), noCompression: true, silent: true }))
    .then(({ port }) => port)
    .catch(error => { upstream = undefined; throw error; });
  return upstream;
}

export default async function handler(req, res) {
  let port;
  try { port = await start(); } catch (error) {
    console.error('Portal indisponível:', error);
    res.statusCode = 503; res.end('Portal temporariamente indisponível.'); return;
  }
  // vercel.json reescreve "/<caminho>" para "/api/index?__path=/<caminho>".
  const url = new URL(req.url ?? '/', 'http://portal.local');
  const original = url.searchParams.get('__path');
  if (original !== null) { url.searchParams.delete('__path'); url.pathname = original; }
  const headers = { ...req.headers, 'x-forwarded-proto': req.headers['x-forwarded-proto'] ?? 'https' };
  const proxy = http.request({ host: '127.0.0.1', port, method: req.method, path: url.pathname + url.search, headers }, upstreamResponse => {
    res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  proxy.on('error', error => {
    console.error('Falha ao encaminhar requisição:', error);
    if (!res.headersSent) { res.statusCode = 502; res.end('Falha temporária. Tente novamente.'); } else res.destroy();
  });
  req.pipe(proxy);
}
