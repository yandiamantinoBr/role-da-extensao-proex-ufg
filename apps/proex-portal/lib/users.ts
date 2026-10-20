import { accessibleProjects, requireCapability, type PortalActor, type PortalMember } from './access';
import { HttpError } from './errors';

const SUBORDINATE_ROLES = ['operator', 'inventory', 'loans', 'viewer'];
const ASSIGNABLE_ROLES = ['manager', ...SUBORDINATE_ROLES];
type AssignableRole = 'manager' | 'operator' | 'inventory' | 'loans' | 'viewer';
type UserStatus = 'active' | 'blocked';
type UserRow = { user_id: string; email: string | null; status: UserStatus };
type ChangeReceipt = { memberId: string; newMemberId: string; role: AssignableRole; changed: boolean };

// Provider subjects never replace these canonical application user ids.
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}

const OWNER_SQL = `EXISTS (SELECT 1 FROM members auth
  JOIN portal_users account ON account.user_id=auth.user_id AND account.status='active' AND COALESCE(account.activation_pending,0)=0
  WHERE auth.user_id=? AND auth.role='owner' AND auth.project_id IS NULL AND auth.revoked_at IS NULL)`;
const ACTIVE_OWNER_COUNT_SQL = `(SELECT COUNT(DISTINCT owners.user_id) FROM members owners
  LEFT JOIN portal_users account ON account.user_id=owners.user_id
  WHERE owners.role='owner' AND owners.project_id IS NULL AND owners.revoked_at IS NULL
    AND COALESCE(account.status,'active')='active' AND COALESCE(account.activation_pending,0)=0)`;
const VISIBLE_MEMBER_SQL = `EXISTS (SELECT 1 FROM members auth
  JOIN portal_users account ON account.user_id=auth.user_id AND account.status='active' AND COALESCE(account.activation_pending,0)=0
  WHERE auth.user_id=? AND auth.revoked_at IS NULL AND auth.role IN ('owner','manager')
    AND (auth.project_id IS NULL OR auth.project_id=m.project_id))`;

function isOwner(actor: PortalActor): boolean {
  return accessibleProjects(actor, 'organization.manage') === null;
}

function canChange(actor: PortalActor, member: PortalMember, role: AssignableRole): boolean {
  if (isOwner(actor)) return true;
  return member.project_id !== null && SUBORDINATE_ROLES.includes(member.role)
    && SUBORDINATE_ROLES.includes(role)
    && actor.members.some(item => item.user_id === actor.userId && item.role === 'manager'
      && item.revoked_at === null && item.project_id === member.project_id);
}

