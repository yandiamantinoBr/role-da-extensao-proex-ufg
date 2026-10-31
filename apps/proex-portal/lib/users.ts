import { accessibleProjects, requireCapability, requireOrganizationCapability, delegationAuthority, memberProjectScopeSql, ownerSurvivalSql, type PortalActor, type PortalMember } from './access';
import { HttpError } from './errors';

const SUBORDINATE_ROLES = ['operator', 'inventory', 'loans', 'viewer'];
const ASSIGNABLE_ROLES = ['manager', ...SUBORDINATE_ROLES];
type AssignableRole = 'manager' | 'operator' | 'inventory' | 'loans' | 'viewer';
type UserStatus = 'active' | 'blocked';
type UserRow = { user_id: string; email: string | null; status: UserStatus; anonymized_at: string|null };
type ChangeReceipt = { memberId: string; newMemberId: string; role: AssignableRole; changed: boolean };

// Provider subjects never replace these canonical application user ids.
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}

const OWNER_SQL = `EXISTS (SELECT 1 FROM members auth
  JOIN portal_users account ON account.user_id=auth.user_id AND account.status='active' AND COALESCE(account.activation_pending,0)=0 AND account.anonymized_at IS NULL
  WHERE auth.user_id=? AND auth.role='owner' AND auth.project_id IS NULL AND auth.organization_id IS NULL AND auth.revoked_at IS NULL)`;
const ACTIVE_OWNER_COUNT_SQL = `(SELECT COUNT(DISTINCT owners.user_id) FROM members owners
  LEFT JOIN portal_users account ON account.user_id=owners.user_id
  WHERE owners.role='owner' AND owners.project_id IS NULL AND owners.organization_id IS NULL AND owners.revoked_at IS NULL
    AND COALESCE(account.status,'active')='active' AND COALESCE(account.activation_pending,0)=0 AND account.anonymized_at IS NULL)`;
const VISIBLE_MEMBER_SQL = `EXISTS (SELECT 1 FROM members auth
  JOIN portal_users account ON account.user_id=auth.user_id AND account.status='active' AND COALESCE(account.activation_pending,0)=0 AND account.anonymized_at IS NULL
  WHERE auth.user_id=? AND auth.revoked_at IS NULL AND auth.role IN ('owner','manager')
    AND ((auth.role='owner' AND auth.project_id IS NULL AND auth.organization_id IS NULL)
      OR (auth.project_id IS NULL AND auth.organization_id=m.organization_id) OR auth.project_id=m.project_id))`;

function isOwner(actor: PortalActor): boolean {
  return accessibleProjects(actor, 'organization.manage') === null;
}

function canChange(actor: PortalActor, member: PortalMember, role: AssignableRole): boolean {
  if (isOwner(actor)) return true;
  if(member.role!=='owner' && actor.members.some(item=>item.role==='owner'&&item.project_id===null&&item.organization_id===member.organization_id&&item.revoked_at===null)) return true;
  return member.project_id !== null && SUBORDINATE_ROLES.includes(member.role)
    && SUBORDINATE_ROLES.includes(role)
    && actor.members.some(item => item.user_id === actor.userId && item.role === 'manager'
      && item.revoked_at === null && (item.project_id === member.project_id || (item.project_id===null && actor.organizationProjects?.[item.organization_id??'org_proex']?.includes(member.project_id!))));
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
    db.prepare(`SELECT u.user_id,u.email,u.status,u.activation_pending,u.anonymized_at,p.display_name,p.avatar_key,p.mime,p.version,
        EXISTS (SELECT 1 FROM identity_aliases aliases WHERE aliases.user_id=u.user_id
          AND aliases.provider='password') AS has_password
      FROM portal_users u LEFT JOIN profiles p ON p.user_id=u.user_id
      WHERE ${OWNER_SQL} OR EXISTS (SELECT 1 FROM members m
        WHERE m.user_id=u.user_id AND ${VISIBLE_MEMBER_SQL})
      ORDER BY COALESCE(p.display_name,u.email,u.user_id),u.user_id`).bind(actorId, actorId)
      .all<UserRow & { display_name: string | null; has_password: number; activation_pending: number; avatar_key:string|null;mime:string|null;version:number|null }>(),
    db.prepare(`SELECT m.id,m.user_id,m.role,m.project_id,m.organization_id,m.revoked_at,m.created_at FROM members m
      WHERE ${VISIBLE_MEMBER_SQL} ORDER BY m.created_at,m.id`).bind(actorId)
      .all<Pick<PortalMember, 'id' | 'user_id' | 'role' | 'project_id' | 'organization_id' | 'revoked_at' | 'created_at'>>(),
  ]);
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const member of memberships.results ?? []) {
    const { user_id: userId, ...visible } = member;
    grouped.set(userId, [...(grouped.get(userId) ?? []), visible]);
  }
  return (accounts.results ?? []).map(account => ({
    userId: account.user_id, email: account.anonymized_at?null:account.email,
    displayName: account.anonymized_at?'Conta anonimizada':account.display_name || account.email || 'Pessoa da equipe',
    avatarUrl: !account.anonymized_at&&account.avatar_key&&account.mime==='image/png'&&Number.isSafeInteger(account.version)&&Number(account.version)>0
      ? `/api/team/${encodeURIComponent(account.user_id)}/avatar?v=${account.version}`:null,
    status: account.status, anonymizedAt: account.anonymized_at, hasPassword: Boolean(account.has_password), activationPending: Boolean(account.activation_pending),
    members: grouped.get(account.user_id) ?? [],
  }));
}

