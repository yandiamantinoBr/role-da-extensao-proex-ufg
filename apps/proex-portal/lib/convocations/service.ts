import {capabilityBatch,projectAuthoritySql,requireCapability,requireLiveCapability,type PortalActor} from '../access';
import {all,one,type Row} from '../database';
import {prepareMutation} from '../mutations';
import {CHANNELS,DEFAULT_PREFERENCES,DEFAULT_PURPOSE,NOTICE_KINDS,access,civilDate,clock,fail,id,instant,longText,onlyKeys,randomToken,sha256,text,translate,type Channel,type NoticeKind} from './shared';

/*
 * Convocations for the team: whoever manages dynamics/events of a project (campaigns.manage) creates a convocation,
 * its shifts and invited projects, generates limited invite links and follows confirmations. Managers or report
 * readers of an invited project see only their project's people. Every change lands in convocation_events (no
 * personal data) and in audit; Registros > Histórico reads the event log.
 */
type Input = Record<string, unknown>;
const MAX_SHIFTS = 12, MAX_PROJECTS = 60, MAX_RESPONSIBLES = 10;
const statement = (db: D1Database, sql: string, values: unknown[] = []) => db.prepare(sql).bind(...values);
const event = (db: D1Database, convocationId: string, kind: string, actorId: string | null, at: string, details: Record<string, unknown> = {}, extra: { guestId?: string | null; projectId?: string | null } = {}) =>
  statement(db, 'INSERT INTO convocation_events(id,convocation_id,kind,guest_id,project_id,actor_id,details,created_at) VALUES(?,?,?,?,?,?,?,?)', [crypto.randomUUID(), convocationId, kind, extra.guestId ?? null, extra.projectId ?? null, actorId, JSON.stringify(details), at]);
const audit = (db: D1Database, actor: PortalActor, projectId: string, action: string, entityId: string, details: Record<string, unknown>, at: string) =>
  statement(db, 'INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)', [crypto.randomUUID(), actor.userId, projectId, action, entityId, JSON.stringify(details), at]);

function shiftsInput(value: unknown, required: boolean) {
  if (value === undefined && !required) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SHIFTS) fail(`Informe de 1 a ${MAX_SHIFTS} turnos.`);
  return value.map((shift, index) => {
    if (!shift || typeof shift !== 'object') fail('Turno inválido.');
    const row = shift as Input, startsAt = clock(row.startsAt, 'o início do turno'), endsAt = clock(row.endsAt, 'o fim do turno');
    if (endsAt <= startsAt) fail('O turno deve terminar depois de começar.');
    return { id: row.id === undefined || row.id === null || row.id === '' ? null : id(row.id, 'o turno'), label: text(row.label, 'o nome do turno', 1, 80), startsAt, endsAt, position: index + 1 };
  });
}
function idList(value: unknown, label: string, max: number, min = 0): string[] {
  if (value === undefined || value === null) value = [];
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`Escolha de ${min} a ${max} ${label}.`);
  const ids = [...new Set((value as unknown[]).map(entry => id(entry, label)))];
  return ids;
}
async function organizationOf(db: D1Database, projectId: string) {
  const row = await one(db, "SELECT p.organization_id,p.name FROM projects p JOIN organizations o ON o.id=p.organization_id WHERE p.id=? AND p.status='active' AND o.status='active'", [projectId]);
  if (!row) fail('O projeto está indisponível.', 'project_unavailable', 409);
  return String(row!.organization_id);
}
async function validProjects(db: D1Database, organizationId: string, ids: string[]) {
  if (!ids.length) return;
  const rows = await all(db, `SELECT id FROM projects WHERE organization_id=? AND status='active' AND id IN(${ids.map(() => '?').join(',')})`, [organizationId, ...ids]);
  if (rows.length !== ids.length) fail('Convide apenas projetos ativos da mesma organização.', 'convocation_project_scope');
}
async function validResponsibles(db: D1Database, organizationId: string, ids: string[]) {
  if (!ids.length) return;
  const rows = await all(db, `SELECT DISTINCT u.user_id FROM portal_users u JOIN members m ON m.user_id=u.user_id AND m.revoked_at IS NULL AND (m.organization_id=? OR m.organization_id IS NULL)
    WHERE u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL AND u.user_id IN(${ids.map(() => '?').join(',')})`, [organizationId, ...ids]);
  if (rows.length !== ids.length) fail('Escolha responsáveis com acesso ativo a esta organização.', 'convocation_responsible_scope');
}
function meta(input: Input, previous?: Row) {
  const pick = (key: string, fallback: unknown) => input[key] === undefined ? fallback : input[key];
  const deadline = instant(pick('responseDeadline', previous?.response_deadline ?? null), 'o prazo de resposta', true);
  const retention = pick('retentionDays', previous?.retention_days ?? 180);
  if (typeof retention !== 'number' || !Number.isSafeInteger(retention) || retention < 30 || retention > 730) fail('Guarde os dados por 30 a 730 dias.');
  return {
    title: text(pick('title', previous?.title), 'o nome da convocação', 3, 160), edition: text(pick('edition', previous?.edition ?? ''), 'a edição', 0, 120),
    location: text(pick('location', previous?.location ?? ''), 'o local', 0, 200), eventDate: civilDate(pick('eventDate', previous?.event_date), 'a data'),
    responseDeadline: deadline, description: longText(pick('description', previous?.description ?? ''), 'a descrição', 0, 2000),
    purposeNotice: longText(pick('purposeNotice', previous?.purpose_notice ?? DEFAULT_PURPOSE), 'o aviso de finalidade', 10, 1000), retentionDays: retention as number,
  };
}

