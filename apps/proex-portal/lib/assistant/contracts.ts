import { HttpError } from '../errors';
import { containsCredential } from './sensitive';

export const ASSISTANT_CONTRACT = 'proex.assistant/v2';
export const PROVIDERS = {
 deepseek: { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', revision: 'DeepSeek-V4.1-Flash-1017', inputMicrosPerToken: 0.3, outputMicrosPerToken: 1.2 },
 typesafe: { endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.14.0', inputMicrosPerToken: 0.042 },
 openai: { endpoint:'https://api.openai.com/v1/responses',model:'gpt-5.6-luna',revision:'gpt-5.6-luna · alias verificado em 2026-11-05',inputMicrosPerToken:0.25,outputMicrosPerToken:1.2 },
} as const;
export type TextProvider = 'deepseek'|'openai';
export type RoleProvider = 'deepseek'|'groq';
export type AssistantConfig = { roleEnabled: boolean; roleProvider: RoleProvider; roleVisionEnabled: boolean; roleModel: string; roleVisionModel: string; documentModel: string; decisionModel: string; speechModel: string; enabled: boolean; documentEnabled: boolean; jevEnabled: boolean; sttEnabled: boolean; sttProvider: 'legacy' | 'deepgram' | 'groq'; textProvider:TextProvider; openaiModel:'gpt-5.6-luna'; usageScope: 'private' | 'organization'; usageUserId: string | null; model: 'deepseek-flash'; jevModel: 'jev-1.14.0'; dailyUsdMicros: number; dailyTokens: number; dailyCalls: number; dailyMs: number; timeoutMs: number; maxOutputTokens: number; testMode: boolean; testModeRestore: DailyLimits | null };
/** Tarefas que a administração geral pode mandar para um modelo do catálogo. Vazio = padrão de hoje. */
export const TASK_MODEL_KEYS = ['documentModel', 'decisionModel', 'speechModel'] as const;
export type TaskModelKey = (typeof TASK_MODEL_KEYS)[number];
export type DailyLimits = { dailyUsdMicros: number; dailyTokens: number; dailyCalls: number; dailyMs: number };
/** Modo de testes: limites altos até alguém desligar; ao desligar, voltam os limites de antes. */
export const TEST_MODE_LIMITS: DailyLimits = { dailyUsdMicros: 5_000_000, dailyTokens: 3_000_000, dailyCalls: 500, dailyMs: 10_800_000 };
export const LIMIT_BOUNDS = { dailyUsdMicros: [1000, 10_000_000], dailyTokens: [1000, 5_000_000], dailyCalls: [1, 1000], dailyMs: [1000, 14_400_000], timeoutMs: [1000, 20_000], maxOutputTokens: [200, 2000] } as const;
export function dailyLimits(config: DailyLimits): DailyLimits { return { dailyUsdMicros: config.dailyUsdMicros, dailyTokens: config.dailyTokens, dailyCalls: config.dailyCalls, dailyMs: config.dailyMs }; }
// JSON saved before usage policies remains organization-scoped. New registrations
// must use newAssistantConfig so that an old document never changes meaning.
export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = { roleEnabled: false, roleProvider: 'deepseek', roleVisionEnabled: false, roleModel: '', roleVisionModel: '', documentModel: '', decisionModel: '', speechModel: '', enabled: false, documentEnabled: false, jevEnabled: false, sttEnabled: false, sttProvider: 'legacy',textProvider:'deepseek',openaiModel:'gpt-5.6-luna', usageScope: 'organization', usageUserId: null, model: 'deepseek-flash', jevModel: 'jev-1.14.0', dailyUsdMicros: 1_000_000, dailyTokens: 100_000, dailyCalls: 20, dailyMs: 300_000, timeoutMs: 12_000, maxOutputTokens: 1200, testMode: false, testModeRestore: null };
export function textModel(config:AssistantConfig){return{provider:config.textProvider,...PROVIDERS[config.textProvider],model:config.textProvider==='openai'?config.openaiModel:config.model};}
export function newAssistantConfig(actorId: string): AssistantConfig { return { ...DEFAULT_ASSISTANT_CONFIG, usageScope: 'private', usageUserId: actorId }; }
export type AssistantCredentials = { deepseek: string; typesafe: string; deepgram?: string; groq?: string; openai?:string };
export const credentialProviders = ['deepseek','openai', 'typesafe', 'deepgram', 'groq'] as const;
export type CredentialProvider = (typeof credentialProviders)[number];

export function availableProviderCredentials(credentials: Record<string, unknown>): AssistantCredentials {
 const read = (provider: CredentialProvider) => typeof credentials[provider] === 'string' ? String(credentials[provider]) : '';
 return { deepseek: read('deepseek'), typesafe: read('typesafe'), deepgram: read('deepgram'), groq: read('groq'),openai:read('openai') };
}
export type AssistantItem = { id: string; name: string; category: string; unit: string; stock: number; reserved: number; condition: string };
export type AssistantIntent = 'stock.query' | 'stock.receive' | 'stock.distribute' | 'stock.consume' | 'record.create';
export type AssistantProposal = { intent: AssistantIntent; itemId: string | null; quantity: number; title: string; body: string; evidence: { source: 'request'; quote: string }[] };
export type AssistantPlan = { contract: string; id: string; actorId: string; organizationId: string; projectId: string; configRevision: number; proposal: AssistantProposal; before: AssistantItem | null; after: { stock: number; available: number } | null; provenance: { requestSha256: string; contextSha256: string; provider: TextProvider; model: string; modelRevision: string; returnedModel: string; jevModel: string | null; reviewedAt: string }; expiresAt: number };

export function object(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Os dados enviados são inválidos.', 'assistant_schema');
 return value as Record<string, unknown>;
}
export function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): void {
 if (Object.keys(value).some(key => !keys.includes(key))) throw new HttpError(400, 'Há campos não permitidos na solicitação.', 'assistant_schema');
}
export function validateConfig(value: unknown): AssistantConfig {
 const input = object(value); onlyKeys(input, Object.keys(DEFAULT_ASSISTANT_CONFIG));
 const result = { ...DEFAULT_ASSISTANT_CONFIG, ...input } as AssistantConfig;
 if(!['deepseek','openai'].includes(result.textProvider)||result.openaiModel!==PROVIDERS.openai.model)throw new HttpError(400,'Escolha um provedor e modelo de texto revisados nesta versão.','assistant_model');
 if (!['private','organization'].includes(result.usageScope) || (result.usageScope === 'private' ? typeof result.usageUserId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(result.usageUserId) : result.usageUserId !== null)) throw new HttpError(400, 'Escolha uso pessoal ou da organização.', 'assistant_usage_scope');
 if (typeof result.roleEnabled !== 'boolean' || typeof result.roleVisionEnabled !== 'boolean' || !['deepseek','groq'].includes(result.roleProvider)) throw new HttpError(400, 'Escolha um modelo revisado para o Rolê.', 'assistant_model');
 // Catalog model ids ('' keeps the reviewed DeepSeek/Groq path). Existence is checked against the catalog when saving.
 if (typeof result.roleModel !== 'string' || typeof result.roleVisionModel !== 'string' || [result.roleModel, result.roleVisionModel].some(id => id !== '' && !/^[a-z0-9][a-z0-9-]{1,47}$/.test(id))) throw new HttpError(400, 'Escolha um modelo do catálogo para o Rolê.', 'assistant_model');
 // Per-task routing: '' keeps today's default for documents, the decision check/triage and voice.
 if (TASK_MODEL_KEYS.some(key => typeof result[key] !== 'string' || (result[key] !== '' && !/^[a-z0-9][a-z0-9-]{1,47}$/.test(result[key])))) throw new HttpError(400, 'Escolha um modelo do catálogo para a tarefa.', 'assistant_model');
 if (typeof result.documentEnabled !== 'boolean' || typeof result.sttEnabled !== 'boolean' || typeof result.enabled !== 'boolean' || typeof result.jevEnabled !== 'boolean' || !['legacy','deepgram','groq'].includes(result.sttProvider) || result.model !== PROVIDERS.deepseek.model || result.jevModel !== PROVIDERS.typesafe.model) throw new HttpError(400, 'Escolha os modelos verificados nesta versão do portal.', 'assistant_model');
 const inBounds = (key: keyof typeof LIMIT_BOUNDS, n: unknown) => Number.isSafeInteger(n) && Number(n) >= LIMIT_BOUNDS[key][0] && Number(n) <= LIMIT_BOUNDS[key][1];
 for (const key of Object.keys(LIMIT_BOUNDS) as (keyof typeof LIMIT_BOUNDS)[]) if (!inBounds(key, result[key])) throw new HttpError(400, `Confira o limite ${LIMIT_LABELS[key]}.`, 'assistant_budget');
 if (typeof result.testMode !== 'boolean') throw new HttpError(400, 'Confira o modo de testes.', 'assistant_budget');
 if (result.testModeRestore !== null) { const restore = object(result.testModeRestore); onlyKeys(restore, ['dailyUsdMicros', 'dailyTokens', 'dailyCalls', 'dailyMs']); if ((['dailyUsdMicros', 'dailyTokens', 'dailyCalls', 'dailyMs'] as const).some(key => !inBounds(key, restore[key]))) throw new HttpError(400, 'Confira os limites guardados do modo de testes.', 'assistant_budget'); }
 return result;
}
const LIMIT_LABELS: Record<keyof typeof LIMIT_BOUNDS, string> = { dailyUsdMicros: 'de custo por dia', dailyTokens: 'de tokens por dia', dailyCalls: 'de chamadas por dia', dailyMs: 'de tempo por dia', timeoutMs: 'de prazo por chamada', maxOutputTokens: 'de tamanho da resposta' };
export function safeRequest(value: unknown): string {
 if (typeof value !== 'string' || !value.trim() || value.length > 4000 || /[\u0000\u000b\u000c]/u.test(value)) throw new HttpError(400, 'Descreva o pedido em até 4.000 caracteres.', 'assistant_request');
 if (containsCredential(value)) throw new HttpError(400, 'Remova senhas, tokens e chaves antes de continuar.', 'assistant_sensitive');
 return value.trim().replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[e-mail omitido]').replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento omitido]');
}
export function validateProposal(value: unknown, request: string, items: AssistantItem[]): AssistantProposal {
 const p = object(value); onlyKeys(p, ['intent', 'itemId', 'quantity', 'title', 'body', 'evidence']);
 if (!['stock.query', 'stock.receive', 'stock.distribute', 'stock.consume', 'record.create'].includes(String(p.intent)) || !(p.itemId === null || typeof p.itemId === 'string') || typeof p.quantity !== 'number' || !Number.isSafeInteger(p.quantity) || p.quantity < 0 || p.quantity > 1_000_000 || typeof p.title !== 'string' || p.title.length > 160 || typeof p.body !== 'string' || p.body.length > 2000 || !Array.isArray(p.evidence) || p.evidence.length < 1 || p.evidence.length > 3) throw new HttpError(502, 'A IA não produziu uma proposta válida. Reescreva o pedido.', 'assistant_provider_schema');
 for (const raw of p.evidence) { const e = object(raw); onlyKeys(e, ['source', 'quote']); if (e.source !== 'request' || typeof e.quote !== 'string' || !e.quote.trim() || e.quote.length > 500 || !request.includes(e.quote)) throw new HttpError(502, 'A proposta não apresenta evidência no seu pedido.', 'assistant_provenance'); }
 if (p.intent === 'record.create') { if (p.itemId !== null || p.quantity !== 0 || !p.title.trim() || !p.body.trim()) throw new HttpError(502, 'Confira o texto do registro antes de continuar.', 'assistant_provider_schema'); }
 else if (!items.some(item => item.id === p.itemId) || (p.intent === 'stock.query' ? p.quantity !== 0 : p.quantity < 1)) throw new HttpError(502, 'A proposta precisa de um material deste projeto e uma quantidade válida.', 'assistant_scope');
 if (p.intent !== 'stock.query' && p.intent !== 'record.create' && !new RegExp(`(?:^|\\D)${p.quantity}(?:\\D|$)`).test(request)) throw new HttpError(502, 'Informe a quantidade em algarismos no pedido para evitar ambiguidade.', 'assistant_quantity');
 return p as AssistantProposal;
}
