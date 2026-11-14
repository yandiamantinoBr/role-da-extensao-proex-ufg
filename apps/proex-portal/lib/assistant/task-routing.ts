/**
 * Roteamento por tarefa: a administração geral pode mandar documento, conferência/triagem e voz
 * para um modelo do catálogo. Chave vazia ('') = padrão de hoje, sem nenhuma leitura a mais.
 *
 * O padrão só é usado antes de um envio ao modelo do catálogo. Um intermediário pode
 * devolver um erro HTTP depois do encaminhamento. Qualquer falha posterior encerra o pedido.
 */
import { all } from '../database';
import { HttpError } from '../errors';
import { PROVIDERS, textModel, type AssistantConfig, type TaskModelKey } from './contracts';
import { firstJsonObject, genericChat, requireConversationEndpoint } from './generic-provider';
import { digest } from './crypto';
import { requireProviderEndpoint } from './provider-transport';
import { aiReservation } from './admission';
import { catalogModelName, fitsTask, isTaskDefault, safeBaseUrl, type CatalogModel, type CatalogProvider, type RoutedTask } from './model-catalog';
import { catalogSettingName, loadCatalog } from './model-catalog-store';
import { taskRouteLabel, type SpeechRouteModel } from './role-contracts';

export const TASK_MODEL_KEY: Record<RoutedTask, TaskModelKey> = { document: 'documentModel', decision: 'decisionModel', speech: 'speechModel' };
export const TASK_LABEL: Record<RoutedTask, string> = { document: 'documentos', decision: 'conferência e triagem', speech: 'voz' };
/** Destino resolvido: provedor e modelo do catálogo, endereço já validado e a chave do cofre. */
export type TaskRoute = { provider: CatalogProvider; model: CatalogModel; baseUrl: string; apiKey: string; catalogRaw: string | null };
export type TaskRouteSkip = { skip: string };
/** null = sem roteamento (chave vazia ou o escolhido é o próprio padrão). */
export type ResolvedTaskRoute = TaskRoute | TaskRouteSkip | null;
export type DefaultSpeech = 'deepgram' | 'groq';

/** Match what was shown, even when two entries have identical display names. Never include credentials. */
export async function taskApproval(organizationId: string, revision: number, purpose: 'operation' | 'triage' | 'document' | 'speech', routes: readonly ResolvedTaskRoute[]) {
  const destinations = routes.map(route => route && !('skip' in route) ? [
    route.provider.id, route.provider.kind, route.baseUrl, route.provider.keyRef, route.provider.label,
    route.model.id, route.model.model, route.model.label, route.model.price.inputPerM, route.model.price.outputPerM, route.model.price.perHour,
  ] : null);
  return digest(JSON.stringify(['proex-task-route/v1', organizationId, revision, purpose, destinations]));
}

export const hasTaskRoute = (route: ResolvedTaskRoute): route is TaskRoute => Boolean(route && !('skip' in route));

/** Run in the reservation transaction and again immediately before dispatch. */
export function taskRouteGuards(db: D1Database, organizationId: string, routes: readonly ResolvedTaskRoute[]) {
  const snapshots = new Set(routes.filter(hasTaskRoute).map(route => route.catalogRaw));
  return [...snapshots].map(raw => db.prepare(
    "SELECT CASE WHEN (SELECT value FROM settings WHERE name=?) IS ? THEN 1 ELSE json_extract('[]','task_route_changed') END",
  ).bind(catalogSettingName(organizationId), raw));
}

/** Same rule as settings.validProviderKey (kept local to avoid an import cycle). */
const validProviderKey = (value: unknown): value is string => typeof value === 'string' && value.length >= 12 && value.length <= 512 && !/\s|[\u0000-\u001f]/u.test(value);

