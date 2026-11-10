import type { PortalActor } from '../access';
import { all, iso } from '../database';
import { HttpError } from '../errors';
import { followupAction } from '../follow-up/service';
import { identifier, organizationAuthoritySql, requireActor, requireOrganizationMember } from './scope';
import { TEAM_TEMPLATES, templateById } from './team-templates';

/** Modelos de equipe e quais equipes nasceram de cada um. */
export async function teamTemplatesState(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor), organizationId = identifier(input.organizationId, 'a organização');
  const organization = await requireOrganizationMember(db, actor, organizationId);
  const applications = await all(db, 'SELECT team_id teamId,template_id templateId FROM team_template_applications WHERE organization_id=? LIMIT 500', [organizationId]);
  return { templates: TEAM_TEMPLATES, applications, canApply: organization.owner };
}

/**
 * Cria a equipe pelo fluxo que já existe (mesma permissão de "Nova equipe") e guarda o modelo usado.
 * A equipe nasce vazia: pessoas e acessos são definidos depois, por quem gerencia.
 */
export async function applyTeamTemplate(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor), organizationId = identifier(input.organizationId, 'a organização');
  const template = templateById(input.templateId);
  if (!template) throw new HttpError(400, 'Escolha um modelo de equipe.', 'invalid_team_template');
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.replace(/\s+/g, ' ').trim().slice(0, 100) : template.name;
  if (typeof input.operationKey !== 'string') throw new HttpError(400, 'Atualize a página e tente de novo.', 'invalid_operation');
  const created = await followupAction(db, actor, 'team.create', { action: 'team.create', organizationId, name, userIds: [], operationKey: input.operationKey });
  const teamId = String(created.teamId ?? '');
  if (!teamId) throw new HttpError(500, 'A equipe não foi criada.', 'team_template_failed');
  const owner = organizationAuthoritySql(actor, organizationId);
  await db.prepare(`INSERT OR IGNORE INTO team_template_applications(team_id,organization_id,template_id,applied_by,applied_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM followup_teams WHERE id=? AND organization_id=?) AND (${owner.sql})`)
    .bind(teamId, organizationId, template.id, actor.userId, iso(), teamId, organizationId, ...owner.values).run();
  return { teamId, ...await teamTemplatesState(db, actor, { organizationId }) };
}
