import { HttpError } from '../errors';
import { pinnedProviderRequest } from './provider-runtime';

// Endereços já registrados no catálogo do Portal. A permissão no Worker vale para
// o endpoint exato, mesmo se alguém reutilizar o id ou a origem de um provedor.
const fixedEndpoints = new Set([
  'https://api.deepseek.com/chat/completions',
  'https://api.groq.com/openai/v1/chat/completions',
  'https://api.groq.com/openai/v1/audio/transcriptions',
  'https://api.openai.com/v1/chat/completions',
  'https://api.anthropic.com/v1/messages',
  'https://integrate.api.nvidia.com/v1/chat/completions',
  'https://api.typesafe.ai/v1/systemone',
  'https://api.perplexity.ai/v1/systemone',
  'https://console.nace.ai/v1/systemone',
  'https://artificialanalysis.ai/api/v2/language/models',
]);

export const customProviderUnavailable = 'Endereços personalizados precisam da hospedagem Node do Portal. Nesta hospedagem, escolha um provedor integrado.';

function providerUrl(endpoint: string) {
  let url: URL;
  try { url = new URL(endpoint); }
  catch { throw new HttpError(400, 'Use o endereço HTTPS público do provedor.', 'assistant_destination_blocked'); }
  const host = url.hostname.replace(/\.+$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      !host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[') ||
      /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host))
    throw new HttpError(400, 'Use o endereço HTTPS público do provedor.', 'assistant_destination_blocked');
  return url;
}

export function requireProviderEndpoint(endpoint: string, syntheticFetch?: typeof fetch) {
  const url = providerUrl(endpoint);
  if (!pinnedProviderRequest && !fixedEndpoints.has(url.href) && (!syntheticFetch || syntheticFetch === fetch))
    throw new HttpError(503, customProviderUnavailable, 'assistant_custom_destination_unavailable');
  return url;
}

/** Única saída do catálogo. O fetch injetado existe para testes de contrato sem chamadas reais. */
export async function requestProvider(endpoint: string, init: RequestInit, syntheticFetch?: typeof fetch) {
  const url = requireProviderEndpoint(endpoint, syntheticFetch);
  const options: RequestInit = { ...init, redirect: 'error', cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(15_000) };
  const response = syntheticFetch && syntheticFetch !== fetch
    ? await syntheticFetch(url.href, options)
    : await (pinnedProviderRequest ? pinnedProviderRequest(url, options) : fetch(url.href, options));
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw new HttpError(503, 'O provedor tentou redirecionar a conexão.', 'assistant_destination_redirect');
  }
  return response;
}
