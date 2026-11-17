import { getActor, projectAuthoritySql, requireCapability, requireLiveCapability, type PortalActor } from '../access';
import { all, one } from '../database';
import { HttpError } from '../errors';
import { rateLimitAll } from '../rate-limit';
import { reservationStatements } from './admission';
import { quotaRefusal, responsibleName } from './quota';
import { onlyKeys, safeRequest, type AssistantConfig, type AssistantCredentials } from './contracts';
import { digest, type CredentialKeys } from './crypto';
import {
  ROLE_CONTRACT, ROLE_MAX_HISTORY, ROLE_MAX_HISTORY_CHARS, ROLE_MAX_IMAGE_BYTES, ROLE_MAX_IMAGE_SIDE, ROLE_MAX_MESSAGE_CHARS, ROLE_IMAGE_TOKEN_CEILING, ROLE_SYSTEM_PROMPT_BYTES, ROLE_MODELS,
  ROLE_SYSTEM_PROMPT, ROLE_SYSTEM_PROMPT_TOOLS, ROLE_TOOL_CALLS_PER_ROUND, ROLE_TOOL_RESULT_BYTES, ROLE_TOOL_ROUNDS, roleConversationBytes, roleEstimate, roleTimeoutMs, validateRoleReply, type RoleSource, type RoleTurn,
} from './role-contracts';
import { ROLE_TOOL_NAMES, ROLE_TOOLS, officialSearchReply, resolveRoleScope, roleScopes, runRoleTool, type RoleToolResult } from './role-tools';
import { ROLE_SUGGESTION_DAYS, roleSuggestions } from './role-suggestions';
import { ROLE_VIDEO_MODELS, roleVideoEstimate, type RoleVideoProfile, type RoleVideoStatus } from './role-video-contracts';
import { dispatchRoleVideo, parseRoleVideo, RoleVideoChargedError } from './role-video';
import { isOfficialSearch } from './official-search-intent';
import { GIFT_SHEET_REPLY, asksGiftSheet } from './gift-sheet-intent';
import { roleDocumentExcerpt, roleDocumentMessage } from './role-document-contracts';
import { roleHistoryForPolicy, roleReasoningParameters, roleReasoningSupport, type RolePolicy, type RoleEffort } from './role-policy';
import { containsCredential } from './sensitive';
import { ChargedError, firstJsonObject, genericChat, requireConversationEndpoint } from './generic-provider';
import { fitsFunction, geminiVideoCredential, type CatalogModel, type CatalogProvider, type ModelCatalog } from './model-catalog';
import { loadCatalog } from './model-catalog-store';
import { catalogPricing, type RolePricing, type SpeechRouteModel } from './role-contracts';
import { assistantUsageSql, loadAssistantSettings, speechProviderForOrganization, validProviderKey, type SpeechEnvironment } from './settings';
import { resolveTaskRoute, speechDestination, speechRouteModel, taskApproval, taskRouteName } from './task-routing';

type Options = { fetcher?: typeof fetch; officialFetcher?: typeof fetch; now?: number; keys?: CredentialKeys; signal?: AbortSignal; speech?: SpeechEnvironment };
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const IMAGE_TYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/webp': [0x52, 0x49, 0x46, 0x46] } as const;

/** Largura e altura lidas do cabeçalho real; null quando o arquivo não tem estrutura conhecida. */
export function imageSize(mime: keyof typeof IMAGE_TYPES, bytes: Uint8Array): { width: number; height: number } | null {
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1], u16le = (i: number) => bytes[i] | (bytes[i + 1] << 8), u24le = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  const u32 = (i: number) => ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n));
  if (mime === 'image/png') return bytes.length > 24 && ascii(12, 4) === 'IHDR' ? { width: u32(16), height: u32(20) } : null;
  if (mime === 'image/webp') {
    if (bytes.length < 30 || ascii(8, 4) !== 'WEBP') return null;
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (chunk === 'VP8L') { const b = bytes.subarray(21, 25); return { width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) }; }
    if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    return null;
  }
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16(i + 7), height: u16(i + 5) };
    i += 2 + u16(i + 2);
  }
  return null;
}

function dayKey(now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

function projectId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new HttpError(400, 'Escolha um projeto para conversar com o Rolê.', 'role_project');
  return value;
}

type PortalTools = typeof ROLE_TOOLS;
function roleTools(config: RolePolicy): PortalTools {
  return ROLE_TOOLS.filter(tool => tool.function.name === 'consultar_fontes_oficiais' ? config.rolePublicSearchEnabled : config.rolePortalContextEnabled);
}
type ToolRoute = { family: 'deepseek' | 'groq'; model: string; endpoint: string; pricing: RolePricing };
function toolRoute(route: Route | null): ToolRoute | null {
  if (!route) return null;
  if (route.kind === 'legacy') {
    const model = ROLE_MODELS[route.provider];
    return { family: route.provider, model: model.model, endpoint: model.endpoint, pricing: route.pricing };
  }
  const { provider, model } = route, kind = provider.kind, baseUrl = provider.baseUrl.replace(/\/$/, '');
  const supported = roleReasoningSupport({ kind, baseUrl, model: model.model });
  if (!supported.length) return null;
  return { family: supported.includes('off') ? 'deepseek' : 'groq', model: model.model, endpoint: `${baseUrl}/chat/completions`, pricing: route.pricing };
}
function toolReasoning(route: ToolRoute, effort: RoleEffort) {
  return roleReasoningParameters({ kind: 'openai_chat', baseUrl: route.endpoint.replace('/chat/completions', ''), model: route.model }, effort);
}
function keepReasoning(route: ToolRoute | null, effort: RoleEffort) {
  return !!route && toolReasoning(route, effort)?.thinking?.type === 'enabled';
}
function inputLimitError() {
  return new HttpError(413, 'A conversa ultrapassou o limite de entrada do Rolê. Encurte o pedido ou comece uma nova conversa.', 'role_input_limit');
}
function assertInputLimit(payload: object, limit: number) {
  if (!limit) return;
  let images = 0;
  const envelope = JSON.stringify(payload, (key, value) => {
    if (key === 'source' && value?.type === 'base64' && typeof value?.data === 'string') { images++; return { ...value, data: '' }; }
    if (key === 'url' && typeof value === 'string' && value.startsWith('data:image/')) { images++; return ''; }
    return value;
  });
  if (new TextEncoder().encode(envelope).byteLength + images * ROLE_IMAGE_TOKEN_CEILING > limit) throw inputLimitError();
}
async function scopedActor(db: D1Database, actor: PortalActor | null, project: string) {
  const current = actor && await getActor(db, actor);
  if (!current) throw new HttpError(403, 'Seu acesso mudou. Entre novamente.', 'assistant_forbidden');
  requireCapability(current, 'inventory.read', project);
  await requireLiveCapability(db, current, 'inventory.read', project);
  const row = await one(db, "SELECT p.organization_id,p.name FROM projects p JOIN organizations o ON o.id=p.organization_id AND o.status='active' WHERE p.id=?", [project]);
  if (!row) throw new HttpError(404, 'Projeto não encontrado.', 'role_project');
  return { current, organizationId: String(row.organization_id), projectName: String(row.name) };
}

