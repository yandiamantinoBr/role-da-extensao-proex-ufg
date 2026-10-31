import { accessibleProjects, requireCapability, projectAuthoritySql, type PortalActor } from './access';
import { all, one, type Row } from './database';
import { HttpError } from './errors';
import { listManagedUsers } from './users';
import { listOrganizations } from './organizations';

type Scope = string[] | null;
type Filter = { sql: string; params: unknown[] };

// Event timestamps are stored in UTC. São Paulo currently uses UTC-03 without DST;
// operational SQL calendar buckets below use that offset, matching America/Sao_Paulo
// for supported events. Revisit these expressions if the legal timezone rules change.

/** Only values are interpolated through bindings; column names are internal constants. */
function filter(column: string, scope: Scope): Filter {
  if (scope === null) return { sql: '1=1', params: [] };
  if (!scope.length) return { sql: '1=0', params: [] };
  return { sql: `${column} IN (${scope.map(() => '?').join(',')})`, params: scope };
}
function authorizedFilter(column:string, scope:Scope, actor:PortalActor, capabilities:readonly string[]=[]):Filter{
  const result=filter(column,scope),authority=projectAuthoritySql(actor,capabilities,column);
  return{sql:`(${result.sql}) AND (${authority.sql})`,params:[...result.params,...authority.values]};
}

function scopes(actor: PortalActor, ...capabilities: string[]): Scope {
  const available = capabilities.map(capability => accessibleProjects(actor, capability));
  if (available.some(scope => scope === null)) return null;
  return [...new Set(available.flatMap(scope => scope ?? []))];
}

function inScope(scope: Scope, projectId: unknown): boolean {
  return scope === null || (typeof projectId === 'string' && scope.includes(projectId));
}

function count(row: Row | null, key: string): number {
  const value = Number(row?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

const OWNER_SQL = `EXISTS (SELECT 1 FROM members auth LEFT JOIN portal_users account ON account.user_id=auth.user_id
  WHERE auth.user_id=? AND auth.role='owner' AND auth.project_id IS NULL AND auth.organization_id IS NULL AND auth.revoked_at IS NULL
    AND COALESCE(account.status,'active')='active' AND COALESCE(account.activation_pending,0)=0 AND account.anonymized_at IS NULL)`;

/** Derive missing directory metadata only from existing canonical membership rows, never an email match. */
async function materializeLegacyUsers(db: D1Database, actor: PortalActor): Promise<void> {
  if (accessibleProjects(actor, 'organization.manage') !== null) return;
  const missing = await all(db, `SELECT m.user_id,m.email,m.created_at FROM members m
    LEFT JOIN portal_users u ON u.user_id=m.user_id LEFT JOIN profiles p ON p.user_id=m.user_id
    WHERE (u.user_id IS NULL OR p.user_id IS NULL) AND u.anonymized_at IS NULL AND ${OWNER_SQL} ORDER BY m.created_at DESC,m.id DESC`, [actor.userId]);
  const known = new Map<string, { email: string | null; createdAt: string }>();
  for (const row of missing) {
    if (typeof row.user_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.user_id) || known.has(row.user_id)) continue;
    const date = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN;
    if (!Number.isFinite(date) || new Date(date).toISOString() !== row.created_at) continue;
    const address = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
    known.set(row.user_id, { email: address.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null, createdAt: row.created_at });
  }
  const entries = [...known];
  const now = new Date().toISOString();
  // Bound each batch; retries only fill missing rows and preserve blocks, activation state and edited profiles.
  for (let offset = 0; offset < entries.length; offset += 20) {
    const statements: D1PreparedStatement[] = [];
    for (const [userId, legacy] of entries.slice(offset, offset + 20)) {
      const name = userId === actor.userId
        ? Array.from(actor.displayName.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, '').trim()).slice(0, 80).join('') || 'Integrante'
        : 'Integrante';
      statements.push(db.prepare(`INSERT OR IGNORE INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at)
        SELECT ?,?,'active',0,?,? WHERE ${OWNER_SQL}`).bind(userId, legacy.email, legacy.createdAt, now, actor.userId));
      statements.push(db.prepare(`INSERT OR IGNORE INTO profiles(user_id,display_name,avatar_key,mime,version,created_at,updated_at)
        SELECT u.user_id,?,NULL,NULL,1,u.created_at,? FROM portal_users u WHERE u.user_id=? AND u.anonymized_at IS NULL AND ${OWNER_SQL}`)
        .bind(name, now, userId, actor.userId));
    }
    await db.batch(statements);
  }
}