async function createConvocation(db: D1Database, actor: PortalActor, input: Input) {
  onlyKeys(input, ['action', 'projectId', 'title', 'edition', 'location', 'eventDate', 'responseDeadline', 'description', 'purposeNotice', 'retentionDays', 'shifts', 'projectIds', 'responsibleIds', 'operationKey']);
  const projectId = id(input.projectId, 'o projeto');
  requireCapability(actor, 'campaigns.manage', projectId);
  await requireLiveCapability(db, actor, 'campaigns.manage', projectId);
  const organizationId = await organizationOf(db, projectId), m = meta(input), shifts = shiftsInput(input.shifts, true)!;
  const projectIds = idList(input.projectIds, 'projetos convidados', MAX_PROJECTS, 1), responsibleIds = [...new Set([actor.userId, ...idList(input.responsibleIds, 'responsáveis', MAX_RESPONSIBLES)])].slice(0, MAX_RESPONSIBLES);
  await validProjects(db, organizationId, projectIds); await validResponsibles(db, organizationId, responsibleIds);
  const mutation = await prepareMutation(db, actor.userId, 'convocation.create', input);
  if (mutation.existingId) return { convocation: await one(db, 'SELECT * FROM convocations WHERE id=?', [mutation.existingId]), duplicate: true };
  const convocationId = crypto.randomUUID(), at = new Date().toISOString();
  try {
    await capabilityBatch(db, actor, 'campaigns.manage', projectId, [mutation.claimStatement(convocationId),
      statement(db, 'INSERT INTO convocations(id,organization_id,project_id,title,edition,location,event_date,response_deadline,description,purpose_notice,retention_days,status,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,\'open\',1,?,?,?)',
        [convocationId, organizationId, projectId, m.title, m.edition, m.location, m.eventDate, m.responseDeadline, m.description, m.purposeNotice, m.retentionDays, actor.userId, at, at]),
      ...shifts.map(shift => statement(db, 'INSERT INTO convocation_shifts(id,convocation_id,label,starts_at,ends_at,position) VALUES(?,?,?,?,?,?)', [crypto.randomUUID(), convocationId, shift.label, shift.startsAt, shift.endsAt, shift.position])),
      ...projectIds.map(project => statement(db, 'INSERT INTO convocation_projects(convocation_id,project_id) VALUES(?,?)', [convocationId, project])),
      ...responsibleIds.map(user => statement(db, 'INSERT INTO convocation_responsibles(convocation_id,user_id,added_by,added_at) VALUES(?,?,?,?)', [convocationId, user, actor.userId, at])),
      event(db, convocationId, 'created', actor.userId, at, { shifts: shifts.length, projects: projectIds.length }),
      audit(db, actor, projectId, 'convocation.create', convocationId, { title: m.title, eventDate: m.eventDate, projects: projectIds.length }, at)]);
  } catch (error) {
    if (error instanceof Error && 'status' in error && (error as { status: number }).status === 403) throw error;
    const replay = await mutation.recover(error).catch(() => null);
    if (replay) return { convocation: await one(db, 'SELECT * FROM convocations WHERE id=?', [replay]), duplicate: true };
    translate(error);
  }
  return { convocation: await one(db, 'SELECT * FROM convocations WHERE id=?', [convocationId]) };
}