/** Same live fence as operational plans, but bound to the Rolê switch. */
function roleAuthorization(db: D1Database, actor: PortalActor, project: string, organizationId: string, revision: number, video = false) {
  const authority = projectAuthoritySql(actor, ['inventory.read'], '?');
  const usage = assistantUsageSql(actor.userId);
  return db.prepare(`SELECT CASE WHEN ${authority.sql} AND EXISTS(SELECT 1 FROM ai_organization_settings s JOIN projects p ON p.organization_id=s.organization_id JOIN organizations o ON o.id=s.organization_id WHERE p.id=? AND s.organization_id=? AND s.revision=? AND json_extract(s.config_json,'$.roleEnabled')=1 AND (?=0 OR json_extract(s.config_json,'$.roleVideoEnabled')=1) AND o.status='active' AND ${usage.sql}) THEN 1 ELSE json_extract('[]','assistant_authority_changed') END`)
    .bind(...authority.values, project, project, organizationId, revision, Number(video), ...usage.values);
}

function videoApproval(organizationId: string, project: string, revision: number, profile: RoleVideoProfile) {
  return digest(JSON.stringify(['role-video/v2', organizationId, project, revision, profile.model, profile.effort]));
}

function documentApproval(actor: PortalActor, project: string, revision: number) {
  return digest(JSON.stringify(['role-document/v1', actor.userId, project, revision]));
}

export type RoleAvailability = {
  contract: string; organizationId: string; projectId: string; available: boolean; reason: string | null;
  provider: string; model: string; visionAvailable: boolean; operationsAvailable: boolean;
  video?: RoleVideoStatus;
  document?: { approval: string; canSaveToRecords: boolean };
  textPricing: RolePricing | null; visionPricing: RolePricing | null;
  /** `route` só existe com modelo do catálogo escolhido para voz: é o destino (`catalog:<id>`) que o consentimento precisa nomear. */
  /** `route` e `routeModel` só existem com modelo do catálogo escolhido para voz e em condição de receber o áudio. */
  speech: { available: boolean; provider: 'groq' | 'deepgram'; route?: string; routeModel?: SpeechRouteModel };
  /** Só existe com modelo do catálogo escolhido e apto para a conferência dos registros: é o nome que o aviso precisa mostrar. */
  decisionRouteName?: string;
  dailyLimitMicros: number; reservedTodayMicros: number;
  /** Consultas ao portal (só leitura) disponíveis na conversa e na foto. */
  tools: { text: boolean; vision: boolean };
  policy?: { historyMessages: number; inputCeiling: number; maxOutputTokens: number; reasoningCarry: boolean; publicSearch: boolean };
  /** Opções do seletor "Procurar em" (só o que a pessoa vê). */
  scopes?: { units: { id: string; name: string }[]; events: { id: string; name: string; projectId: string }[] };
};

type Route = { kind: 'legacy'; provider: 'deepseek' | 'groq'; apiKey: string; pricing: RolePricing } | { kind: 'catalog'; provider: CatalogProvider; model: CatalogModel; apiKey: string; pricing: RolePricing };
/** Which model answers: the reviewed DeepSeek/Groq path, or a catalog model chosen by the administration. */
function route(config: AssistantConfig, raw: Record<string, unknown> | null, catalog: ModelCatalog | null, need: 'chat' | 'vision'): Route | null {
  if (!raw) return null;
  const chosen = need === 'chat' ? config.roleModel : config.roleVisionModel;
  if (!chosen) {
    const provider = need === 'vision' ? 'deepseek' : config.roleProvider, apiKey = raw[provider];
    return validProviderKey(apiKey) ? { kind: 'legacy', provider, apiKey, pricing: { ...ROLE_MODELS[provider], model: ROLE_MODELS[provider].model } } : null;
  }
  const model = catalog?.models.find(entry => entry.id === chosen && entry.enabled), provider = catalog?.providers.find(entry => entry.id === model?.providerId);
  if (!model || !provider || fitsFunction(model, provider, need)) return null;
  const apiKey = raw[provider.keyRef];
  return validProviderKey(apiKey) ? { kind: 'catalog', provider, model, apiKey, pricing: catalogPricing(model) } : null;
}

function availability(config: AssistantConfig, credentials: AssistantCredentials | null, organizationId: string, speech?: SpeechEnvironment, raw: Record<string, unknown> | null = credentials as Record<string, unknown> | null, catalog: ModelCatalog | null = null) {
  const speechProvider = speechProviderForOrganization(organizationId, speech, config.sttProvider);
  const speechKey = speechProvider === 'groq' ? (config.sttProvider === 'legacy' ? speech?.groqKey : credentials?.groq) : credentials?.deepgram;
  const text = config.roleEnabled ? route(config, raw, catalog, 'chat') : null;
  const vision = config.roleEnabled && config.roleVisionEnabled ? route(config, raw, catalog, 'vision') : null;
  return {
    text, vision,
    available: !!credentials && !!text,
    visionAvailable: !!credentials && !!vision,
    operationsAvailable: !!credentials && config.enabled && validProviderKey(credentials[config.textProvider]) && (!config.jevEnabled || validProviderKey(credentials.typesafe)),
    speech: { available: config.sttEnabled && validProviderKey(speechKey), provider: speechProvider },
  };
}

/** Busca em fontes oficiais (sem IA nem custo): basta o Rolê ligado e a busca pública ligada, mesmo sem chave de conversa. */
const officialSearchOn = (config: AssistantConfig) => config.roleEnabled && config.rolePublicSearchEnabled;