function allowed(actor: PortalActor, capability: string, projectId?: string | null): boolean {
  try { requireCapability(actor, capability, projectId); return true; }
  catch (error) { if (error instanceof HttpError && error.status === 403) return false; throw error; }
}

async function reportMetrics(db: D1Database, scope: Scope, actor:PortalActor): Promise<Row> {
  // No permission is different from an observed zero. Never manufacture "unique people".
  if (scope !== null && !scope.length) return {
    available: false, participations: null, attempts: null, deliveries: null,
    pendingPrizes: null, unitsDelivered: null, tickets: null, visits: null,
    modalities: [], results: [], campaigns: [], daily: [], byProject: [],
  };
  const campaign = authorizedFilter('c.project_id', scope,actor,['reports.read']);
  const item = authorizedFilter('i.project_id', scope,actor,['reports.read']);
  const project = authorizedFilter('pr.id', scope,actor,['reports.read']);
  const [participations, attempts, entitlements, movements, visits, modalities, results, campaigns, daily, byProject] = await Promise.all([
    one(db, `SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN p.identity_method='ticket' THEN 1 ELSE 0 END),0) AS tickets
      FROM participations p JOIN campaigns c ON c.id=p.campaign_id WHERE ${campaign.sql}`, campaign.params),
    one(db, `SELECT COUNT(*) AS total FROM attempts a
      JOIN participations p ON p.id=a.participation_id JOIN campaigns c ON c.id=p.campaign_id
      WHERE ${campaign.sql}`, campaign.params),
    one(db, `SELECT COALESCE(SUM(CASE WHEN e.state='delivered' THEN 1 ELSE 0 END),0) AS delivered,
      COALESCE(SUM(CASE WHEN e.state='reserved' THEN 1 ELSE 0 END),0) AS pending
      FROM entitlements e JOIN participations p ON p.id=e.participation_id
      JOIN campaigns c ON c.id=p.campaign_id WHERE ${campaign.sql}`, campaign.params),
    one(db, `SELECT COALESCE(SUM(CASE WHEN m.kind='redeem' THEN -m.delta ELSE 0 END),0) AS units
      FROM stock_movements m JOIN items i ON i.id=m.item_id WHERE ${item.sql}`, item.params),
    one(db, `SELECT COALESCE(SUM(v.hits),0) AS hits FROM visits v
      JOIN campaigns c ON c.id=v.campaign_id WHERE ${campaign.sql}`, campaign.params),
    all(db, `SELECT p.modality,COUNT(*) AS count FROM participations p
      JOIN campaigns c ON c.id=p.campaign_id WHERE ${campaign.sql}
      GROUP BY p.modality ORDER BY p.modality`, campaign.params),
    all(db, `SELECT a.result,COUNT(*) AS count FROM attempts a
      JOIN participations p ON p.id=a.participation_id JOIN campaigns c ON c.id=p.campaign_id
      WHERE ${campaign.sql} GROUP BY a.result ORDER BY a.result`, campaign.params),
    all(db, `SELECT c.id,c.project_id,c.name,
      (SELECT COUNT(*) FROM participations p WHERE p.campaign_id=c.id) AS participations,
      (SELECT COUNT(*) FROM attempts a JOIN participations p ON p.id=a.participation_id
        WHERE p.campaign_id=c.id) AS attempts,
      (SELECT COUNT(*) FROM participations p WHERE p.campaign_id=c.id AND p.identity_method='ticket') AS tickets,
      (SELECT COUNT(*) FROM entitlements e JOIN participations p ON p.id=e.participation_id
        WHERE p.campaign_id=c.id AND e.state='delivered') AS deliveries,
      (SELECT COALESCE(SUM(v.hits),0) FROM visits v WHERE v.campaign_id=c.id) AS visits
      FROM campaigns c WHERE ${campaign.sql} ORDER BY c.starts_at DESC,c.id`, campaign.params),
    all(db, `WITH daily_events AS (
      SELECT c.id AS campaign_id,c.project_id,c.name AS campaign_name,date(p.created_at,'-3 hours') AS day,
        p.modality,1 AS participations,0 AS attempts,0 AS deliveries,
        CASE WHEN p.identity_method='ticket' THEN 1 ELSE 0 END AS tickets
      FROM participations p JOIN campaigns c ON c.id=p.campaign_id WHERE ${campaign.sql}
      UNION ALL
      SELECT c.id,c.project_id,c.name,date(a.created_at,'-3 hours'),p.modality,0,1,0,0
      FROM attempts a JOIN participations p ON p.id=a.participation_id
      JOIN campaigns c ON c.id=p.campaign_id WHERE ${campaign.sql}
      UNION ALL
      SELECT c.id,c.project_id,c.name,date(e.delivered_at,'-3 hours'),p.modality,0,0,1,0
      FROM entitlements e JOIN participations p ON p.id=e.participation_id
      JOIN campaigns c ON c.id=p.campaign_id WHERE e.state='delivered' AND ${campaign.sql}
    ) SELECT campaign_id,project_id,campaign_name,day,modality,SUM(participations) AS participations,
      SUM(attempts) AS attempts,SUM(deliveries) AS deliveries,SUM(tickets) AS tickets
      FROM daily_events GROUP BY campaign_id,project_id,campaign_name,day,modality
      ORDER BY day DESC,campaign_name,modality`, [...campaign.params, ...campaign.params, ...campaign.params]),
    all(db, `SELECT pr.id AS project_id,pr.name AS project_name,
      (SELECT COUNT(*) FROM participations p JOIN campaigns c ON c.id=p.campaign_id
        WHERE c.project_id=pr.id) AS participations,
      (SELECT COUNT(*) FROM attempts a JOIN participations p ON p.id=a.participation_id
        JOIN campaigns c ON c.id=p.campaign_id WHERE c.project_id=pr.id) AS attempts,
      (SELECT COUNT(*) FROM entitlements e JOIN participations p ON p.id=e.participation_id
        JOIN campaigns c ON c.id=p.campaign_id WHERE c.project_id=pr.id AND e.state='delivered') AS deliveries,
      (SELECT COUNT(*) FROM entitlements e JOIN participations p ON p.id=e.participation_id
        JOIN campaigns c ON c.id=p.campaign_id WHERE c.project_id=pr.id AND e.state='reserved') AS pendingPrizes,
      (SELECT COALESCE(SUM(-m.delta),0) FROM stock_movements m JOIN items i ON i.id=m.item_id
        WHERE i.project_id=pr.id AND m.kind='redeem') AS unitsDelivered,
      (SELECT COUNT(*) FROM participations p JOIN campaigns c ON c.id=p.campaign_id
        WHERE c.project_id=pr.id AND p.identity_method='ticket') AS tickets,
      (SELECT COALESCE(SUM(v.hits),0) FROM visits v JOIN campaigns c ON c.id=v.campaign_id
        WHERE c.project_id=pr.id) AS visits
      FROM projects pr WHERE ${project.sql} ORDER BY pr.name,pr.id`, project.params),
  ]);
  return {
    available: true, participations: count(participations, 'total'),
    attempts: count(attempts, 'total'), deliveries: count(entitlements, 'delivered'),
    pendingPrizes: count(entitlements, 'pending'), unitsDelivered: count(movements, 'units'),
    tickets: count(participations, 'tickets'), visits: count(visits, 'hits'), visitsCollection: 'paused',
    modalities, results, campaigns, daily, byProject,
    definitions: {
      participations: 'Registros de identidade por campanha; não prova pessoas físicas únicas.',
      tickets: 'Participações identificadas por tíquete; não contagem de tíquetes apenas emitidos.',
      visits: 'Histórico de carregamentos registrados; coleta de novas visitas suspensa para preservar a disponibilidade. Não representa visitantes únicos nem o público atual.',
      results: 'Resultados por tentativa, incluindo repetições registradas.',
      unitsDelivered: 'Unidades baixadas em movimentos de resgate; não quantidade de participantes.',
      daily: 'Contagens por campanha, modalidade e dia operacional de Brasília; participação, tentativa e entrega têm datas próprias.',
    },
  };
}