async function updateConvocation(db: D1Database, actor: PortalActor, input: Input) {
  onlyKeys(input, ['action', 'id', 'expectedVersion', 'title', 'edition', 'location', 'eventDate', 'responseDeadline', 'description', 'purposeNotice', 'retentionDays', 'shifts', 'projectIds', 'responsibleIds', 'status', 'operationKey']);
  const convocationId = id(input.id, 'a convocação'), scope = await access(db, actor, convocationId), previous = scope.convocation;
  if (!scope.canManage) fail('Só quem gerencia as dinâmicas do projeto pode editar a convocação.', 'forbidden', 403);
  if (previous.purged_at) fail('Os dados desta convocação já foram apagados. Crie outra convocação.', 'convocation_purged', 409);
  if (input.expectedVersion !== previous.version) fail('A convocação mudou em outra sessão. Atualize a página.', 'convocation_changed', 409);
  const m = meta(input, previous), at = new Date().toISOString(), status = input.status === undefined ? String(previous.status) : input.status;
  if (status !== 'open' && status !== 'closed') fail('Escolha convocação aberta ou encerrada.');
  const statements: D1PreparedStatement[] = [];
  const shifts = shiftsInput(input.shifts, false);
  if (shifts) {
    const current = await all(db, 'SELECT s.id,(SELECT COUNT(*) FROM convocation_guest_shifts g WHERE g.shift_id=s.id) used FROM convocation_shifts s WHERE s.convocation_id=?', [convocationId]);
    const kept = new Set(shifts.filter(shift => shift.id).map(shift => shift.id));
    if (shifts.some(shift => shift.id && !current.some(row => row.id === shift.id))) fail('Turno inválido para esta convocação.');
    const removed = current.filter(row => !kept.has(String(row.id)));
    if (removed.some(row => Number(row.used) > 0)) fail('Um turno com respostas não pode ser removido. Renomeie-o ou encerre a convocação.', 'convocation_shift_in_use', 409);
    // Positions are rewritten in two steps so the unique (convocation, position) index never collides mid-batch.
    statements.push(statement(db, 'UPDATE convocation_shifts SET position=position+100 WHERE convocation_id=?', [convocationId]));
    for (const row of removed) statements.push(statement(db, 'DELETE FROM convocation_shifts WHERE id=? AND convocation_id=? AND NOT EXISTS(SELECT 1 FROM convocation_guest_shifts g WHERE g.shift_id=?)', [row.id, convocationId, row.id]));
    for (const shift of shifts) statements.push(shift.id
      ? statement(db, 'UPDATE convocation_shifts SET label=?,starts_at=?,ends_at=?,position=? WHERE id=? AND convocation_id=?', [shift.label, shift.startsAt, shift.endsAt, shift.position, shift.id, convocationId])
      : statement(db, 'INSERT INTO convocation_shifts(id,convocation_id,label,starts_at,ends_at,position) VALUES(?,?,?,?,?,?)', [crypto.randomUUID(), convocationId, shift.label, shift.startsAt, shift.endsAt, shift.position]));
  }
  if (input.projectIds !== undefined) {
    const projectIds = idList(input.projectIds, 'projetos convidados', MAX_PROJECTS, 1);
    await validProjects(db, String(previous.organization_id), projectIds);
    const current = await all(db, 'SELECT cp.project_id,(SELECT COUNT(*) FROM convocation_guests g WHERE g.convocation_id=cp.convocation_id AND g.project_id=cp.project_id) used FROM convocation_projects cp WHERE cp.convocation_id=?', [convocationId]);
    const removed = current.filter(row => !projectIds.includes(String(row.project_id)));
    if (removed.some(row => Number(row.used) > 0)) fail('Um projeto que já tem respostas não pode sair da convocação.', 'convocation_project_in_use', 409);
    for (const row of removed) statements.push(statement(db, 'DELETE FROM convocation_projects WHERE convocation_id=? AND project_id=?', [convocationId, row.project_id]));
    for (const project of projectIds.filter(project => !current.some(row => row.project_id === project))) statements.push(statement(db, 'INSERT INTO convocation_projects(convocation_id,project_id) VALUES(?,?)', [convocationId, project]));
  }
  if (input.responsibleIds !== undefined) {
    const responsibleIds = idList(input.responsibleIds, 'responsáveis', MAX_RESPONSIBLES, 1);
    await validResponsibles(db, String(previous.organization_id), responsibleIds);
    statements.push(statement(db, 'DELETE FROM convocation_responsibles WHERE convocation_id=?', [convocationId]), ...responsibleIds.map(user => statement(db, 'INSERT INTO convocation_responsibles(convocation_id,user_id,added_by,added_at) VALUES(?,?,?,?)', [convocationId, user, actor.userId, at])));
  }
  const kind = status !== previous.status ? status === 'closed' ? 'closed' : 'reopened' : 'updated';
  const results = await capabilityBatch(db, actor, 'campaigns.manage', String(previous.project_id), [
    statement(db, 'UPDATE convocations SET title=?,edition=?,location=?,event_date=?,response_deadline=?,description=?,purpose_notice=?,retention_days=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND purged_at IS NULL',
      [m.title, m.edition, m.location, m.eventDate, m.responseDeadline, m.description, m.purposeNotice, m.retentionDays, status, at, convocationId, previous.version]),
    statement(db, "SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','convocation_identity') END"),
    ...statements, event(db, convocationId, kind, actor.userId, at, { version: Number(previous.version) + 1 }),
    audit(db, actor, String(previous.project_id), `convocation.${kind}`, convocationId, { version: Number(previous.version) + 1, status }, at)]).catch(translate);
  void results;
  return { convocation: await one(db, 'SELECT * FROM convocations WHERE id=?', [convocationId]) };
}