/** No provider call. Reports what Rolê can do for this person in this project. */
export async function roleStatus(db: D1Database, actor: PortalActor | null, input: { projectId?: string | null }, secret: string, options: Options = {}): Promise<RoleAvailability> {
  const project = projectId(input.projectId), { current, organizationId } = await scopedActor(db, actor, project);
  const today = dayKey(options.now ?? Date.now());
  const usage = await one(db, 'SELECT reserved_usd_micros FROM ai_organization_usage WHERE organization_id=? AND day=?', [organizationId, today]);
  const base = { contract: ROLE_CONTRACT, organizationId, projectId: project, reservedTodayMicros: Number(usage?.reserved_usd_micros ?? 0), canConfigure: (await responsibleName(db, current, organizationId)).canConfigure };
  try {
    const { config, credentials, rawCredentials, revision } = await loadAssistantSettings(db, secret, organizationId, 'configuration', options.keys, current.userId);
    const catalog = config.roleModel || config.roleVisionModel || config.roleVideoEnabled ? (await loadCatalog(db, organizationId)).catalog : null;
    const { text, vision, ...state } = availability(config, credentials, organizationId, options.speech, rawCredentials, catalog);
    let speech: RoleAvailability['speech'] = state.speech;
    if (config.speechModel && speech.available) {
      const resolved = await resolveTaskRoute(db, organizationId, config, rawCredentials, 'speech', speech.provider), routeModel = speechRouteModel(resolved);
      if (routeModel) speech = { ...speech, route: speechDestination(resolved, speech.provider), routeModel: { ...routeModel, approval: await taskApproval(organizationId, revision, 'speech', [resolved]) } };
    }
    const profile = { model: config.roleVideoModel, effort: config.roleVideoEffort };
    const video = state.available && config.roleVideoEnabled && validProviderKey(geminiVideoCredential(catalog, rawCredentials))
      ? { ...profile, label: ROLE_VIDEO_MODELS[profile.model].label, approval: await videoApproval(organizationId, project, revision, profile) }
      : undefined;
    const decisionRouteName = state.operationsAvailable && config.jevEnabled && config.decisionModel ? taskRouteName(await resolveTaskRoute(db, organizationId, config, rawCredentials, 'decision').catch(() => null)) : null;
    const recordScope = projectAuthoritySql(current, ['campaigns.manage'], '?');
    const document = state.available ? {
      approval: await documentApproval(current, project, revision),
      canSaveToRecords: !!await one(db, `SELECT 1 WHERE ${recordScope.sql}`, [...recordScope.values, project]),
    } : undefined;
    return { ...base, ...state, speech, ...(document ? { document } : {}), ...(video ? { video } : {}), ...(decisionRouteName ? { decisionRouteName } : {}), provider: text?.kind === 'catalog' ? text.provider.id : config.roleProvider, model: text?.pricing.label ?? ROLE_MODELS[config.roleProvider].label,
      textPricing: text?.pricing ?? null, visionPricing: vision?.pricing ?? null, dailyLimitMicros: config.dailyUsdMicros, tools: { text: !!toolRoute(text) && !!roleTools(config).length, vision: !!toolRoute(vision) && !!roleTools(config).length },
      policy: { historyMessages: config.roleHistoryMessages, inputCeiling: config.roleInputTokenCeiling, maxOutputTokens: config.roleOutputTokenLimit, reasoningCarry: keepReasoning(toolRoute(text), config.roleReasoningEffort), publicSearch: officialSearchOn(config) },
      reason: state.available ? null : !config.roleEnabled ? 'O Rolê ainda não foi ligado nesta organização.' : 'Falta a chave do provedor escolhido para o Rolê.', scopes: state.available ? await roleScopes(db, current, organizationId) : undefined };
  } catch (error) {
    const reason = error instanceof HttpError && error.status === 403 ? 'A IA desta organização está liberada só para outra pessoa.' : 'O Rolê ainda não foi configurado nesta organização.';
    return { ...base, available: false, reason, provider: 'deepseek', model: ROLE_MODELS.deepseek.label, visionAvailable: false, operationsAvailable: false, textPricing: null, visionPricing: null, speech: { available: false, provider: 'groq' }, dailyLimitMicros: 0, tools: { text: false, vision: false } };
  }
}

/** Bloqueia a leitura de anexos antes do corpo da requisição e revalida antes de devolver o texto. */
export async function requireRoleDocumentAccess(db: D1Database, actor: PortalActor, projectId: string | null, secret: string, options: Options = {}) {
  const status = await roleStatus(db, actor, { projectId }, secret, options);
  if (!status.document) throw new HttpError(403, 'Anexos do Rolê estão indisponíveis neste projeto.', 'assistant_forbidden');
  return async () => {
    const current = await roleStatus(db, actor, { projectId }, secret, options);
    if (!current.document || current.document.approval !== status.document?.approval) {
      throw new HttpError(403, 'Seu acesso ou a configuração mudou durante a leitura.', 'assistant_forbidden');
    }
  };
}

/** Sugestões por pessoa (regras, sem IA nem custo): só para quem já pode conversar com o Rolê neste projeto. */
export async function roleSuggestionList(db: D1Database, actor: PortalActor | null, input: { projectId?: string | null; scope?: unknown }, now = Date.now()) {
  const { current, organizationId } = await scopedActor(db, actor, projectId(input.projectId));
  // Mesmo "Procurar em" da conversa, conferido pela mesma função: recorte que a pessoa não vê é recusado, nunca ampliado.
  const scope = await resolveRoleScope(db, current, organizationId, input.scope);
  return { days: ROLE_SUGGESTION_DAYS, suggestions: await roleSuggestions(db, current, organizationId, now, scope.projectIds) };
}

function history(value: unknown): RoleTurn[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > ROLE_MAX_HISTORY) throw new HttpError(400, 'A conversa ficou longa. Comece uma nova.', 'role_history');
  let total = 0;
  const turns = value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'A conversa enviada é inválida.', 'role_history');
    const turn = raw as Record<string, unknown>;
    onlyKeys(turn, ['role', 'content']);
    if ((turn.role !== 'user' && turn.role !== 'assistant') || typeof turn.content !== 'string' || !turn.content.trim() || turn.content.length > 4000) throw new HttpError(400, 'A conversa enviada é inválida.', 'role_history');
    // Both roles are client-supplied: apply the same redaction and credential refusal.
    const content = safeRequest(turn.content);
    total += content.length;
    return { role: turn.role, content } as RoleTurn;
  });
  if (total > ROLE_MAX_HISTORY_CHARS) throw new HttpError(400, 'A conversa ficou longa. Comece uma nova.', 'role_history');
  return turns;
}

export function parseRoleImage(value: unknown): { dataUrl: string; bytes: number; mime: string } | null {
  if (value === undefined || value === null) return null;
  const match = typeof value === 'string' ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value) : null;
  if (!match) throw new HttpError(415, 'Envie uma imagem JPG, PNG ou WebP.', 'role_image');
  const mime = match[1] as keyof typeof IMAGE_TYPES, encoded = match[2];
  const bytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (bytes < 64 || bytes > ROLE_MAX_IMAGE_BYTES) throw new HttpError(413, 'A imagem precisa ter até 1,5 MB depois de reduzida.', 'role_image');
  let decoded: Uint8Array;
  try { if (encoded.length % 4 !== 0) throw new Error(); decoded = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)); }
  catch { throw new HttpError(415, 'O arquivo não parece ser a imagem informada.', 'role_image'); }
  if (!IMAGE_TYPES[mime].every((byte, index) => decoded[index] === byte)) throw new HttpError(415, 'O arquivo não parece ser a imagem informada.', 'role_image');
  const size = imageSize(mime, decoded);
  if (!size || size.width < 1 || size.height < 1) throw new HttpError(415, 'O arquivo não parece ser a imagem informada.', 'role_image');
  if (Math.max(size.width, size.height) > ROLE_MAX_IMAGE_SIDE) throw new HttpError(413, 'Reduza a imagem para até 1024 pixels no lado maior.', 'role_image');
  return { dataUrl: value as string, bytes, mime };
}

