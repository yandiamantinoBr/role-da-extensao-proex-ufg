import { aiConfigurationAuthority, type PortalActor } from '../access';
import { one } from '../database';
import { HttpError } from '../errors';
import type { AssistantConfig } from './contracts';
import { formatDuration, formatThousands, formatUsd } from './limits-format';

export type QuotaNeed = { cost: number; tokens: number; ms: number; calls: number };
const usd = formatUsd, thousand = formatThousands, seconds = formatDuration;

/**
 * Admission refused: tell which daily limit blocked, how much is used and what the request needed,
 * and who can change it. Never a generic "limit reached".
 */
/** "Peça à administração" (crase) ou "Peça a Fulana". */
const ask = (name: string) => name === 'a administração' ? 'Peça à administração para aumentar o limite.' : `Peça a ${name} para aumentar o limite.`;

export async function quotaRefusal(db: D1Database, actor: PortalActor, organizationId: string, day: string, config: AssistantConfig, need: QuotaNeed, personalCap?: { used: number; max: number }) {
  if (personalCap && personalCap.used >= personalCap.max) {
    const who = await responsibleName(db, actor, organizationId);
    return new HttpError(429, `Você já usou sua parte das chamadas de IA de hoje (${personalCap.used} de ${personalCap.max}); cada pessoa usa no máximo metade das chamadas do dia. O limite volta à meia-noite. ${who.canConfigure ? 'Você pode aumentar as chamadas por dia em Configurações → Chaves e modelos → Funções e acesso → Limites e cotas.' : ask(who.name)}`, 'role_user_quota');
  }
  const usage = await one(db, 'SELECT reserved_usd_micros,reserved_tokens,reserved_ms,calls FROM ai_organization_usage WHERE organization_id=? AND day=?', [organizationId, day]);
  const used = { cost: Number(usage?.reserved_usd_micros ?? 0), tokens: Number(usage?.reserved_tokens ?? 0), ms: Number(usage?.reserved_ms ?? 0), calls: Number(usage?.calls ?? 0) };
  const checks = [
    { key: 'tokens', label: 'tokens', unit: () => ' tokens', used: used.tokens, max: config.dailyTokens, need: need.tokens, fmt: thousand },
    { key: 'cost', label: 'custo', unit: () => '', used: used.cost, max: config.dailyUsdMicros, need: need.cost, fmt: usd },
    { key: 'calls', label: 'chamadas', unit: (n: number) => n === 1 ? ' chamada' : ' chamadas', used: used.calls, max: config.dailyCalls, need: need.calls, fmt: (value: number) => value.toLocaleString('pt-BR') },
    { key: 'time', label: 'tempo', unit: () => '', used: used.ms, max: config.dailyMs, need: need.ms, fmt: seconds },
  ];
  const hit = checks.find(check => check.used + check.need > check.max);
  const who = await responsibleName(db, actor, organizationId);
  // Outra pessoa liberou reserva ou o limite mudou entre a tentativa e esta leitura.
  if (!hit) return new HttpError(429, 'Os limites de IA de hoje estavam no máximo neste instante. Tente de novo em alguns segundos.', 'assistant_quota');
  const situation = hit.need > hit.max
    ? `Este pedido é maior que o limite de ${hit.label} do dia (precisa de até ${hit.fmt(hit.need)}${hit.unit(hit.need)}; o limite é ${hit.fmt(hit.max)}${hit.unit(hit.max)}).`
    : `Acabou o limite de ${hit.label} de hoje (uso: ${hit.fmt(hit.used)} de ${hit.fmt(hit.max)}${hit.unit(hit.max)}; este pedido precisa de até ${hit.fmt(hit.need)}${hit.unit(hit.need)}). O limite volta à meia-noite.`;
  const message = `${situation} ${who.canConfigure ? 'Você pode aumentar o limite em Configurações → Chaves e modelos → Funções e acesso → Limites e cotas.' : ask(who.name)}`;
  return new HttpError(429, message, 'assistant_quota');
}

