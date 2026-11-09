import { projectAuthoritySql, platformOwnerAuthoritySql, type PortalActor } from './access';
import { all, one, uid, iso } from './database';
import { HttpError } from './errors';
import { prepareMutation } from './mutations';
import { portalRelease } from './release';

/*
 * Feedback box (caixa de retorno): suggestion, problem or praise about the platform, a project or an event.
 * Routing: platform → active global owner; project/event → whoever has access.manage on that project.
 * An event's project always comes from the stored campaign, never from the client.
 * Not anonymous: management sees the author's name. The anonymous channel is lib/community/ombuds.ts.
 */
const modules = ['overview','my-work','projects','demands','calendar','materials','loans','events','records','team','reports','settings','profile','community','work-teams'];
export const FEEDBACK_KINDS = ['problem','suggestion','praise'] as const;
const STATUSES = ['new','reviewing','resolved'] as const;
function admitted(actor: PortalActor) {
  return { sql: `EXISTS(SELECT 1 FROM members m JOIN portal_users u ON u.user_id=m.user_id WHERE m.user_id=? AND m.revoked_at IS NULL AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL)`, values: [actor.userId] };
}
function management(actor: PortalActor) {
  const global = platformOwnerAuthoritySql(actor), project = projectAuthoritySql(actor, ['access.manage'], 'portal_feedback.project_id');
  return { sql: `((${global.sql}) OR (portal_feedback.project_id IS NOT NULL AND ${project.sql}))`, values: [...global.values, ...project.values] };
}
function text(value: unknown, min: number, max: number, message: string, code: string) {
  const body = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  if (Array.from(body).length < min || body.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) throw new HttpError(400, message, code);
  return body;
}
export async function feedbackList(db: D1Database, actor: PortalActor | null, manage = false) {
  if (!actor) throw new HttpError(401, 'Entre para consultar seu feedback.', 'unauthenticated');
  const active = admitted(actor), permission = management(actor), read = projectAuthoritySql(actor, [], 'portal_feedback.project_id');
  const rows = await all(db, `SELECT portal_feedback.id,portal_feedback.project_id,portal_feedback.campaign_id,kind,module,body,release,portal_feedback.status,portal_feedback.version,
    response,responded_at,portal_feedback.created_at,portal_feedback.updated_at,
    p.name project_name,c.name campaign_name,
    CASE WHEN ${manage ? '1' : '0'}=1 THEN COALESCE(NULLIF(author.display_name,''),'Pessoa da equipe') END author_name,
    (author_id=?) own, (${permission.sql}) canManage FROM portal_feedback
    LEFT JOIN projects p ON p.id=portal_feedback.project_id LEFT JOIN campaigns c ON c.id=portal_feedback.campaign_id
    LEFT JOIN profiles author ON author.user_id=portal_feedback.author_id
    WHERE ${active.sql} AND ${manage ? permission.sql : 'author_id=?'}
    AND (portal_feedback.project_id IS NULL OR ${read.sql})
    ORDER BY CASE WHEN ${manage ? '1' : '0'}=1 AND portal_feedback.status='new' THEN 0 ELSE 1 END, portal_feedback.created_at DESC,portal_feedback.id DESC LIMIT 51`, [actor.userId, ...permission.values, ...active.values,
    ...(manage ? permission.values : [actor.userId]), ...read.values]);
  return { entries: rows.slice(0,50).map(row => ({...row,own:Boolean(row.own),canManage:Boolean(row.canManage)})), hasMore: rows.length > 50 };
}
/** True when the actor can manage at least one feedback scope (global owner or access.manage somewhere). */
export function canManageFeedback(actor: PortalActor | null) {
  return !!actor?.members.some(member => member.role === 'owner' || member.role === 'manager');
}
export async function feedbackAction(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>) {
  if (!actor) throw new HttpError(401, 'Entre para enviar feedback.', 'unauthenticated');
  const active = admitted(actor);
  if (!await one(db, `SELECT 1 WHERE ${active.sql}`, active.values)) throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'feedback_access_changed');
  if (input.action === 'create') {
    const body = text(input.body, 10, 2000, 'Descreva o que aconteceu em 10 a 2.000 caracteres.', 'invalid_feedback');
    if (!modules.includes(String(input.module)) || !FEEDBACK_KINDS.includes(input.kind as typeof FEEDBACK_KINDS[number])) throw new HttpError(400, 'Escolha o tipo e a área do feedback.', 'invalid_feedback_context');
    const campaignId = input.campaignId == null || input.campaignId === '' ? null : input.campaignId;
    let projectId = input.projectId == null || input.projectId === '' ? null : input.projectId;
    for (const value of [projectId, campaignId]) if (value !== null && (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value))) throw new HttpError(400, 'Escolha um projeto ou evento permitido.', 'invalid_project');
    if (campaignId !== null) {
      const campaign = await one(db, 'SELECT project_id FROM campaigns WHERE id=?', [campaignId]);
      if (!campaign || (projectId !== null && projectId !== campaign.project_id)) throw new HttpError(403, 'Você não tem mais acesso a este evento.', 'feedback_access_changed');
      projectId = String(campaign.project_id);
    }
    const project = projectAuthoritySql(actor, [], '?');
    const eventFence = campaignId === null ? '' : ' AND EXISTS(SELECT 1 FROM campaigns WHERE id=? AND project_id=?)';
    const guard = projectId === null ? active : { sql: `(${active.sql}) AND (${project.sql})${eventFence}`, values: [...active.values, ...project.values, projectId, ...(campaignId === null ? [] : [campaignId, projectId])] };
    if (!await one(db,`SELECT 1 WHERE ${guard.sql}`,guard.values)) throw new HttpError(403,'Você não tem mais acesso a este projeto.','feedback_access_changed');
    const mutation = await prepareMutation(db, actor.userId, 'feedback.create', { action:'create', body, module:input.module, kind:input.kind, projectId, campaignId, operationKey:input.operationKey });
    if (mutation.existingId) return { id: mutation.existingId, duplicate: true };
    const id = uid(), now = iso();
    try {
      await db.batch([
        db.prepare(`SELECT CASE WHEN ${guard.sql} THEN 1 ELSE json_extract('[]','feedback_access_changed') END`).bind(...guard.values),
        db.prepare("SELECT CASE WHEN (SELECT COUNT(*) FROM portal_feedback WHERE author_id=? AND created_at>?)<100 THEN 1 ELSE json_extract('[]','feedback_rate_limited') END").bind(actor.userId,new Date(Date.now()-86400000).toISOString()),
        db.prepare('INSERT INTO portal_feedback(id,author_id,project_id,campaign_id,kind,module,body,release,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,actor.userId,projectId,campaignId,input.kind,input.module,body,portalRelease(),now,now),
        mutation.claimStatement(id),
        db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,'feedback.create',?,'{}',?)").bind(uid(),actor.userId,projectId,id,now),
      ]);
    } catch (error) {
      if (String(error).includes('feedback_access_changed')) throw new HttpError(403, 'Seu acesso mudou. Reabra o formulário.', 'feedback_access_changed');
      if (String(error).includes('feedback_rate_limited')) throw new HttpError(429,'Você já enviou 100 registros nas últimas 24 horas. Aguarde para enviar novamente.','feedback_rate_limited');
      return {id: await mutation.recover(error), duplicate:true};
    }
    return { id, duplicate: false };
  }
  if (input.action === 'status' || input.action === 'respond') {
    if (typeof input.id !== 'string' || !STATUSES.includes(input.status as typeof STATUSES[number]) || !Number.isSafeInteger(input.expectedVersion)) throw new HttpError(400, 'Confira a atualização do feedback.', 'invalid_feedback_status');
    const response = input.action === 'respond' ? text(input.response, 2, 2000, 'Escreva a resposta em 2 a 2.000 caracteres.', 'invalid_feedback_response') : null;
    const permission = management(actor), now = iso();
    const update = response === null
      ? db.prepare(`UPDATE portal_feedback SET status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND ${active.sql} AND ${permission.sql}`).bind(input.status,now,input.id,input.expectedVersion,...active.values,...permission.values)
      : db.prepare(`UPDATE portal_feedback SET status=?,response=?,responded_by=?,responded_at=?,version=version+1,updated_at=? WHERE id=? AND version=? AND ${active.sql} AND ${permission.sql}`).bind(input.status,response,actor.userId,now,now,input.id,input.expectedVersion,...active.values,...permission.values);
    const results = await db.batch([
      update,
      db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,project_id,?,id,?,? FROM portal_feedback WHERE id=? AND changes()=1").bind(uid(),actor.userId,response === null ? 'feedback.status' : 'feedback.respond',JSON.stringify({status:input.status}),now,input.id),
    ]);
    if (results[0].meta.changes !== 1) throw new HttpError(409, 'O feedback ou seu acesso mudou. Atualize a lista.', 'feedback_changed');
    return { id: input.id };
  }
  throw new HttpError(400, 'Operação de feedback inválida.', 'invalid_action');
}