/** "Hoje: 2026-11-09 (segunda-feira)", em Brasília: o modelo precisa da data para "amanhã" e "esta semana". */
export function brasiliaToday(now: number): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  return `${date} (${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(new Date(now))})`;
}
function transportBody(route: ToolRoute, turns: RoleTurn[], message: string, projectName: string, image: string | null, today: string | null, scopeLabel: string | null, maxOutput: number, effort: RoleEffort) {
  const user = `${today ? `Hoje: ${today}, horário de Brasília\n` : ''}${scopeLabel ? `Procurar em: ${scopeLabel} (as consultas já ficam limitadas a isso)\n` : ''}Projeto atual: ${projectName}\nMensagem: ${message}`;
  const messages = [
    { role: 'system', content: today ? ROLE_SYSTEM_PROMPT_TOOLS : ROLE_SYSTEM_PROMPT },
    ...turns.map(turn => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: image ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: image } }] : user },
  ];
  const reasoning = toolReasoning(route, effort);
  return { model: route.model, ...reasoning, ...(reasoning?.thinking?.type === 'enabled' ? {} : { temperature: 0.4 }),
    ...(route.family === 'groq' ? { max_completion_tokens: maxOutput } : { max_tokens: maxOutput }), stream: false, response_format: { type: 'json_object' }, messages };
}

const withheld = () => new HttpError(502, 'A resposta do provedor não pôde ser mostrada. Nada foi cobrado além do previsto.', 'role_provider_schema');
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {});
    throw new HttpError(503, response.status === 401 || response.status === 403 ? 'O Rolê está sem acesso ao serviço de IA agora. Avise a administração do portal para conferir a chave em Configurações → Chaves e modelos.' : response.status === 429 ? 'O provedor atingiu o limite de uso agora. Tente de novo em alguns minutos.' : 'O provedor não respondeu. A reserva preventiva continua contando no limite diário.', 'role_provider_unavailable');
  }
  const reader = response.body?.getReader();
  if (!reader) throw withheld();
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 128 * 1024) throw withheld(); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed as Record<string, unknown>; }
  catch { throw withheld(); }
  finally { bytes.fill(0); }
}

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
const FINAL_INSTRUCTION = 'Agora responda à pessoa usando só os dados consultados acima (não há mais consultas). Responda somente em JSON: {"reply":"texto para a pessoa","operation":null}.';
/** One provider step of the tool loop: a reply or tool calls, with confirmed usage. */
async function toolStep(route: ToolRoute, apiKey: string, body: unknown, maxOutput: number, retainReasoning: boolean, signal: AbortSignal, fetcher: typeof fetch) {
  let data: Record<string, unknown>;
  try {
    data = await boundedJson(await fetcher(route.endpoint, { method: 'POST', redirect: 'error', cache: 'no-store', signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'A chamada ao Rolê falhou ou demorou demais. Não houve nova tentativa automática.', 'role_provider_unavailable');
  }
  if (JSON.stringify(data).includes(apiKey)) throw withheld();
  const choices = Array.isArray(data.choices) ? data.choices as { finish_reason?: unknown; message?: { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown } }[] : [];
  const choice = choices.length === 1 ? choices[0] : null;
  const usage = data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : {};
  const inputTokens = Number(usage.prompt_tokens), outputTokens = Number(usage.completion_tokens);
  if (data.model !== route.model || !choice || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) || inputTokens < 0 || outputTokens < 0) throw withheld();
  const costMicros = Math.ceil(inputTokens * route.pricing.inputMicrosPerToken + outputTokens * route.pricing.outputMicrosPerToken);
  const charged = (message: string) => new ChargedError(message, costMicros, inputTokens + outputTokens);
  if (outputTokens > maxOutput) throw charged('O provedor excedeu o limite de saída. O custo foi registrado.');
  const thinking = retainReasoning && typeof choice.message?.reasoning_content === 'string' ? choice.message.reasoning_content : '';
  if (new TextEncoder().encode(thinking).byteLength > maxOutput * 4) throw charged('A resposta usada na consulta ficou longa demais. O custo foi registrado.');
  const raw = choice.message?.tool_calls, content = typeof choice.message?.content === 'string' ? choice.message.content : '';
  if (content.length > 16000) throw charged('A resposta do provedor não pôde ser mostrada.');
  let toolCalls: ToolCall[] = [];
  if (raw !== undefined && raw !== null) {
    const valid = Array.isArray(raw) && raw.length <= 8 && raw.every(call => call && typeof call.id === 'string' && call.id.length <= 100 && call.type === 'function' && typeof call.function?.name === 'string' && call.function.name.length <= 60 && typeof call.function?.arguments === 'string' && call.function.arguments.length <= 2000);
    if (!valid) throw charged('A resposta do provedor não pôde ser mostrada.');
    toolCalls = (raw as ToolCall[]).map(call => ({ id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } }));
  }
  if (!toolCalls.length && choice.finish_reason !== 'stop') throw charged('A resposta do Rolê veio incompleta. O custo foi registrado.');
  return { content, thinking, toolCalls, inputTokens, outputTokens, costMicros, finish: String(choice.finish_reason ?? '').slice(0, 20) };
}

/**
 * Read-only tool loop: up to ROLE_TOOL_ROUNDS rounds of portal lookups (run here, with the asking
 * person's live permissions), then a final answer without tools. Lookup results are data, never
 * instructions; nothing is written; only tool names and row counts are audited.
 */