async function receiptId(actorId: string, operationKey: unknown): Promise<string> {
  if (typeof operationKey !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(operationKey)) {
    throw new HttpError(400, 'Identificador da operação inválido.', 'invalid_operation');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([actorId, operationKey])));
  return `member-change:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function changeReceipt(
  db: D1Database, id: string, actorId: string, memberId: string, role: AssignableRole,
): Promise<ChangeReceipt | null> {
  const saved = await db.prepare("SELECT actor_id,action,entity_id,details FROM audit WHERE id=?")
    .bind(id).first<{ actor_id: string; action: string; entity_id: string; details: string }>();
  if (!saved) return null;
  let details: Partial<ChangeReceipt>;
  try {
    const parsed = JSON.parse(saved.details);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_receipt');
    details = parsed;
  } catch { throw new HttpError(409, 'Atualize a lista da equipe.', 'operation_conflict'); }
  if (saved.actor_id !== actorId || saved.action !== 'member.change' || saved.entity_id !== memberId
    || details.memberId !== memberId || details.role !== role || !identifier(details.newMemberId)
    || typeof details.changed !== 'boolean') {
    throw new HttpError(409, 'Esta operação já foi usada com outros dados. Atualize a página.', 'operation_conflict');
  }
  return { memberId, role, newMemberId: details.newMemberId, changed: details.changed };
}

/** Scoped directory projection. No provider subjects, sessions, passwords or avatar storage keys. */
export async function listManagedUsers(db: D1Database, actor: PortalActor | null): Promise<Record<string, unknown>[]> {
  requireCapability(actor, 'access.manage');
  const actorId = actor!.userId;
  // SQL rechecks the current account and membership, including a previously loaded actor snapshot.
  const [accounts, memberships] = await Promise.all([
    db.prepare(`SELECT u.user_id,u.email,u.status,u.activation_pending,p.display_name,
        EXISTS (SELECT 1 FROM identity_aliases aliases WHERE aliases.user_id=u.user_id
          AND aliases.provider='password') AS has_password
      FROM portal_users u LEFT JOIN profiles p ON p.user_id=u.user_id
      WHERE ${OWNER_SQL} OR EXISTS (SELECT 1 FROM members m
        WHERE m.user_id=u.user_id AND ${VISIBLE_MEMBER_SQL})
      ORDER BY COALESCE(p.display_name,u.email,u.user_id),u.user_id`).bind(actorId, actorId)
      .all<UserRow & { display_name: string | null; has_password: number; activation_pending: number }>(),
    db.prepare(`SELECT m.id,m.user_id,m.role,m.project_id,m.revoked_at,m.created_at FROM members m
      WHERE ${VISIBLE_MEMBER_SQL} ORDER BY m.created_at,m.id`).bind(actorId)
      .all<Pick<PortalMember, 'id' | 'user_id' | 'role' | 'project_id' | 'revoked_at' | 'created_at'>>(),
  ]);
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const member of memberships.results ?? []) {
    const { user_id: userId, ...visible } = member;
    grouped.set(userId, [...(grouped.get(userId) ?? []), visible]);
  }
  return (accounts.results ?? []).map(account => ({
    userId: account.user_id, email: account.email,
    displayName: account.display_name || account.email || 'Pessoa da equipe',
    status: account.status, hasPassword: Boolean(account.has_password), activationPending: Boolean(account.activation_pending),
    members: grouped.get(account.user_id) ?? [],
  }));
}

/** Account state is global; membership changes retain their original stored project scope. */
export async function usersAction(
  db: D1Database, actor: PortalActor | null, action: string, input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!['user.status', 'member.change'].includes(action)) return null;
  if (!actor) throw new HttpError(401, 'Entre para continuar.', 'unauthenticated');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Dados inválidos.', 'invalid_input');

  if (action === 'user.status') {
    requireCapability(actor, 'organization.manage', null);
    if (!identifier(input.userId) || (input.status !== 'active' && input.status !== 'blocked')) {
      throw new HttpError(400, 'Informe uma conta e situação válidas.', 'invalid_user_status');
    }
    const targetId = input.userId, status = input.status as UserStatus;
    if (status === 'blocked' && targetId === actor.userId) {
      throw new HttpError(409, 'Você não pode bloquear sua própria conta.', 'self_block_forbidden');
    }
    const target = await db.prepare(`SELECT user_id,email,status FROM portal_users
      WHERE user_id=? AND ${OWNER_SQL}`).bind(targetId, actor.userId).first<UserRow>();
    if (!target) throw new HttpError(404, 'Conta não encontrada ou seu acesso mudou.', 'user_not_found');
    if (target.status === status) {
      // A repeat block also removes a session that might have been issued meanwhile.
      if (status === 'blocked') await db.prepare(`DELETE FROM auth_session WHERE user_id IN
        (SELECT subject FROM identity_aliases WHERE provider='password' AND user_id=?)
        AND EXISTS (SELECT 1 FROM portal_users WHERE user_id=? AND status='blocked') AND ${OWNER_SQL}`)
        .bind(targetId, targetId, actor.userId).run();
      return { userId: targetId, status, changed: false };
    }
    const now = new Date().toISOString(), auditId = crypto.randomUUID();
    const results = await db.batch([
      db.prepare(`UPDATE portal_users SET status=?,updated_at=? WHERE user_id=? AND status=?
        AND ${OWNER_SQL}
        AND (?!='blocked' OR (user_id!=? AND (NOT EXISTS
          (SELECT 1 FROM members target WHERE target.user_id=portal_users.user_id
            AND target.role='owner' AND target.project_id IS NULL AND target.revoked_at IS NULL
            AND COALESCE(portal_users.activation_pending,0)=0)
          OR ${ACTIVE_OWNER_COUNT_SQL}>1)))`)
        .bind(status, now, targetId, target.status, actor.userId, status, actor.userId),
      db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
        SELECT ?,?,NULL,'user.status',?,?,? WHERE changes()=1`)
        .bind(auditId, actor.userId, targetId, JSON.stringify({ previousStatus: target.status, status }), now),
      db.prepare(`DELETE FROM auth_session WHERE user_id IN
        (SELECT subject FROM identity_aliases WHERE provider='password' AND user_id=?)
        AND EXISTS (SELECT 1 FROM audit WHERE id=?)`).bind(targetId, auditId),
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
      throw new HttpError(409, 'A conta ou seu acesso mudou. O último responsável ativo deve ser preservado.', 'user_not_changed');
    }
    return { userId: targetId, status, changed: true };
  }

  if (!identifier(input.memberId) || typeof input.role !== 'string' || !ASSIGNABLE_ROLES.includes(input.role)) {
    throw new HttpError(400, 'Selecione um vínculo e uma função válidos.', 'invalid_member_change');
  }
  const role = input.role as AssignableRole;
  const member = await db.prepare('SELECT * FROM members WHERE id=?').bind(input.memberId).first<PortalMember>();
  if (!member) throw new HttpError(404, 'Vínculo não encontrado.', 'member_not_found');
  requireCapability(actor, 'access.manage', member.project_id);
  if (!canChange(actor, member, role)) throw new HttpError(403, 'Você não pode alterar essa função ou escopo.', 'delegation_forbidden');
  const authorization = `(${OWNER_SQL} OR (? IS NOT NULL AND ? IN ('operator','inventory','loans','viewer')
    AND ? IN ('operator','inventory','loans','viewer') AND EXISTS (SELECT 1 FROM members auth
      JOIN portal_users account ON account.user_id=auth.user_id AND account.status='active' AND COALESCE(account.activation_pending,0)=0
      WHERE auth.user_id=? AND auth.role='manager' AND auth.project_id=? AND auth.revoked_at IS NULL)))`;
  const authorizationParameters = [actor.userId, member.project_id, member.role, role, actor.userId, member.project_id];
  // Replays and no-ops also require a currently authorized, active account.
  const permitted = await db.prepare(`SELECT id FROM members WHERE id=? AND ${authorization}`)
    .bind(member.id, ...authorizationParameters).first();
  if (!permitted) throw new HttpError(409, 'Seu acesso ou o vínculo mudou. Atualize a página.', 'member_not_changed');
  const auditId = await receiptId(actor.userId, input.operationKey);
  const repeated = await changeReceipt(db, auditId, actor.userId, member.id, role);
  if (repeated) return { memberId: repeated.newMemberId, previousMemberId: member.id, role, changed: repeated.changed, replayed: true };
  if (member.revoked_at) throw new HttpError(409, 'Este vínculo já foi encerrado. Atualize a lista da equipe.', 'member_not_changed');
  if (member.role === role) {
    const now = new Date().toISOString();
    try {
      const result = await db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
        SELECT ?,?,?,'member.change',?,?,? FROM members WHERE id=? AND role=? AND revoked_at IS NULL AND ${authorization}`)
        .bind(auditId, actor.userId, member.project_id, member.id,
          JSON.stringify({ memberId: member.id, newMemberId: member.id, role, changed: false }), now,
          member.id, role, ...authorizationParameters).run();
      if (result.meta.changes !== 1) throw new HttpError(409, 'Seu acesso ou o vínculo mudou. Atualize a página.', 'member_not_changed');
    } catch (error) {
      const replay = await changeReceipt(db, auditId, actor.userId, member.id, role);
      if (!replay) throw error;
      return { memberId: replay.newMemberId, previousMemberId: member.id, role, changed: replay.changed, replayed: true };
    }
    return { memberId: member.id, previousMemberId: member.id, role, changed: false };
  }
  const newMemberId = crypto.randomUUID(), now = new Date().toISOString();
  try {
    const results = await db.batch([
      db.prepare(`UPDATE members SET revoked_at=? WHERE id=? AND user_id=? AND role=?
        AND project_id IS ? AND revoked_at IS NULL AND ${authorization}
        AND (role!='owner' OR NOT EXISTS (SELECT 1 FROM portal_users account
          WHERE account.user_id=members.user_id AND account.status='active' AND COALESCE(account.activation_pending,0)=0) OR ${ACTIVE_OWNER_COUNT_SQL}>1)`)
        .bind(now, member.id, member.user_id, member.role, member.project_id, ...authorizationParameters),
      db.prepare(`INSERT INTO members (id,user_id,email,role,project_id,revoked_at,created_at)
        SELECT ?,user_id,email,?,project_id,NULL,? FROM members WHERE id=? AND changes()=1`)
        .bind(newMemberId, role, now, member.id),
      db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
        SELECT ?,?,?,'member.change',?,?,? WHERE changes()=1`)
        .bind(auditId, actor.userId, member.project_id, member.id,
          JSON.stringify({ memberId: member.id, newMemberId, role, changed: true }), now),
    ]);
    if (results.some(result => result.meta.changes !== 1)) {
      const replay = await changeReceipt(db, auditId, actor.userId, member.id, role);
      if (replay) return { memberId: replay.newMemberId, previousMemberId: member.id, role, changed: replay.changed, replayed: true };
      throw new HttpError(409, 'O vínculo ou seu acesso mudou. O último responsável ativo deve ser preservado.', 'member_not_changed');
    }
  } catch (error) {
    const replay = await changeReceipt(db, auditId, actor.userId, member.id, role);
    if (replay) return { memberId: replay.newMemberId, previousMemberId: member.id, role, changed: replay.changed, replayed: true };
    throw error;
  }
  return { memberId: newMemberId, previousMemberId: member.id, role, changed: true };
}