async function createInvite(db: D1Database, actor: PortalActor, input: Input) {
  onlyKeys(input, ['action', 'convocationId', 'label', 'expiresAt', 'maxUses', 'operationKey']);
  const convocationId = id(input.convocationId, 'a convocação'), scope = await access(db, actor, convocationId);
  if (!scope.canManage) fail('Só quem gerencia as dinâmicas do projeto cria convites.', 'forbidden', 403);
  if (scope.convocation.status !== 'open' || scope.convocation.purged_at) fail('Reabra a convocação antes de criar um convite.', 'convocation_closed', 409);
  const label = text(input.label, 'o nome do convite', 0, 80), expiresAt = instant(input.expiresAt, 'a validade')!, now = Date.now();
  if (Date.parse(expiresAt) <= now + 3_600_000 || Date.parse(expiresAt) > now + 120 * 86_400_000) fail('A validade deve ficar entre 1 hora e 120 dias a partir de agora.');
  const maxUses = input.maxUses;
  if (typeof maxUses !== 'number' || !Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 2000) fail('Limite de respostas entre 1 e 2000.');
  const mutation = await prepareMutation(db, actor.userId, `convocation.invite:${convocationId}`, input);
  // The token is shown only once (the database keeps its hash); a replay returns the invite without it.
  if (mutation.existingId) return { invite: await inviteRow(db, mutation.existingId), token: null, duplicate: true };
  const inviteId = crypto.randomUUID(), secret = randomToken(), at = new Date(now).toISOString();
  await capabilityBatch(db, actor, 'campaigns.manage', String(scope.convocation.project_id), [mutation.claimStatement(inviteId),
    statement(db, 'INSERT INTO convocation_invites(id,convocation_id,token_hash,label,expires_at,max_uses,use_count,created_by,created_at) VALUES(?,?,?,?,?,?,0,?,?)', [inviteId, convocationId, await sha256(secret), label, expiresAt, maxUses, actor.userId, at]),
    event(db, convocationId, 'invite_created', actor.userId, at, { inviteId, maxUses, expiresAt }),
    audit(db, actor, String(scope.convocation.project_id), 'convocation.invite.create', inviteId, { convocationId, maxUses, expiresAt }, at)]).catch(translate);
  return { invite: await inviteRow(db, inviteId), token: secret, path: `/convocacao#c=${secret}` };
}
async function inviteRow(db: D1Database, inviteId: string) { return one(db, 'SELECT id,convocation_id,label,expires_at,max_uses,use_count,revoked_at,created_at FROM convocation_invites WHERE id=?', [inviteId]); }
async function revokeInvite(db: D1Database, actor: PortalActor, input: Input) {
  onlyKeys(input, ['action', 'inviteId', 'operationKey']);
  const inviteId = id(input.inviteId, 'o convite'), invite = await one(db, 'SELECT * FROM convocation_invites WHERE id=?', [inviteId]);
  if (!invite) fail('Convite não encontrado.', 'not_found', 404);
  const scope = await access(db, actor, String(invite!.convocation_id));
  if (!scope.canManage) fail('Só quem gerencia as dinâmicas do projeto encerra convites.', 'forbidden', 403);
  if (invite!.revoked_at) return { invite: await inviteRow(db, inviteId), duplicate: true };
  const at = new Date().toISOString();
  await capabilityBatch(db, actor, 'campaigns.manage', String(scope.convocation.project_id), [
    statement(db, 'UPDATE convocation_invites SET revoked_at=? WHERE id=? AND revoked_at IS NULL', [at, inviteId]),
    event(db, String(invite!.convocation_id), 'invite_revoked', actor.userId, at, { inviteId }),
    audit(db, actor, String(scope.convocation.project_id), 'convocation.invite.revoke', inviteId, {}, at)]).catch(translate);
  return { invite: await inviteRow(db, inviteId) };
}
/** LGPD: delete every guest answer of the convocation (the event log keeps only counts and ids). */
async function purgeGuests(db: D1Database, actor: PortalActor, input: Input) {
  onlyKeys(input, ['action', 'id', 'expectedVersion', 'confirmed', 'operationKey']);
  const convocationId = id(input.id, 'a convocação'), scope = await access(db, actor, convocationId);
  if (!scope.canManage) fail('Só quem gerencia as dinâmicas do projeto apaga os dados.', 'forbidden', 403);
  if (input.confirmed !== true) fail('Confirme que os dados das pessoas serão apagados sem volta.');
  if (scope.convocation.purged_at) return { convocation: scope.convocation, duplicate: true };
  if (input.expectedVersion !== scope.convocation.version) fail('A convocação mudou em outra sessão. Atualize a página.', 'convocation_changed', 409);
  const count = Number((await one(db, 'SELECT COUNT(*) n FROM convocation_guests WHERE convocation_id=?', [convocationId]))?.n ?? 0), at = new Date().toISOString();
  await capabilityBatch(db, actor, 'campaigns.manage', String(scope.convocation.project_id), [
    statement(db, 'UPDATE convocations SET status=\'closed\',purged_at=?,version=version+1,updated_at=? WHERE id=? AND version=? AND purged_at IS NULL', [at, at, convocationId, scope.convocation.version]),
    statement(db, "SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','convocation_identity') END"),
    statement(db, 'DELETE FROM convocation_guest_shifts WHERE guest_id IN(SELECT id FROM convocation_guests WHERE convocation_id=?)', [convocationId]),
    statement(db, 'DELETE FROM convocation_guests WHERE convocation_id=?', [convocationId]),
    statement(db, "UPDATE convocation_email_queue SET status='cancelled',updated_at=? WHERE convocation_id=? AND status IN('queued','claimed')", [at, convocationId]),
    event(db, convocationId, 'purged', actor.userId, at, { removed: count }),
    audit(db, actor, String(scope.convocation.project_id), 'convocation.purge', convocationId, { removed: count }, at)]).catch(translate);
  return { convocation: await one(db, 'SELECT * FROM convocations WHERE id=?', [convocationId]), removed: count };
}