async function dispatchWithTools(route: ToolRoute, apiKey: string, body: { messages: Record<string, unknown>[] } & Record<string, unknown>, run: (name: string, args: Record<string, unknown>, budget: number) => Promise<RoleToolResult>, policy: RolePolicy, offeredTools: PortalTools, retainReasoning: boolean, checkAccess: () => Promise<unknown>, signal: AbortSignal, fetcher: typeof fetch) {
  const messages = [...body.messages], used: { name: string; rows: number }[] = [], sources = new Map<string, RoleSource>();
  let inputTokens = 0, outputTokens = 0, costMicros = 0, steps = 0;
  const charged = (message: string) => new ChargedError(message, costMicros, inputTokens + outputTokens);
  // No JSON mode in the loop: after lookups, DeepSeek's JSON mode can return an empty message.
  // The reply is parsed leniently (JSON or plain text); the final step gets a closing instruction.
  const { response_format: _format, ...free } = body; void _format;
  let finalNudged = false;
  for (let round = 0; ; round++) {
    const offer = !!offeredTools.length && round < ROLE_TOOL_ROUNDS;
    if (offeredTools.length && !offer && !finalNudged) { messages.push({ role: 'system', content: FINAL_INSTRUCTION }); finalNudged = true; }
    let step;
    try {
      const payload = offer ? { ...free, messages, tools: offeredTools, tool_choice: 'auto' } : { ...free, messages };
      assertInputLimit(payload, policy.roleInputTokenCeiling);
      await checkAccess();
      step = await toolStep(route, apiKey, payload, policy.roleOutputTokenLimit, retainReasoning && offer, signal, fetcher);
    }
    catch (error) {
      if (String(error).includes('assistant_authority_changed')) throw error;
      if (error instanceof ChargedError) throw new ChargedError(error.message, costMicros + error.chargedMicros, inputTokens + outputTokens + error.chargedTokens);
      if (costMicros > 0) throw charged(error instanceof HttpError ? error.message : 'A chamada ao Rolê falhou.');
      throw error;
    }
    inputTokens += step.inputTokens; outputTokens += step.outputTokens; costMicros += step.costMicros; steps++;
    if (step.toolCalls.length) {
      if (!offer) throw charged('O Rolê tentou consultar demais. Reformule a pergunta de um jeito mais direto.');
      messages.push({ role: 'assistant', content: step.content, tool_calls: step.toolCalls, ...(retainReasoning ? { reasoning_content: step.thinking } : {}) });
      let budget = ROLE_TOOL_RESULT_BYTES;
      for (const [index, call] of step.toolCalls.entries()) {
        let content: string;
        if (index >= ROLE_TOOL_CALLS_PER_ROUND || budget < 600) content = JSON.stringify({ erro: 'Limite de consultas desta pergunta. Responda com o que já tem.' });
        else {
          try {
            if (!offeredTools.some(tool => tool.function.name === call.function.name)) throw new HttpError(400, 'Consulta não autorizada nesta conversa.', 'role_tool_disabled');
            const args: unknown = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
            if (!args || typeof args !== 'object' || Array.isArray(args)) throw new HttpError(400, 'Consulta com dados inválidos.', 'role_tool_input');
            const result = await run(call.function.name, args as Record<string, unknown>, budget);
            content = result.content; budget -= new TextEncoder().encode(content).byteLength;
            used.push({ name: call.function.name, rows: result.rows });
            for (const source of result.sources) if (sources.size < 8) sources.set(source.href, source);
          } catch (error) {
            content = JSON.stringify({ erro: error instanceof HttpError && error.status < 500 ? error.message : 'Consulta indisponível agora.' });
            used.push({ name: ROLE_TOOL_NAMES.includes(call.function.name) ? call.function.name : 'desconhecida', rows: -1 });
          }
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content });
      }
      continue;
    }
    if (!step.content.trim()) {
      // Empty message in a lookup round: one closing call without tools. Empty at the end: stop.
      console.warn('role_empty_reply', JSON.stringify({ provider: route.family, steps, round, finish: step.finish, lookups: used.map(entry => entry.name) }));
      if (offer) { round = ROLE_TOOL_ROUNDS - 1; continue; }
      throw charged('O Rolê não conseguiu montar a resposta agora. Tente de novo com uma pergunta mais curta. O custo foi registrado.');
    }
    let reply: { reply: string; operation: string | null };
    try { reply = validateRoleReply(firstJsonObject(step.content)); }
    catch { reply = { reply: step.content.trim().slice(0, 4000), operation: null }; }
    if (!reply.reply) throw charged('A resposta do Rolê veio vazia. O custo foi registrado.');
    if (containsCredential(reply.reply) || reply.operation && containsCredential(reply.operation)) throw charged('A resposta do provedor não pôde ser mostrada.');
    return { ...reply, inputTokens, outputTokens, costMicros, steps, tools: used, sources: [...sources.values()] };
  }
}

const STOP = new Set(['para', 'com', 'dos', 'das', 'uma', 'uns', 'umas', 'por', 'que', 'saida', 'saidas', 'entrada', 'entradas', 'registrar', 'registro', 'distribuicao', 'consumo', 'projeto', 'estoque', 'material', 'materiais', 'unidade', 'unidades', 'centro', 'eventos', 'evento']);
function words(value: string): string[] {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3 && !/^\d+$/.test(word) && !STOP.has(word))
    .map(word => word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)
    .map(word => word === 'bottom' || word === 'boton' || word === 'button' ? 'botton' : word);
}
export type ProjectMatch = { projectId: string; projectName: string; itemName: string; score: number };
/**
 * Where is the material named in an operation? Only projects the person can read are searched,
 * and only item names leave the server. No provider call, no cost.
 */
export async function matchOperationProjects(db: D1Database, actor: PortalActor | null, request: string): Promise<{ matches: ProjectMatch[]; ambiguous: boolean }> {
  const current = actor && await getActor(db, actor);
  if (!current) throw new HttpError(403, 'Seu acesso mudou. Entre novamente.', 'assistant_forbidden');
  const wanted = new Set(words(safeRequest(request)));
  if (!wanted.size) return { matches: [], ambiguous: false };
  const authority = projectAuthoritySql(current, ['inventory.read'], 'p.id');
  const rows = await all(db, `SELECT p.id AS project_id,p.name AS project_name,i.name AS item_name FROM items i
    JOIN projects p ON p.id=i.project_id JOIN organizations o ON o.id=p.organization_id AND o.status='active'
    WHERE ${authority.sql} ORDER BY p.name,i.name LIMIT 2000`, authority.values);
  const best = new Map<string, ProjectMatch>();
  for (const row of rows) {
    const itemWords = words(String(row.item_name));
    if (!itemWords.length) continue;
    const hits = itemWords.filter(word => wanted.has(word)).length;
    if (!hits) continue;
    const score = Math.round(hits / itemWords.length * 100) + hits;
    const projectId = String(row.project_id), previous = best.get(projectId);
    if (!previous || score > previous.score) best.set(projectId, { projectId, projectName: String(row.project_name), itemName: String(row.item_name), score });
  }
  const matches = [...best.values()].sort((a, b) => b.score - a.score || a.projectName.localeCompare(b.projectName)).slice(0, 5);
  return { matches, ambiguous: matches.length > 1 && matches[0].score === matches[1].score };
}

