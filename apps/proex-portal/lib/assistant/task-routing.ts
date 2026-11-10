/**
 * Roteamento por tarefa: a administração geral pode mandar documento, conferência/triagem e voz
 * para um modelo do catálogo. Chave vazia ('') = padrão de hoje, sem nenhuma leitura a mais.
 *
 * Regra para nunca cobrar duas vezes: só se cai no padrão quando é certo que o modelo escolhido
 * não cobrou, isto é, antes do envio (sem chave, desligado, removido, não serve) ou quando o
 * provedor respondeu com status de erro (RefusedError). Prazo, rede e formato ruim sobem como erro.
 */
import { HttpError } from '../errors';
import { PROVIDERS, textModel, type AssistantConfig, type TaskModelKey } from './contracts';
import { firstJsonObject, genericChat, RefusedError } from './generic-provider';
import { fitsTask, safeBaseUrl, type CatalogModel, type CatalogProvider, type RoutedTask } from './model-catalog';
import { loadCatalog } from './model-catalog-store';

export const TASK_MODEL_KEY: Record<RoutedTask, TaskModelKey> = { document: 'documentModel', decision: 'decisionModel', speech: 'speechModel' };
export const TASK_LABEL: Record<RoutedTask, string> = { document: 'documentos', decision: 'conferência e triagem', speech: 'voz' };
/** Destino resolvido: provedor e modelo do catálogo, endereço já validado e a chave do cofre. */
export type TaskRoute = { provider: CatalogProvider; model: CatalogModel; baseUrl: string; apiKey: string };
export type TaskRouteSkip = { skip: string };
/** null = sem roteamento (chave vazia ou o escolhido é o próprio padrão). */
export type ResolvedTaskRoute = TaskRoute | TaskRouteSkip | null;
export type DefaultSpeech = 'deepgram' | 'groq';

/** Same rule as settings.validProviderKey (kept local to avoid an import cycle). */
const validProviderKey = (value: unknown): value is string => typeof value === 'string' && value.length >= 12 && value.length <= 512 && !/\s|[\u0000-\u001f]/u.test(value);
const GROQ_BASE = 'https://api.groq.com/openai/v1', GROQ_SPEECH_MODEL = 'whisper-large-v3-turbo';

/** O modelo escolhido aponta para o mesmo destino do padrão? Então vale o caminho de hoje, sem rota. */
function sameAsDefault(config: AssistantConfig, provider: CatalogProvider, model: CatalogModel, baseUrl: string, task: RoutedTask, defaultSpeech?: DefaultSpeech) {
  if (task === 'document') return provider.keyRef === config.textProvider && model.model === textModel(config).model;
  if (task === 'decision') return provider.keyRef === 'typesafe' && `${baseUrl}/systemone` === PROVIDERS.typesafe.endpoint && model.model === config.jevModel;
  if (defaultSpeech === 'groq') return provider.keyRef === 'groq' && baseUrl === GROQ_BASE && model.model === GROQ_SPEECH_MODEL;
  return defaultSpeech === 'deepgram' && provider.kind === 'speech' && provider.keyRef === 'deepgram';
}

/**
 * Resolve o modelo escolhido para a tarefa. Devolve a rota, `{skip: motivo}` quando o escolhido não pode
 * receber o pedido (cai no padrão, sem envio) ou null quando não há roteamento. Nunca grava nada:
 * a auditoria da queda é feita por recordRouteFallback no momento em que o padrão é de fato usado.
 */
export async function resolveTaskRoute(db: D1Database, organizationId: string, config: AssistantConfig, rawCredentials: Record<string, unknown>, task: RoutedTask, defaultSpeech?: DefaultSpeech): Promise<ResolvedTaskRoute> {
  const chosen = config[TASK_MODEL_KEY[task]];
  if (!chosen) return null;
  const { catalog } = await loadCatalog(db, organizationId);
  const model = catalog.models.find(entry => entry.id === chosen && entry.enabled);
  if (!model) return { skip: 'Modelo removido ou desligado no catálogo.' };
  const provider = catalog.providers.find(entry => entry.id === model.providerId);
  const unfit = fitsTask(model, provider, task);
  if (unfit || !provider) return { skip: unfit ?? 'Provedor removido.' };
  let baseUrl: string;
  try { baseUrl = safeBaseUrl(provider.baseUrl); } catch { return { skip: 'Endereço do provedor inválido.' }; }
  if (sameAsDefault(config, provider, model, baseUrl, task, defaultSpeech)) return null;
  const apiKey = rawCredentials[provider.keyRef];
  if (!validProviderKey(apiKey)) return { skip: 'Falta a chave do provedor deste modelo.' };
  return { provider, model, baseUrl, apiKey };
}

