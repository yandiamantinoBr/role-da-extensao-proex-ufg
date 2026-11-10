import {HttpError} from '../errors';
import type {PortalActor} from '../access';
import {projectAuthoritySql} from '../access';
import {one,type Row} from '../database';

export const RESPONSES = ['yes', 'no', 'maybe'] as const;
export type GuestResponse = typeof RESPONSES[number];
export const NOTICE_KINDS = ['digest', 'reminder', 'response'] as const;
export const CHANNELS = ['bell', 'email', 'whatsapp'] as const;
export type NoticeKind = typeof NOTICE_KINDS[number];
export type Channel = typeof CHANNELS[number];
/** Defaults when a person never chose: the bell shows everything; e-mail sends the daily summary and the deadline reminder. */
export const DEFAULT_PREFERENCES: Record<NoticeKind, Record<Channel, boolean>> = {
  digest: { bell: true, email: true, whatsapp: false },
  reminder: { bell: true, email: true, whatsapp: false },
  response: { bell: true, email: false, whatsapp: false },
};
export const DEFAULT_PURPOSE = 'Seus dados são usados só para organizar a presença nesta ação de extensão (escala, contato da coordenação e comprovação de participação). Apenas a coordenação da convocação e os gestores do seu projeto veem a sua resposta.';

export function fail(message: string, code = 'invalid_input', status = 400): never { throw new HttpError(status, message, code); }
export function onlyKeys(input: Record<string, unknown>, keys: string[]) { if (Object.keys(input).some(key => !keys.includes(key))) fail('Há campos não permitidos nesta operação.'); }
export function id(value: unknown, label: string): string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) fail(`Selecione ${label}.`); return value; }
export function text(value: unknown, label: string, min: number, max: number): string {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') fail(`Informe ${label} como texto.`);
  const result = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (result.length < min || result.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(result)) fail(min ? `${label[0].toUpperCase()}${label.slice(1)} deve ter entre ${min} e ${max} caracteres.` : `${label[0].toUpperCase()}${label.slice(1)} deve ter até ${max} caracteres.`);
  return result;
}
export function longText(value: unknown, label: string, min: number, max: number): string {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') fail(`Informe ${label} como texto.`);
  const result = value.normalize('NFC').replace(/\r\n/g, '\n').trim();
  if (result.length < min || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)) fail(`${label[0].toUpperCase()}${label.slice(1)} deve ter entre ${min} e ${max} caracteres.`);
  return result;
}
export function civilDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) fail(`Informe ${label} no formato AAAA-MM-DD.`);
  const year = Number(value.slice(0, 4)); if (year < 2020 || year > 2100) fail(`Informe ${label} entre 2020 e 2100.`);
  return value;
}
export function instant(value: unknown, label: string, optional = false): string | null {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`Informe ${label} com data, horário e fuso.`);
  return new Date(Date.parse(value)).toISOString();
}
export function clock(value: unknown, label: string): string { if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail(`Informe ${label} no formato HH:MM.`); return value; }
export function token(value: unknown, label = 'o link'): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) fail(`Abra ${label} completo de novo.`, 'convocation_token', 400); return value; }
export async function sha256(value: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export function randomToken(): string { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function translate(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const message = String(error).toLowerCase();
  if (message.includes('convocation_invite_closed')) fail('Este link de convite expirou, foi encerrado ou já atingiu o limite de respostas. Peça um novo link à coordenação.', 'convocation_invite_closed', 409);
  if (message.includes('convocation_guest_changed')) fail('A convocação foi encerrada ou mudou. Atualize a página.', 'convocation_closed', 409);
  if (message.includes('convocation_project_scope')) fail('Escolha um dos projetos convidados.', 'convocation_project_scope', 400);
  if (message.includes('convocation_shift_scope')) fail('Escolha turnos desta convocação.', 'convocation_shift_scope', 400);
  if (message.includes('convocation_identity') || message.includes('convocation_invite_identity')) fail('A convocação mudou em outra sessão. Atualize a página.', 'convocation_changed', 409);
  if (message.includes('convocation_guests_edit_unique') || message.includes('convocation_guests.edit_hash')) fail('Este link pessoal já foi usado. Atualize a página.', 'convocation_token', 409);
  throw error;
}
/**
 * Live access to one convocation, re-read from SQL on every call (revocation applies at once):
 * manage = campaigns.manage on its project; full = manage, reports.read on its project, or a listed responsible who
 * still belongs to the organization; scoped = the invited projects where the person manages or reads reports.
 */
export async function access(db: D1Database, actor: PortalActor, convocationId: string) {
  const manage = projectAuthoritySql(actor, ['campaigns.manage'], 'c.project_id'), read = projectAuthoritySql(actor, ['reports.read'], 'c.project_id');
  const row = await one(db, `SELECT c.*,CASE WHEN ${manage.sql} THEN 1 ELSE 0 END can_manage,CASE WHEN ${read.sql} THEN 1 ELSE 0 END can_read,
    CASE WHEN EXISTS(SELECT 1 FROM convocation_responsibles r JOIN members m ON m.user_id=r.user_id AND m.revoked_at IS NULL AND (m.organization_id=c.organization_id OR m.organization_id IS NULL)
      JOIN portal_users u ON u.user_id=r.user_id AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL WHERE r.convocation_id=c.id AND r.user_id=?) THEN 1 ELSE 0 END is_responsible
    FROM convocations c JOIN organizations o ON o.id=c.organization_id AND o.status='active' WHERE c.id=?`, [...manage.values, ...read.values, actor.userId, convocationId]);
  if (!row) fail('Convocação não encontrada.', 'convocation_not_found', 404);
  const scoped = projectAuthoritySql(actor, ['campaigns.manage', 'reports.read'], 'cp.project_id');
  const projects = (await db.prepare(`SELECT cp.project_id FROM convocation_projects cp WHERE cp.convocation_id=? AND (${scoped.sql})`).bind(convocationId, ...scoped.values).all<Row>()).results ?? [];
  const full = Boolean(row!.can_manage || row!.can_read || row!.is_responsible);
  const readable = full ? null : projects.map(project => String(project.project_id));
  if (!full && !readable!.length) fail('Você não tem acesso a esta convocação.', 'forbidden', 403);
  return { convocation: row!, canManage: Boolean(row!.can_manage), full, readableProjects: readable };
}
