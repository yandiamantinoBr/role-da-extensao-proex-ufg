/**
 * Catálogo de modelos editável pela administração geral.
 * Puro (sem banco): tipos, padrões, validação e regras de segurança de endereço.
 * Os valores padrão são só linhas iniciais; tudo pode ser editado ou apagado na tela.
 */
import { HttpError } from '../errors';

export const CAPABILITIES = ['text', 'vision', 'document', 'speech', 'decision'] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const CAPABILITY_LABELS: Record<Capability, string> = { text: 'Texto', vision: 'Foto', document: 'Documento', speech: 'Voz para texto', decision: 'Decisão' };
/** Formato da API. "openai_chat" cobre DeepSeek, Groq, NVIDIA, OpenRouter e qualquer serviço compatível com OpenAI. */
export const PROVIDER_KINDS = ['openai_chat', 'anthropic_messages', 'typesafe', 'speech', 'reference'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export const KIND_LABELS: Record<ProviderKind, string> = { openai_chat: 'Compatível com OpenAI', anthropic_messages: 'Anthropic', typesafe: 'Decisão (formato JEV)', speech: 'Voz (integração revisada)', reference: 'Referência de notas e preços' };
/** Chaves já existentes no cofre; provedores novos usam "p:<id>". */
export const VAULT_KEYS = ['deepseek', 'openai', 'typesafe', 'deepgram', 'groq'] as const;

export type CatalogProvider = {
  id: string; label: string; kind: ProviderKind; baseUrl: string; keyRef: string; builtin: boolean;
  /** Só para chaves "p:<id>": dica mascarada e situação, nunca o valor. */
  key?: { label: string; mask: string; state: 'active' | 'removed'; updatedAt: string; updatedBy: string } | null;
};
export type CatalogModel = {
  id: string; providerId: string; model: string; label: string; capabilities: Capability[];
  price: { inputPerM: number; outputPerM: number; perHour: number };
  source: { url: string; readAt: string } | null; notes: string; enabled: boolean;
  /** Grátis só para teste (ex.: NVIDIA): nunca usado pelo Rolê com dados reais; só na comparação. */
  testOnly: boolean;
  score: { value: number; source: string; readAt: string } | null;
};
export type ModelCatalog = { version: 1; providers: CatalogProvider[]; models: CatalogModel[]; updatedAt: string; updatedBy: string };

const read = '2026-11-09';
const P = (id: string, label: string, kind: ProviderKind, baseUrl: string, keyRef: string): CatalogProvider => ({ id, label, kind, baseUrl, keyRef, builtin: true, key: null });
const M = (id: string, providerId: string, model: string, label: string, capabilities: Capability[], price: Partial<CatalogModel['price']>, url: string, notes = ''): CatalogModel =>
  ({ id, providerId, model, label, capabilities, price: { inputPerM: 0, outputPerM: 0, perHour: 0, ...price }, source: { url, readAt: read }, notes, enabled: true, testOnly: providerId === 'nvidia', score: null });

export function defaultCatalog(now = new Date().toISOString()): ModelCatalog {
  return {
    version: 1, updatedAt: now, updatedBy: 'padrão',
    providers: [
      P('deepseek', 'DeepSeek', 'openai_chat', 'https://api.deepseek.com', 'deepseek'),
      P('groq', 'Groq', 'openai_chat', 'https://api.groq.com/openai/v1', 'groq'),
      P('openai', 'OpenAI', 'openai_chat', 'https://api.openai.com/v1', 'openai'),
      P('typesafe', 'TypeSafe', 'typesafe', 'https://api.typesafe.ai/v1', 'typesafe'),
      P('deepgram', 'Deepgram', 'speech', 'https://api.deepgram.com/v1', 'deepgram'),
      P('nvidia', 'NVIDIA (prototipação)', 'openai_chat', 'https://integrate.api.nvidia.com/v1', 'p:nvidia'),
      P('anthropic', 'Anthropic', 'anthropic_messages', 'https://api.anthropic.com', 'p:anthropic'),
      P('perplexity', 'Perplexity (decisão)', 'typesafe', 'https://api.perplexity.ai/v1', 'p:perplexity'),
      P('nace', 'Nace (decisão)', 'typesafe', 'https://console.nace.ai/v1', 'p:nace'),
      P('artificialanalysis', 'Artificial Analysis', 'reference', 'https://artificialanalysis.ai/api/v2', 'p:artificialanalysis'),
    ],
    models: [
      M('deepseek-flash', 'deepseek', 'deepseek-flash', 'DeepSeek Flash', ['text', 'vision', 'document'], { inputPerM: 0.3, outputPerM: 1.2 }, 'https://api-docs.deepseek.com/quick_start/pricing/', 'Padrão do Rolê. Metade do preço fora do pico.'),
      M('groq-gpt-oss-120b', 'groq', 'openai/gpt-oss-120b', 'GPT-OSS 120B (Groq)', ['text'], { inputPerM: 0.15, outputPerM: 0.6 }, 'https://console.groq.com/docs/model/openai/gpt-oss-120b', 'Mais barato, só texto.'),
      M('groq-whisper-turbo', 'groq', 'whisper-large-v3-turbo', 'Whisper turbo (Groq)', ['speech'], { perHour: 0.04 }, 'https://console.groq.com/docs/speech-to-text', 'Voz para texto. Não serve para documento.'),
      M('deepgram-nova-3', 'deepgram', 'nova-3', 'Nova-3 (Deepgram)', ['speech'], { perHour: 0.258 }, 'https://deepgram.com/pricing', 'Alternativa de voz; US$ 0,0043/min.'),
      M('typesafe-jev-1-14', 'typesafe', 'jev-1.14.0', 'JEV 1.14 (TypeSafe)', ['decision'], { inputPerM: 0.042 }, 'https://typesafe.ai', 'Decisão tipada; abstém-se quando incerto.'),
      M('openai-gpt-5-6-luna', 'openai', 'gpt-5.6-luna', 'GPT-5.6 Luna (OpenAI)', ['text', 'document'], { inputPerM: 0.25, outputPerM: 1.2 }, 'https://developers.openai.com/api/docs/pricing', 'Usado hoje nas operações (com chave OpenAI).'),
      M('openai-gpt-6-luna', 'openai', 'gpt-6-luna', 'GPT-6 Luna (OpenAI)', ['text', 'vision', 'document'], { inputPerM: 0.1, outputPerM: 0.5 }, 'https://developers.openai.com/api/docs/models/gpt-6-luna', 'Mais barato por token; segue formatos fixos à risca. Bom para tirar dados de textos.'),
      M('openai-gpt-6-1-terra', 'openai', 'gpt-6.1-terra', 'GPT-6.1 Terra (OpenAI)', ['text', 'vision', 'document'], { inputPerM: 1, outputPerM: 5 }, 'https://developers.openai.com/api/docs/models/gpt-6.1-terra', 'Mais inteligente (nota 38 no esforço médio); usar se a Luna não bastar.'),
      M('anthropic-claude-haiku-5-5', 'anthropic', 'claude-haiku-5-5', 'Claude Haiku 5.5 (Anthropic)', ['text', 'vision', 'document'], { inputPerM: 0.1, outputPerM: 0.5 }, 'https://platform.claude.com/docs/en/about-claude/pricing', 'Indicado para classificação e extração; até 100 mil tokens por pedido nesse preço.'),
      M('nvidia-deepseek-v4-1-flash', 'nvidia', 'deepseek-ai/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash (NVIDIA, teste)', ['text', 'vision'], {}, 'https://build.nvidia.com/', 'Grátis só para teste: a NVIDIA pode usar o conteúdo. Use apenas dados sintéticos.'),
      M('nvidia-nemotron-3-5-super-vl', 'nvidia', 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'Nemotron 3.5 Super VL (NVIDIA, teste)', ['text', 'vision'], {}, 'https://build.nvidia.com/', 'Grátis só para teste, com dados sintéticos.'),
      M('perplexity-decider-v1-2', 'perplexity', 'pplx-decider-v1.2', 'Decider v1.2 (Perplexity)', ['decision', 'vision'], { inputPerM: 0.02 }, 'https://artificialanalysis.ai/evaluations/artificial-analysis-decision-index', 'Nota 70 e US$ 68 por milhão de decisões (JEV: 67 e US$ 156). Testar antes de trocar.'),
      M('nace-drex-max-v1-1', 'nace', 'drex-max', 'Drex Max v1.1 (Nace)', ['decision', 'vision'], { inputPerM: 0.03 }, 'https://www.nace.ai/drex.md', 'Nota 73; preço de lançamento temporário; o mais lento.'),
    ],
  };
}

export const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/;
const bad = (message: string) => new HttpError(400, message, 'catalog_invalid');

/** Endereço de API aceito: HTTPS público, sem usuário, porta, consulta ou IP literal. Reduz SSRF. */
export function safeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200) throw bad('Informe o endereço da API (https://…).');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw bad('Endereço da API inválido.'); }
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) throw bad('Use um endereço https:// sem porta, usuário ou parâmetros.');
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[') || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host) || /^(metadata|169\.254)/.test(host)) throw bad('Use o endereço público do provedor (não IP, localhost ou rede interna).');
  return url.origin + url.pathname.replace(/\/+$/, '');
}