/** Endereço do formato JEV no provedor escolhido (mesmo caminho do TypeSafe). */
export function decisionEndpoint(route: TaskRoute) { return `${route.baseUrl}/systemone`; }
/** Destino JEV no formato que checkDecision e classifyTaskTriage recebem. */
export function decisionTarget(route: TaskRoute) { return { endpoint: decisionEndpoint(route), apiKey: route.apiKey, model: route.model.model }; }
/**
 * Preço para reservar a conferência quando há rota: o maior entre o escolhido e o padrão, porque o pedido
 * pode terminar em qualquer um dos dois. Sem rota devolve undefined (valem os números do padrão).
 */
export function decisionCeiling(resolved: ResolvedTaskRoute) {
  return resolved && !('skip' in resolved) ? { decisionInputMicrosPerToken: Math.max(PROVIDERS.typesafe.inputMicrosPerToken, resolved.model.price.inputPerM) } : undefined;
}
/** Preço para o acerto: o do modelo do catálogo que de fato respondeu. null = respondeu o padrão. */
export function decisionSettled(route: TaskRoute | null) { return route ? { decisionInputMicrosPerToken: route.model.price.inputPerM } : undefined; }
/** Preço para reservar a leitura de documento com rota: o maior, entrada e saída, entre o escolhido e o padrão. */
export function documentCeiling(config: AssistantConfig, resolved: ResolvedTaskRoute) {
  if (!resolved || 'skip' in resolved) return undefined;
  const standard = textModel(config), price = resolved.model.price;
  return { text: { inputMicrosPerToken: Math.max(standard.inputMicrosPerToken, price.inputPerM), outputMicrosPerToken: Math.max(standard.outputMicrosPerToken, price.outputPerM) } };
}
/**
 * Leitura de documento no modelo escolhido: mesma instrução e mesmo texto do padrão, uma chamada só.
 * Recusa do provedor sai como RefusedError (permite o padrão); prazo, rede e formato ruim sobem como erro.
 */
export async function routedDocumentProposal(route: TaskRoute, messages: { role: string; content: string }[], maxTokens: number, signal: AbortSignal, fetcher?: typeof fetch) {
  const system = messages.find(message => message.role === 'system')?.content ?? '', user = messages.find(message => message.role === 'user')?.content ?? '';
  const answer = await genericChat({ provider: route.provider, model: route.model, apiKey: route.apiKey, system, turns: [{ role: 'user', content: user }], maxTokens, json: true, signal, fetcher });
  if (answer.outputTokens > maxTokens) throw new HttpError(502, 'O provedor não confirmou o uso de tokens.', 'assistant_usage');
  let proposal: unknown;
  try { proposal = firstJsonObject(answer.text); } catch { throw new HttpError(502, 'A IA não produziu uma proposta JSON válida.', 'assistant_provider_schema'); }
  return { proposal, returnedModel: answer.returnedModel, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens };
}
/** Destino de voz que o consentimento precisa nomear: `catalog:<id>` com rota ativa; senão o provedor padrão. */
export function speechDestination(resolved: ResolvedTaskRoute, provider: DefaultSpeech): string { return resolved && !('skip' in resolved) ? `catalog:${resolved.model.id}` : provider; }
export function refusalReason(error: RefusedError) { return `O provedor recusou o pedido (HTTP ${error.providerStatus}).`; }

/**
 * Registra que a tarefa seguiu pelo padrão em vez do modelo escolhido. Só tarefa, id do modelo no
 * catálogo e motivo: nunca chave, endereço com segredo ou conteúdo do pedido.
 */
export async function recordRouteFallback(db: D1Database, organizationId: string, actorId: string, task: RoutedTask, modelId: string, reason: string) {
  await db.prepare("INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,NULL,?,'assistant.route.fallback',?,?,?)")
    .bind(crypto.randomUUID(), actorId, organizationId, organizationId, JSON.stringify({ task, model: modelId.slice(0, 60), reason: reason.slice(0, 200) }), new Date().toISOString()).run();
}

/**
 * Executa a tarefa no modelo escolhido e cai no padrão só nos dois casos seguros: rota pulada antes do
 * envio ou recusa do provedor (RefusedError). `onFallback` grava a auditoria e refaz as cercas antes do
 * padrão. Qualquer outro erro sobe sem segunda chamada. `route` diz quem respondeu (null = padrão).
 */
export async function withTaskRoute<T>(resolved: ResolvedTaskRoute, options: { chosen: (route: TaskRoute) => Promise<T>; fallback: () => Promise<T>; onFallback: (reason: string) => Promise<void> }): Promise<{ result: T; route: TaskRoute | null }> {
  if (!resolved) return { result: await options.fallback(), route: null };
  if ('skip' in resolved) { await options.onFallback(resolved.skip); return { result: await options.fallback(), route: null }; }
  try { return { result: await options.chosen(resolved), route: resolved }; }
  catch (error) {
    if (!(error instanceof RefusedError)) throw error;
    await options.onFallback(refusalReason(error));
    return { result: await options.fallback(), route: null };
  }
}
