import { HttpError } from './errors';
import { accessRoleLabel, projectAccessRoleLabels } from './team-access-labels';

type WorkAccess = { project: string | null; roles: string[]; archived: boolean };
type EventAccess = { name: string; project: string; endsAt: string };
type OrganizationAccess = {
  name: string;
  archived: boolean;
  work: WorkAccess[];
  events: EventAccess[];
};
export type AccountAccess = { platformAdmin: boolean; organizations: OrganizationAccess[]; checkedAt: number };

type AccessRow = {
  kind: 'account' | 'membership' | 'volunteer';
  role: string | null;
  organization_id: string | null;
  organization_name: string | null;
  organization_status: string | null;
  project_id: string | null;
  project_name: string | null;
  project_status: string | null;
  event_name: string | null;
  ends_at: string | null;
};

/** A single read snapshot rechecks account, grant scope, revocation and deadlines at the same time. */
export async function accountAccess(db: D1Database, userId: string): Promise<AccountAccess> {
  const { results: rows = [] } = await db.prepare(`
    WITH account AS (
      SELECT user_id FROM portal_users
      WHERE user_id=? AND status='active' AND activation_pending=0 AND anonymized_at IS NULL
    )
    SELECT 'account' kind,NULL role,NULL organization_id,NULL organization_name,NULL organization_status,
      NULL project_id,NULL project_name,NULL project_status,NULL event_name,NULL ends_at
    FROM account
    UNION ALL
    SELECT 'membership',m.role,o.id,o.name,o.status,p.id,p.name,p.status,NULL,NULL
    FROM account a JOIN members m ON m.user_id=a.user_id
    LEFT JOIN projects p ON p.id=m.project_id AND p.organization_id=m.organization_id
    LEFT JOIN organizations o ON o.id=m.organization_id
    WHERE m.revoked_at IS NULL AND (
      (m.project_id IS NULL AND (o.id IS NOT NULL OR (m.role='owner' AND m.organization_id IS NULL)))
      OR (p.id IS NOT NULL AND o.id IS NOT NULL)
    )
    UNION ALL
    SELECT 'volunteer',NULL,o.id,o.name,o.status,p.id,p.name,p.status,c.name,v.ends_at
    FROM account a JOIN campaign_volunteers v ON v.user_id=a.user_id
    JOIN campaigns c ON c.id=v.campaign_id AND c.project_id=v.project_id
    JOIN projects p ON p.id=v.project_id JOIN organizations o ON o.id=p.organization_id
    WHERE v.revoked_at IS NULL AND julianday(v.ends_at)>julianday('now')
  `).bind(userId).all<AccessRow>();
  if (!rows.some(row => row.kind === 'account')) {
    throw new HttpError(403, 'Seu acesso mudou. Entre novamente.', 'account_inactive');
  }

  let platformAdmin = false;
  const organizations = new Map<string, OrganizationAccess>();
  const work = new Map<string, WorkAccess>();
  for (const row of rows) {
    if (row.kind === 'account') continue;
    if (row.kind === 'membership' && row.role === 'owner' && !row.organization_id && !row.project_id) {
      platformAdmin = true;
      continue;
    }
    if (!row.organization_id || !row.organization_name) continue;
    if (row.kind === 'membership' && row.role !== 'owner' && !Object.hasOwn(projectAccessRoleLabels, row.role ?? '')) continue;
    let group = organizations.get(row.organization_id);
    if (!group) {
      group = { name: row.organization_name, archived: row.organization_status === 'archived', work: [], events: [] };
      organizations.set(row.organization_id, group);
    }
    if (row.kind === 'volunteer') {
      if (row.event_name && row.project_name && row.ends_at) group.events.push({ name: row.event_name, project: row.project_name, endsAt: row.ends_at });
      continue;
    }
    const key = JSON.stringify([row.organization_id, row.project_id]);
    let grant = work.get(key);
    if (!grant) {
      grant = { project: row.project_name, roles: [], archived: row.project_status === 'archived' };
      work.set(key, grant);
      group.work.push(grant);
    }
    const label = accessRoleLabel(row.role!, row.organization_id);
    if (!grant.roles.includes(label)) grant.roles.push(label);
  }

  const order = (a: string, b: string) => a.localeCompare(b, 'pt-BR');
  const sorted = Array.from(organizations.values()).sort((a, b) => order(a.name, b.name));
  for (const group of sorted) {
    group.work.sort((a, b) => order(a.project ?? '', b.project ?? ''));
    group.events.sort((a, b) => order(a.endsAt, b.endsAt) || order(a.name, b.name));
  }
  return { platformAdmin, organizations: sorted, checkedAt: Date.now() };
}
