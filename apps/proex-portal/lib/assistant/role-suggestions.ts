/**
 * Sugestões de pergunta do Rolê, por pessoa. São regras fixas, sem chamada de IA e sem custo:
 * olham o momento (dinâmica e agenda dos próximos dias), a atividade recente de quem abriu a conversa
 * e o que a equipe dela pode ver. Tudo sai das mesmas permissões das telas, só da organização da
 * conversa e, quando a conversa está em "Procurar em" um projeto, unidade ou evento, só dos projetos
 * desse recorte (a pergunta sugerida precisa ter resposta ali). O sorteio é fixo por pessoa e muda a
 * cada ROLE_SUGGESTION_DAYS dias.
 */
import { projectAuthoritySql, type PortalActor } from '../access';
import { all } from '../database';
import { authority as followupAuthority } from '../follow-up/scope';

export const ROLE_SUGGESTION_DAYS = 3;
export const ROLE_SUGGESTION_LIMIT = 4;
export type RoleSuggestion = { text: string; why: 'momento' | 'atividade' | 'equipe' | 'geral' };

const GENERAL = [
  'Como registro a entrega de brindes?',
  'Como funciona o empréstimo de equipamentos?',
  'Quais editais da PROEX estão abertos?',
  'Escreva um aviso curto para a equipe sobre o plantão de amanhã.',
  'Quais materiais devo conferir antes de uma dinâmica?',
  'Quem são os contatos da PROEX?',
];
const dayOf = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** Nome curto e limpo para caber numa pergunta (sem aspas nem quebras). */
const short = (value: unknown) => String(value ?? '').replace(/["“”\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
const fits = (value: string) => value.length >= 3 && value.length <= 60;
function hash(value: string): number { let h = 2166136261; for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** Escolhe `count` itens da lista com um sorteio fixo para a semente. */
function pick<T>(list: T[], count: number, seed: number): T[] {
  const pool = [...list], out: T[] = [];
  for (let step = 0; pool.length && out.length < count; step += 1) out.push(pool.splice((seed + step * 7919) % pool.length, 1)[0]);
  return out;
}

/** `scopeProjectIds`: projetos do recorte da conversa (já conferidos por resolveRoleScope); null = toda a organização. Só estreita, nunca amplia. */
export async function roleSuggestions(db: D1Database, actor: PortalActor, organizationId: string, now = Date.now(), scopeProjectIds: string[] | null = null): Promise<RoleSuggestion[]> {
  const today = dayOf(now), seed = hash(`${actor.userId}:${Math.floor(Date.parse(`${today}T12:00:00Z`) / 86400000 / ROLE_SUGGESTION_DAYS)}`);
  const projects = await all(db, `SELECT p.id FROM projects p JOIN organizations o ON o.id=p.organization_id AND o.status='active' WHERE p.organization_id=? AND ${followupAuthority('?', 'p.organization_id', 'p.id')} LIMIT 400`, [organizationId, actor.userId]);
  const allowed = scopeProjectIds ? new Set(scopeProjectIds) : null, ids = projects.map(row => String(row.id)).filter(id => !allowed || allowed.has(id));
  if (!ids.length) return pick(GENERAL, ROLE_SUGGESTION_LIMIT, seed).map(text => ({ text, why: 'geral' as const }));
  const marks = `(${ids.map(() => '?').join(',')})`;
  const inventory = projectAuthoritySql(actor, ['inventory.read'], 'p.id'), agenda = projectAuthoritySql(actor, ['reports.read', 'campaigns.manage'], 'p.id'), loans = projectAuthoritySql(actor, ['loans.read'], 'p.id');
  const [campaigns, schedule, moved, assigned, stock, openLoans] = await Promise.all([
    // Momento: dinâmica que começa em até 3 dias ou está acontecendo.
    all(db, `SELECT c.name FROM campaigns c WHERE c.project_id IN ${marks} AND c.status!='closed' AND substr(c.starts_at,1,10)<=? AND substr(c.ends_at,1,10)>=? ORDER BY c.starts_at LIMIT 5`, [...ids, shift(today, 3), today]),
    all(db, `SELECT substr(s.starts_at,1,10) day FROM project_schedule_items s JOIN projects p ON p.id=s.project_id WHERE ${agenda.sql} AND p.id IN ${marks} AND s.status!='cancelled' AND substr(s.starts_at,1,10)>=? AND substr(s.starts_at,1,10)<=? ORDER BY s.starts_at LIMIT 40`, [...agenda.values, ...ids, today, shift(today, 6)]),
    // Atividade: o que a própria pessoa movimentou nos últimos 14 dias e as demandas atribuídas a ela.
    all(db, `SELECT i.name,COUNT(*) n FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id WHERE ${inventory.sql} AND p.id IN ${marks} AND m.actor_id=? AND m.created_at>=? AND i.condition!='inactive' GROUP BY i.id ORDER BY n DESC,MAX(m.created_at) DESC LIMIT 4`, [...inventory.values, ...ids, actor.userId, new Date(now - 14 * 86400000).toISOString()]),
    all(db, `SELECT t.title FROM followup_tasks t JOIN followup_assignees a ON a.task_id=t.id AND a.user_id=? AND a.removed_at IS NULL WHERE ${followupAuthority('?', 't.organization_id', 't.project_id')} AND t.project_id IN ${marks} AND t.status NOT IN ('completed','cancelled') ORDER BY t.due_at IS NULL,t.due_at,t.updated_at DESC LIMIT 4`, [actor.userId, actor.userId, ...ids]),
    // Equipe: o que a função da pessoa deixa ver.
    all(db, `SELECT i.name FROM items i JOIN projects p ON p.id=i.project_id WHERE ${inventory.sql} AND p.id IN ${marks} AND i.condition!='inactive' AND i.stock>0 ORDER BY (i.stock-i.reserved),i.name LIMIT 6`, [...inventory.values, ...ids]),
    all(db, `SELECT COUNT(*) n,SUM(CASE WHEN l.status='out' AND l.ends_at<? THEN 1 ELSE 0 END) late FROM loans l JOIN projects p ON p.id=l.project_id WHERE ${loans.sql} AND p.id IN ${marks} AND l.status IN ('reserved','out')`, [now, ...loans.values, ...ids]),
  ]);

  const moment: string[] = [], activity: string[] = [], team: string[] = [];
  for (const row of campaigns) { const name = short(row.name); if (fits(name)) moment.push(`Quais são os níveis de brinde da dinâmica ${name}?`); }
  if (schedule.some(row => row.day === today)) moment.push('O que tem na agenda de hoje?');
  else if (schedule.length) moment.push('O que tem na agenda dos próximos 7 dias?');
  for (const row of moved) { const name = short(row.name); if (fits(name)) activity.push(`Quanto saiu de ${name} nos últimos 7 dias?`, `Quanto ainda temos de ${name}?`); }
  for (const row of assigned) { const title = short(row.title); if (fits(title)) activity.push(`O que diz a demanda ${title}?`); }
  if (assigned.length) activity.push('Quais demandas estão abertas?');
  for (const row of stock) { const name = short(row.name); if (fits(name)) team.push(`Quanto ainda temos de ${name}?`); }
  const loan = openLoans[0];
  if (Number(loan?.late ?? 0) > 0) team.push('Quais empréstimos estão atrasados?');
  else if (Number(loan?.n ?? 0) > 0) team.push('Quais empréstimos estão em aberto?');

  const out: RoleSuggestion[] = [], seen = new Set<string>();
  const add = (list: string[], count: number, why: RoleSuggestion['why']) => { for (const text of pick(list.filter(entry => !seen.has(entry)), count, seed)) { if (out.length >= ROLE_SUGGESTION_LIMIT) return; seen.add(text); out.push({ text, why }); } };
  add(moment, 1, 'momento'); add(activity, 2, 'atividade'); add(team, 1, 'equipe');
  add(GENERAL, ROLE_SUGGESTION_LIMIT - out.length, 'geral');
  return out;
}