function text(value: unknown, max: number, message: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) throw bad(message);
  return result;
}
function price(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 1000) throw bad('Preço inválido (US$ por milhão de tokens ou por hora, de 0 a 1000).');
  return Math.round(n * 10000) / 10000;
}
/** Credenciais coladas em campos de texto livre são recusadas (nome, notas, endereço). */
export function looksLikeSecret(value: string): boolean {
  return /\b(?:sk|gsk|nvapi|sk-ant|xai|pk)[-_][A-Za-z0-9_-]{12,}|\b[A-Za-z0-9_-]{40,}\b|bearer\s+\S{12,}/i.test(value);
}

export function validateModel(input: Record<string, unknown>, providers: CatalogProvider[]): CatalogModel {
  const id = text(input.id, 48, 'Use um identificador curto (letras minúsculas, números e hífen).').toLowerCase();
  if (!ID.test(id)) throw bad('Use um identificador curto (letras minúsculas, números e hífen).');
  const providerId = String(input.providerId ?? '');
  if (!providers.some(provider => provider.id === providerId)) throw bad('Escolha um provedor cadastrado.');
  const model = text(input.model, 120, 'Informe o nome exato do modelo na API.');
  if (!MODEL_ID.test(model)) throw bad('Nome do modelo na API com caracteres inválidos.');
  const label = text(input.label, 60, 'Dê um nome curto ao modelo.');
  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 200) : '';
  const capabilities = Array.isArray(input.capabilities) ? [...new Set(input.capabilities.filter((c): c is Capability => CAPABILITIES.includes(c as Capability)))] : [];
  if (!capabilities.length) throw bad('Marque pelo menos uma capacidade.');
  const raw = input.price && typeof input.price === 'object' ? input.price as Record<string, unknown> : {};
  const sourceUrl = typeof (input.source as Record<string, unknown> | undefined)?.url === 'string' ? String((input.source as Record<string, unknown>).url).trim() : '';
  const readAt = typeof (input.source as Record<string, unknown> | undefined)?.readAt === 'string' ? String((input.source as Record<string, unknown>).readAt).trim() : '';
  if (sourceUrl && (!/^https:\/\/[^\s]{4,300}$/.test(sourceUrl))) throw bad('A fonte do preço precisa ser um link https://.');
  if (readAt && !/^\d{4}-\d{2}-\d{2}$/.test(readAt)) throw bad('Data da fonte no formato AAAA-MM-DD.');
  for (const field of [label, notes, model]) if (looksLikeSecret(field)) throw bad('Parece haver uma chave nesse campo. Cole chaves só no cofre.');
  const score = input.score && typeof input.score === 'object' ? input.score as Record<string, unknown> : null;
  const testOnly = input.testOnly === true;
  const parsedPrice = { inputPerM: price(raw.inputPerM), outputPerM: price(raw.outputPerM), perHour: price(raw.perHour) };
  const paid = capabilities.some(capability => capability === 'text' || capability === 'vision' || capability === 'document');
  if (paid && !testOnly && (parsedPrice.inputPerM <= 0 || parsedPrice.outputPerM <= 0)) throw bad('Informe o preço de entrada e de saída (maior que zero). Modelos grátis só podem ser marcados como “somente teste”.');
  return { id, providerId, model, label, capabilities, notes, enabled: input.enabled !== false, testOnly,
    price: parsedPrice,
    source: sourceUrl ? { url: sourceUrl, readAt: readAt || new Date().toISOString().slice(0, 10) } : null,
    score: score && Number.isFinite(Number(score.value)) && Number(score.value) >= 0 && Number(score.value) <= 1000 ? { value: Number(score.value), source: String(score.source ?? '').slice(0, 120), readAt: String(score.readAt ?? '').slice(0, 10) } : null };
}

