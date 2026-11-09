import { HttpError } from '../errors';
import { safeBaseUrl, type CatalogModel, type CatalogProvider } from './model-catalog';

export type ChatTurn = { role: 'user' | 'assistant'; content: string; image?: string | null };
export type GenericResult = { text: string; inputTokens: number; outputTokens: number; returnedModel: string; costMicros: number };
const withheld = () => new HttpError(502, 'A resposta do provedor não pôde ser mostrada.', 'generic_provider_schema');
/** Erro depois de o provedor já ter cobrado: leva o custo conhecido para entrar no limite diário. */
export class ChargedError extends HttpError { constructor(message: string, readonly chargedMicros: number, readonly chargedTokens: number) { super(502, message, 'generic_provider_schema'); } }

export async function boundedJson(response: Response, limit = 256 * 1024): Promise<Record<string, unknown>> {
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {});
    const status = response.status;
    throw new HttpError(503, status === 401 || status === 403 ? 'O provedor recusou a chave. Confira a chave em Chaves e modelos.' : status === 404 ? 'O provedor não reconheceu o modelo. Confira o nome do modelo na API.' : status === 429 ? 'O provedor atingiu o limite de uso agora. Tente de novo em alguns minutos.' : 'O provedor não respondeu.', 'generic_provider_unavailable');
  }
  const reader = response.body?.getReader();
  if (!reader) throw withheld();
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) throw withheld(); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed as Record<string, unknown>; }
  catch { throw withheld(); }
  finally { bytes.fill(0); }
}

function dataUrlParts(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new HttpError(415, 'Imagem inválida.', 'role_image');
  return { mime: match[1], data: match[2] };
}

const tokens = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

/** Uma chamada de conversa a um modelo do catálogo. Sem nova tentativa automática. */
export async function genericChat(options: { provider: CatalogProvider; model: CatalogModel; apiKey: string; system: string; turns: ChatTurn[]; maxTokens: number; json: boolean; signal: AbortSignal; fetcher?: typeof fetch }): Promise<GenericResult> {
  const { provider, model, apiKey, system, turns, maxTokens, json, signal } = options;
  const fetcher = options.fetcher ?? fetch;
  if (!apiKey || apiKey.length < 12) throw new HttpError(503, 'Falta a chave deste provedor.', 'generic_provider_key');
  const base = safeBaseUrl(provider.baseUrl);
  let data: Record<string, unknown>;
  try {
    if (provider.kind === 'anthropic_messages') {
      const messages = turns.map(turn => ({ role: turn.role, content: turn.image ? [{ type: 'text', text: turn.content }, { type: 'image', source: { type: 'base64', media_type: dataUrlParts(turn.image).mime, data: dataUrlParts(turn.image).data } }] : turn.content }));
      data = await boundedJson(await fetcher(`${base}/v1/messages`, { method: 'POST', redirect: 'error', cache: 'no-store', signal,
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model: model.model, max_tokens: maxTokens, system, messages }) }));
    } else if (provider.kind === 'openai_chat') {
      const official = new URL(base).hostname === 'api.openai.com';
      const messages = [{ role: 'system', content: system }, ...turns.map(turn => ({ role: turn.role, content: turn.image ? [{ type: 'text', text: turn.content }, { type: 'image_url', image_url: { url: turn.image } }] : turn.content }))];
      data = await boundedJson(await fetcher(`${base}/chat/completions`, { method: 'POST', redirect: 'error', cache: 'no-store', signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model: model.model, messages, stream: false, ...(official ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens, temperature: 0.3 }), ...(json ? { response_format: { type: 'json_object' } } : {}) }) }));
    } else throw new HttpError(400, 'Este provedor não conversa por texto.', 'generic_provider_kind');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'A chamada ao modelo falhou ou demorou demais. Não houve nova tentativa automática.', 'generic_provider_unavailable');
  }
  if (JSON.stringify(data).includes(apiKey)) throw withheld();
  let text = '', inputTokens: number | null, outputTokens: number | null;
  if (provider.kind === 'anthropic_messages') {
    const content = Array.isArray(data.content) ? data.content as { type?: unknown; text?: unknown }[] : [];
    text = content.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => String(part.text)).join('\n');
    const usage = data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : {};
    inputTokens = tokens(usage.input_tokens); outputTokens = tokens(usage.output_tokens);
  } else {
    const choices = Array.isArray(data.choices) ? data.choices as { message?: { content?: unknown } }[] : [];
    text = typeof choices[0]?.message?.content === 'string' ? String(choices[0].message.content) : '';
    const usage = data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : {};
    inputTokens = tokens(usage.prompt_tokens); outputTokens = tokens(usage.completion_tokens);
  }
  if (inputTokens === null || outputTokens === null) throw withheld();
  const costMicros = Math.ceil(inputTokens * model.price.inputPerM + outputTokens * model.price.outputPerM);
  if (!text.trim() || text.length > 32000) throw new ChargedError('O modelo respondeu vazio ou longo demais. O custo foi registrado.', costMicros, inputTokens + outputTokens);
  return { text, inputTokens, outputTokens, returnedModel: typeof data.model === 'string' ? data.model.slice(0, 120) : model.model, costMicros };
}

/** Muitos modelos devolvem JSON cercado de texto; extrai o primeiro objeto. */
export function firstJsonObject(text: string): unknown {
  try { return JSON.parse(text); } catch { /* segue */ }
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no_json');
  return JSON.parse(text.slice(start, end + 1));
}
