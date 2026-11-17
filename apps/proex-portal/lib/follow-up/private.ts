import type { PortalActor } from '../access';
import { all, one, uid, iso, type Row } from '../database';
import { HttpError } from '../errors';
import { prepareMutation } from '../mutations';
import { id, text, date, choices, ids, onlyKeys, fail, version } from './contracts';
import { activeAccount, actorRequired, fanout, leadershipMemberSql, organizationMemberSql, participantSql, recipientLimit, requireScope, taskAuthority } from './scope';
import { serverWorkClock } from './time';

/*
 * Demandas privadas e painel de Despachos (pedido de 17/11/2026).
 * - Visibilidade `participants`: o autor e as pessoas indicadas. `leadership`: a Gestão superior da organização e os participantes.
 * - A demanda privada é da organização (sem projeto), não recebe equipes nem delegação e só muda por estas ações.
 * - A leitura passa por taskAuthority (scope.ts) em todas as consultas; aqui ninguém se inclui por ID forjado:
 *   só o autor muda participantes e visibilidade, e cada participante precisa ter acesso vigente à organização.
 * - Auditoria sem título: o registro existe, mas o assunto fica só para quem participa.
 */
export const DISPATCH_VISIBILITY = ['participants','leadership'] as const;
export const DISPATCH_KINDS = ['signature','question','decision','document_review','referral','agenda'] as const;
export const DISPATCH_DOCUMENTS = ['term','draft','notice','dispatch','acknowledgement','agreement','other'] as const;
export const DISPATCH_URGENCY = ['immediate','high','medium','low'] as const;
/** Situação do despacho sobre os estados de sempre: Pendente, Em análise, Devolvido para ajustes, Concluída. */
export const DISPATCH_STATES = ['open','in_progress','blocked','completed'] as const;
const MAX_PARTICIPANTS = 12;
const priorityOf = (urgency: string) => urgency === 'immediate' || urgency === 'high' ? 'high' : urgency === 'low' ? 'low' : 'medium';