export function validateProvider(input: Record<string, unknown>): CatalogProvider {
  const id = text(input.id, 48, 'Use um identificador curto (letras minúsculas, números e hífen).').toLowerCase();
  if (!ID.test(id) || (VAULT_KEYS as readonly string[]).includes(id)) throw bad('Esse identificador já é usado por um provedor do portal.');
  const kind = input.kind as ProviderKind;
  if (kind !== 'openai_chat' && kind !== 'anthropic_messages') throw bad('Por enquanto, novos provedores podem ser compatíveis com OpenAI ou Anthropic.');
  const label = text(input.label, 40, 'Dê um nome curto ao provedor.');
  if (looksLikeSecret(label)) throw bad('Parece haver uma chave nesse campo. Cole chaves só no cofre.');
  return { id, label, kind, baseUrl: safeBaseUrl(input.baseUrl), keyRef: `p:${id}`, builtin: false, key: null };
}

/** Lê o JSON salvo, aceitando só o formato conhecido; qualquer problema volta ao padrão sem quebrar a tela. */
export function parseCatalog(raw: string | null | undefined): ModelCatalog {
  if (!raw) return defaultCatalog();
  try {
    const value = JSON.parse(raw) as ModelCatalog;
    if (value?.version !== 1 || !Array.isArray(value.providers) || !Array.isArray(value.models)) return defaultCatalog();
    const providers = value.providers.filter(provider => provider && ID.test(provider.id) && PROVIDER_KINDS.includes(provider.kind));
    const models = value.models.filter(model => model && ID.test(model.id) && providers.some(provider => provider.id === model.providerId)).map(model => ({ ...model, testOnly: model.testOnly === true || model.providerId === 'nvidia' }));
    return { version: 1, providers, models, updatedAt: String(value.updatedAt ?? ''), updatedBy: String(value.updatedBy ?? '') };
  } catch { return defaultCatalog(); }
}