/** O modelo escolhido aponta para o mesmo destino do padrão? Então vale o caminho de hoje, sem rota. (Regra em model-catalog.isTaskDefault, a mesma dos seletores.) */
function sameAsDefault(config: AssistantConfig, provider: CatalogProvider, model: CatalogModel, baseUrl: string, task: RoutedTask, defaultSpeech?: DefaultSpeech) {
  return isTaskDefault(provider, model, baseUrl, task, { textKeyRef: config.textProvider, textModel: textModel(config).model, decisionEndpoint: PROVIDERS.typesafe.endpoint, decisionModel: config.jevModel, speech: defaultSpeech });
}

/**
 * Resolve o modelo escolhido para a tarefa. Devolve a rota, `{skip: motivo}` quando o escolhido não pode
 * receber o pedido (cai no padrão, sem envio) ou null quando não há roteamento. Nunca grava nada:
 * a auditoria da queda é feita por recordRouteFallback no momento em que o padrão é de fato usado.
 */
export async function resolveTaskRoute(db: D1Database, organizationId: string, config: AssistantConfig, rawCredentials: Record<string, unknown>, task: RoutedTask, defaultSpeech?: DefaultSpeech): Promise<ResolvedTaskRoute> {
  const chosen = config[TASK_MODEL_KEY[task]];
  if (!chosen) return null;
  const { catalog, raw } = await loadCatalog(db, organizationId);
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
  return { provider, model, baseUrl, apiKey, catalogRaw: raw };
}

/** Endereço do formato JEV no provedor escolhido (mesmo caminho do TypeSafe). */
export function decisionEndpoint(route: TaskRoute) { return `${route.baseUrl}/systemone`; }
export function speechTaskEndpoint(route: TaskRoute) {
  return route.baseUrl + '/audio/transcriptions';
}

export function requireTaskEndpoint(route: ResolvedTaskRoute, task: RoutedTask, syntheticFetch?: typeof fetch) {
  if (!hasTaskRoute(route)) return;
  if (task === 'document') requireConversationEndpoint(route.provider, syntheticFetch);
  else if (task === 'decision') requireProviderEndpoint(decisionEndpoint(route), syntheticFetch);
  else if (speechRouteStyle(route) === 'groq') requireProviderEndpoint(speechTaskEndpoint(route), syntheticFetch);
}

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
export const DOCUMENT_AI_BODY_LIMIT = 24000;
export const documentPrices = (config: AssistantConfig, document: ResolvedTaskRoute, decision: ResolvedTaskRoute) => ({ ...documentCeiling(config, document), ...decisionCeiling(decision) });
export const documentMaximum = (config: AssistantConfig, document: ResolvedTaskRoute, decision: ResolvedTaskRoute) => aiReservation(config, DOCUMENT_AI_BODY_LIMIT, documentPrices(config, document, decision)).cost;
/**
 * Leitura de documento no modelo escolhido: mesma instrução e mesmo texto do padrão, uma chamada só,
 * com temperatura 0 onde o portal envia temperatura (extração de campos não deve variar entre pedidos).
 * Qualquer erro do provedor encerra o pedido antes de uma segunda transmissão.
 */
export async function routedDocumentProposal(route: TaskRoute, messages: { role: string; content: string }[], maxTokens: number, signal: AbortSignal, fetcher?: typeof fetch) {
  const system = messages.find(message => message.role === 'system')?.content ?? '', user = messages.find(message => message.role === 'user')?.content ?? '';
  const answer = await genericChat({ provider: route.provider, model: route.model, apiKey: route.apiKey, system, turns: [{ role: 'user', content: user }], maxTokens, json: true, signal, fetcher, temperature: 0 });
  if (answer.outputTokens > maxTokens) throw new HttpError(502, 'O provedor não confirmou o uso de tokens.', 'assistant_usage');
  let proposal: unknown;
  try { proposal = firstJsonObject(answer.text); } catch { throw new HttpError(502, 'A IA não produziu uma proposta JSON válida.', 'assistant_provider_schema'); }
  return { proposal, returnedModel: answer.returnedModel, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens };
}
/** Destino de voz que o consentimento precisa nomear: `catalog:<id>` com rota ativa; senão o provedor padrão. */
export function speechDestination(resolved: ResolvedTaskRoute, provider: DefaultSpeech): string { return resolved && !('skip' in resolved) ? `catalog:${resolved.model.id}` : provider; }
/** Formato de envio do destino de voz: provedor de voz revisado (Deepgram) ou formulário de áudio compatível com OpenAI. */
export function speechRouteStyle(route: TaskRoute): 'groq' | 'deepgram' { return route.provider.kind === 'speech' ? 'deepgram' : 'groq'; }
/**
 * O que a tela mostra do modelo de voz escolhido antes de a pessoa autorizar: nome do modelo e do serviço no
 * catálogo, preço por hora e formato de envio. Só com rota válida; nunca chave nem endereço.
 */