export type ManagedPerson = {
 userId:string;displayName:string;email:string|null;status:UserStatus;isAnonymized:boolean;isSelf:boolean;
 unitId:string|null;unit:string;organizationalUnit:{id:string;name:string;acronym:string;kind:string;status:string}|null;
 affiliation:string;jobTitle:string;phone:string;registrationType:string;registrationNumber:string;
 avatarUrl:string|null;profileVersion:number|null;members:Record<string,unknown>[];
};
type ManagedPersonRow={
 user_id:string;email:string|null;status:UserStatus;anonymized_at:string|null;display_name:string|null;
 unit_id:string|null;unit:string|null;affiliation:string|null;job_title:string|null;phone:string|null;
 registration_type:string|null;registration_number:string|null;avatar_key:string|null;mime:string|null;version:number|null;
 org_id:string|null;org_name:string;org_acronym:string;org_kind:string;org_status:string;members_json:string|null;
};
function managedTarget(actor:PortalActor|null,target:unknown,project:unknown){
 requireCapability(actor,'access.manage');
 if(!identifier(target)||(project!==undefined&&project!==null&&project!==''&&!identifier(project)))throw new HttpError(400,'Selecione uma pessoa e um projeto válidos.','invalid_user_detail');
 const projectId=typeof project==='string'&&project?project:null;
 if(projectId)requireCapability(actor,'access.manage',projectId);
 const sql=`u.user_id=? AND (${OWNER_SQL} OR EXISTS(SELECT 1 FROM members m WHERE m.user_id=u.user_id AND ${VISIBLE_MEMBER_SQL}))
  ${projectId?`AND EXISTS(SELECT 1 FROM members m WHERE m.user_id=u.user_id AND ${memberProjectScopeSql('m','?')} AND ${VISIBLE_MEMBER_SQL})`:''}`;
 return {actor:actor!,userId:target,projectId,sql,parameters:[target,actor!.userId,actor!.userId,...(projectId?[projectId,actor!.userId]:[])]};
}
/** Institutional contact/enrollment fields are read on demand, never in the broad directory or Sheets. */
export async function getManagedUser(db:D1Database,actor:PortalActor|null,userId:unknown,projectId?:unknown):Promise<ManagedPerson>{
 const target=managedTarget(actor,userId,projectId);
 // One SQL snapshot binds the private projection, target territory and current authority together.
 const row=await db.prepare(`SELECT u.user_id,u.email,u.status,u.anonymized_at,p.display_name,p.unit_id,p.unit,p.affiliation,p.job_title,p.phone,
   p.registration_type,p.registration_number,p.avatar_key,p.mime,p.version,
   org.id org_id,org.name org_name,org.acronym org_acronym,org.kind org_kind,org.status org_status,
   (SELECT json_group_array(json_object('id',visible.id,'role',visible.role,'project_id',visible.project_id,'organization_id',visible.organization_id,'revoked_at',visible.revoked_at,'created_at',visible.created_at))
    FROM(SELECT m.id,m.role,m.project_id,m.organization_id,m.revoked_at,m.created_at FROM members m WHERE m.user_id=u.user_id AND ${VISIBLE_MEMBER_SQL}
      ${target.projectId?`AND ${memberProjectScopeSql('m','?')}`:''} ORDER BY m.created_at,m.id) visible) members_json
  FROM portal_users u LEFT JOIN profiles p ON p.user_id=u.user_id AND u.anonymized_at IS NULL
  LEFT JOIN organizational_units org ON org.id=p.unit_id WHERE ${target.sql}`)
  .bind(target.actor.userId,...(target.projectId?[target.projectId]:[]),...target.parameters).first<ManagedPersonRow>();
 if(!row)throw new HttpError(404,'Pessoa não encontrada neste contexto ou seu acesso mudou.','user_detail_not_found');
 const anonymized=!!row.anonymized_at,version=typeof row.version==='number'&&Number.isSafeInteger(row.version)&&row.version>0?row.version:null;
 const query=new URLSearchParams();if(version)query.set('v',String(version));if(target.projectId)query.set('projectId',target.projectId);
 return {userId:row.user_id,displayName:anonymized?'Conta anonimizada':row.display_name||row.email||'Pessoa da equipe',email:anonymized?null:row.email,
  status:row.status,isAnonymized:anonymized,isSelf:row.user_id===target.actor.userId,
  unitId:row.unit_id??null,unit:row.unit??'',organizationalUnit:row.org_id?{id:row.org_id,name:row.org_name,acronym:row.org_acronym,kind:row.org_kind,status:row.org_status}:null,
  affiliation:row.affiliation??'',jobTitle:row.job_title??'',phone:row.phone??'',registrationType:row.registration_type??'',registrationNumber:row.registration_number??'',
  avatarUrl:!anonymized&&row.avatar_key&&row.mime==='image/png'&&version?`/api/team/${encodeURIComponent(row.user_id)}/avatar?${query}`:null,
  profileVersion:version,members:JSON.parse(row.members_json||'[]')};
}
/** Storage keys are internal to the protected avatar route and must never enter its JSON response. */
export async function managedUserAvatar(db:D1Database,actor:PortalActor|null,userId:unknown,projectId?:unknown):Promise<{key:string;version:number}>{
 const target=managedTarget(actor,userId,projectId);
 const row=await db.prepare(`SELECT p.avatar_key,p.mime,p.version FROM portal_users u JOIN profiles p ON p.user_id=u.user_id
   WHERE ${target.sql} AND u.anonymized_at IS NULL AND p.avatar_key IS NOT NULL AND p.mime='image/png'`)
   .bind(...target.parameters).first<{avatar_key:string;mime:string;version:number}>();
 if(!row||!Number.isSafeInteger(row.version)||row.version<1)throw new HttpError(404,'Foto não encontrada neste contexto ou seu acesso mudou.','user_avatar_not_found');
 return {key:row.avatar_key,version:row.version};
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
    const target = await db.prepare(`SELECT user_id,email,status,anonymized_at FROM portal_users
      WHERE user_id=? AND ${OWNER_SQL}`).bind(targetId, actor.userId).first<UserRow>();
    if (!target) throw new HttpError(404, 'Conta não encontrada ou seu acesso mudou.', 'user_not_found');
    if (target.anonymized_at) throw new HttpError(409, 'Esta conta foi anonimizada e não pode ser reativada.', 'account_anonymized');
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
      db.prepare(`UPDATE portal_users SET status=?,updated_at=? WHERE user_id=? AND status=? AND anonymized_at IS NULL
        AND ${OWNER_SQL}
        AND (?!='blocked' OR (user_id!=? AND (NOT EXISTS
          (SELECT 1 FROM members target WHERE target.user_id=portal_users.user_id
            AND target.role='owner' AND target.project_id IS NULL AND target.organization_id IS NULL AND target.revoked_at IS NULL
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
  if(member.project_id)requireCapability(actor,'access.manage',member.project_id);else if(member.organization_id)requireOrganizationCapability(actor,'access.manage',member.organization_id);else requireCapability(actor,'access.manage',null);
  if (!canChange(actor, member, role)) throw new HttpError(403, 'Você não pode alterar essa função ou escopo.', 'delegation_forbidden');
  const permission=delegationAuthority(actor,member.project_id,member.organization_id??null,role),authorization=permission.sql,authorizationParameters=permission.values;
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
        AND (NOT EXISTS (SELECT 1 FROM portal_users account
          WHERE account.user_id=members.user_id AND account.status='active' AND COALESCE(account.activation_pending,0)=0 AND account.anonymized_at IS NULL) OR ${ownerSurvivalSql('members')})`)
        .bind(now, member.id, member.user_id, member.role, member.project_id, ...authorizationParameters),
      db.prepare(`INSERT INTO members (id,user_id,email,role,project_id,revoked_at,created_at,organization_id)
        SELECT ?,user_id,email,?,project_id,NULL,?,organization_id FROM members WHERE id=? AND changes()=1`)
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