export function modelMicrosPerToken(model: CatalogModel) { return { input: model.price.inputPerM, output: model.price.outputPerM }; }
export function fitsFunction(model: CatalogModel, provider: CatalogProvider | undefined, need: 'chat' | 'vision'): string | null {
  if (!provider) return 'Provedor removido.';
  if (provider.kind !== 'openai_chat' && provider.kind !== 'anthropic_messages') return 'Esse provedor não conversa por texto.';
  if (model.testOnly) return 'Modelo só para teste: não pode receber conversas reais.';
  if (!model.capabilities.includes('text')) return 'Este modelo não está marcado para texto.';
  if (need === 'vision' && !model.capabilities.includes('vision')) return 'Este modelo não está marcado para foto.';
  return null;
}

/** Tarefas que podem trocar o padrão fixo por um modelo do catálogo. */
export type RoutedTask = 'document' | 'decision' | 'speech';
/** Endereço revisado do Deepgram; outro provedor do tipo "voz" ainda não tem formato de envio conferido. */
const REVIEWED_SPEECH_BASE = 'https://api.deepgram.com/v1';
/**
 * Diz se o modelo serve para a tarefa: devolve null ou o motivo, em português simples.
 * Documento: conversa por texto (OpenAI ou Anthropic). Decisão: só o formato JEV. Voz: Deepgram nova-3
 * revisado ou serviço compatível com OpenAI (<endereço>/audio/transcriptions).
 */
