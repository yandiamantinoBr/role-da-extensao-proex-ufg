import { Resolver } from 'node:dns/promises';
import { Agent, request } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import ipaddr from 'ipaddr.js';
import { HttpError } from '../lib/errors';

const globalUnicastV6 = ipaddr.IPv6.parse('2000::');
const directAgent = new Agent({ keepAlive: false, maxCachedSessions: 0 });

function blockedAddress() {
  return new HttpError(503, 'O endereço do provedor não está disponível em uma rede pública.', 'assistant_destination_blocked');
}

function isPublicAddress(address: string) {
  if (!isIP(address) || address.includes('%')) return false;
  const ip = ipaddr.parse(address);
  if (ip.range() !== 'unicast') return false;
  return !(ip instanceof ipaddr.IPv6) || ip.match(globalUnicastV6, 3);
}

async function resolvePublicHostname(hostname: string, signal: AbortSignal) {
  const resolver = new Resolver({ tries: 1 });
  const noRecords = (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENODATA' || error.code === 'ENOTFOUND') return [];
    throw error;
  };
  const cancel = () => resolver.cancel();
  signal.throwIfAborted();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const name = hostname.endsWith('.') ? hostname : hostname + '.';
    const [ipv4, ipv6] = await Promise.all([resolver.resolve4(name).catch(noRecords), resolver.resolve6(name).catch(noRecords)]);
    return [...ipv4, ...ipv6];
  } finally {
    cancel();
    signal.removeEventListener('abort', cancel);
  }
}

/** Recebe somente o IP selecionado, sem recorrer ao resolvedor nem ao proxy global do Node. */
async function sendPinnedRequest(url: URL, address: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  const incoming = new Request(url, init);
  const body = incoming.body ? Buffer.from(await incoming.arrayBuffer()) : undefined;
  incoming.headers.set('host', url.hostname);
  incoming.headers.set('accept-encoding', 'identity');
  if (body) incoming.headers.set('content-length', String(body.length));
  signal.throwIfAborted();
  return new Promise<Response>((resolve, reject) => {
    const outgoing = request({
      hostname: address, port: 443, servername: url.hostname, rejectUnauthorized: true, agent: directAgent,
      path: url.pathname + url.search, method: incoming.method, headers: Object.fromEntries(incoming.headers), signal,
    }, response => {
      const status = response.statusCode ?? 502;
      const headers = new Headers();
      try {
        for (const [key, values] of Object.entries(response.headers)) {
          for (const value of Array.isArray(values) ? values : values === undefined ? [] : [values]) headers.append(key, value);
        }
        const hasBody = incoming.method !== 'HEAD' && status !== 204 && status !== 205 && status !== 304;
        if (!hasBody) response.resume();
        resolve(new Response(hasBody ? Readable.toWeb(response, { strategy: { highWaterMark: 16 * 1024, size: chunk => chunk.byteLength } }) as ReadableStream<Uint8Array> : null, { status, headers }));
      } catch (error) {
        response.destroy();
        reject(error);
      }
    });
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}

export function createPinnedProviderRequest(resolveAddresses = resolvePublicHostname, send = sendPinnedRequest) {
  return async (url: URL, init: RequestInit) => {
    const signal = init.signal ?? AbortSignal.timeout(15_000);
    const addresses = await resolveAddresses(url.hostname, signal);
    signal.throwIfAborted();
    if (addresses.length === 0 || addresses.some(address => !isPublicAddress(address))) throw blockedAddress();
    // Nunca troca de IP após falha. A cota e o consentimento contam um único envio.
    return send(url, addresses[0], init, signal);
  };
}

export const pinnedProviderRequest = createPinnedProviderRequest();