function documentRef(value: unknown): string {
  const ref = text(value, 500, true).trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) && !/^https:\/\//i.test(ref)) fail('Use um endereço HTTPS (SEI ou Drive) ou escreva o número do processo.');
  return ref;
}
function auditStatement(db: D1Database, actor: PortalActor, organizationId: string, action: string, taskId: string, details: Record<string, unknown>, at: string) {
  // Sem título nem texto: quem não participa vê só que houve uma ação numa demanda privada.
  return db.prepare('INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,NULL,?,?,?,?,?)')
    .bind(uid(), actor.userId, organizationId, action, taskId, JSON.stringify({ ...details, private: true }), at);
}
function history(db: D1Database, actor: PortalActor, taskId: string, at: string) {
  return db.prepare(`INSERT INTO followup_history(id,task_id,version,snapshot_json,actor_id,created_at) SELECT ?,id,version,json_object('title',title,'body',body,'priority',priority,'importance',importance,'status',status,'dueAt',due_at,'campaignId',campaign_id,'itemId',item_id,'loanId',loan_id,'progressNote',''),?,? FROM followup_tasks WHERE id=?`).bind(uid(), actor.userId, at, taskId);
}
function memberAssertion(db: D1Database, userId: string, organizationId: string, code = 'followup_participant_invalid') {
  return db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT ? AS uid,? AS oid) target JOIN portal_users u ON u.user_id=target.uid WHERE ${activeAccount('u')} AND ${organizationMemberSql('target.uid', 'target.oid')}) THEN 1 ELSE json_extract('[]','${code}') END`)
    .bind(userId, organizationId);
}
async function run(db: D1Database, statements: D1PreparedStatement[]) {
  try { return await db.batch(statements); } catch (error) {
    const message = String(error);
    if (message.includes('followup_actor_forbidden')) fail('Seu acesso a esta organização mudou. Atualize a página.', 'followup_forbidden', 403);
    if (message.includes('followup_participant_invalid')) fail('Escolha pessoas com acesso vigente a esta organização.', 'followup_participant', 409);
    if (message.includes('followup_author_only')) fail('Só quem criou a demanda muda as pessoas e a visibilidade.', 'followup_forbidden', 403);
    if (message.includes('followup_version_changed')) fail('O registro mudou. Reabra a edição.', 'followup_conflict', 409);
    if (message.includes('followup_too_many_recipients')) fail('Há pessoas demais nesta demanda.', 'followup_recipients', 409);
    if (message.includes('followup_authority_changed')) fail('Seu acesso a esta demanda mudou.', 'followup_forbidden', 403);
    throw error;
  }
}
function dispatchFields(input: Record<string, unknown>, old?: Row) {
  const kind = choices(input.kind ?? old?.kind ?? 'question', DISPATCH_KINDS);
  const documentKind = input.documentKind === undefined ? old?.document_kind ?? null : input.documentKind === null || input.documentKind === '' ? null : choices(input.documentKind, DISPATCH_DOCUMENTS);
  const urgency = choices(input.urgency ?? old?.urgency ?? 'medium', DISPATCH_URGENCY);
  return {
    title: text(input.title ?? old?.title, 160), body: text(input.body ?? old?.body, 4000, true),
    status: choices(input.status ?? old?.status ?? 'open', DISPATCH_STATES),
    dueAt: date(input.dueAt === undefined ? old?.due_at : input.dueAt),
    kind, documentKind, urgency, documentRef: input.documentRef === undefined ? String(old?.document_ref ?? '') : documentRef(input.documentRef),
    onAgenda: input.onAgenda === undefined ? Boolean(old?.on_agenda) : input.onAgenda === true,
  };
}

async function createDispatch(db: D1Database, actor: PortalActor, input: Record<string, unknown>) {
  onlyKeys(input, ['action','organizationId','visibility','participantIds','title','body','status','dueAt','kind','documentKind','urgency','documentRef','onAgenda','holderUserId','operationKey']);
  const organizationId = id(input.organizationId)!, visibility = choices(input.visibility ?? 'participants', DISPATCH_VISIBILITY);
  const others = ids(input.participantIds, MAX_PARTICIPANTS).filter(user => user !== actor.userId);
  if (visibility === 'participants' && !others.length) fail('Escolha pelo menos uma pessoa para esta demanda privada.');
  const participants = [actor.userId, ...others], value = dispatchFields(input);
  const holder = id(input.holderUserId, true) ?? others[0] ?? actor.userId;
  if (!participants.includes(holder)) fail('A demanda fica com alguém que participa dela.');
  if (!await one(db, `SELECT 1 allowed FROM (SELECT ? AS uid,? AS oid) caller WHERE ${organizationMemberSql('caller.uid', 'caller.oid')}`, [actor.userId, organizationId]))
    fail('Seu acesso a esta organização mudou.', 'followup_forbidden', 403);
  const mutation = await prepareMutation(db, actor.userId, 'dispatch.create', input);
  if (mutation.existingId) return { taskId: mutation.existingId, duplicate: true };
  const taskId = uid(), at = iso();
  const statements = [
    memberAssertion(db, actor.userId, organizationId, 'followup_actor_forbidden'),
    ...others.map(user => memberAssertion(db, user, organizationId)),
    mutation.claimStatement(taskId),
    db.prepare('INSERT INTO followup_tasks(id,organization_id,project_id,title,body,priority,importance,status,due_at,campaign_id,item_id,loan_id,created_by,created_at,updated_at) VALUES(?,?,NULL,?,?,?,NULL,?,?,NULL,NULL,NULL,?,?,?)')
      .bind(taskId, organizationId, value.title, value.body, priorityOf(value.urgency), value.status, value.dueAt, actor.userId, at, at),
    db.prepare('INSERT INTO followup_task_privacy(task_id,visibility,created_by,created_at,updated_at) VALUES(?,?,?,?,?)').bind(taskId, visibility, actor.userId, at, at),
    ...participants.map(user => db.prepare('INSERT INTO followup_task_participants(id,task_id,user_id,added_by,created_at) VALUES(?,?,?,?,?)').bind(uid(), taskId, user, actor.userId, at)),
    db.prepare('INSERT INTO followup_dispatch_details(task_id,kind,document_kind,holder_user_id,document_ref,urgency,on_agenda,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(taskId, value.kind, value.documentKind, holder, value.documentRef, value.urgency, value.onAgenda ? 1 : 0, at),
    recipientLimit(db, taskId), history(db, actor, taskId, at),
    auditStatement(db, actor, organizationId, 'dispatch.create', taskId, { version: 1, visibility }, at),
    fanout(db, taskId, 'task:1', at),
  ];
  try { await run(db, statements); } catch (error) {
    if (error instanceof HttpError) throw error;
    return { taskId: await mutation.recover(error), duplicate: true };
  }
  return { taskId };
}

async function privateTask(db: D1Database, actor: PortalActor, taskId: string, write = false): Promise<Row> {
  const row = await one(db, `SELECT t.*,priv.visibility,d.kind,d.document_kind,d.holder_user_id,d.document_ref,d.urgency,d.on_agenda
    FROM followup_tasks t JOIN followup_task_privacy priv ON priv.task_id=t.id LEFT JOIN followup_dispatch_details d ON d.task_id=t.id
    WHERE t.id=? AND ${taskAuthority('?', 't', write)}`, [taskId, actor.userId]);
  if (!row) fail('Demanda não encontrada ou seu acesso mudou.', 'followup_not_found', 404);
  return row!;
}

async function updateDispatch(db: D1Database, actor: PortalActor, input: Record<string, unknown>) {
  onlyKeys(input, ['action','id','expectedVersion','visibility','participantIds','title','body','status','dueAt','kind','documentKind','urgency','documentRef','onAgenda','holderUserId','operationKey']);
  const old = await privateTask(db, actor, id(input.id)!, true), expected = version(input.expectedVersion), value = dispatchFields(input, old);
  const current = (await all(db, 'SELECT user_id FROM followup_task_participants WHERE task_id=? AND removed_at IS NULL', [old.id])).map(row => String(row.user_id));
  const changesPeople = input.participantIds !== undefined || (input.visibility !== undefined && input.visibility !== old.visibility);
  const visibility = input.visibility === undefined ? String(old.visibility) : choices(input.visibility, DISPATCH_VISIBILITY);
  const next = input.participantIds === undefined ? current : [String(old.created_by), ...ids(input.participantIds, MAX_PARTICIPANTS).filter(user => user !== old.created_by)];
  if (visibility === 'participants' && next.length < 2) fail('Mantenha pelo menos uma pessoa além de quem criou a demanda.');
  const holder = input.holderUserId === undefined ? (next.includes(String(old.holder_user_id)) ? String(old.holder_user_id) : next[0]) : id(input.holderUserId)!;
  if (!next.includes(holder)) fail('A demanda fica com alguém que participa dela.');
  const mutation = await prepareMutation(db, actor.userId, 'dispatch.update', input);
  if (mutation.existingId) return { taskId: old.id, duplicate: true };
  const at = iso(), added = next.filter(user => !current.includes(user)), removed = current.filter(user => !next.includes(user));
  const statements = [
    db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM followup_tasks t WHERE t.id=? AND ${taskAuthority('?', 't', true)}) THEN 1 ELSE json_extract('[]','followup_authority_changed') END`).bind(old.id, actor.userId),
    ...(changesPeople ? [db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM followup_tasks WHERE id=? AND created_by=?) THEN 1 ELSE json_extract('[]','followup_author_only') END").bind(old.id, actor.userId)] : []),
    db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM followup_tasks WHERE id=? AND version=?) THEN 1 ELSE json_extract('[]','followup_version_changed') END").bind(old.id, expected),
    ...added.map(user => memberAssertion(db, user, String(old.organization_id))),
    mutation.claimStatement(old.id),
    db.prepare('UPDATE followup_tasks SET title=?,body=?,priority=?,status=?,due_at=?,version=version+1,updated_at=? WHERE id=?')
      .bind(value.title, value.body, priorityOf(value.urgency), value.status, value.dueAt, at, old.id),
    db.prepare('UPDATE followup_task_privacy SET visibility=?,updated_at=? WHERE task_id=?').bind(visibility, at, old.id),
    ...removed.map(user => db.prepare('UPDATE followup_task_participants SET removed_at=? WHERE task_id=? AND user_id=? AND removed_at IS NULL').bind(at, old.id, user)),
    ...added.map(user => db.prepare('INSERT INTO followup_task_participants(id,task_id,user_id,added_by,created_at) VALUES(?,?,?,?,?)').bind(uid(), old.id, user, actor.userId, at)),
    // A pessoa que saiu deixa de receber avisos já pendentes desta demanda.
    ...removed.map(user => db.prepare('DELETE FROM followup_hidden_pending WHERE task_id=? AND user_id=?').bind(old.id, user)),
    db.prepare(`INSERT INTO followup_dispatch_details(task_id,kind,document_kind,holder_user_id,document_ref,urgency,on_agenda,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(task_id) DO UPDATE SET kind=excluded.kind,document_kind=excluded.document_kind,holder_user_id=excluded.holder_user_id,document_ref=excluded.document_ref,urgency=excluded.urgency,on_agenda=excluded.on_agenda,updated_at=excluded.updated_at`)
      .bind(old.id, value.kind, value.documentKind, holder, value.documentRef, value.urgency, value.onAgenda ? 1 : 0, at),
    recipientLimit(db, old.id), history(db, actor, old.id, at),
    auditStatement(db, actor, String(old.organization_id), 'dispatch.update', old.id, { version: expected + 1, visibility, added: added.length, removed: removed.length }, at),
    fanout(db, old.id, `task:${expected + 1}`, at),
  ];
  try { await run(db, statements); } catch (error) {
    if (error instanceof HttpError) throw error;
    await mutation.recover(error); return { taskId: old.id, duplicate: true };
  }
  return { taskId: old.id };
}