/** Numbers in a suggested operation must come from what the person wrote (blocks "dê saída de 500" hidden in a photo). */
export function operationNumbersAllowed(operation: string, userTexts: string[]): boolean {
  const said = new Set(userTexts.flatMap(text => text.match(/\d+/g) ?? []).map(value => String(Number(value))));
  return (operation.match(/\d+/g) ?? []).every(value => said.has(String(Number(value))));
}

/** Catalog models: same prompt and limits; JSON parsed leniently, plain text kept as the reply. */
async function catalogDispatch(chosen: Extract<Route, { kind: 'catalog' }>, turns: RoleTurn[], message: string, projectName: string, image: string | null, policy: RolePolicy, signal: AbortSignal, fetcher?: typeof fetch) {
  const result = await genericChat({ provider: chosen.provider, model: chosen.model, apiKey: chosen.apiKey, system: ROLE_SYSTEM_PROMPT, maxTokens: policy.roleOutputTokenLimit, reasoningEffort: !image && policy.roleReasoningEffort !== 'default' ? policy.roleReasoningEffort : undefined, assertPayload: body => assertInputLimit(body, policy.roleInputTokenCeiling), json: chosen.provider.kind === 'openai_chat', signal, fetcher,
    turns: [...turns, { role: 'user', content: `Projeto atual: ${projectName}\nMensagem: ${message}`, image }] });
  if (result.outputTokens > policy.roleOutputTokenLimit) throw new ChargedError('O modelo passou do limite de resposta. O custo foi registrado.', result.costMicros, result.inputTokens + result.outputTokens);
  let reply: { reply: string; operation: string | null };
  try { reply = validateRoleReply(firstJsonObject(result.text)); }
  catch { reply = { reply: result.text.trim().slice(0, 4000), operation: null }; }
  if (containsCredential(reply.reply) || reply.operation && containsCredential(reply.operation)) throw new ChargedError('A resposta do provedor não pôde ser mostrada.', result.costMicros, result.inputTokens + result.outputTokens);
  return { ...reply, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costMicros: result.costMicros };
}

