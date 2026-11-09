import { getActor, projectAuthoritySql, requireCapability, requireLiveCapability, type PortalActor } from '../access';
import { one } from '../database';
import { HttpError } from '../errors';
import { reservationStatements } from './admission';
import { onlyKeys, safeRequest, type AssistantConfig, type AssistantCredentials } from './contracts';
import { digest, type CredentialKeys } from './crypto';
import {
  ROLE_CONTRACT, ROLE_MAX_HISTORY, ROLE_MAX_HISTORY_CHARS, ROLE_MAX_IMAGE_BYTES, ROLE_MAX_MESSAGE_CHARS, ROLE_MAX_OUTPUT_TOKENS, ROLE_MODELS,
  ROLE_SYSTEM_PROMPT, roleConversationBytes, roleEstimate, validateRoleReply, type RoleTurn,
} from './role-contracts';
import { containsCredential } from './sensitive';
import { assistantUsageSql, loadAssistantSettings, speechProviderForOrganization, validProviderKey, type SpeechEnvironment } from './settings';

type Options = { fetcher?: typeof fetch; now?: number; keys?: CredentialKeys; signal?: AbortSignal; speech?: SpeechEnvironment };
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const IMAGE_TYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] } as const;

function dayKey(now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

function projectId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new HttpError(400, 'Escolha um projeto para conversar com o Rolê.', 'role_project');
  return value;
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
function roleAuthorization(db: D1Database, actor: PortalActor, project: string, organizationId: string, revision: number) {
  const authority = projectAuthoritySql(actor, ['inventory.read'], '?');
  const usage = assistantUsageSql(actor.userId);
  return db.prepare(`SELECT CASE WHEN ${authority.sql} AND EXISTS(SELECT 1 FROM ai_organization_settings s JOIN projects p ON p.organization_id=s.organization_id JOIN organizations o ON o.id=s.organization_id WHERE p.id=? AND s.organization_id=? AND s.revision=? AND json_extract(s.config_json,'$.roleEnabled')=1 AND o.status='active' AND ${usage.sql}) THEN 1 ELSE json_extract('[]','assistant_authority_changed') END`)
    .bind(...authority.values, project, project, organizationId, revision, ...usage.values);
}

export type RoleAvailability = {
  contract: string; organizationId: string; projectId: string; available: boolean; reason: string | null;
  provider: 'deepseek' | 'groq'; model: string; visionAvailable: boolean;
  speech: { available: boolean; provider: 'groq' | 'deepgram' };
  dailyLimitMicros: number; reservedTodayMicros: number;
};

function availability(config: AssistantConfig, credentials: AssistantCredentials | null, organizationId: string, speech?: SpeechEnvironment) {
  const speechProvider = speechProviderForOrganization(organizationId, speech, config.sttProvider);
  const speechKey = speechProvider === 'groq' ? (config.sttProvider === 'legacy' ? speech?.groqKey : credentials?.groq) : credentials?.deepgram;
  return {
    available: !!credentials && config.roleEnabled && validProviderKey(credentials[config.roleProvider]),
    visionAvailable: !!credentials && config.roleEnabled && config.roleVisionEnabled && validProviderKey(credentials.deepseek),
    speech: { available: config.sttEnabled && validProviderKey(speechKey), provider: speechProvider },
  };
}

/** No provider call. Reports what Rolê can do for this person in this project. */
export async function roleStatus(db: D1Database, actor: PortalActor | null, input: { projectId?: string | null }, secret: string, options: Options = {}): Promise<RoleAvailability> {
  const project = projectId(input.projectId), { current, organizationId } = await scopedActor(db, actor, project);
  const today = dayKey(options.now ?? Date.now());
  const usage = await one(db, 'SELECT reserved_usd_micros FROM ai_organization_usage WHERE organization_id=? AND day=?', [organizationId, today]);
  const base = { contract: ROLE_CONTRACT, organizationId, projectId: project, reservedTodayMicros: Number(usage?.reserved_usd_micros ?? 0) };
  try {
    const { config, credentials } = await loadAssistantSettings(db, secret, organizationId, 'configuration', options.keys, current.userId);
    const state = availability(config, credentials, organizationId, options.speech);
    return { ...base, ...state, provider: config.roleProvider, model: ROLE_MODELS[config.roleProvider].model, dailyLimitMicros: config.dailyUsdMicros,
      reason: state.available ? null : !config.roleEnabled ? 'O Rolê ainda não foi ligado nesta organização.' : 'Falta a chave do provedor escolhido para o Rolê.' };
  } catch (error) {
    const reason = error instanceof HttpError && error.status === 403 ? 'A IA desta organização está liberada só para outra pessoa.' : 'O Rolê ainda não foi configurado nesta organização.';
    return { ...base, available: false, reason, provider: 'deepseek', model: ROLE_MODELS.deepseek.model, visionAvailable: false, speech: { available: false, provider: 'groq' }, dailyLimitMicros: 0 };
  }
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
    const content = turn.role === 'user' ? safeRequest(turn.content) : turn.content.trim();
    if (containsCredential(content)) throw new HttpError(400, 'Remova senhas, tokens e chaves antes de continuar.', 'assistant_sensitive');
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
  const head = Uint8Array.from(atob(encoded.slice(0, 16)), char => char.charCodeAt(0));
  if (!IMAGE_TYPES[mime].every((byte, index) => head[index] === byte)) throw new HttpError(415, 'O arquivo não parece ser a imagem informada.', 'role_image');
  return { dataUrl: value as string, bytes, mime };
}

function transportBody(provider: 'deepseek' | 'groq', turns: RoleTurn[], message: string, projectName: string, image: string | null) {
  const user = `Projeto atual: ${projectName}\nMensagem: ${message}`;
  const messages = [
    { role: 'system', content: ROLE_SYSTEM_PROMPT },
    ...turns.map(turn => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: image ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: image } }] : user },
  ];
  if (provider === 'groq') {
    return { model: ROLE_MODELS.groq.model, temperature: 0.4, max_completion_tokens: ROLE_MAX_OUTPUT_TOKENS, stream: false, reasoning_effort: 'low', include_reasoning: false, response_format: { type: 'json_object' }, messages };
  }
  return { model: ROLE_MODELS.deepseek.model, thinking: { type: 'disabled' }, temperature: 0.4, max_tokens: ROLE_MAX_OUTPUT_TOKENS, stream: false, response_format: { type: 'json_object' }, messages };
}

