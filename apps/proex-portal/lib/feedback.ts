import { projectAuthoritySql, platformOwnerAuthoritySql, type PortalActor } from './access';
import { all, one, uid, iso } from './database';
import { HttpError } from './errors';
import { prepareMutation } from './mutations';
import { portalRelease } from './release';

const modules = ['overview','my-work','projects','demands','calendar','materials','loans','events','records','team','reports','settings','profile'];
function admitted(actor: PortalActor) {
  return { sql: `EXISTS(SELECT 1 FROM members m JOIN portal_users u ON u.user_id=m.user_id WHERE m.user_id=? AND m.revoked_at IS NULL AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL)`, values: [actor.userId] };
}
function management(actor: PortalActor) {
  const global = platformOwnerAuthoritySql(actor), project = projectAuthoritySql(actor, ['access.manage'], 'portal_feedback.project_id');
  return { sql: `((${global.sql}) OR (portal_feedback.project_id IS NOT NULL AND ${project.sql}))`, values: [...global.values, ...project.values] };
}
export async function feedbackList(db: D1Database, actor: PortalActor | null, manage = false) {
  if (!actor) throw new HttpError(401, 'Entre para consultar seu feedback.', 'unauthenticated');
  const active = admitted(actor), permission = management(actor);
  const rows = await all(db, `SELECT id,project_id,kind,module,body,release,status,version,created_at,updated_at,
    (author_id=?) own, (${permission.sql}) canManage FROM portal_feedback
    WHERE ${active.sql} AND ${manage ? permission.sql : 'author_id=?'}
    AND (project_id IS NULL OR ${projectAuthoritySql(actor, [], 'portal_feedback.project_id').sql})
    ORDER BY created_at DESC,id DESC LIMIT 51`, [actor.userId, ...permission.values, ...active.values,
    ...(manage ? permission.values : [actor.userId]), ...projectAuthoritySql(actor, [], 'portal_feedback.project_id').values]);
  return { entries: rows.slice(0,50).map(row => ({...row,own:Boolean(row.own),canManage:Boolean(row.canManage)})), hasMore: rows.length > 50 };
}
export async function feedbackAction(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>) {
  if (!actor) throw new HttpError(401, 'Entre para enviar feedback.', 'unauthenticated');
  const active = admitted(actor);
  if (!await one(db, `SELECT 1 WHERE ${active.sql}`, active.values)) throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'feedback_access_changed');
  if (input.action === 'create') {
    const body = typeof input.body === 'string' ? input.body.normalize('NFC').trim() : '';
    if (body.length < 10 || body.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) throw new HttpError(400, 'Descreva o que aconteceu em 10 a 2.000 caracteres.', 'invalid_feedback');
    if (!modules.includes(String(input.module)) || !['problem','suggestion'].includes(String(input.kind))) throw new HttpError(400, 'Escolha o tipo e a área do feedback.', 'invalid_feedback_context');
    const projectId = input.projectId == null || input.projectId === '' ? null : input.projectId;
    if (projectId !== null && (typeof projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(projectId))) throw new HttpError(400, 'Escolha um projeto permitido.', 'invalid_project');
    const project = projectAuthoritySql(actor, [], '?');
    const guard = projectId === null ? active : { sql: `(${active.sql}) AND (${project.sql})`, values: [...active.values, ...project.values, projectId] };
    if (!await one(db,`SELECT 1 WHERE ${guard.sql}`,guard.values)) throw new HttpError(403,'Você não tem mais acesso a este projeto.','feedback_access_changed');
    const mutation = await prepareMutation(db, actor.userId, 'feedback.create', { action:'create', body, module:input.module, kind:input.kind, projectId, operationKey:input.operationKey });
    if (mutation.existingId) return { id: mutation.existingId, duplicate: true };
    const id = uid(), now = iso();
    try {
      await db.batch([
        db.prepare(`SELECT CASE WHEN ${guard.sql} THEN 1 ELSE json_extract('[]','feedback_access_changed') END`).bind(...guard.values),
        db.prepare('INSERT INTO portal_feedback(id,author_id,project_id,kind,module,body,release,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,actor.userId,projectId,input.kind,input.module,body,portalRelease(),now,now),
        mutation.claimStatement(id),
        db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,'feedback.create',?,'{}',?)").bind(uid(),actor.userId,projectId,id,now),
      ]);
    } catch (error) {
      if (String(error).includes('feedback_access_changed')) throw new HttpError(403, 'Seu acesso mudou. Reabra o formulário.', 'feedback_access_changed');
      return {id: await mutation.recover(error), duplicate:true};
    }
    return { id, duplicate: false };
  }
  if (input.action === 'status') {
    if (typeof input.id !== 'string' || !['new','reviewing','resolved'].includes(String(input.status)) || !Number.isSafeInteger(input.expectedVersion)) throw new HttpError(400, 'Confira a atualização do feedback.', 'invalid_feedback_status');
    const permission = management(actor), now = iso();
    const result = await db.prepare(`UPDATE portal_feedback SET status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND ${active.sql} AND ${permission.sql}`).bind(input.status,now,input.id,input.expectedVersion,...active.values,...permission.values).run();
    if (result.meta.changes !== 1) throw new HttpError(409, 'O feedback ou seu acesso mudou. Atualize a lista.', 'feedback_changed');
    return { id: input.id };
  }
  throw new HttpError(400, 'Operação de feedback inválida.', 'invalid_action');
}