export function speechRouteModel(resolved: ResolvedTaskRoute): SpeechRouteModel | null {
  return resolved && !('skip' in resolved) ? { label: resolved.model.label, service: resolved.provider.label, perHour: resolved.model.price.perHour, style: speechRouteStyle(resolved) } : null;
}
/**
 * Nome que avisos e autorizações mostram para o modelo escolhido de uma tarefa: o modelo e, se o nome dele
 * ainda não disser, o serviço. Só com rota válida; nunca chave nem endereço.
 */
export function taskRouteName(resolved: ResolvedTaskRoute): string | null {
  return resolved && !('skip' in resolved) ? taskRouteLabel({ label: resolved.model.label, service: resolved.provider.label }) : null;
}
const brasiliaDay = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);

/**
 * Registra que a tarefa seguiu pelo padrão em vez do modelo escolhido. Só tarefa, id e nome do modelo no
 * catálogo e motivo: nunca chave, endereço com segredo ou conteúdo do pedido.
 * No máximo um registro por organização, tarefa, modelo e motivo por dia (dia de Brasília): um modelo sem
 * chave não enche o histórico a cada pedido.
 */
export async function recordRouteFallback(db: D1Database, organizationId: string, actorId: string, task: RoutedTask, modelId: string, reason: string) {
  const model = modelId.slice(0, 60), why = reason.slice(0, 200), now = new Date(), today = brasiliaDay(now);
  const recent = await all(db, "SELECT created_at FROM audit WHERE action='assistant.route.fallback' AND organization_id=? AND created_at>=? AND json_extract(details,'$.task')=? AND json_extract(details,'$.model')=? AND json_extract(details,'$.reason')=?",
    [organizationId, new Date(now.getTime() - 26 * 3600000).toISOString(), task, model, why]);
  if (recent.some(row => brasiliaDay(new Date(String(row.created_at))) === today)) return;
  // O nome é só para o histórico; se o catálogo não puder ser lido, o registro sai com o id.
  let name: string | null = null;
  try { name = catalogModelName((await loadCatalog(db, organizationId)).catalog, modelId); } catch { /* segue sem nome */ }
  await db.prepare("INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,NULL,?,'assistant.route.fallback',?,?,?)")
    .bind(crypto.randomUUID(), actorId, organizationId, organizationId, JSON.stringify({ task, model, ...(name ? { name: name.slice(0, 120) } : {}), reason: why }), now.toISOString()).run();
}

/**
 * Usa o padrão apenas quando o escolhido não recebeu o pedido. `onFallback` registra a
 * indisponibilidade e confere as permissões. `route` diz quem respondeu (null = padrão).
 */
export async function withTaskRoute<T>(resolved: ResolvedTaskRoute, options: { chosen: (route: TaskRoute) => Promise<T>; fallback: () => Promise<T>; onFallback: (reason: string) => Promise<void> }): Promise<{ result: T; route: TaskRoute | null }> {
  if (!resolved) return { result: await options.fallback(), route: null };
  if ('skip' in resolved) { await options.onFallback(resolved.skip); return { result: await options.fallback(), route: null }; }
  return { result: await options.chosen(resolved), route: resolved };
}