const withheld = () => new HttpError(502, 'A resposta do provedor não pôde ser mostrada. Nada foi cobrado além do previsto.', 'role_provider_schema');
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {});
    throw new HttpError(503, response.status === 401 || response.status === 403 ? 'O provedor recusou a chave. Peça à administração para testar ou trocar a chave.' : response.status === 429 ? 'O provedor atingiu o limite de uso agora. Tente de novo em alguns minutos.' : 'O provedor não respondeu. A reserva preventiva continua contando no limite diário.', 'role_provider_unavailable');
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

async function dispatch(provider: 'deepseek' | 'groq', apiKey: string, body: unknown, signal: AbortSignal, fetcher: typeof fetch) {
  const model = ROLE_MODELS[provider];
  let data: Record<string, unknown>;
  try {
    data = await boundedJson(await fetcher(model.endpoint, { method: 'POST', redirect: 'error', cache: 'no-store', signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'A chamada ao Rolê falhou ou demorou demais. Não houve nova tentativa automática.', 'role_provider_unavailable');
  }
  if (JSON.stringify(data).includes(apiKey)) throw withheld();
  const choices = Array.isArray(data.choices) ? data.choices as { finish_reason?: unknown; message?: { content?: unknown; tool_calls?: unknown } }[] : [];
  const choice = choices.length === 1 ? choices[0] : null;
  if (data.model !== model.model || !choice || choice.finish_reason !== 'stop' || choice.message?.tool_calls || typeof choice.message?.content !== 'string' || choice.message.content.length > 16000) throw withheld();
  const usage = data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : {};
  const inputTokens = Number(usage.prompt_tokens), outputTokens = Number(usage.completion_tokens);
  if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) || inputTokens < 0 || outputTokens < 0 || outputTokens > ROLE_MAX_OUTPUT_TOKENS) throw withheld();
  let reply;
  try { reply = validateRoleReply(JSON.parse(choice.message.content)); } catch { throw withheld(); }
  if (containsCredential(reply.reply) || reply.operation && containsCredential(reply.operation)) throw withheld();
  return { ...reply, inputTokens, outputTokens, costMicros: Math.ceil(inputTokens * model.inputMicrosPerToken + outputTokens * model.outputMicrosPerToken) };
}

