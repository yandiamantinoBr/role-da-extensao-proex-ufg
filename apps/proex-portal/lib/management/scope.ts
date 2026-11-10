import { organizationAuthoritySql, projectAuthoritySql, type PortalActor } from '../access';
import { one } from '../database';
import { HttpError } from '../errors';

/** Pessoa ativa com qualquer vínculo na organização (projeto dela, a própria organização ou responsável global). */
export function organizationMemberSql(userSql: string, organizationSql: string, memberSinceSql?: string): string {
  // memberSinceSql: o vínculo ativo precisa existir desde essa data (ex.: designação de editor).
  return `EXISTS(SELECT 1 FROM members om LEFT JOIN portal_users ou ON ou.user_id=om.user_id
    WHERE om.user_id=${userSql} AND om.revoked_at IS NULL${memberSinceSql ? ` AND om.created_at<=${memberSinceSql}` : ''}
    AND COALESCE(ou.status,'active')='active' AND COALESCE(ou.activation_pending,0)=0 AND ou.anonymized_at IS NULL
    AND ((om.role='owner' AND om.project_id IS NULL AND om.organization_id IS NULL) OR om.organization_id=${organizationSql}
      OR EXISTS(SELECT 1 FROM projects op WHERE op.id=om.project_id AND op.organization_id=${organizationSql})))`;
}
export function identifier(value: unknown, label = 'o identificador'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(value)) throw new HttpError(400, `Informe ${label}.`, 'invalid_identifier');
  return value;
}
export function requireActor(actor: PortalActor | null): PortalActor {
  if (!actor) throw new HttpError(401, 'Entre para continuar.', 'unauthenticated');
  return actor;
}
/** Confere no banco que a organização está ativa e que a pessoa faz parte dela. */
export async function requireOrganizationMember(db: D1Database, actor: PortalActor, organizationId: string): Promise<{ name: string; owner: boolean }> {
  const owner = organizationAuthoritySql(actor, organizationId);
  const row = await one(db, `SELECT o.name,(${owner.sql}) is_owner FROM organizations o WHERE o.id=? AND o.status='active' AND ${organizationMemberSql('?', 'o.id')}`,
    [...owner.values, organizationId, actor.userId]);
  if (!row) throw new HttpError(404, 'Organização não encontrada ou sem acesso.', 'organization_not_found');
  return { name: String(row.name), owner: Number(row.is_owner) === 1 };
}
export { organizationAuthoritySql, projectAuthoritySql };
