import { HttpError } from './errors';
import { prepareMutation } from './mutations';

type Role = 'owner' | 'manager' | 'operator' | 'inventory' | 'loans' | 'viewer';
export const LEGACY_ORGANIZATION_ID = 'org_proex';
export type PortalMember = {
  id: string; user_id: string; email: string; role: Role; project_id: string | null;
  revoked_at: string | null; created_at: string;
  organization_id?: string | null;
};
export type PortalActor = {
  userId: string; email: string; displayName: string;
  members: PortalMember[]; capabilities: string[];
  organizationProjects?: Record<string, string[]>;
  organizations?: { id: string; name: string; slug: string; status: string; version: number; canManage: boolean }[];
  /** Volunteer grants: one action (campaign) each, until endsAt. Never a project membership. */
  volunteers?: VolunteerGrant[];
};
export type VolunteerGrant = { id: string; campaignId: string; projectId: string; endsAt: string };
type NativeUser = { userId: string; email: string; displayName: string };
type Invite = {
  id: string; token_hash: string; email: string; role: Exclude<Role, 'owner'>;
  project_id: string | null; created_by: string; expires_at: string;
  accepted_by: string | null; accepted_at: string | null; revoked_at: string | null; created_at: string;
  organization_id: string;
};

const OPERATIONAL = [
  'campaigns.manage', 'participation.operate', 'inventory.read', 'inventory.manage',
  'inventory.deliver', 'loans.read', 'loans.manage', 'loans.checkout', 'reports.read',
  'access.invite', 'access.manage',
];
const ROLE_CAPABILITIES: Record<Role, readonly string[]> = {
  owner: [...OPERATIONAL, 'organization.manage', 'projects.manage', 'reports.export_identifiable'],
  manager: OPERATIONAL,
  operator: ['participation.operate', 'inventory.deliver'],
  inventory: ['inventory.read', 'inventory.manage'],
  loans: ['loans.read', 'loans.manage', 'loans.checkout'],
  viewer: ['reports.read'],
};
const SUBORDINATE_ROLES = ['operator', 'inventory', 'loans', 'viewer'];
const INVITABLE_ROLES = ['manager', ...SUBORDINATE_ROLES];
const KNOWN_CAPABILITIES = new Set(ROLE_CAPABILITIES.owner);
/** What a volunteer may do, and only at the campaign of the grant: run the physical desk and hand out prizes. */
export const VOLUNTEER_CAPABILITIES: readonly string[] = ['participation.operate', 'inventory.deliver'];
/** Longest volunteer access allowed from the moment the invite is created. */
const VOLUNTEER_MAX_MS = 120 * 24 * 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}
function email(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}
function isoValid(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function isRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.hasOwn(ROLE_CAPABILITIES, value);
}
function usableMember(member: PortalMember, actorUserId: string): boolean {
  return member?.user_id === actorUserId && identifier(member.id) && isRole(member.role)
    && member.revoked_at === null && isoValid(member.created_at)
    && (member.project_id === null || identifier(member.project_id))
    && (member.organization_id == null || identifier(member.organization_id))
    && (member.role !== 'owner' || member.project_id === null);
}
function activeMembers(actor: PortalActor): PortalMember[] {
  return Array.isArray(actor.members) ? actor.members.filter((member) => usableMember(member, actor.userId)) : [];
}
function globalOwner(actor: PortalActor): boolean {
  return activeMembers(actor).some((member) => member.role === 'owner' && member.project_id === null && member.organization_id == null);
}