async function leadershipAction(db: D1Database, actor: PortalActor, action: string, input: Record<string, unknown>) {
  onlyKeys(input, ['action','organizationId','userId','operationKey']);
  const organizationId = id(input.organizationId)!, userId = id(input.userId)!;
  // Só a administração da organização mantém a Gestão superior, e ninguém se inclui sozinho (revisão de privacidade de 17/11).
  await requireScope(db, actor, { organizationId, projectId: null }, true);
  if (action === 'leadership.add' && userId === actor.userId) fail('Peça a outra pessoa da administração para incluir você na Gestão superior.', 'followup_forbidden', 403);
  const at = iso();
  const statements = action === 'leadership.add'
    ? [memberAssertion(db, userId, organizationId), db.prepare('INSERT OR IGNORE INTO leadership_group_members(id,organization_id,user_id,added_by,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM leadership_group_members WHERE organization_id=? AND user_id=? AND removed_at IS NULL)').bind(uid(), organizationId, userId, actor.userId, at, organizationId, userId)]
    : [db.prepare('UPDATE leadership_group_members SET removed_at=? WHERE organization_id=? AND user_id=? AND removed_at IS NULL').bind(at, organizationId, userId)];
  await run(db, [...statements, db.prepare('INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,NULL,?,?,?,?,?)').bind(uid(), actor.userId, organizationId, action, userId, '{}', at)]);
  return leadershipRoster(db, actor, organizationId);
}