export function fitsTask(model: CatalogModel, provider: CatalogProvider | undefined, task: RoutedTask): string | null {
  if (!provider) return 'Provedor removido.';
  if (model.testOnly) return 'Modelo só para teste: não pode receber dados reais.';
  if (task === 'document') {
    if (provider.kind !== 'openai_chat' && provider.kind !== 'anthropic_messages') return 'Esse provedor não lê documentos por texto.';
    if (!model.capabilities.includes('document')) return 'Este modelo não está marcado para documento.';
    if (!(model.price.inputPerM > 0) || !(model.price.outputPerM > 0)) return 'Falta o preço de entrada e de saída deste modelo.';
    return null;
  }
  if (task === 'decision') {
    if (provider.kind !== 'typesafe') return 'Esse provedor não usa o formato de decisão (JEV).';
    if (!model.capabilities.includes('decision')) return 'Este modelo não está marcado para decisão.';
    if (!(model.price.inputPerM > 0)) return 'Falta o preço de entrada deste modelo.';
    return null;
  }
  if (!model.capabilities.includes('speech')) return 'Este modelo não está marcado para voz.';
  if (!(model.price.perHour > 0)) return 'Falta o preço por hora deste modelo.';
  if (provider.kind === 'openai_chat') return null;
  let base = '';
  try { base = safeBaseUrl(provider.baseUrl); } catch { /* endereço inválido não serve */ }
  if (provider.kind === 'speech' && base === REVIEWED_SPEECH_BASE && model.model === 'nova-3') return null;
  return 'Esse provedor de voz ainda não tem formato de envio revisado.';
}
/**
 * Modelos que a administração pode escolher para a tarefa: ligados e aprovados pela mesma regra que o
 * servidor aplica ao salvar e ao usar (fitsTask). `hasKey` diz se o provedor já tem chave salva.
 */
export function taskModelOptions(catalog: { providers: (CatalogProvider & { hasKey?: boolean })[]; models: CatalogModel[] }, task: RoutedTask): { id: string; label: string; hasKey: boolean }[] {
  return catalog.models.flatMap(model => {
    const provider = catalog.providers.find(entry => entry.id === model.providerId);
    return model.enabled && provider && !fitsTask(model, provider, task) ? [{ id: model.id, label: model.label, hasKey: Boolean(provider.hasKey) }] : [];
  });
}

export const COMPARE_SYSTEM = 'Você ajuda a equipe da Pró-Reitoria de Extensão da UFG. Responda em português do Brasil, de forma curta e direta. Se a pergunta pedir JSON, responda só com JSON válido.';
export const COMPARE_MAX_OUTPUT = 600;

/** Teto por modelo: cada byte enviado conta como um token, mais a saída máxima. */
export function compareEstimate(models: Pick<CatalogModel, 'price'>[], prompt: string) {
  const input = new TextEncoder().encode(prompt).byteLength + new TextEncoder().encode(COMPARE_SYSTEM).byteLength + 64;
  const each = models.map(model => Math.ceil(input * model.price.inputPerM + COMPARE_MAX_OUTPUT * model.price.outputPerM));
  return { each, total: each.reduce((sum, value) => sum + value, 0), tokens: models.length * (input + COMPARE_MAX_OUTPUT) };
}

