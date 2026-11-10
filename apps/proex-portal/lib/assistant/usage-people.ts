import { platformOwnerAuthoritySql, type PortalActor } from '../access';
import { all, one } from '../database';
import { HttpError } from '../errors';

/*
 * Uso de IA por pessoa. A administração geral vê todas as pessoas da organização; qualquer
 * outra pessoa vê só o próprio uso. Lê apenas metadados da auditoria (função, custo, tokens),
 * por lista de permissão: nunca conteúdo, e-mail ou identificador de pessoa.
 * As dicas são regras locais, sem chamada paga.
 */

export const USAGE_TYPES = { text: 'Texto', photo: 'Foto', audio: 'Áudio', other: 'Outras funções' } as const;
export type UsageType = keyof typeof USAGE_TYPES;
const ACTIONS = ['assistant.role.chat', 'assistant.plan', 'import.ai.preview', 'assistant.transcribe', 'task.triage.prepare', 'assistant.compare'] as const;
const MAX_DAYS = 92, ROW_LIMIT = 50_000;

export type UsageBucket = { calls: number; spentUsdMicros: number };
export type PersonUsage = {
  key: string; name: string; isMe: boolean; calls: number; spentUsdMicros: number;
  byType: Record<UsageType, UsageBucket>; days: { day: string; calls: number; spentUsdMicros: number }[];
  /** Média de tokens de entrada por conversa do Rolê (texto longo pesa no custo). */
  avgChatTokens: number | null; tips: string[];
};
export type PeopleUsage = { organizationId: string; from: string; to: string; scope: 'all' | 'mine'; people: PersonUsage[]; totalSpentUsdMicros: number; partial: boolean };

const brasiliaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const DAY = 86_400_000;
const addDays = (day: string, amount: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + amount * DAY).toISOString().slice(0, 10);
function dayValue(value: unknown, fallback: string, label: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new HttpError(400, `Informe ${label} no formato AAAA-MM-DD.`, 'assistant_usage_range');
  return value;
}
const micros = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
function details(raw: unknown): Record<string, unknown> { try { const parsed: unknown = JSON.parse(String(raw ?? '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function typeOf(action: string, info: Record<string, unknown>): UsageType {
  if (action === 'assistant.role.chat') return info.hasImage === true ? 'photo' : 'text';
  return action === 'assistant.transcribe' ? 'audio' : 'other';
}
function displayName(value: unknown): string {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  if (!name) return 'Pessoa sem nome';
  if (name.includes('@') || name.length > 120 || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) return 'Pessoa da equipe';
  return name;
}
const money = (value: number) => (value / 1_000_000).toLocaleString('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value < 10_000 ? 4 : 2 });

/** Dicas de economia por regras simples (sem IA). */
export function usageTips(person: Omit<PersonUsage, 'tips'>, totalSpent: number, peopleCount: number): string[] {
  const tips: string[] = [], photos = person.byType.photo.calls, texts = person.byType.text.calls;
  if (photos >= 5 && photos >= (photos + texts) * 0.4) tips.push(`Muitas fotos (${photos}). Cada foto custa mais que uma mensagem: quando der, descreva em texto ou recorte só o que importa.`);
  if (person.avgChatTokens !== null && person.avgChatTokens > 4000 && texts >= 3) tips.push('Conversas longas. Comece uma conversa nova para cada assunto: o Rolê reenvia o histórico a cada pergunta.');
  if (person.byType.audio.calls >= 10) tips.push(`Muitos áudios (${person.byType.audio.calls}). Escrever é mais barato e o texto não precisa ser revisado.`);
  if (peopleCount >= 3 && totalSpent > 0 && person.spentUsdMicros >= totalSpent * 0.5) tips.push(`Responde por ${Math.round(person.spentUsdMicros / totalSpent * 100)}% do gasto do período (${money(person.spentUsdMicros)}).`);
  return tips;
}

export async function aiPeopleUsage(db: D1Database, actor: PortalActor | null, input: { organizationId: unknown; from?: unknown; to?: unknown }, now = Date.now()): Promise<PeopleUsage> {
  if (!actor) throw new HttpError(401, 'Entre para ver o uso de IA.', 'unauthenticated');
  if (typeof input.organizationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input.organizationId)) throw new HttpError(400, 'Escolha uma organização.', 'assistant_organization');
  const organizationId = input.organizationId, today = brasiliaDay.format(new Date(now));
  const to = dayValue(input.to, today, 'o fim do período'), from = dayValue(input.from, addDays(to, -29), 'o início do período');
  if (from > to || Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1 > MAX_DAYS) throw new HttpError(400, `Escolha um período de até ${MAX_DAYS} dias.`, 'assistant_usage_range');
  const owner = platformOwnerAuthoritySql(actor);
  const admin = !!await one(db, `SELECT 1 WHERE ${owner.sql}`, owner.values);
  // Quem não é administração geral só enxerga as próprias linhas, e só de organização em que é membro ativo.
  if (!admin && !await one(db, "SELECT 1 FROM members m JOIN organizations o ON o.id=? AND o.status='active' WHERE m.user_id=? AND m.revoked_at IS NULL AND (m.organization_id=o.id OR m.project_id IN (SELECT id FROM projects WHERE organization_id=o.id)) LIMIT 1", [organizationId, actor.userId])) throw new HttpError(403, 'Você não participa desta organização.', 'assistant_usage_forbidden');
  const rows = await all(db, `SELECT a.actor_id,a.action,a.details,a.created_at,p.display_name FROM audit a LEFT JOIN profiles p ON p.user_id=a.actor_id
    WHERE a.organization_id=? AND a.action IN (${ACTIONS.map(() => '?').join(',')}) AND a.created_at>=? AND a.created_at<?${admin ? '' : ' AND a.actor_id=?'}
    ORDER BY a.created_at LIMIT ?`, [organizationId, ...ACTIONS, `${addDays(from, -1)}T00:00:00.000Z`, `${addDays(to, 2)}T00:00:00.000Z`, ...(admin ? [] : [actor.userId]), ROW_LIMIT + 1]);
  const partial = rows.length > ROW_LIMIT; if (partial) rows.length = ROW_LIMIT;
  const people = new Map<string, Omit<PersonUsage, 'tips' | 'days' | 'key' | 'avgChatTokens'> & { days: Map<string, { calls: number; spentUsdMicros: number }>; chatTokens: number; chats: number }>();
  for (const row of rows) {
    const time = Date.parse(String(row.created_at ?? '')); if (!Number.isFinite(time)) continue;
    const day = brasiliaDay.format(new Date(time)); if (day < from || day > to) continue;
    const info = details(row.details), type = typeOf(String(row.action), info), spent = micros(info.usdMicros) ?? micros(info.reservedUsdMicros) ?? 0;
    const id = String(row.actor_id ?? '');
    let person = people.get(id);
    if (!person) { person = { name: displayName(row.display_name), isMe: id === actor.userId, calls: 0, spentUsdMicros: 0, byType: { text: { calls: 0, spentUsdMicros: 0 }, photo: { calls: 0, spentUsdMicros: 0 }, audio: { calls: 0, spentUsdMicros: 0 }, other: { calls: 0, spentUsdMicros: 0 } }, days: new Map(), chatTokens: 0, chats: 0 }; people.set(id, person); }
    person.calls += 1; person.spentUsdMicros += spent; person.byType[type].calls += 1; person.byType[type].spentUsdMicros += spent;
    const bucket = person.days.get(day) ?? { calls: 0, spentUsdMicros: 0 }; bucket.calls += 1; bucket.spentUsdMicros += spent; person.days.set(day, bucket);
    const tokens = Number(info.inputTokens);
    if (type === 'text' && Number.isSafeInteger(tokens) && tokens >= 0) { person.chatTokens += tokens; person.chats += 1; }
  }
  const totalSpentUsdMicros = [...people.values()].reduce((sum, person) => sum + person.spentUsdMicros, 0);
  const list = [...people.values()].sort((a, b) => b.spentUsdMicros - a.spentUsdMicros || b.calls - a.calls).map((person, index) => {
    const base = { key: `p${index + 1}`, name: person.name, isMe: person.isMe, calls: person.calls, spentUsdMicros: person.spentUsdMicros, byType: person.byType,
      days: [...person.days].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, ...value })), avgChatTokens: person.chats ? Math.round(person.chatTokens / person.chats) : null };
    return { ...base, tips: usageTips(base, totalSpentUsdMicros, people.size) };
  });
  // Revogação durante a leitura não devolve dados de outras pessoas.
  if (admin && !await one(db, `SELECT 1 WHERE ${owner.sql}`, owner.values)) throw new HttpError(403, 'Seu acesso mudou.', 'assistant_usage_forbidden');
  return { organizationId, from, to, scope: admin ? 'all' : 'mine', people: list, totalSpentUsdMicros, partial };
}