export async function preferences(db: D1Database, userId: string) {
  const rows = await all(db, 'SELECT kind,channel,enabled FROM convocation_notification_preferences WHERE user_id=?', [userId]);
  const result = JSON.parse(JSON.stringify(DEFAULT_PREFERENCES)) as Record<NoticeKind, Record<Channel, boolean>>;
  for (const row of rows) if (result[row.kind as NoticeKind] && String(row.channel) in result[row.kind as NoticeKind]) result[row.kind as NoticeKind][row.channel as Channel] = row.channel !== 'whatsapp' && Boolean(row.enabled);
  return result;
}
async function setPreference(db: D1Database, actor: PortalActor, input: Input) {
  onlyKeys(input, ['action', 'kind', 'channel', 'enabled', 'operationKey']);
  if (!(NOTICE_KINDS as readonly unknown[]).includes(input.kind) || !(CHANNELS as readonly unknown[]).includes(input.channel) || typeof input.enabled !== 'boolean') fail('Escolha um aviso e um canal válidos.');
  if (input.channel === 'whatsapp' && input.enabled) fail('O WhatsApp ainda está em preparação e não envia avisos.', 'channel_unavailable', 409);
  await statement(db, 'INSERT INTO convocation_notification_preferences(user_id,kind,channel,enabled,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,kind,channel) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at',
    [actor.userId, input.kind, input.channel, input.enabled ? 1 : 0, new Date().toISOString()]).run();
  return { preferences: await preferences(db, actor.userId) };
}
async function markSeen(db: D1Database, actor: PortalActor, input: Input) {
  onlyKeys(input, ['action', 'convocationId', 'operationKey']);
  const convocationId = id(input.convocationId, 'a convocação'); await access(db, actor, convocationId);
  await statement(db, `INSERT INTO convocation_receipts(user_id,convocation_id,seen_sequence,updated_at) VALUES(?,?,COALESCE((SELECT MAX(sequence) FROM convocation_events WHERE convocation_id=?),0),?)
    ON CONFLICT(user_id,convocation_id) DO UPDATE SET seen_sequence=excluded.seen_sequence,updated_at=excluded.updated_at`, [actor.userId, convocationId, convocationId, new Date().toISOString()]).run();
  return { ok: true };
}

