/**
 * Roteamento por tarefa: a administração geral pode mandar documento, conferência/triagem e voz
 * para um modelo do catálogo. Chave vazia ('') = padrão de hoje, sem nenhuma leitura a mais.
 *
 * Regra para nunca cobrar duas vezes: só se cai no padrão quando é certo que o modelo escolhido
 * não cobrou, isto é, antes do envio (sem chave, desligado, removido, não serve) ou quando o
 * provedor respondeu com status de erro (RefusedError). Prazo, rede e formato ruim sobem como erro.
 */
import { PROVIDERS, textModel, type AssistantConfig, type TaskModelKey } from './contracts';
import { RefusedError } from './generic-provider';
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