/** projectSql is server-owned SQL. Its placeholder, if any, occurs exactly once. */
export function memberProjectScopeSql(alias: string, projectSql: string): string {
  return `EXISTS(SELECT 1 FROM projects auth_project WHERE auth_project.id=${projectSql} AND
    (${alias}.project_id=auth_project.id OR (${alias}.project_id IS NULL AND
      ((${alias}.role='owner' AND ${alias}.organization_id IS NULL) OR ${alias}.organization_id=auth_project.organization_id))))`;
}
export function organizationOwnerSql(alias: string, organizationSql: string): string {
  return `${alias}.role='owner' AND ${alias}.project_id IS NULL AND (${alias}.organization_id IS NULL OR ${alias}.organization_id=${organizationSql})`;
}
export function ownerSurvivalSql(target:string):string{
  return `(${target}.role!='owner' OR (${target}.organization_id IS NULL AND
    (SELECT COUNT(DISTINCT remaining.user_id) FROM members remaining LEFT JOIN portal_users account ON account.user_id=remaining.user_id
     WHERE remaining.role='owner' AND remaining.project_id IS NULL AND remaining.organization_id IS NULL AND remaining.revoked_at IS NULL
     AND COALESCE(account.status,'active')='active' AND COALESCE(account.activation_pending,0)=0 AND account.anonymized_at IS NULL)>1)
    OR (${target}.organization_id IS NOT NULL AND EXISTS(SELECT 1 FROM members remaining LEFT JOIN portal_users account ON account.user_id=remaining.user_id
     WHERE remaining.id!=${target}.id AND remaining.role='owner' AND remaining.project_id IS NULL AND remaining.organization_id=${target}.organization_id AND remaining.revoked_at IS NULL
     AND COALESCE(account.status,'active')='active' AND COALESCE(account.activation_pending,0)=0 AND account.anonymized_at IS NULL)))`;
}
function memberHasProject(actor: PortalActor, member: PortalMember, projectId: string): boolean {
  if (member.project_id !== null) return member.project_id === projectId;
  if (member.role === 'owner' && member.organization_id == null) return true;
  return !!actor.organizationProjects?.[member.organization_id ?? LEGACY_ORGANIZATION_ID]?.includes(projectId);
}
export function requireOrganizationCapability(actor: PortalActor | null, capability: string, organizationId: string): void {
  if (!actor) throw new HttpError(401, 'Entre para continuar.', 'unauthenticated');
  if (!identifier(organizationId) || !KNOWN_CAPABILITIES.has(capability) || !activeMembers(actor).some(member =>
    ROLE_CAPABILITIES[member.role].includes(capability) && member.role === 'owner' && member.project_id === null
    && (member.organization_id == null || member.organization_id === organizationId))) {
    throw new HttpError(403, 'Você não tem permissão nesta organização.', 'organization_forbidden');
  }
}
export function organizationAuthoritySql(actor: PortalActor, organizationId: string) {
  return { sql: `EXISTS(SELECT 1 FROM members m LEFT JOIN portal_users u ON u.user_id=m.user_id
    WHERE m.user_id=? AND m.revoked_at IS NULL AND ${organizationOwnerSql('m','?')}
    AND COALESCE(u.status,'active')='active' AND COALESCE(u.activation_pending,0)=0 AND u.anonymized_at IS NULL)`, values: [actor.userId, organizationId] };
}
export function platformOwnerAuthoritySql(actor: PortalActor) {
  return { sql: `EXISTS(SELECT 1 FROM members m JOIN portal_users u ON u.user_id=m.user_id
    WHERE m.user_id=? AND m.role='owner' AND m.organization_id IS NULL AND m.project_id IS NULL AND m.revoked_at IS NULL
    AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL)`, values: [actor.userId] };
}
/** Configuration delegation does not grant access to provider credentials. */
export function aiConfigurationAuthority(actor: PortalActor, organizationId: string) {
  const owner = organizationAuthoritySql(actor, organizationId);
  return { sql: `EXISTS(SELECT 1 FROM organizations WHERE id=? AND status='active') AND (${owner.sql} OR EXISTS(
    SELECT 1 FROM ai_configuration_grants g JOIN members issuer ON issuer.id=g.grantor_member_id
    JOIN portal_users u ON u.user_id=issuer.user_id
    WHERE g.organization_id=? AND g.user_id=? AND g.revoked_at IS NULL
    AND issuer.role='owner' AND issuer.project_id IS NULL AND (issuer.organization_id IS NULL OR issuer.organization_id=g.organization_id) AND issuer.revoked_at IS NULL
    AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL
    AND EXISTS(SELECT 1 FROM members target JOIN portal_users account ON account.user_id=target.user_id WHERE target.user_id=g.user_id AND target.organization_id=g.organization_id AND target.revoked_at IS NULL AND account.status='active' AND account.activation_pending=0 AND account.anonymized_at IS NULL)))`, values: [organizationId, ...owner.values, organizationId, actor.userId] };
}
/** SQL authorization is evaluated with the resource, including revocation after getActor. */
export function projectAuthoritySql(actor: PortalActor, capabilities: readonly string[], projectSql: string) {
  const roles=Object.entries(ROLE_CAPABILITIES).filter(([,available])=>!capabilities.length||capabilities.some(capability=>available.includes(capability))).map(([role])=>role);
  if(!roles.length)return{sql:'1=0',values:[]};
  return {sql:`EXISTS(SELECT 1 FROM members read_auth LEFT JOIN portal_users read_user ON read_user.user_id=read_auth.user_id
    WHERE read_auth.user_id=? AND read_auth.role IN (${roles.map(()=>'?').join(',')}) AND read_auth.revoked_at IS NULL
    AND COALESCE(read_user.status,'active')='active' AND COALESCE(read_user.activation_pending,0)=0 AND read_user.anonymized_at IS NULL
    AND ${memberProjectScopeSql('read_auth',projectSql)})`,values:[actor.userId,...roles]};
}

/**
 * `user` must come exclusively from the server-side canonical session resolver.
 * Native bootstrap alone may supply configuredOwnerEmail; password identities never do.
 * Re-read memberships for EVERY API request. No provider headers or client claims are accepted here.
 */