export async function convocationAction(db: D1Database, actor: PortalActor, action: string, input: Input): Promise<Record<string, unknown> | null> {
  switch (action) {
    case 'convocation.create': return createConvocation(db, actor, input);
    case 'convocation.update': return updateConvocation(db, actor, input);
    case 'convocation.invite.create': return createInvite(db, actor, input);
    case 'convocation.invite.revoke': return revokeInvite(db, actor, input);
    case 'convocation.purge': return purgeGuests(db, actor, input);
    case 'convocation.preference': return setPreference(db, actor, input);
    case 'convocation.seen': return markSeen(db, actor, input);
    default: return null;
  }
}

/** Convocations the person can see, with counts limited to what they may read. */
export async function listConvocations(db: D1Database, actor: PortalActor | null) {
  if (!actor) fail('Entre para ver as convocações.', 'unauthenticated', 401);
  const own = projectAuthoritySql(actor!, ['campaigns.manage', 'reports.read'], 'c.project_id'), invited = projectAuthoritySql(actor!, ['campaigns.manage', 'reports.read'], 'cp.project_id');
  const rows = await all(db, `SELECT c.id,c.title,c.edition,c.location,c.event_date,c.response_deadline,c.status,c.project_id,p.name project_name,c.purged_at,
    CASE WHEN ${own.sql} OR EXISTS(SELECT 1 FROM convocation_responsibles r WHERE r.convocation_id=c.id AND r.user_id=?) THEN 1 ELSE 0 END full_access
    FROM convocations c JOIN projects p ON p.id=c.project_id JOIN organizations o ON o.id=c.organization_id AND o.status='active'
    WHERE ${own.sql} OR EXISTS(SELECT 1 FROM convocation_responsibles r JOIN members m ON m.user_id=r.user_id AND m.revoked_at IS NULL AND (m.organization_id=c.organization_id OR m.organization_id IS NULL) WHERE r.convocation_id=c.id AND r.user_id=?)
      OR EXISTS(SELECT 1 FROM convocation_projects cp WHERE cp.convocation_id=c.id AND (${invited.sql}))
    ORDER BY c.status,c.event_date DESC,c.id LIMIT 200`, [...own.values, actor!.userId, ...own.values, actor!.userId, ...invited.values]);
  const result = [];
  for (const row of rows) {
    const scope = row.full_access ? null : (await all(db, `SELECT cp.project_id FROM convocation_projects cp WHERE cp.convocation_id=? AND (${invited.sql})`, [row.id, ...invited.values])).map(entry => String(entry.project_id));
    const filter = scope ? ` AND g.project_id IN(${scope.map(() => '?').join(',') || 'NULL'})` : '';
    const counts = await one(db, `SELECT SUM(g.response='yes') yes,SUM(g.response='maybe') maybe,SUM(g.response='no') no FROM convocation_guests g WHERE g.convocation_id=?${filter}`, [row.id, ...(scope ?? [])]);
    const silent = await one(db, `SELECT COUNT(*) n FROM convocation_projects cp WHERE cp.convocation_id=?${scope ? ` AND cp.project_id IN(${scope.map(() => '?').join(',') || 'NULL'})` : ''} AND NOT EXISTS(SELECT 1 FROM convocation_guests g WHERE g.convocation_id=cp.convocation_id AND g.project_id=cp.project_id)`, [row.id, ...(scope ?? [])]);
    result.push({ id: row.id, title: row.title, edition: row.edition, location: row.location, eventDate: row.event_date, responseDeadline: row.response_deadline, status: row.status, projectId: row.project_id, projectName: row.project_name, purged: Boolean(row.purged_at), scope: scope ? 'projects' : 'full',
      counts: { yes: Number(counts?.yes ?? 0), maybe: Number(counts?.maybe ?? 0), no: Number(counts?.no ?? 0) }, silentProjects: Number(silent?.n ?? 0) });
  }
  const manageable = actor!.members.filter(member => member.role === 'owner' || member.role === 'manager').length > 0;
  return { convocations: result, canCreate: manageable, preferences: await preferences(db, actor!.userId) };
}