/** Integrantes da Gestão superior: a administração vê e mantém; quem é da organização vê os nomes para escolher com quem despachar. */
export async function leadershipRoster(db: D1Database, actor: PortalActor | null, organizationIdInput: unknown) {
  actorRequired(actor);
  const organizationId = id(organizationIdInput)!;
  if (!await one(db, `SELECT 1 allowed FROM (SELECT ? AS uid,? AS oid) caller WHERE ${organizationMemberSql('caller.uid', 'caller.oid')}`, [actor.userId, organizationId]))
    fail('Seu acesso a esta organização mudou.', 'followup_forbidden', 403);
  const members = await all(db, `SELECT l.user_id userId,COALESCE(NULLIF(p.display_name,''),'Integrante') name FROM leadership_group_members l JOIN portal_users u ON u.user_id=l.user_id LEFT JOIN profiles p ON p.user_id=l.user_id
    WHERE l.organization_id=? AND l.removed_at IS NULL AND ${activeAccount('u')} ORDER BY name,l.user_id`, [organizationId]);
  return { organizationId, members };
}

export async function privateDispatchAction(db: D1Database, actor: PortalActor, action: string, input: Record<string, unknown>): Promise<Row> {
  if (action === 'dispatch.create') return createDispatch(db, actor, input);
  if (action === 'dispatch.update') return updateDispatch(db, actor, input);
  if (action === 'leadership.add' || action === 'leadership.remove') return leadershipAction(db, actor, action, input);
  return fail('Escolha uma operação válida.', 'followup_action');
}

/**
 * Painel de Despachos: demandas privadas que a pessoa compartilha com `withUserId` (ou, para a Gestão superior, as do grupo).
 * Tudo filtrado por taskAuthority; a contraparte entra só como filtro adicional, nunca como acesso.
 */