/** One paid call, only after the person accepted a cost ceiling at least as high as the server's. */
export async function roleChat(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, secret: string, options: Options = {}) {
  onlyKeys(input, ['action', 'projectId', 'operationKey', 'consent', 'history', 'message', 'image', 'video', 'videoApproval', 'videoConsent', 'acceptedCostMicros', 'scope', 'document', 'documentConsent', 'documentApproval', 'officialSearch']);
  if (input.officialSearch !== undefined && input.officialSearch !== true) throw new HttpError(400, 'Pedido de busca em fontes oficiais inválido.', 'assistant_request');
  // A ciência de envio à IA vale para a conversa; a busca pedida explicitamente não manda nada para IA.
  if (input.officialSearch !== true && input.consent !== true) throw new HttpError(400, 'Confirme que o texto e a imagem podem ir para o provedor de IA.', 'assistant_consent');
  if (typeof input.operationKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.operationKey)) throw new HttpError(400, 'Reabra o Rolê antes de enviar.', 'assistant_operation');
  if (typeof input.message !== 'string' || input.message.length > ROLE_MAX_MESSAGE_CHARS) throw new HttpError(400, 'Escreva até 2.000 caracteres por mensagem.', 'assistant_request');
  const project = projectId(input.projectId), message = safeRequest(input.message);
  const hasVideo = Object.hasOwn(input, 'video');
  const { current, organizationId, projectName } = await scopedActor(db, actor, project), now = options.now ?? Date.now();
  const { config, credentials, rawCredentials, revision } = await loadAssistantSettings(db, secret, organizationId, 'configuration', options.keys, current.userId);
  // Busca em fontes oficiais: sem IA, sem custo e sem histórico, por isso vale também sem chave de conversa.
  // Login, projeto, escopo e a cerca de autorização (antes e depois da rede) são os mesmos da conversa.
  const explicitSearch = input.officialSearch === true, hasMedia = hasVideo || input.image != null || Object.hasOwn(input, 'document');
  if (explicitSearch && hasMedia) throw new HttpError(400, 'A busca em fontes oficiais aceita só texto. Tire o anexo e envie de novo.', 'role_official_media');
  if (explicitSearch && !officialSearchOn(config)) throw new HttpError(403, 'A busca em fontes oficiais está desligada nesta organização.', 'role_official_disabled');
  // Planilha de brindes: o Rolê ainda não tem acesso. Resposta fixa, sem IA e sem custo, também no modo só busca.
  if (!hasMedia && config.roleEnabled && asksGiftSheet(message)) {
    await resolveRoleScope(db, current, organizationId, input.scope);
    history(input.history);
    try {
      await roleAuthorization(db, current, project, organizationId, revision).first();
    } catch (error) {
      if (String(error).includes('assistant_authority_changed')) throw new HttpError(403, 'Seu acesso ou a configuração mudou antes da resposta.', 'assistant_forbidden');
      throw error;
    }
    return { contract: ROLE_CONTRACT, reply: GIFT_SHEET_REPLY, operation: null, operationDropped: false, provider: 'portal', model: 'Resposta do Portal',
      reservedMicros: 0, costMicros: 0, inputTokens: 0, outputTokens: 0, sources: [], lookups: 0 };
  }
  if (!hasMedia && officialSearchOn(config) && (explicitSearch || isOfficialSearch(message))) {
    await resolveRoleScope(db, current, organizationId, input.scope);
    history(input.history);
    // Sem custo de IA, mas cada busca lê sites públicos: limite por pessoa e por organização, antes de qualquer pedido externo.
    try {
      await rateLimitAll(db, [{ bucket: `role-official:${current.userId}`, limit: 20, windowMs: 60_000 }, { bucket: `role-official:org:${organizationId}`, limit: 300, windowMs: 60_000 }]);
    } catch (error) {
      if (error instanceof HttpError && error.code === 'rate_limited') throw new HttpError(429, 'Muitas buscas seguidas. Espere um minuto e tente de novo.', 'role_official_rate');
      throw error;
    }
    const authorization = roleAuthorization(db, current, project, organizationId, revision);
    try {
      await authorization.first();
      const result = await officialSearchReply(db, organizationId, message, options.officialFetcher);
      await authorization.first();
      return { contract: ROLE_CONTRACT, reply: result.reply, operation: null, operationDropped: false, provider: 'official', model: 'Consulta oficial',
        reservedMicros: 0, costMicros: 0, inputTokens: 0, outputTokens: 0, sources: result.sources, lookups: 1 };
    } catch (error) {
      if (String(error).includes('assistant_authority_changed')) throw new HttpError(403, 'Seu acesso ou a configuração mudou antes da resposta.', 'assistant_forbidden');
      throw error;
    }
  }
  const catalog = config.roleModel || config.roleVisionModel || hasVideo && config.roleVideoEnabled ? (await loadCatalog(db, organizationId)).catalog : null;
  const state = availability(config, credentials, organizationId, options.speech, rawCredentials, catalog);
  if (!state.available) throw new HttpError(503, 'O Rolê está desligado ou sem chave nesta organização.', 'role_unavailable');
  const scope = await resolveRoleScope(db, current, organizationId, input.scope);
  const document = Object.hasOwn(input, 'document') ? roleDocumentExcerpt(input.document) : null;
  if (document && (hasVideo || input.image != null)) throw new HttpError(400, 'Envie um documento, uma foto ou um vídeo por vez.', 'role_document_media');
  if (document && (input.documentConsent !== true || input.documentApproval !== await documentApproval(current, project, revision))) {
    throw new HttpError(409, 'Confirme novamente o envio do trecho ao modelo de conversa atual.', 'role_document_consent');
  }
  const providerMessage = document ? roleDocumentMessage(message, document) : message;
  const videoProfile = { model: config.roleVideoModel, effort: config.roleVideoEffort };
  const videoKey = hasVideo && config.roleVideoEnabled ? geminiVideoCredential(catalog, rawCredentials) : null;
  if (hasVideo && !validProviderKey(videoKey)) throw new HttpError(403, 'A análise de vídeo não está liberada neste projeto.', 'role_video_disabled');
  if (hasVideo && (input.videoConsent !== true || input.videoApproval !== await videoApproval(organizationId, project, revision, videoProfile))) {
    throw new HttpError(409, 'Confirme novamente o envio deste vídeo ao Google Gemini.', 'role_video_consent');
  }
  if (hasVideo && input.image != null) throw new HttpError(400, 'Envie uma foto ou um vídeo por vez.', 'role_video_input');
  const video = hasVideo ? parseRoleVideo(input.video) : null;
  if (hasVideo && !video) throw new HttpError(400, 'Selecione um vídeo MP4.', 'role_video_input');
  const image = parseRoleImage(input.image), submittedTurns = video || document ? [] : history(input.history);
  if (image && !state.visionAvailable) throw new HttpError(503, 'A leitura de imagens não está ligada nesta organização. Envie só o texto.', 'role_vision_unavailable');
  const chosen = (image ? state.vision : state.text)!;
  if (!video && chosen.kind === 'catalog') requireConversationEndpoint(chosen.provider, options.fetcher);
  const provider = video ? 'gemini' : chosen.kind === 'catalog' ? chosen.provider.id : chosen.provider;
  const modelName = video ? videoProfile.model : chosen.kind === 'catalog' ? chosen.model.model : ROLE_MODELS[chosen.provider].model;
  const apiKey = chosen.apiKey;
  const callable = video ? null : toolRoute(chosen);
  const tools = callable && !document ? roleTools(config) : [], toolsOn = tools.length > 0;
  // Leave ten seconds for validation and settlement in the 60 s Vercel function.
  const timeoutMs = video && videoProfile.effort === 'xhigh' ? 50_000 : roleTimeoutMs(config.timeoutMs, toolsOn || !!video);
  const turns = roleHistoryForPolicy(submittedTurns, config.roleHistoryMessages);
  const reasoningCarry = !image && keepReasoning(callable, config.roleReasoningEffort);
  const envelope = callable ? transportBody(callable, turns, providerMessage, projectName, image?.dataUrl ?? null, toolsOn ? brasiliaToday(now) : null, toolsOn ? scope.label : null, config.roleOutputTokenLimit, image ? 'default' : config.roleReasoningEffort) : null;
  if (envelope) assertInputLimit(toolsOn ? { ...envelope, tools, tool_choice: 'auto' } : envelope, config.roleInputTokenCeiling);
  const textBytes = roleConversationBytes(turns, providerMessage, projectName);
  if (!video && !envelope && config.roleInputTokenCeiling && textBytes + ROLE_SYSTEM_PROMPT_BYTES + (image ? ROLE_IMAGE_TOKEN_CEILING : 0) > config.roleInputTokenCeiling) throw inputLimitError();
  const videoQuote = video ? roleVideoEstimate({ textBytes: new TextEncoder().encode(message).byteLength, maxOutputTokens: config.roleOutputTokenLimit, seconds: video.seconds, now, model: videoProfile.model }) : null;
  if (videoQuote && config.roleInputTokenCeiling && videoQuote.inputTokens > config.roleInputTokenCeiling) throw inputLimitError();
  const estimate = videoQuote ?? roleEstimate({ textProvider: config.roleProvider, textBytes, hasImage: !!image, text: state.text?.pricing, vision: state.vision?.pricing, tools: toolsOn, reasoningCarry, maxOutputTokens: config.roleOutputTokenLimit, inputCeiling: config.roleInputTokenCeiling });
  if (!Number.isSafeInteger(input.acceptedCostMicros) || Number(input.acceptedCostMicros) < estimate.costMicros) {
    throw new HttpError(409, 'O custo previsto mudou. Confira o novo valor e envie de novo.', 'role_cost_changed');
  }
  const reservation = { tokens: estimate.tokens, cost: estimate.costMicros, calls: 1, milliseconds: timeoutMs }; // uma pergunta = uma chamada; custo, tokens e tempo cobrem as até 3 requisições
  const id = await digest(`role\n${current.userId}\n${project}\n${input.operationKey}`);
  const fingerprint = await digest(JSON.stringify({ contract: ROLE_CONTRACT, message: providerMessage, turns, image: image ? await digest(image.dataUrl) : null,
    ...(video ? { video: await digest(video.data) } : {}), revision }));
  const authorization = roleAuthorization(db, current, project, organizationId, revision, !!video), nonce = crypto.randomUUID(), day = dayKey(now);
  // One person cannot use up the whole organization budget: half of the daily calls (all of them under private use).
  const personalCap = config.usageScope === 'private' ? config.dailyCalls : Math.max(3, Math.ceil(config.dailyCalls / 2));
  const personalQuota = db.prepare("SELECT CASE WHEN (SELECT COUNT(*) FROM ai_calls WHERE actor_id=? AND day=?) < ? THEN 1 ELSE json_extract('[]','role_user_quota') END").bind(current.userId, day, personalCap);
  const replay = async () => {
    const call = await one(db, 'SELECT fingerprint FROM ai_calls WHERE id=?', [id]);
    if (call) throw new HttpError(409, call.fingerprint === fingerprint ? 'Esta mensagem já foi enviada. Escreva de novo para uma nova resposta.' : 'Este envio já foi usado com outra mensagem.', 'assistant_call_replay');
  };
  await replay();
  try {
    await db.batch([personalQuota, ...reservationStatements(db, { table: 'ai_calls', authorization, id, fingerprint, nonce, actorId: current.userId, projectId: project, organizationId, day, createdAt: new Date(now).toISOString(), revision, config, reservation })]);
  } catch (error) {
    if (String(error).includes('assistant_authority_changed')) throw new HttpError(403, 'Seu acesso ou a configuração mudou.', 'assistant_forbidden');
    if (String(error).includes('role_user_quota')) throw await quotaRefusal(db, current, organizationId, day, config, { cost: reservation.cost, tokens: reservation.tokens, ms: reservation.milliseconds, calls: 1 }, { used: Number((await one(db, 'SELECT COUNT(*) n FROM ai_calls WHERE actor_id=? AND day=?', [current.userId, day]))?.n ?? personalCap), max: personalCap });
    await replay();
    throw error;
  }
  const admitted = await one(db, 'SELECT admission_nonce FROM ai_calls WHERE id=?', [id]);
  if (admitted?.admission_nonce !== nonce) throw await quotaRefusal(db, current, organizationId, day, config, { cost: reservation.cost, tokens: reservation.tokens, ms: reservation.milliseconds, calls: 1 });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    // Last live fence before money leaves: access or configuration may have changed during decryption.
    await authorization.first();
    const startedAt = Date.now();
    const result: { reply: string; operation: string | null; inputTokens: number; outputTokens: number; reasoningTokens?: number; costMicros: number; tools?: { name: string; rows: number }[]; sources?: RoleSource[]; steps?: number } = video && validProviderKey(videoKey)
      ? await dispatchRoleVideo({ apiKey: videoKey, video, message, maxOutputTokens: config.roleOutputTokenLimit,
          inputCeiling: config.roleInputTokenCeiling, now, profile: videoProfile, signal: controller.signal, fetcher: options.fetcher })
      : callable
      ? await dispatchWithTools(callable, apiKey, envelope!, async (name, args, budget) => {
          await authorization.first();
          return runRoleTool(db, current, organizationId, name, args, budget, scope, options.officialFetcher);
        }, config, tools, reasoningCarry, () => authorization.first(), controller.signal, options.fetcher ?? fetch)
      : await catalogDispatch(chosen as Extract<Route, { kind: 'catalog' }>, turns, providerMessage, projectName, image?.dataUrl ?? null, config, controller.signal, options.fetcher);
    // A model can suggest a draft only to someone with write authority in this project.
    // The separate review endpoint still checks the exact action and live permissions.
    const write = projectAuthoritySql(current, ['inventory.manage', 'campaigns.manage'], '?');
    const allowDraft = !document && result.operation && state.operationsAvailable && !!await one(db, `SELECT 1 WHERE ${write.sql}`, [...write.values, project]);
    const dropped = !!result.operation && (!allowDraft || !operationNumbersAllowed(result.operation, [message, ...turns.filter(turn => turn.role === 'user').map(turn => turn.content)]));
    if (dropped) result.operation = null;
    const extraCost = Math.max(0, result.costMicros - estimate.costMicros), extraTokens = Math.max(0, result.inputTokens + result.outputTokens - estimate.tokens), elapsed = Date.now() - startedAt;
    const videoReceipt = video ? { hasVideo: true, videoEffort: videoProfile.effort, reasoningTokens: result.reasoningTokens } : {};
    const details = { provider, model: modelName, hasImage: !!image, ...(document ? { hasDocumentExcerpt: true } : {}), ...videoReceipt, inputTokens: result.inputTokens, outputTokens: result.outputTokens, reservedUsdMicros: estimate.costMicros, usdMicros: result.costMicros, operationSuggested: !!result.operation, operationDropped: dropped, overrun: extraCost > 0 || extraTokens > 0, tools: result.tools ?? [], steps: result.steps ?? 1 };
    await db.batch([
      authorization,
      db.prepare("UPDATE ai_calls SET status='complete' WHERE id=? AND admission_nonce=? AND status='reserved'").bind(id, nonce),
      // The day keeps the real use: unused reservation goes back, use above the ceiling still counts.
      db.prepare('UPDATE ai_organization_usage SET reserved_usd_micros=MAX(0,reserved_usd_micros+?),reserved_tokens=MAX(0,reserved_tokens+?),reserved_ms=MAX(0,reserved_ms-?) WHERE organization_id=? AND day=? AND changes()=1').bind(result.costMicros - estimate.costMicros, result.inputTokens + result.outputTokens - estimate.tokens, Math.max(0, reservation.milliseconds - elapsed), organizationId, day),
      db.prepare("INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,?,'assistant.role.chat',?,?,?)")
        .bind(crypto.randomUUID(), current.userId, project, organizationId, id, JSON.stringify(details), new Date().toISOString()),
    ]);
    return { contract: ROLE_CONTRACT, reply: result.reply, operation: result.operation, operationDropped: dropped, provider, model: modelName,
      ...videoReceipt, reservedMicros: estimate.costMicros, costMicros: result.costMicros, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      sources: result.sources ?? [], lookups: (result.tools ?? []).length };
  } catch (error) {
    const failureDetails = { provider, model: modelName, hasImage: !!image, ...(video ? { hasVideo: true, videoEffort: videoProfile.effort } : {}), reservedUsdMicros: estimate.costMicros,
      ...(error instanceof ChargedError ? { usdMicros: error.chargedMicros } : {}),
      ...(error instanceof RoleVideoChargedError ? error.usage : {}) };
    await db.batch([
      db.prepare("UPDATE ai_calls SET status='failed' WHERE id=? AND admission_nonce=? AND status='reserved'").bind(id, nonce),
      db.prepare("INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,?,?,'assistant.role.chat.failed',?,?,? WHERE changes()=1")
        .bind(crypto.randomUUID(), current.userId, project, organizationId, id, JSON.stringify(failureDetails), new Date().toISOString()),
      ...(error instanceof RoleVideoChargedError ? [
        db.prepare('UPDATE ai_organization_usage SET reserved_usd_micros=MAX(0,reserved_usd_micros+?),reserved_tokens=MAX(0,reserved_tokens+?) WHERE organization_id=? AND day=? AND changes()=1')
          .bind(error.chargedMicros - estimate.costMicros, error.chargedTokens - estimate.tokens, organizationId, day),
      ] : []),
    ]);
    if (error instanceof ChargedError && !(error instanceof RoleVideoChargedError) && (error.chargedMicros > estimate.costMicros || error.chargedTokens > estimate.tokens)) {
      await db.prepare('UPDATE ai_organization_usage SET reserved_usd_micros=reserved_usd_micros+?,reserved_tokens=reserved_tokens+? WHERE organization_id=? AND day=?').bind(Math.max(0, error.chargedMicros - estimate.costMicros), Math.max(0, error.chargedTokens - estimate.tokens), organizationId, day).run();
    }
    if (String(error).includes('assistant_authority_changed')) throw new HttpError(403, 'Seu acesso ou a configuração mudou antes da resposta.', 'assistant_forbidden');
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