/** Can this person change the limits? If not, name someone who can (display name only). */
export async function responsibleName(db: D1Database, actor: PortalActor, organizationId: string) {
  const auth = aiConfigurationAuthority(actor, organizationId);
  const canConfigure = !!await one(db, `SELECT 1 FROM organizations WHERE id=? AND ${auth.sql}`, [organizationId, ...auth.values]);
  if (canConfigure) return { canConfigure, name: '' };
  const row = await one(db, `SELECT COALESCE(NULLIF(p.display_name,''),'a administração') AS name FROM members m JOIN portal_users u ON u.user_id=m.user_id AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL LEFT JOIN profiles p ON p.user_id=m.user_id
    WHERE m.role='owner' AND m.revoked_at IS NULL AND (m.organization_id=? OR (m.organization_id IS NULL AND m.project_id IS NULL)) ORDER BY m.organization_id IS NULL, m.created_at LIMIT 1`, [organizationId]);
  return { canConfigure, name: String(row?.name ?? 'a administração') };
}

/** Before/after of every limit and switch, for the configuration history (Registros). */
export const CONFIG_FIELDS: { key: keyof AssistantConfig; label: string; kind: 'bool' | 'usd' | 'int' | 'tokens' | 'ms' | 'text' }[] = [
  { key: 'testMode', label: 'Modo de testes', kind: 'bool' },
  { key: 'dailyUsdMicros', label: 'Custo por dia', kind: 'usd' },
  { key: 'dailyTokens', label: 'Tokens por dia', kind: 'tokens' },
  { key: 'dailyCalls', label: 'Chamadas por dia', kind: 'int' },
  { key: 'dailyMs', label: 'Tempo por dia', kind: 'ms' },
  { key: 'timeoutMs', label: 'Prazo por chamada', kind: 'ms' },
  { key: 'maxOutputTokens', label: 'Tamanho máximo da resposta (tokens)', kind: 'int' },
  { key: 'usageScope', label: 'Quem pode usar', kind: 'text' },
  { key: 'roleEnabled', label: 'Rolê', kind: 'bool' },
  { key: 'roleProvider', label: 'Modelo do Rolê', kind: 'text' },
  { key: 'roleModel', label: 'Modelo do catálogo para o Rolê', kind: 'text' },
  { key: 'roleVisionEnabled', label: 'Rolê lê fotos', kind: 'bool' },
  { key: 'roleVisionModel', label: 'Modelo para fotos', kind: 'text' },
  { key: 'enabled', label: 'Pedidos de operações', kind: 'bool' },
  { key: 'documentEnabled', label: 'Interpretação de documentos', kind: 'bool' },
  { key: 'jevEnabled', label: 'Conferência e triagem', kind: 'bool' },
  { key: 'sttEnabled', label: 'Voz para texto', kind: 'bool' },
  { key: 'sttProvider', label: 'Provedor de voz', kind: 'text' },
  { key: 'textProvider', label: 'Serviço de operações e documentos', kind: 'text' },
  { key: 'documentModel', label: 'Modelo do catálogo para documentos', kind: 'text' },
  { key: 'decisionModel', label: 'Modelo do catálogo para conferência e triagem', kind: 'text' },
  { key: 'speechModel', label: 'Modelo do catálogo para voz', kind: 'text' },
];
export type ConfigChange = { field: string; before: string | number | boolean | null; after: string | number | boolean | null };
export function configChanges(before: AssistantConfig, after: AssistantConfig): ConfigChange[] {
  return CONFIG_FIELDS.filter(field => before[field.key] !== after[field.key]).map(field => ({ field: String(field.key), before: before[field.key] as ConfigChange['before'], after: after[field.key] as ConfigChange['after'] }));
}
export function describeChange(change: ConfigChange): string {
  const field = CONFIG_FIELDS.find(entry => entry.key === change.field);
  if (!field) return '';
  const show = (value: ConfigChange['before']) => value === null || value === '' ? '—' : field.kind === 'bool' ? (value ? 'ligado' : 'desligado') : field.kind === 'usd' ? usd(Number(value)) : field.kind === 'ms' ? seconds(Number(value)) : field.kind === 'tokens' ? thousand(Number(value)) : field.kind === 'int' ? Number(value).toLocaleString('pt-BR') : value === 'private' ? 'só quem configurou' : value === 'organization' ? 'organização' : String(value).slice(0, 60);
  return `${field.label}: ${show(change.before)} → ${show(change.after)}`;
}