export async function dispatchWorkspace(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>) {
  actorRequired(actor);
  const organizationId = id(input.organizationId)!, withUserId = id(input.withUserId, true), group = input.group === '1' || input.group === true;
  if (!await one(db, `SELECT 1 allowed FROM (SELECT ? AS uid,? AS oid) caller WHERE ${organizationMemberSql('caller.uid', 'caller.oid')}`, [actor.userId, organizationId]))
    fail('Seu acesso a esta organização mudou.', 'followup_forbidden', 403);
  const inLeadership = Boolean(await one(db, `SELECT 1 member FROM (SELECT ? AS uid) caller WHERE ${leadershipMemberSql('caller.uid', '?')}`, [actor.userId, organizationId]));
  if (group && !inLeadership) fail('Só quem está na Gestão superior vê as demandas do grupo.', 'followup_forbidden', 403);
  const counterpart = group ? null : withUserId;
  const conditions = ['t.organization_id=?', `EXISTS(SELECT 1 FROM followup_task_privacy p WHERE p.task_id=t.id)`, taskAuthority('?', 't')];
  const values: unknown[] = [organizationId, actor.userId];
  if (group) conditions.push(`EXISTS(SELECT 1 FROM followup_task_privacy p WHERE p.task_id=t.id AND p.visibility='leadership')`);
  else if (counterpart) {
    conditions.push(`(${participantSql('?', 't')} OR EXISTS(SELECT 1 FROM followup_task_privacy p WHERE p.task_id=t.id AND p.visibility='leadership' AND ${leadershipMemberSql('?', 't.organization_id')}))`);
    values.push(counterpart, counterpart);
  }
  const { today } = serverWorkClock();
  const rows = await all(db, `SELECT t.id,t.title,t.status,t.due_at,t.version,t.updated_at,t.created_by=? is_author,p.visibility,d.kind,d.document_kind,d.holder_user_id,d.document_ref,d.urgency,d.on_agenda,
      COALESCE(NULLIF(holder.display_name,''),'Integrante') holder_name
    FROM followup_tasks t JOIN followup_task_privacy p ON p.task_id=t.id LEFT JOIN followup_dispatch_details d ON d.task_id=t.id LEFT JOIN profiles holder ON holder.user_id=d.holder_user_id
    WHERE ${conditions.join(' AND ')} AND t.status!='cancelled'
    ORDER BY CASE WHEN t.status='completed' THEN 1 ELSE 0 END,CASE d.urgency WHEN 'immediate' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,COALESCE(t.due_at,'9999'),t.updated_at DESC,t.id LIMIT 300`,
    [actor.userId, ...values]);
  const soon = new Date(`${today}T12:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 3);
  const soonDay = soon.toISOString().slice(0, 10);
  const open = rows.filter(row => row.status !== 'completed');
  const counts = {
    open: open.length,
    needsCounterpart: counterpart ? open.filter(row => row.holder_user_id === counterpart).length : open.filter(row => row.holder_user_id === actor.userId).length,
    dueSoon: open.filter(row => row.due_at && row.due_at >= today && row.due_at <= soonDay).length,
    overdue: open.filter(row => row.due_at && row.due_at < today).length,
  };
  const people = (await all(db, `SELECT u.user_id userId,COALESCE(NULLIF(p.display_name,''),'Integrante') name,${leadershipMemberSql('u.user_id', '?')} inLeadership
    FROM portal_users u JOIN (SELECT ? AS oid,? AS uid) caller LEFT JOIN profiles p ON p.user_id=u.user_id WHERE u.user_id!=caller.uid AND ${activeAccount('u')} AND ${organizationMemberSql('u.user_id', 'caller.oid')} ORDER BY name,u.user_id LIMIT 500`,
    [organizationId, organizationId, actor.userId])).map(row => ({ userId: row.userId, name: row.name, inLeadership: Boolean(row.inLeadership) }));
  return {
    organizationId, withUserId: counterpart, group, inLeadership, today, counts, people,
    tasks: rows.map(row => ({
      id: row.id, title: row.title, status: row.status, dueAt: row.due_at ?? null, version: row.version, updatedAt: row.updated_at,
      isAuthor: Boolean(row.is_author), visibility: row.visibility, kind: row.kind ?? 'question', documentKind: row.document_kind ?? null,
      holderUserId: row.holder_user_id ?? null, holderName: row.holder_user_id ? row.holder_name : null, documentRef: row.document_ref ?? '',
      urgency: row.urgency ?? 'medium', onAgenda: Boolean(row.on_agenda),
    })),
  };
}
