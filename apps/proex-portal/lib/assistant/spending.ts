import { platformOwnerAuthoritySql, type PortalActor } from '../access';
import { all, one } from '../database';
import { HttpError } from '../errors';
import { DEFAULT_ASSISTANT_CONFIG, validateConfig } from './contracts';

/*
 * Painel de gastos de IA (somente administração geral).
 * Lê a auditoria das chamadas pagas e o teto diário reservado. Nada sai daqui
 * sem passar por lista de permissão: nunca devolve `details` cru, prompt,
 * conteúdo, chave ou e-mail.
 */

export const SPENDING_MAX_DAYS = 92;
export const SPENDING_DEFAULT_DAYS = 30;
export const SPENDING_DAY_LIMIT = 200;
/** Teto de linhas lidas por consulta: protege o servidor; acima disso o resultado é marcado como parcial. */
export const SPENDING_ROW_LIMIT = 50_000;

export const SPENDING_PROVIDERS = { deepseek: 'DeepSeek', groq: 'Groq', openai: 'OpenAI', typesafe: 'TypeSafe JEV', deepgram: 'Deepgram', other: 'Outro' } as const;
export type SpendingProvider = keyof typeof SPENDING_PROVIDERS;
export const SPENDING_FUNCTIONS = { role: 'Conversa do Rolê', photos: 'Fotos', operations: 'Operações', documents: 'Documentos', speech: 'Voz para texto', triage: 'Decisão/triagem', compare: 'Comparação' } as const;
export type SpendingFunction = keyof typeof SPENDING_FUNCTIONS;

/** Ação de auditoria → função mostrada. Fotos são separadas pela marca `hasImage` da conversa. */
const ACTIONS = ['assistant.role.chat', 'assistant.plan', 'import.ai.preview', 'assistant.transcribe', 'task.triage.prepare', 'assistant.compare'] as const;
type SpendingAction = (typeof ACTIONS)[number];
const ACTION_FUNCTION: Record<Exclude<SpendingAction, 'assistant.role.chat'>, SpendingFunction> = {
  'assistant.plan': 'operations', 'import.ai.preview': 'documents', 'assistant.transcribe': 'speech', 'task.triage.prepare': 'triage', 'assistant.compare': 'compare',
};
/** A triagem usa sempre o JEV; a auditoria não grava o provedor. */
const IMPLICIT_PROVIDER: Partial<Record<SpendingAction, SpendingProvider>> = { 'task.triage.prepare': 'typesafe' };

export type SpendingBucket = { calls: number; realUsdMicros: number; ceilingUsdMicros: number; spentUsdMicros: number };
export type SpendingDay = {
  day: string;
  /** Soma do custo informado pelo provedor (somente chamadas que informam). */
  realUsdMicros: number;
  /** Teto reservado no dia para a organização (ai_organization_usage). */
  reservedUsdMicros: number;
  /** Chamadas concluídas registradas na auditoria. */
  calls: number;
  /** Custo real quando existe; senão, o teto da própria chamada. */
  spentUsdMicros: number;
  byProvider: Partial<Record<SpendingProvider, SpendingBucket>>;
  byFunction: Partial<Record<SpendingFunction, SpendingBucket>>;
};
export type SpendingTotals = Omit<SpendingDay, 'day'>;
export type AiSpending = {
  organizationId: string; from: string; to: string; today: SpendingTotals & { day: string };
  dailyLimitUsdMicros: number; days: SpendingDay[]; totals: SpendingTotals; partial: boolean;
  providers: { key: SpendingProvider; label: string }[]; functions: { key: SpendingFunction; label: string }[];
};
export type SpendingCall = {
  at: string; time: string; function: SpendingFunction; functionLabel: string;
  provider: SpendingProvider | 'mixed'; providerLabel: string; model: string | null;
  realUsdMicros: number | null; ceilingUsdMicros: number | null; who: string;
};
export type AiSpendingDay = { organizationId: string; day: string; calls: SpendingCall[]; total: number; truncated: boolean };

const DAY = 86_400_000;
const brasiliaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const brasiliaTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const forbidden = () => new HttpError(403, 'Somente a administração geral pode ver os gastos de IA.', 'assistant_spending_admin');