export async function getActor(
  db: D1Database, user: NativeUser | null, configuredOwnerEmail?: string,
): Promise<PortalActor | null> {
  if (!user || !identifier(user.userId) || !email(user.email)) return null;
  const normalizedEmail = email(user.email)!;
  await expireVolunteerAccess(db);
  const account=await db.prepare('SELECT status,activation_pending,anonymized_at FROM portal_users WHERE user_id=?').bind(user.userId).first<{status:string;activation_pending:number;anonymized_at:string|null}>();
  if(account?.status==='blocked'||account?.anonymized_at)return null;
  if (!account?.activation_pending && email(configuredOwnerEmail) === normalizedEmail) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // Bootstrap happens only before any global owner has ever existed. Logging in must not
    // resurrect a revoked owner or turn a changed OWNER_EMAIL into an administrator bypass.
    await db.batch([
      db.prepare(`INSERT INTO members (id,user_id,email,role,project_id,revoked_at,created_at)
        SELECT ?,?,?,'owner',NULL,NULL,?
        WHERE NOT EXISTS (SELECT 1 FROM members WHERE role='owner' AND project_id IS NULL AND organization_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM members WHERE user_id=? AND project_id IS NULL AND organization_id IS NULL AND revoked_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM portal_users WHERE user_id=? AND (status!='active' OR activation_pending!=0 OR anonymized_at IS NOT NULL))`)
        .bind(id, user.userId, normalizedEmail, now, user.userId, user.userId),
      db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
        SELECT ?,?,NULL,'owner.bootstrap',?,'{}',? WHERE EXISTS (SELECT 1 FROM members WHERE id=?)`)
        .bind(crypto.randomUUID(), user.userId, id, now, id),
    ]);
  }
  const result = await db.prepare('SELECT * FROM members WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at,id')
    .bind(user.userId).all<PortalMember>();
  const members = (account?.activation_pending ? [] : result.results ?? []).filter((member) => usableMember(member, user.userId));
  const platformOwner = members.some(member => member.role === 'owner' && member.project_id === null && member.organization_id == null);
  const organizationIds = [...new Set(members.filter(member => member.project_id === null && !platformOwner).map(member => member.organization_id ?? LEGACY_ORGANIZATION_ID))];
  const organizationProjects: Record<string, string[]> = Object.fromEntries(organizationIds.map(id => [id, []]));
  if (organizationIds.length) {
    const projects = await db.prepare(`SELECT id,organization_id FROM projects WHERE organization_id IN (${organizationIds.map(() => '?').join(',')})`).bind(...organizationIds).all<{id:string;organization_id:string}>();
    for (const project of projects.results ?? []) organizationProjects[project.organization_id].push(project.id);
  }
  const organizations = !members.length ? [] : platformOwner
    ? (await db.prepare('SELECT id,name,slug,status,version FROM organizations ORDER BY name,id').all<{id:string;name:string;slug:string;status:string;version:number}>()).results ?? []
    : (await db.prepare(`SELECT DISTINCT o.id,o.name,o.slug,o.status,o.version FROM organizations o JOIN members m ON m.organization_id=o.id
        WHERE m.id IN (${members.map(()=>'?').join(',')}) ORDER BY o.name,o.id`).bind(...members.map(member=>member.id)).all<{id:string;name:string;slug:string;status:string;version:number}>()).results ?? [];
  const volunteers = account?.activation_pending ? [] : ((await db.prepare(`SELECT v.id,v.campaign_id AS campaignId,v.project_id AS projectId,v.ends_at AS endsAt
    FROM campaign_volunteers v JOIN campaigns c ON c.id=v.campaign_id AND c.project_id=v.project_id
    WHERE v.user_id=? AND v.revoked_at IS NULL AND julianday(v.ends_at)>julianday('now') ORDER BY v.ends_at,v.id`).bind(user.userId).all<VolunteerGrant>()).results ?? [])
    .filter(grant => identifier(grant.id) && identifier(grant.campaignId) && identifier(grant.projectId) && isoValid(grant.endsAt));
  return {
    userId: user.userId, email: normalizedEmail,
    displayName: typeof user.displayName === 'string' ? user.displayName.slice(0, 200) : normalizedEmail,
    members, volunteers, organizationProjects, organizations:organizations.map(organization=>({...organization,canManage:platformOwner||members.some(member=>member.role==='owner'&&member.project_id===null&&member.organization_id===organization.id)})), capabilities: [...new Set(members.flatMap((member) => ROLE_CAPABILITIES[member.role]))],
  };
}

/**
 * Omitted projectId is a presence check for filtered snapshots only. `null` requires global scope.
 * Resource mutations must pass the project resolved from the stored resource, never its client label.
 * The informational actor.capabilities array is never used as an authorization source.
 */
export function requireCapability(actor: PortalActor | null, capability: string, projectId?: string | null): void {
  if (!actor) throw new HttpError(401, 'Entre com sua conta para continuar.', 'unauthenticated');
  if (!KNOWN_CAPABILITIES.has(capability) || (projectId !== undefined && projectId !== null && !identifier(projectId))) {
    throw new HttpError(403, 'Você não tem permissão para esta operação.', 'forbidden');
  }
  const allowed = activeMembers(actor).some((member) => ROLE_CAPABILITIES[member.role].includes(capability)
    && (projectId === undefined || (projectId === null ? member.role === 'owner' && member.project_id === null && member.organization_id == null : memberHasProject(actor, member, projectId))));
  if (!allowed) throw new HttpError(403, 'Você não tem permissão neste projeto.', 'forbidden');
}

/** null means organization-wide scope; [] means no authorized projects. */
export function accessibleProjects(actor: PortalActor | null, capability?: string): string[] | null {
  if (!actor || (capability !== undefined && !KNOWN_CAPABILITIES.has(capability))) return [];
  const members = activeMembers(actor).filter((member) => capability === undefined
    || ROLE_CAPABILITIES[member.role].includes(capability));
  if (members.some((member) => member.role === 'owner' && member.project_id === null && member.organization_id == null)) return null;
  return [...new Set(members.flatMap(member => member.project_id === null ? actor.organizationProjects?.[member.organization_id ?? LEGACY_ORGANIZATION_ID] ?? [] : [member.project_id]))];
}

function liveCapability(actor: PortalActor, capability: string, projectId: string | null) {
  requireCapability(actor, capability, projectId);
  const roles = Object.entries(ROLE_CAPABILITIES).filter(([, capabilities]) => capabilities.includes(capability)).map(([role]) => role);
  const sql = `EXISTS (SELECT 1 FROM members m LEFT JOIN portal_users u ON u.user_id=m.user_id
    WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN (${roles.map(() => '?').join(',')})
      AND COALESCE(u.status,'active')='active' AND COALESCE(u.activation_pending,0)=0 AND u.anonymized_at IS NULL
      AND ${projectId === null ? "m.role='owner' AND m.project_id IS NULL AND m.organization_id IS NULL" : memberProjectScopeSql('m','?')})`;
  return { sql, values: [actor.userId, ...roles, ...(projectId === null ? [] : [projectId])] };
}

/** Replays are protected reads too; never trust a membership loaded before revocation. */
export async function requireLiveCapability(db: D1Database, actor: PortalActor, capability: string, projectId: string | null): Promise<void> {
  const permission = liveCapability(actor, capability, projectId);
  if (!await db.prepare(`SELECT 1 AS allowed WHERE ${permission.sql}`).bind(...permission.values).first()) {
    throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'access_changed');
  }
}

/** The assertion and domain writes share one transaction, including audit and stock triggers. */
export async function capabilityBatch(db: D1Database, actor: PortalActor, capability: string, projectId: string | null, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  const permission = liveCapability(actor, capability, projectId);
  const assertion = db.prepare(`SELECT CASE WHEN ${permission.sql} THEN 1 ELSE json_extract('[]','portal_authority_changed') END`).bind(...permission.values);
  try { return (await db.batch([assertion, ...statements])).slice(1); }
  catch (error) {
    if (String(error).includes('portal_authority_changed')) throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'access_changed');
    throw error;
  }
}

/**
 * Live volunteer authority over one campaign, read with the resource: active grant, before its end,
 * same project as the campaign and an active account. Revocation and expiry apply at once.
 */
export function volunteerCampaignSql(actor: PortalActor, campaignSql: string) {
  return { sql: `EXISTS(SELECT 1 FROM campaign_volunteers vol JOIN campaigns vol_c ON vol_c.id=vol.campaign_id AND vol_c.project_id=vol.project_id
    JOIN portal_users vol_u ON vol_u.user_id=vol.user_id
    WHERE vol.user_id=? AND vol.campaign_id=${campaignSql} AND vol.revoked_at IS NULL AND julianday(vol.ends_at)>julianday('now')
    AND vol_u.status='active' AND vol_u.activation_pending=0 AND vol_u.anonymized_at IS NULL)`, values: [actor.userId] };
}
function hasProjectCapability(actor: PortalActor, capability: string, projectId: string): boolean {
  try { requireCapability(actor, capability, projectId); return true; } catch { return false; }
}
/** Team members keep their project authority; a volunteer adds authority only over the campaign of the grant. */
function campaignCapability(actor: PortalActor, capability: string, projectId: string, campaignId: string) {
  const member = hasProjectCapability(actor, capability, projectId) ? liveCapability(actor, capability, projectId) : null;
  const volunteer = VOLUNTEER_CAPABILITIES.includes(capability) && identifier(campaignId)
    && (actor.volunteers ?? []).some(grant => grant.campaignId === campaignId && grant.projectId === projectId)
    ? volunteerCampaignSql(actor, '?') : null;
  if (!member && !volunteer) throw new HttpError(403, 'Você não tem permissão nesta ação.', 'forbidden');
  const parts = [member, volunteer && { sql: volunteer.sql, values: [...volunteer.values, campaignId] }].filter(Boolean) as { sql: string; values: unknown[] }[];
  return { sql: parts.map(part => `(${part.sql})`).join(' OR '), values: parts.flatMap(part => part.values) };
}
export async function requireLiveCampaignCapability(db: D1Database, actor: PortalActor, capability: string, projectId: string, campaignId: string): Promise<void> {
  const permission = campaignCapability(actor, capability, projectId, campaignId);
  if (!await db.prepare(`SELECT 1 AS allowed WHERE ${permission.sql}`).bind(...permission.values).first()) {
    throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'access_changed');
  }
}
export async function campaignCapabilityBatch(db: D1Database, actor: PortalActor, capability: string, projectId: string, campaignId: string, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  const permission = campaignCapability(actor, capability, projectId, campaignId);
  const assertion = db.prepare(`SELECT CASE WHEN ${permission.sql} THEN 1 ELSE json_extract('[]','portal_authority_changed') END`).bind(...permission.values);
  try { return (await db.batch([assertion, ...statements])).slice(1); }
  catch (error) {
    if (String(error).includes('portal_authority_changed')) throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'access_changed');
    throw error;
  }
}
/**
 * Ends every volunteer grant whose deadline passed and records it in the audit (Registros), once.
 * Runs on each request; it only writes when something is due. Access already stops at endsAt in every
 * SQL check, so this sweep only makes the end visible and permanent.
 */
export async function expireVolunteerAccess(db: D1Database): Promise<number> {
  const due = (await db.prepare(`SELECT id FROM campaign_volunteers WHERE revoked_at IS NULL AND julianday(ends_at)<=julianday('now') ORDER BY ends_at,id LIMIT 50`).all<{ id: string }>()).results ?? [];
  if (!due.length) return 0;
  const now = new Date().toISOString();
  await db.batch(due.flatMap(({ id }) => [
    db.prepare(`UPDATE campaign_volunteers SET revoked_at=ends_at,revoke_reason='expired' WHERE id=? AND revoked_at IS NULL AND julianday(ends_at)<=julianday('now')`).bind(id),
    db.prepare(`INSERT OR IGNORE INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
      SELECT ?,v.user_id,v.project_id,'volunteer.expired',v.id,json_object('campaignId',v.campaign_id,'endsAt',v.ends_at,'recordedAt',?),v.ends_at
      FROM campaign_volunteers v WHERE v.id=? AND v.revoke_reason='expired'`).bind(`volunteer-expired:${id}`, now, id),
  ]));
  return due.length;
}

const ACTIVE_ACCOUNT_SQL = `EXISTS (SELECT 1 FROM portal_users WHERE user_id=? AND status='active' AND activation_pending=0 AND anonymized_at IS NULL)`;
/** Public participation needs an active canonical account, but no internal project role. */
export async function requireLiveAccount(db: D1Database, userId: string): Promise<void> {
  if (!identifier(userId) || !await db.prepare(`SELECT 1 AS allowed WHERE ${ACTIVE_ACCOUNT_SQL}`).bind(userId).first()) {
    throw new HttpError(403, 'Seu acesso mudou. Entre novamente.', 'account_inactive');
  }
}
export async function accountBatch(db: D1Database, userId: string, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  const assertion = db.prepare(`SELECT CASE WHEN ${ACTIVE_ACCOUNT_SQL} THEN 1 ELSE json_extract('[]','participant_account_changed') END`).bind(userId);
  try { return (await db.batch([assertion, ...statements])).slice(1); }
  catch (error) {
    if (String(error).includes('participant_account_changed')) throw new HttpError(403, 'Seu acesso mudou. Entre novamente.', 'account_inactive');
    throw error;
  }
}

function auditDetails(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[omitido]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return /[?&](token|code|key)=|[^\s@]+@[^\s@]+\.[^\s@]+/i.test(value) ? '[omitido]' : value.slice(0, 500);
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => auditDetails(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key,
      /token|password|secret|authorization|cookie|email|message|inviteurl/i.test(key)
        ? '[omitido]' : auditDetails(item, depth + 1)]));
  }
  return null;
}

export async function writeAudit(
  db: D1Database, actor: PortalActor, action: string, entityId: string,
  projectId: string | null = null, details: Record<string, unknown> = {},
): Promise<void> {
  await db.prepare('INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), actor.userId, projectId, action.slice(0, 100), entityId,
      JSON.stringify(auditDetails(details)), new Date().toISOString()).run();
}

async function hashToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function invitationToken(secret: string, actorId: string, operationKey: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = JSON.stringify(['proex.invitation.v1', actorId, 'invite.create', operationKey]);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function projectValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!identifier(value)) throw new HttpError(400, 'Escolha um projeto válido.', 'invalid_project');
  return value;
}
function canManageRole(actor: PortalActor, role: string, projectId: string | null, organizationId: string | null = LEGACY_ORGANIZATION_ID): boolean {
  if (globalOwner(actor)) return true;
  if (INVITABLE_ROLES.includes(role) && activeMembers(actor).some(member => member.role==='owner' && member.project_id===null && member.organization_id===organizationId)) return true;
  return projectId !== null && SUBORDINATE_ROLES.includes(role)
    && activeMembers(actor).some((member) => member.role === 'manager' && memberHasProject(actor, member, projectId));
}
function delegationPredicate(alias: string, scope: string): string {
  return `((${organizationOwnerSql(alias,`${scope}.organization_id`)} AND (${scope}.role!='owner' OR ${alias}.organization_id IS NULL))
    OR (${scope}.project_id IS NOT NULL AND ${scope}.role IN ('operator','inventory','loans','viewer') AND ${alias}.role='manager' AND ${memberProjectScopeSql(alias,`${scope}.project_id`)}))`;
}
export function delegationAuthority(actor: PortalActor, projectId: string | null, organizationId: string | null, role: string) {
  return { sql: `EXISTS(SELECT 1 FROM (SELECT ? AS project_id,? AS organization_id,? AS role) scope JOIN members auth
    LEFT JOIN portal_users account ON account.user_id=auth.user_id WHERE auth.user_id=? AND auth.revoked_at IS NULL
    AND COALESCE(account.status,'active')='active' AND COALESCE(account.activation_pending,0)=0 AND account.anonymized_at IS NULL
    AND ${delegationPredicate('auth','scope')})`, values: [projectId,organizationId,role,actor.userId] };
}
const ISSUER_SQL = `(EXISTS (SELECT 1 FROM members issuer
  LEFT JOIN portal_users account ON account.user_id=issuer.user_id
  WHERE issuer.user_id=i.created_by AND issuer.revoked_at IS NULL AND ${delegationPredicate('issuer','i')}
    AND COALESCE(account.status,'active')='active' AND COALESCE(account.activation_pending,0)=0 AND account.anonymized_at IS NULL))`;

/** Access mutations use conditional SQL and atomic D1 batches, not a read-then-unconditional-write. */
export async function accessAction(
  db: D1Database, actor: PortalActor | null, action: string, input: Record<string, unknown>, origin: string,
  inviteSecret?: string,
): Promise<Record<string, unknown> | null> {
  if (!['invite.create', 'invite.revoke', 'invite.accept', 'member.revoke', 'volunteer.revoke'].includes(action)) return null;
  if (!actor) throw new HttpError(401, 'Entre com sua conta para continuar.', 'unauthenticated');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Dados inválidos.', 'invalid_input');

  if (action === 'invite.create') {
    const recipient = email(input.email);
    const role = typeof input.role === 'string' ? input.role : '';
    const projectId = projectValue(input.projectId);
    const project = projectId ? await db.prepare('SELECT id,organization_id FROM projects WHERE id=?').bind(projectId).first<{id:string;organization_id:string}>() : null;
    const ownOrganizations = activeMembers(actor).filter(member=>member.role==='owner'&&member.organization_id).map(member=>member.organization_id!);
    const organizationId = project?.organization_id ?? (typeof input.organizationId==='string'?input.organizationId:ownOrganizations.length===1?ownOrganizations[0]:LEGACY_ORGANIZATION_ID);
    if (!recipient || !INVITABLE_ROLES.includes(role)) throw new HttpError(400, 'Informe e-mail e função válidos.', 'invalid_invite');
    if(projectId)requireCapability(actor,'access.invite',projectId);else requireOrganizationCapability(actor,'access.invite',organizationId);
    if (!canManageRole(actor, role, projectId, organizationId)) throw new HttpError(403, 'Você não pode conceder essa função ou escopo.', 'delegation_forbidden');
    if (projectId === null && input.globalAccess !== true) {
      throw new HttpError(400, 'Escolha um projeto. O acesso ao portal inteiro exige confirmação explícita da administração.', 'global_scope_confirmation_required');
    }
    if (projectId && !project) {
      throw new HttpError(404, 'Projeto não encontrado.', 'project_not_found');
    }
    // Voluntário: convite de operador recortado a uma ação (campanha) do mesmo projeto, com data de fim.
    const volunteer = input.campaignId === undefined && input.endsAt === undefined ? null : await (async () => {
      if (role !== 'operator' || !projectId) throw new HttpError(400, 'O acesso de voluntário vale para uma ação de um projeto, com a função de atendimento.', 'invalid_volunteer_scope');
      if (!identifier(input.campaignId)) throw new HttpError(400, 'Escolha a ação do voluntário.', 'invalid_volunteer_scope');
      if (typeof input.endsAt !== 'string' || !Number.isFinite(Date.parse(input.endsAt))) throw new HttpError(400, 'Informe até quando vai o acesso do voluntário.', 'invalid_volunteer_end');
      const endsAt = new Date(Date.parse(input.endsAt)).toISOString();
      if (Date.parse(endsAt) <= Date.now() + 10 * 60 * 1000) throw new HttpError(400, 'O fim do acesso precisa ser daqui a pelo menos 10 minutos.', 'invalid_volunteer_end');
      if (Date.parse(endsAt) > Date.now() + VOLUNTEER_MAX_MS) throw new HttpError(400, 'O acesso de voluntário dura no máximo 120 dias.', 'invalid_volunteer_end');
      const campaign = await db.prepare(`SELECT id,status FROM campaigns WHERE id=? AND project_id=?`).bind(input.campaignId, projectId).first<{ id: string; status: string }>();
      if (!campaign) throw new HttpError(404, 'Ação não encontrada neste projeto.', 'campaign_not_found');
      if (campaign.status === 'closed') throw new HttpError(409, 'Esta ação já foi encerrada. Escolha uma ação em andamento.', 'campaign_closed');
      return { campaignId: campaign.id, endsAt };
    })();
    if(!await db.prepare("SELECT id FROM organizations WHERE id=? AND status='active'").bind(organizationId).first() || (project && input.organizationId!==undefined && input.organizationId!==organizationId))throw new HttpError(400,'Escolha uma organização ativa e compatível com o projeto.','invalid_organization');
    let base: URL;
    try { base = new URL(origin); } catch { throw new HttpError(400, 'Endereço do portal inválido.', 'invalid_origin'); }
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) {
      throw new HttpError(400, 'Endereço do portal inválido.', 'invalid_origin');
    }
    if (typeof inviteSecret !== 'string' || inviteSecret.trim().length < 32) {
      throw new HttpError(503, 'A emissão de convites precisa ser configurada pelo responsável.', 'invites_unavailable');
    }
    const mutation = await prepareMutation(db, actor.userId, action, {
      email: recipient, role, projectId, ...(organizationId===LEGACY_ORGANIZATION_ID?{}:{organizationId}), ...(volunteer ?? {}), operationKey: input.operationKey,
    });
    const token = await invitationToken(inviteSecret, actor.userId, input.operationKey as string);
    const tokenHash = await hashToken(token);
    const permission=delegationAuthority(actor,projectId,organizationId,role),authorization=permission.sql,authorizationParameters=permission.values;
    async function presentInvite(id: string, replayed: boolean): Promise<Record<string, unknown>> {
      // Recovering a link is a privileged operation too; a stale or blocked author gets no token.
      const invitation = await db.prepare(`SELECT invites.*,s.campaign_id AS scope_campaign_id,s.ends_at AS scope_ends_at FROM invites
        LEFT JOIN invite_campaign_scopes s ON s.invite_id=invites.id WHERE invites.id=? AND invites.created_by=? AND ${authorization}`)
        .bind(id, actor!.userId, ...authorizationParameters).first<Invite & { scope_campaign_id: string | null; scope_ends_at: string | null }>();
      if (!invitation) throw new HttpError(403, 'O convite ou seu acesso mudou. Atualize a página.', 'access_changed');
      if (invitation.email !== recipient || invitation.role !== role || invitation.project_id !== projectId || invitation.organization_id!==organizationId || invitation.token_hash !== tokenHash
        || invitation.scope_campaign_id !== (volunteer?.campaignId ?? null) || invitation.scope_ends_at !== (volunteer?.endsAt ?? null)) {
        throw new HttpError(409, 'Não foi possível recuperar este convite. Confira a configuração e gere um novo link.', 'invite_replay_unavailable');
      }
      if (invitation.accepted_at) throw new HttpError(409, 'Este convite já foi aceito.', 'invite_used');
      if (invitation.revoked_at) throw new HttpError(409, 'Este convite foi revogado.', 'invite_revoked');
      if (!isoValid(invitation.expires_at) || Date.parse(invitation.expires_at) <= Date.now()) {
        throw new HttpError(409, 'Este convite expirou. Gere um novo convite.', 'invite_expired');
      }
      return { id: invitation.id, expiresAt: invitation.expires_at, ...(volunteer ? { volunteer } : {}),
        inviteUrl: `${base.origin}/convite?token=${encodeURIComponent(token)}`, delivery: 'manual', ...(replayed ? { replayed: true } : {}) };
    }
    if (mutation.existingId) return presentInvite(mutation.existingId, true);
    const id = crypto.randomUUID(), now = new Date().toISOString();
    // The link of a volunteer invite never outlives the access it grants.
    const expiresAt = new Date(Math.min(Date.now() + INVITE_TTL_MS, volunteer ? Date.parse(volunteer.endsAt) : Infinity)).toISOString();
    try {
      const result = await db.batch([
        db.prepare(`INSERT INTO invites (id,token_hash,email,role,project_id,organization_id,created_by,expires_at,created_at)
          SELECT ?,?,?,?,?,?,?,?,? WHERE ${authorization}`)
          .bind(id, tokenHash, recipient, role, projectId, organizationId, actor.userId, expiresAt, now, ...authorizationParameters),
        ...(volunteer ? [db.prepare(`INSERT INTO invite_campaign_scopes(invite_id,campaign_id,ends_at,created_at)
          SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM invites WHERE id=?)`).bind(id, volunteer.campaignId, volunteer.endsAt, now, id)] : []),
        db.prepare(`INSERT INTO mutation_keys(scope,fingerprint,entity_id,created_at)
          SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM invites WHERE id=?)`)
          .bind(mutation.scope, mutation.fingerprint, id, now, id),
        db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
          SELECT ?,?,?,'invite.create',?,?,? WHERE EXISTS (SELECT 1 FROM invites WHERE id=?)`)
          .bind(crypto.randomUUID(), actor.userId, projectId, id, JSON.stringify(volunteer ? { role, volunteer: true, ...volunteer } : { role }), now, id),
      ]);
      if (result.some(statement => statement.meta.changes !== 1)) {
        throw new HttpError(403, 'Seu acesso mudou. Atualize a página.', 'access_changed');
      }
    } catch (error) {
      return presentInvite(await mutation.recover(error), true);
    }
    return presentInvite(id, false);
  }

  if (action === 'invite.accept') {
    const token = typeof input.token === 'string' ? input.token : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(400, 'Convite inválido.', 'invalid_invite');
    const tokenHash = await hashToken(token);
    const invitation = await db.prepare('SELECT * FROM invites WHERE token_hash=?').bind(tokenHash).first<Invite>();
    if (!invitation) throw new HttpError(404, 'Convite não encontrado.', 'invite_not_found');
    if (invitation.accepted_at) throw new HttpError(409, 'Este convite já foi aceito.', 'invite_used');
    if (invitation.revoked_at) throw new HttpError(409, 'Este convite foi revogado.', 'invite_revoked');
    if (!isoValid(invitation.expires_at) || Date.parse(invitation.expires_at) <= Date.now()) {
      throw new HttpError(409, 'Este convite expirou. Peça um novo link à equipe.', 'invite_expired');
    }
    if (email(invitation.email) !== email(actor.email)) {
      throw new HttpError(403, 'Entre com a conta do e-mail que recebeu o convite.', 'email_mismatch');
    }
    const memberId = crypto.randomUUID();
    const now = new Date().toISOString();
    const scope = await db.prepare('SELECT campaign_id,ends_at FROM invite_campaign_scopes WHERE invite_id=?').bind(invitation.id).first<{ campaign_id: string; ends_at: string }>();
    if (scope) {
      if (!Number.isFinite(Date.parse(scope.ends_at)) || Date.parse(scope.ends_at) <= Date.now()) {
        throw new HttpError(409, 'O prazo deste acesso de voluntário já terminou. Peça um novo convite à equipe.', 'volunteer_access_ended');
      }
      // A volunteer is not a member: the grant lives in campaign_volunteers and reaches one campaign only.
      const result = await db.batch([
        db.prepare(`INSERT INTO campaign_volunteers (id,user_id,email,campaign_id,project_id,invite_id,ends_at,granted_by,created_at)
          SELECT ?,?,?,s.campaign_id,i.project_id,i.id,s.ends_at,i.created_by,? FROM invites i
          JOIN invite_campaign_scopes s ON s.invite_id=i.id JOIN campaigns c ON c.id=s.campaign_id AND c.project_id=i.project_id
          WHERE i.id=? AND i.token_hash=? AND lower(i.email)=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
            AND julianday(i.expires_at)>julianday('now') AND julianday(s.ends_at)>julianday('now')
            AND i.role='operator' AND c.status!='closed' AND ${ISSUER_SQL}
            AND NOT EXISTS (SELECT 1 FROM campaign_volunteers existing WHERE existing.user_id=? AND existing.campaign_id=s.campaign_id AND existing.revoked_at IS NULL)`)
          .bind(memberId, actor.userId, actor.email, now, invitation.id, tokenHash, email(actor.email), actor.userId),
        db.prepare(`UPDATE invites SET accepted_by=?,accepted_at=? WHERE id=? AND accepted_at IS NULL
          AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM campaign_volunteers WHERE id=? AND user_id=?)`)
          .bind(actor.userId, now, invitation.id, memberId, actor.userId),
        db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
          SELECT ?,?,v.project_id,'volunteer.grant',v.id,json_object('campaignId',v.campaign_id,'endsAt',v.ends_at,'inviteId',v.invite_id),? FROM campaign_volunteers v
          WHERE v.id=? AND EXISTS (SELECT 1 FROM invites WHERE id=? AND accepted_by=?)`)
          .bind(crypto.randomUUID(), actor.userId, now, memberId, invitation.id, actor.userId),
      ]);
      if (result[0].meta.changes !== 1 || result[1].meta.changes !== 1) {
        throw new HttpError(409, 'O convite ou o acesso mudou, ou você já é voluntário nesta ação. Atualize a página.', 'invite_not_accepted');
      }
      return { accepted: true, volunteerId: memberId, campaignId: scope.campaign_id, endsAt: scope.ends_at, projectId: invitation.project_id };
    }
    // The unique active (user_id, COALESCE(project_id,'')) index is required. Revoked memberships
    // remain historical rows; a later valid invite creates a new membership rather than rewriting them.
    const result = await db.batch([
      db.prepare(`INSERT INTO members (id,user_id,email,role,project_id,revoked_at,created_at,organization_id)
        SELECT ?,?,?,i.role,i.project_id,NULL,?,i.organization_id FROM invites i
        WHERE i.id=? AND i.token_hash=? AND lower(i.email)=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
          AND julianday(i.expires_at)>julianday('now')
          AND i.role IN ('manager','operator','inventory','loans','viewer') AND ${ISSUER_SQL}
          AND NOT EXISTS (SELECT 1 FROM invite_campaign_scopes s WHERE s.invite_id=i.id)
          AND NOT EXISTS (SELECT 1 FROM members existing WHERE existing.user_id=?
            AND existing.project_id IS i.project_id AND existing.organization_id IS i.organization_id AND existing.revoked_at IS NULL)`)
        .bind(memberId, actor.userId, actor.email, now, invitation.id, tokenHash, email(actor.email), actor.userId),
      db.prepare(`UPDATE invites SET accepted_by=?,accepted_at=? WHERE id=? AND accepted_at IS NULL
        AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM members WHERE id=? AND user_id=?)`)
        .bind(actor.userId, now, invitation.id, memberId, actor.userId),
      db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
        SELECT ?,?,i.project_id,'invite.accept',i.id,?,? FROM invites i
        WHERE i.id=? AND i.accepted_by=? AND EXISTS (SELECT 1 FROM members WHERE id=?)`)
        .bind(crypto.randomUUID(), actor.userId, JSON.stringify({ memberId }), now,
          invitation.id, actor.userId, memberId),
    ]);
    if (result[0].meta.changes !== 1 || result[1].meta.changes !== 1) {
      throw new HttpError(409, 'O convite ou seu acesso mudou, ou você já possui vínculo neste escopo. Atualize a página.', 'invite_not_accepted');
    }
    return { accepted: true, memberId, projectId: invitation.project_id };
  }

  if (!identifier(input.id)) throw new HttpError(400, 'Identificador inválido.', 'invalid_id');
  if (action === 'invite.revoke') {
    const invitation = await db.prepare('SELECT * FROM invites WHERE id=?').bind(input.id).first<Invite>();
    if (!invitation) throw new HttpError(404, 'Convite não encontrado.', 'invite_not_found');
    if(invitation.project_id)requireCapability(actor,'access.manage',invitation.project_id);else requireOrganizationCapability(actor,'access.manage',invitation.organization_id);
    if (!canManageRole(actor, invitation.role, invitation.project_id, invitation.organization_id)) throw new HttpError(403, 'Você não pode revogar este convite.', 'forbidden');
    if (invitation.accepted_at) throw new HttpError(409, 'Convite já aceito. Revogue o vínculo na lista da equipe.', 'invite_used');
    if (invitation.revoked_at) return { revoked: true, id: invitation.id };
    const now = new Date().toISOString();
    const permission=delegationAuthority(actor,invitation.project_id,invitation.organization_id,invitation.role);
    const results = await db.batch([
      db.prepare(`UPDATE invites SET revoked_at=? WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL
        AND ${permission.sql}`)
        .bind(now, invitation.id, ...permission.values),
      db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
        SELECT ?,?,?,'invite.revoke',?,'{}',? WHERE changes()=1`)
        .bind(crypto.randomUUID(), actor.userId, invitation.project_id, invitation.id, now),
    ]);
    if (results[0].meta.changes !== 1) throw new HttpError(409, 'O convite ou seu acesso mudou. Atualize a página.', 'access_changed');
    return { revoked: true, id: invitation.id };
  }

  if (action === 'volunteer.revoke') {
    const grant = await db.prepare('SELECT v.id,v.project_id,v.revoked_at,p.organization_id FROM campaign_volunteers v JOIN projects p ON p.id=v.project_id WHERE v.id=?').bind(input.id).first<{ id: string; project_id: string; revoked_at: string | null; organization_id: string | null }>();
    if (!grant) throw new HttpError(404, 'Acesso de voluntário não encontrado.', 'volunteer_not_found');
    requireCapability(actor, 'access.manage', grant.project_id);
    if (!canManageRole(actor, 'operator', grant.project_id, grant.organization_id)) throw new HttpError(403, 'Você não pode encerrar este acesso.', 'forbidden');
    if (grant.revoked_at) return { revoked: true, id: grant.id };
    const now = new Date().toISOString();
    const results = await capabilityBatch(db, actor, 'access.manage', grant.project_id, [
      db.prepare(`UPDATE campaign_volunteers SET revoked_at=?,revoked_by=?,revoke_reason='revoked' WHERE id=? AND revoked_at IS NULL`).bind(now, actor.userId, grant.id),
      db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
        SELECT ?,?,v.project_id,'volunteer.revoke',v.id,json_object('campaignId',v.campaign_id,'endsAt',v.ends_at),? FROM campaign_volunteers v
        WHERE v.id=? AND v.revoked_at=? AND v.revoke_reason='revoked'`).bind(crypto.randomUUID(), actor.userId, now, grant.id, now),
    ]);
    if (results[0].meta.changes !== 1) throw new HttpError(409, 'O acesso já terminou ou mudou. Atualize a página.', 'volunteer_changed');
    return { revoked: true, id: grant.id };
  }

  const member = await db.prepare('SELECT * FROM members WHERE id=?').bind(input.id).first<PortalMember>();
  if (!member) throw new HttpError(404, 'Vínculo não encontrado.', 'member_not_found');
  if(member.project_id)requireCapability(actor,'access.manage',member.project_id);else if(member.organization_id)requireOrganizationCapability(actor,'access.manage',member.organization_id);else requireCapability(actor,'access.manage',null);
  if (!canManageRole(actor, member.role, member.project_id, member.organization_id)) throw new HttpError(403, 'Você não pode revogar esta função.', 'forbidden');
  if (member.revoked_at) return { revoked: true, id: member.id };
  const now = new Date().toISOString();
  const permission=delegationAuthority(actor,member.project_id,member.organization_id??null,member.role);
  const results = await db.batch([
    db.prepare(`UPDATE members SET revoked_at=? WHERE id=? AND revoked_at IS NULL
      AND ${permission.sql}
      AND ${ownerSurvivalSql('members')}`)
      .bind(now, member.id, ...permission.values),
    db.prepare(`INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at)
      SELECT ?,?,?,'member.revoke',?,'{}',? WHERE changes()=1`)
      .bind(crypto.randomUUID(), actor.userId, member.project_id, member.id, now),
  ]);
  if (results[0].meta.changes !== 1) {
    throw new HttpError(409, 'Não é possível remover o último responsável, ou seu acesso mudou. Atualize a página.', 'member_not_revoked');
  }
  return { revoked: true, id: member.id };
}