/** Panel of one convocation: by person, by project ("tal projeto não respondeu") and by shift, scoped to what the person may read. */
export async function convocationDetail(db: D1Database, actor: PortalActor | null, convocationId: unknown) {
  if (!actor) fail('Entre para ver a convocação.', 'unauthenticated', 401);
  const scope = await access(db, actor!, id(convocationId, 'a convocação')), c = scope.convocation, readable = scope.readableProjects;
  const projectFilter = readable ? ` AND cp.project_id IN(${readable.map(() => '?').join(',')})` : '', guestFilter = readable ? ` AND g.project_id IN(${readable.map(() => '?').join(',')})` : '';
  const shifts = await all(db, 'SELECT id,label,starts_at startsAt,ends_at endsAt,position FROM convocation_shifts WHERE convocation_id=? ORDER BY position', [c.id]);
  const guests = await all(db, `SELECT g.id,g.name,g.enrollment,g.project_id projectId,p.name projectName,g.response,g.created_at createdAt,g.updated_at updatedAt,
    (SELECT json_group_array(gs.shift_id) FROM convocation_guest_shifts gs WHERE gs.guest_id=g.id) shift_ids
    FROM convocation_guests g JOIN projects p ON p.id=g.project_id WHERE g.convocation_id=?${guestFilter} ORDER BY p.name,g.name,g.id LIMIT 2000`, [c.id, ...(readable ?? [])]);
  const projects = await all(db, `SELECT cp.project_id id,p.name,p.short_name shortName,
    (SELECT COUNT(*) FROM convocation_guests g WHERE g.convocation_id=cp.convocation_id AND g.project_id=cp.project_id AND g.response='yes') yes,
    (SELECT COUNT(*) FROM convocation_guests g WHERE g.convocation_id=cp.convocation_id AND g.project_id=cp.project_id AND g.response='maybe') maybe,
    (SELECT COUNT(*) FROM convocation_guests g WHERE g.convocation_id=cp.convocation_id AND g.project_id=cp.project_id AND g.response='no') no
    FROM convocation_projects cp JOIN projects p ON p.id=cp.project_id WHERE cp.convocation_id=?${projectFilter} ORDER BY p.name,p.id`, [c.id, ...(readable ?? [])]);
  const invites = scope.canManage ? await all(db, 'SELECT id,label,expires_at expiresAt,max_uses maxUses,use_count useCount,revoked_at revokedAt,created_at createdAt FROM convocation_invites WHERE convocation_id=? ORDER BY created_at DESC LIMIT 50', [c.id]) : [];
  const responsibles = await all(db, `SELECT r.user_id userId,COALESCE(NULLIF(pr.display_name,''),'Integrante') name FROM convocation_responsibles r LEFT JOIN profiles pr ON pr.user_id=r.user_id WHERE r.convocation_id=? ORDER BY name`, [c.id]);
  const events = await all(db, `SELECT e.sequence,e.kind,e.project_id projectId,e.created_at createdAt,COALESCE(NULLIF(pr.display_name,''),CASE WHEN e.actor_id IS NULL THEN 'Convidado' ELSE 'Integrante' END) actorName
    FROM convocation_events e LEFT JOIN profiles pr ON pr.user_id=e.actor_id WHERE e.convocation_id=?${readable ? ` AND (e.project_id IS NULL OR e.project_id IN(${readable.map(() => '?').join(',')}))` : ''} ORDER BY e.sequence DESC LIMIT 60`, [c.id, ...(readable ?? [])]);
  const candidates = scope.canManage ? await all(db, `SELECT DISTINCT u.user_id userId,COALESCE(NULLIF(pr.display_name,''),'Integrante') name FROM portal_users u JOIN members m ON m.user_id=u.user_id AND m.revoked_at IS NULL AND (m.organization_id=? OR m.organization_id IS NULL)
    LEFT JOIN profiles pr ON pr.user_id=u.user_id WHERE u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL ORDER BY name LIMIT 300`, [c.organization_id]) : [];
  const projectChoices = scope.canManage ? await all(db, "SELECT id,name FROM projects WHERE organization_id=? AND status='active' ORDER BY name,id", [c.organization_id]) : [];
  return {
    convocation: { id: c.id, title: c.title, edition: c.edition, location: c.location, eventDate: c.event_date, responseDeadline: c.response_deadline, description: c.description, purposeNotice: c.purpose_notice, retentionDays: Number(c.retention_days), status: c.status, version: Number(c.version), projectId: c.project_id, purgedAt: c.purged_at, createdAt: c.created_at },
    scope: readable ? 'projects' : 'full', permissions: { canManage: scope.canManage },
    shifts, projects: projects.map(project => ({ ...project, yes: Number(project.yes), maybe: Number(project.maybe), no: Number(project.no), answered: Number(project.yes) + Number(project.maybe) + Number(project.no) > 0 })),
    guests: guests.map(guest => ({ id: guest.id, name: guest.name, enrollment: guest.enrollment, projectId: guest.projectId, projectName: guest.projectName, response: guest.response, createdAt: guest.createdAt, updatedAt: guest.updatedAt, shiftIds: JSON.parse(String(guest.shift_ids ?? '[]')) })),
    invites, responsibles, events, candidates, projectChoices,
  };
}