async function requireOwner(db: D1Database, actor: PortalActor | null) {
  if (!actor) throw new HttpError(401, 'Entre para ver os gastos de IA.', 'unauthenticated');
  const authority = platformOwnerAuthoritySql(actor);
  if (!await one(db, `SELECT 1 WHERE ${authority.sql}`, authority.values)) throw forbidden();
  return authority;
}

function organizationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new HttpError(400, 'Escolha uma organização.', 'assistant_organization');
  return value;
}

function dayValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `Informe ${label} no formato AAAA-MM-DD.`, 'assistant_spending_range');
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new HttpError(400, `A data de ${label} não existe.`, 'assistant_spending_range');
  return value;
}
const addDays = (day: string, amount: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + amount * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY);
/** Brasília está em UTC-3 fixo desde 2019; a janela consultada ganha um dia de folga e o agrupamento usa o fuso oficial. */
const windowStart = (day: string) => `${addDays(day, -1)}T00:00:00.000Z`;
const windowEnd = (day: string) => `${addDays(day, 2)}T00:00:00.000Z`;

function parseDetails(raw: unknown): Record<string, unknown> {
  try { const parsed: unknown = JSON.parse(String(raw ?? '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
function micros(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
}
function providerKey(value: unknown): SpendingProvider {
  return typeof value === 'string' && value !== 'other' && Object.hasOwn(SPENDING_PROVIDERS, value) ? value as SpendingProvider : 'other';
}
function modelName(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/.test(value) ? value : null;
}
function displayName(value: unknown): string {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  if (!name) return 'Pessoa sem nome';
  // Nome de exibição nunca pode vazar e-mail ou caracteres de controle.
  if (name.includes('@') || name.length > 120 || /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/u.test(name)) return 'Pessoa da equipe';
  return name;
}

type Charge = { fn: SpendingFunction; provider: SpendingProvider; real: number | null; ceiling: number | null };
/** Reconstrói cada linha da auditoria por lista de permissão. A comparação pode gerar várias cobranças (uma por modelo). */
function charges(action: string, details: Record<string, unknown>): { fn: SpendingFunction; parts: Charge[]; models: string[]; ceiling: number | null; real: number | null } | null {
  if (!(ACTIONS as readonly string[]).includes(action)) return null;
  const typed = action as SpendingAction;
  const fn: SpendingFunction = typed === 'assistant.role.chat' ? (details.hasImage === true ? 'photos' : 'role') : ACTION_FUNCTION[typed];
  const ceiling = micros(details.reservedUsdMicros);
  if (typed === 'assistant.compare') {
    const list = Array.isArray(details.models) ? details.models.slice(0, 8) : [];
    const parts: Charge[] = [], models: string[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>, model = modelName(item.model);
      if (model) models.push(model);
      parts.push({ fn, provider: providerKey(item.provider), real: micros(item.usdMicros), ceiling: null });
    }
    const real = micros(details.usdMicros) ?? (parts.some(part => part.real !== null) ? parts.reduce((sum, part) => sum + (part.real ?? 0), 0) : null);
    if (!parts.length) parts.push({ fn, provider: 'other', real, ceiling });
    else if (parts.length === 1) parts[0].ceiling = ceiling;
    return { fn, parts, models, ceiling, real };
  }
  const provider = IMPLICIT_PROVIDER[typed] ?? providerKey(details.provider);
  const real = micros(details.usdMicros);
  return { fn, parts: [{ fn, provider, real, ceiling }], models: [modelName(details.model)].filter((model): model is string => !!model), ceiling, real };
}

const emptyBucket = (): SpendingBucket => ({ calls: 0, realUsdMicros: 0, ceilingUsdMicros: 0, spentUsdMicros: 0 });
const emptyTotals = (): SpendingTotals => ({ realUsdMicros: 0, reservedUsdMicros: 0, calls: 0, spentUsdMicros: 0, byProvider: {}, byFunction: {} });
function add(target: SpendingBucket, calls: number, real: number | null, ceiling: number | null) {
  target.calls += calls; target.realUsdMicros += real ?? 0; target.ceilingUsdMicros += ceiling ?? 0; target.spentUsdMicros += real ?? ceiling ?? 0;
}
function record(totals: SpendingTotals, charge: NonNullable<ReturnType<typeof charges>>) {
  totals.calls += 1; totals.realUsdMicros += charge.real ?? 0; totals.spentUsdMicros += charge.real ?? charge.ceiling ?? 0;
  add(totals.byFunction[charge.fn] ??= emptyBucket(), 1, charge.real, charge.ceiling);
  // Na comparação, a chamada conta uma vez por provedor envolvido; o custo é o de cada modelo.
  const seen = new Set<SpendingProvider>();
  for (const part of charge.parts) {
    add(totals.byProvider[part.provider] ??= emptyBucket(), seen.has(part.provider) ? 0 : 1, part.real, part.ceiling);
    seen.add(part.provider);
  }
}
function merge(target: SpendingTotals, source: SpendingTotals) {
  target.calls += source.calls; target.realUsdMicros += source.realUsdMicros; target.reservedUsdMicros += source.reservedUsdMicros; target.spentUsdMicros += source.spentUsdMicros;
  for (const kind of ['byProvider', 'byFunction'] as const) {
    for (const [key, bucket] of Object.entries(source[kind]) as [string, SpendingBucket][]) {
      const into = ((target[kind] as Record<string, SpendingBucket>)[key] ??= emptyBucket());
      into.calls += bucket.calls; into.realUsdMicros += bucket.realUsdMicros; into.ceilingUsdMicros += bucket.ceilingUsdMicros; into.spentUsdMicros += bucket.spentUsdMicros;
    }
  }
}

const actionList = ACTIONS.map(() => '?').join(',');
async function activeOrganization(db: D1Database, id: string, authority: { sql: string; values: unknown[] }) {
  if (!await one(db, `SELECT 1 FROM organizations WHERE id=? AND status='active' AND ${authority.sql}`, [id, ...authority.values])) throw new HttpError(404, 'Organização indisponível.', 'assistant_organization');
}

async function aggregate(db: D1Database, id: string, from: string, to: string, authority: { sql: string; values: unknown[] }) {
  const byDay = new Map<string, SpendingTotals>();
  const at = (day: string) => { let totals = byDay.get(day); if (!totals) { totals = emptyTotals(); byDay.set(day, totals); } return totals; };
  // A auditoria guarda somente metadados; cada linha é lida e reduzida em memória por lista de permissão.
  const rows = await all(db, `SELECT a.action,a.details,a.created_at FROM audit a WHERE a.organization_id=? AND a.action IN (${actionList})
    AND a.created_at>=? AND a.created_at<? AND ${authority.sql} ORDER BY a.created_at LIMIT ?`, [id, ...ACTIONS, windowStart(from), windowEnd(to), ...authority.values, SPENDING_ROW_LIMIT + 1]);
  const partial = rows.length > SPENDING_ROW_LIMIT;
  if (partial) rows.length = SPENDING_ROW_LIMIT;
  for (const row of rows) {
    const time = Date.parse(String(row.created_at ?? ''));
    if (!Number.isFinite(time)) continue;
    const day = brasiliaDay.format(new Date(time));
    if (day < from || day > to) continue;
    const charge = charges(String(row.action ?? ''), parseDetails(row.details));
    if (charge) record(at(day), charge);
  }
  const usage = await all(db, `SELECT day,reserved_usd_micros FROM ai_organization_usage WHERE organization_id=? AND day>=? AND day<=? AND ${authority.sql}`, [id, from, to, ...authority.values]);
  for (const row of usage) {
    const day = String(row.day ?? '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) at(day).reservedUsdMicros += Math.max(0, Number(row.reserved_usd_micros) || 0);
  }
  return { byDay, partial };
}

/** Gastos por dia (Brasília) da organização. Somente administração geral; intervalo máximo de 92 dias, padrão últimos 30. */
export async function aiSpending(db: D1Database, actor: PortalActor | null, input: { organizationId: unknown; from?: unknown; to?: unknown }, now = Date.now()): Promise<AiSpending> {
  const authority = await requireOwner(db, actor);
  const id = organizationId(input.organizationId);
  const today = brasiliaDay.format(new Date(now));
  const to = input.to === undefined || input.to === null || input.to === '' ? today : dayValue(input.to, 'o fim do período');
  const from = input.from === undefined || input.from === null || input.from === '' ? addDays(to, -(SPENDING_DEFAULT_DAYS - 1)) : dayValue(input.from, 'o início do período');
  if (from > to) throw new HttpError(400, 'O início do período precisa vir antes do fim.', 'assistant_spending_range');
  if (daysBetween(from, to) + 1 > SPENDING_MAX_DAYS) throw new HttpError(400, `Escolha um período de até ${SPENDING_MAX_DAYS} dias.`, 'assistant_spending_range');
  await activeOrganization(db, id, authority);
  const { byDay, partial } = await aggregate(db, id, from, to, authority);
  const todayTotals = from <= today && today <= to ? byDay.get(today) ?? emptyTotals() : (await aggregate(db, id, today, today, authority)).byDay.get(today) ?? emptyTotals();
  const settings = await one(db, `SELECT config_json FROM ai_organization_settings WHERE organization_id=? AND ${authority.sql}`, [id, ...authority.values]);
  let dailyLimitUsdMicros = DEFAULT_ASSISTANT_CONFIG.dailyUsdMicros;
  if (settings) { try { dailyLimitUsdMicros = validateConfig(JSON.parse(String(settings.config_json))).dailyUsdMicros; } catch { /* configuração antiga: mantém o padrão */ } }
  const days: SpendingDay[] = [], totals = emptyTotals();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const value = byDay.get(day) ?? emptyTotals();
    days.push({ day, ...value }); merge(totals, value);
  }
  // A autoridade é conferida de novo: uma revogação durante a leitura não devolve dados.
  if (!await one(db, `SELECT 1 WHERE ${authority.sql}`, authority.values)) throw forbidden();
  return {
    organizationId: id, from, to, today: { day: today, ...todayTotals }, dailyLimitUsdMicros, days, totals, partial,
    providers: (Object.keys(SPENDING_PROVIDERS) as SpendingProvider[]).map(key => ({ key, label: SPENDING_PROVIDERS[key] })),
    functions: (Object.keys(SPENDING_FUNCTIONS) as SpendingFunction[]).map(key => ({ key, label: SPENDING_FUNCTIONS[key] })),
  };
}

/** Chamadas de um dia (Brasília), mais recentes primeiro, no máximo 200. Mostra só o nome de exibição de quem pediu. */
export async function aiSpendingDay(db: D1Database, actor: PortalActor | null, input: { organizationId: unknown; day: unknown }): Promise<AiSpendingDay> {
  const authority = await requireOwner(db, actor);
  const id = organizationId(input.organizationId), day = dayValue(input.day, 'o dia');
  await activeOrganization(db, id, authority);
  const rows = await all(db, `SELECT a.action,a.details,a.created_at,p.display_name FROM audit a LEFT JOIN profiles p ON p.user_id=a.actor_id
    WHERE a.organization_id=? AND a.action IN (${actionList}) AND a.created_at>=? AND a.created_at<? AND ${authority.sql}
    ORDER BY a.created_at DESC,a.id DESC LIMIT ?`, [id, ...ACTIONS, windowStart(day), windowEnd(day), ...authority.values, SPENDING_ROW_LIMIT]);
  const calls: SpendingCall[] = [];
  let total = 0;
  for (const row of rows) {
    const time = Date.parse(String(row.created_at ?? ''));
    if (!Number.isFinite(time) || brasiliaDay.format(new Date(time)) !== day) continue;
    const charge = charges(String(row.action ?? ''), parseDetails(row.details));
    if (!charge) continue;
    total += 1;
    if (calls.length >= SPENDING_DAY_LIMIT) continue;
    const providers = [...new Set(charge.parts.map(part => part.provider))];
    const provider = providers.length === 1 ? providers[0] : 'mixed';
    calls.push({
      at: new Date(time).toISOString(), time: brasiliaTime.format(new Date(time)), function: charge.fn, functionLabel: SPENDING_FUNCTIONS[charge.fn],
      provider, providerLabel: provider === 'mixed' ? providers.map(key => SPENDING_PROVIDERS[key]).join(' + ') : SPENDING_PROVIDERS[provider],
      model: charge.models.length ? charge.models.slice(0, 4).join(', ') : null,
      realUsdMicros: charge.real, ceilingUsdMicros: charge.ceiling, who: displayName(row.display_name),
    });
  }
  if (!await one(db, `SELECT 1 WHERE ${authority.sql}`, authority.values)) throw forbidden();
  return { organizationId: id, day, calls, total, truncated: total > calls.length };
}