/** One paid call, only after the person accepted a cost ceiling at least as high as the server's. */
export async function roleChat(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, secret: string, options: Options = {}) {
  onlyKeys(input, ['action', 'projectId', 'operationKey', 'consent', 'history', 'message', 'image', 'acceptedCostMicros']);
  if (input.consent !== true) throw new HttpError(400, 'Confirme que o texto e a imagem podem ir para o provedor de IA.', 'assistant_consent');
  if (typeof input.operationKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.operationKey)) throw new HttpError(400, 'Reabra o Rolê antes de enviar.', 'assistant_operation');
  if (typeof input.message !== 'string' || input.message.length > ROLE_MAX_MESSAGE_CHARS) throw new HttpError(400, 'Escreva até 2.000 caracteres por mensagem.', 'assistant_request');
  const project = projectId(input.projectId), message = safeRequest(input.message), turns = history(input.history), image = parseRoleImage(input.image);
  const { current, organizationId, projectName } = await scopedActor(db, actor, project), now = options.now ?? Date.now();
  const { config, credentials, revision } = await loadAssistantSettings(db, secret, organizationId, 'configuration', options.keys, current.userId);
  const state = availability(config, credentials, organizationId, options.speech);
  if (!state.available) throw new HttpError(503, 'O Rolê está desligado ou sem chave nesta organização.', 'role_unavailable');
  if (image && !state.visionAvailable) throw new HttpError(503, 'A leitura de imagens não está ligada nesta organização. Envie só o texto.', 'role_vision_unavailable');
  const provider = image ? 'deepseek' as const : config.roleProvider;
  const apiKey = credentials[provider];
  if (!validProviderKey(apiKey)) throw new HttpError(503, 'Falta a chave do provedor escolhido para o Rolê.', 'role_unavailable');
  const estimate = roleEstimate({ textProvider: config.roleProvider, textBytes: roleConversationBytes(turns, message, projectName), hasImage: !!image });
  if (!Number.isSafeInteger(input.acceptedCostMicros) || Number(input.acceptedCostMicros) < estimate.costMicros) {
    throw new HttpError(409, 'O custo previsto mudou. Confira o novo valor e envie de novo.', 'role_cost_changed');
  }
  const reservation = { tokens: estimate.tokens, cost: estimate.costMicros, calls: 1, milliseconds: config.timeoutMs };
  const id = await digest(`role\n${current.userId}\n${project}\n${input.operationKey}`);
  const fingerprint = await digest(JSON.stringify({ contract: ROLE_CONTRACT, message, turns, image: image ? await digest(image.dataUrl) : null, revision }));
  const authorization = roleAuthorization(db, current, project, organizationId, revision), nonce = crypto.randomUUID(), day = dayKey(now);
  const replay = async () => {
    const call = await one(db, 'SELECT fingerprint FROM ai_calls WHERE id=?', [id]);
    if (call) throw new HttpError(409, call.fingerprint === fingerprint ? 'Esta mensagem já foi enviada. Escreva de novo para uma nova resposta.' : 'Este envio já foi usado com outra mensagem.', 'assistant_call_replay');
  };
  await replay();
  try {
    await db.batch(reservationStatements(db, { table: 'ai_calls', authorization, id, fingerprint, nonce, actorId: current.userId, projectId: project, organizationId, day, createdAt: new Date(now).toISOString(), revision, config, reservation }));
  } catch (error) {
    if (String(error).includes('assistant_authority_changed')) throw new HttpError(403, 'Seu acesso ou a configuração mudou.', 'assistant_forbidden');
    await replay();
    throw error;
  }
  const admitted = await one(db, 'SELECT admission_nonce FROM ai_calls WHERE id=?', [id]);
  if (admitted?.admission_nonce !== nonce) throw new HttpError(429, 'O limite diário de IA desta organização foi atingido. Tente amanhã ou peça para ampliar o limite.', 'assistant_quota');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await dispatch(provider, apiKey, transportBody(provider, turns, message, projectName, image?.dataUrl ?? null), controller.signal, options.fetcher ?? fetch);
    const details = { provider, model: ROLE_MODELS[provider].model, hasImage: !!image, inputTokens: result.inputTokens, outputTokens: result.outputTokens, reservedUsdMicros: estimate.costMicros, usdMicros: result.costMicros, operationSuggested: !!result.operation };
    await db.batch([
      authorization,
      db.prepare("UPDATE ai_calls SET status='complete' WHERE id=? AND admission_nonce=? AND status='reserved'").bind(id, nonce),
      db.prepare("INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,?,'assistant.role.chat',?,?,?)")
        .bind(crypto.randomUUID(), current.userId, project, organizationId, id, JSON.stringify(details), new Date().toISOString()),
    ]);
    return { contract: ROLE_CONTRACT, reply: result.reply, operation: result.operation, provider, model: ROLE_MODELS[provider].model,
      reservedMicros: estimate.costMicros, costMicros: result.costMicros, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  } catch (error) {
    await db.prepare("UPDATE ai_calls SET status='failed' WHERE id=? AND status='reserved'").bind(id).run();
    if (String(error).includes('assistant_authority_changed')) throw new HttpError(403, 'Seu acesso ou a configuração mudou antes da resposta.', 'assistant_forbidden');
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