/** Protected, explicitly projected snapshot. No token hashes or storage keys leave the server. */
export async function portalSnapshot(db: D1Database, actor: PortalActor | null): Promise<Row> {
  if (!actor) throw new HttpError(401, 'Entre com sua conta para continuar.', 'unauthenticated');
  if (!actor.members.length) throw new HttpError(403, 'A conta de participante não concede acesso ao painel da equipe.', 'portal_membership_required');
  const ownAccount = await one(db, 'SELECT status,activation_pending FROM portal_users WHERE user_id=?', [actor.userId]);
  if (ownAccount && (ownAccount.status !== 'active' || ownAccount.activation_pending !== 0)) {
    throw new HttpError(403, 'Seu acesso ao portal não está ativo.', 'account_inactive');
  }
  await materializeLegacyUsers(db, actor);
  const projectScope = accessibleProjects(actor);
  const campaignScope = scopes(actor, 'campaigns.manage', 'participation.operate', 'reports.read');
  const inventoryScope = scopes(actor, 'inventory.read', 'inventory.manage', 'inventory.deliver', 'reports.read');
  const offerScope = scopes(actor, 'campaigns.manage', 'participation.operate', 'inventory.read', 'inventory.manage', 'inventory.deliver', 'reports.read');
  const loanPrivateScope = accessibleProjects(actor, 'loans.read');
  const loanScope = scopes(actor, 'loans.read', 'reports.read');
  const accessScope = accessibleProjects(actor, 'access.manage');
  const auditScope = scopes(actor, 'access.manage', 'reports.read');
  const projectsFilter = authorizedFilter('projects.id', projectScope,actor);
  const campaignsFilter = authorizedFilter('campaigns.project_id', campaignScope,actor,['campaigns.manage','participation.operate','reports.read']);
  const inventoryFilter = authorizedFilter('items.project_id', inventoryScope,actor,['inventory.read','inventory.manage','inventory.deliver','reports.read']);
  const equipmentFilter = authorizedFilter('items.project_id', loanPrivateScope,actor,['loans.read']);
  const offersFilter = authorizedFilter('o.project_id', offerScope,actor,['campaigns.manage','participation.operate','inventory.read','inventory.manage','inventory.deliver','reports.read']);
  const loansFilter = authorizedFilter('loans.project_id', loanScope,actor,['loans.read','reports.read']);
  const privateLoansFilter = authorizedFilter('loans.project_id', loanPrivateScope,actor,['loans.read']);
  const accessRowsFilter=(table:string,scope:Scope,capabilities:readonly string[])=>{
    const projected=authorizedFilter(`${table}.project_id`,scope,actor,capabilities);
    const admin=`EXISTS(SELECT 1 FROM members admin LEFT JOIN portal_users account ON account.user_id=admin.user_id
      WHERE admin.user_id=? AND admin.role='owner' AND admin.project_id IS NULL AND admin.revoked_at IS NULL
      AND (admin.organization_id IS NULL OR admin.organization_id=${table}.organization_id)
      AND COALESCE(account.status,'active')='active' AND COALESCE(account.activation_pending,0)=0 AND account.anonymized_at IS NULL)`;
    return{sql:`((${projected.sql}) OR (${admin}))`,params:[...projected.params,actor.userId]};
  };
  const membersFilter=accessRowsFilter('members',accessScope,['access.manage']),invitesFilter=accessRowsFilter('invites',accessScope,['access.manage']);
  const auditFilter=accessRowsFilter('audit',auditScope,['access.manage','reports.read']);
  const documentsFilter = authorizedFilter('d.project_id', loanPrivateScope,actor,['loans.read']);
  const physicalFilter = authorizedFilter('c.project_id', accessibleProjects(actor, 'participation.operate'),actor,['participation.operate']);
  const prizesFilter = authorizedFilter('c.project_id', accessibleProjects(actor, 'inventory.deliver'),actor,['inventory.deliver']);
  const snapshotTime = Date.now();

  const [projects, campaigns, items, offers, components, loans, loanDetails, members, invites, audit, settingsRows, documents, metrics, physicalTickets, pendingPrizes, pendingPrizeCount, users, ownProfile] = await Promise.all([
    all(db, `SELECT id,name,description,created_at,short_name,status,color,official_url,starts_at,ends_at,location,version,lifecycle,type_id,parent_id,unit_id,prizes_enabled,scope,thematic_area,extension_line,organization_id
      FROM projects WHERE ${projectsFilter.sql} ORDER BY name,id`, projectsFilter.params),
    all(db, `SELECT id,project_id,name,location,starts_at,ends_at,status,retry_limit,
      brinde_offer_id,super_offer_id,rules_text,version,created_at
      FROM campaigns WHERE ${campaignsFilter.sql} ORDER BY starts_at DESC,id`, campaignsFilter.params),
    all(db, `SELECT id,project_id,name,category,unit,stock,reserved,low_stock,description,condition,created_at,
      asset_code,version,updated_at,
      CASE WHEN category='equipment' AND EXISTS (SELECT 1 FROM loans l WHERE l.item_id=items.id AND l.status='out') THEN 1 ELSE 0 END AS on_loan,
      CASE WHEN category='equipment' AND EXISTS (SELECT 1 FROM loans l WHERE l.item_id=items.id AND l.status='reserved'
        AND l.starts_at<=? AND l.ends_at>?) THEN 1 ELSE 0 END AS reserved_now
      FROM items WHERE (${inventoryFilter.sql}) OR (category='equipment' AND (${equipmentFilter.sql}))
      ORDER BY name,id`, [snapshotTime, snapshotTime, ...inventoryFilter.params, ...equipmentFilter.params]),
    all(db, `SELECT o.id,o.project_id,o.name,o.kind,o.active FROM offers o
      WHERE ${offersFilter.sql} ORDER BY o.name,o.id`, offersFilter.params),
    all(db, `SELECT oc.offer_id,oc.item_id,oc.quantity,i.name,i.unit
      FROM offer_components oc JOIN offers o ON o.id=oc.offer_id
      JOIN items i ON i.id=oc.item_id AND i.project_id=o.project_id
      WHERE ${offersFilter.sql} ORDER BY oc.offer_id,oc.item_id`, offersFilter.params),
    all(db, `SELECT id,project_id,item_id,action_name,starts_at,ends_at,status,created_at,returned_at,checked_out_at,updated_at
      FROM loans WHERE ${loansFilter.sql} ORDER BY starts_at DESC,id`, loansFilter.params),
    all(db, `SELECT id,project_id,borrower_name,borrower_contact,note,condition_out,condition_in
      FROM loans WHERE ${privateLoansFilter.sql}`, privateLoansFilter.params),
    all(db, `SELECT id,email,role,project_id,organization_id,revoked_at,created_at FROM members
      WHERE ${membersFilter.sql} ORDER BY created_at,id`, membersFilter.params),
    all(db, `SELECT id,email,role,project_id,organization_id,expires_at,accepted_at,revoked_at,created_at FROM invites
      WHERE ${invitesFilter.sql} ORDER BY created_at DESC,id`, invitesFilter.params),
    // Activity summaries deliberately exclude actor ids, free-form details and entity values.
    all(db, `SELECT id,project_id,action,created_at FROM audit
      WHERE ${auditFilter.sql} ORDER BY created_at DESC,id DESC LIMIT 100`, auditFilter.params),
    all(db, `SELECT name,value FROM settings WHERE name IN ('privacyNotice','instagramUrl')`),
    all(db, `SELECT d.id,d.loan_id,d.project_id,d.name,d.mime,d.size,d.created_at
      FROM documents d JOIN loans l ON l.id=d.loan_id AND l.project_id=d.project_id
      WHERE ${documentsFilter.sql} ORDER BY d.created_at DESC,d.id`, documentsFilter.params),
    reportMetrics(db, accessibleProjects(actor, 'reports.read'),actor),
    all(db, `SELECT p.id AS participation_id,p.campaign_id,p.identity_method,p.state,p.attempt_count,
      a.id AS attempt_id,a.number,a.result,a.state AS attempt_state,c.name AS campaign_name,c.project_id
      FROM participations p JOIN campaigns c ON c.id=p.campaign_id
      JOIN attempts a ON a.participation_id=p.id
        AND a.number=(SELECT MAX(latest.number) FROM attempts latest WHERE latest.participation_id=p.id)
      WHERE p.modality='physical'
        AND p.state IN ('physical_pending','retry_ready') AND ${physicalFilter.sql}
      ORDER BY p.created_at DESC,p.id LIMIT 200`, physicalFilter.params),
    all(db, `SELECT e.id,e.id AS entitlement_id,o.name AS offer_name,c.name AS campaign_name,
      c.project_id,e.created_at FROM entitlements e
      JOIN participations p ON p.id=e.participation_id JOIN campaigns c ON c.id=p.campaign_id
      JOIN offers o ON o.id=e.offer_id AND o.project_id=c.project_id
      WHERE e.state='reserved' AND ${prizesFilter.sql}
      ORDER BY e.created_at,e.id LIMIT 200`, prizesFilter.params),
    one(db, `SELECT COUNT(*) AS total FROM entitlements e
      JOIN participations p ON p.id=e.participation_id JOIN campaigns c ON c.id=p.campaign_id
      JOIN offers o ON o.id=e.offer_id AND o.project_id=c.project_id
      WHERE e.state='reserved' AND ${prizesFilter.sql}`, prizesFilter.params),
    accessScope === null || accessScope.length ? listManagedUsers(db, actor) : Promise.resolve([]),
    one(db, `SELECT p.display_name,p.avatar_key,p.mime,p.version,u.email,
      EXISTS (SELECT 1 FROM identity_aliases aliases JOIN auth_account credential ON credential.user_id=aliases.subject
        AND credential.provider_id='credential' AND credential.password IS NOT NULL
        WHERE aliases.provider='password' AND aliases.user_id=u.user_id) AS has_password
      FROM portal_users u LEFT JOIN profiles p ON p.user_id=u.user_id
      WHERE u.user_id=? AND u.status='active' AND u.activation_pending=0`, [actor.userId]),
  ]);
  const detailsByLoan = new Map(loanDetails.map(row => [row.id, row]));
  const componentsByOffer = new Map<string, Row[]>();
  for (const component of components) {
    const { offer_id, ...safeComponent } = component;
    componentsByOffer.set(offer_id, [...(componentsByOffer.get(offer_id) ?? []), safeComponent]);
  }
  const rolePriority = ['owner', 'manager', 'operator', 'inventory', 'loans', 'viewer'];
  const role = rolePriority.find(value => actor.members.some(member => member.role === value && !member.revoked_at)) ?? '';
  const capabilities = [...new Set(actor.capabilities)].filter(capability => allowed(actor, capability));
  const globalCapabilities = capabilities.filter(capability => allowed(actor, capability, null));
  const capabilitiesByProject = Object.fromEntries(projects.map(project => [project.id,
    capabilities.filter(capability => allowed(actor, capability, project.id))]));
  const profileVersion = Number.isSafeInteger(ownProfile?.version) && ownProfile!.version > 0 ? ownProfile!.version : 1;
  const profile = {
    displayName: ownProfile?.display_name || actor.displayName,
    email: ownProfile?.email ?? actor.email,
    avatarUrl: ownProfile?.avatar_key && ownProfile.mime === 'image/png'
      ? `/api/profile/avatar/${encodeURIComponent(actor.userId)}?v=${profileVersion}` : null,
    version: profileVersion,
  };
  const hasPassword = Boolean(ownProfile?.has_password);
  return {
    user: { userId: actor.userId, ...profile, hasPassword }, profile, hasPassword,
    role, capabilities, globalCapabilities, capabilitiesByProject, organizations: await listOrganizations(db,actor), projects, campaigns,
    projectTypes: await all(db,'SELECT id,key,label,description,status,version FROM project_types ORDER BY label,id'),
    organizationalUnits: await all(db,'SELECT id,name,acronym,kind,status,version,group_label,campus FROM organizational_units ORDER BY name,id'),
    items: items.map(item => ({ ...item, on_loan: Boolean(item.on_loan), reserved_now: Boolean(item.reserved_now),
      available: item.condition === 'active' && !item.on_loan && !item.reserved_now ? Math.max(0, item.stock - item.reserved) : 0 })),
    offers: offers.map(offer => ({ ...offer, components: componentsByOffer.get(offer.id) ?? [] })),
    loans: loans.map(loan => inScope(loanPrivateScope, loan.project_id)
      ? { ...loan, ...(detailsByLoan.get(loan.id) ?? {}) } : loan),
    members, invites, users, metrics,
    audit: audit.map(entry => ({ ...entry, action: typeof entry.action === 'string'
      && !/[^\s@]+@[^\s@]+\.[^\s@]+|[?&](token|code|key)=/i.test(entry.action)
      ? entry.action.slice(0, 100) : '[omitido]' })),
    settings: Object.fromEntries(settingsRows.map(row => [row.name, row.value])),
    documents, physicalTickets, pendingPrizes,
    pendingPrizesTotal: count(pendingPrizeCount, 'total'),
    pendingPrizesTruncated: count(pendingPrizeCount, 'total') > pendingPrizes.length,
    pendingPrizesLimit: 200,
    updatedAt: new Date().toISOString(),
  };
}
