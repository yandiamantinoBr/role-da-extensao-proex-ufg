import type { PortalActor } from '../access';
import { all, one, uid, iso, type Row } from '../database';
import { HttpError } from '../errors';
import { isCivilDate } from '../civil-date';
import { identifier, organizationAuthoritySql, projectAuthoritySql, requireActor, requireOrganizationMember } from './scope';

/*
 * Registro de riscos. Riscos da organização: só a administração vê e edita. Riscos de projeto ou
 * dinâmica: quem vê o projeto lê; responsável ou gestor do projeto edita. Exemplos só entram quando a
 * administração pede ("Carregar exemplos") e ficam marcados como exemplo.
 */
export const RISK_LIMIT = 500;
export const RISK_CATEGORIES = ['operacional', 'tecnologia', 'pessoas', 'financeiro', 'reputacao', 'legal', 'outro'] as const;
export const RISK_STATUSES = ['open', 'monitoring', 'mitigated', 'closed'] as const;
export type RiskLevel = 'baixo' | 'moderado' | 'alto' | 'critico';
export function riskLevel(probability: number, impact: number): RiskLevel {
  const score = probability * impact;
  return score >= 15 ? 'critico' : score >= 10 ? 'alto' : score >= 5 ? 'moderado' : 'baixo';
}
const todayBrasilia = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

// Exemplos genéricos (sem nome de pessoa, conta ou arquivo): a organização ajusta datas e donos na tela.
export const EXAMPLE_RISKS = [
  { title: 'Portal hospedado em conta pessoal, não institucional', category: 'tecnologia', probability: 4, impact: 5, ownerLabel: 'Equipe de TI (a definir)',
    description: 'Hospedagem, banco e planilhas do portal estão em contas pessoais. Se a conta for perdida ou o vínculo acabar, o portal pode parar.',
    mitigation: 'Migrar para contas institucionais da PROEX, com mais de um responsável, e manter a cópia de segurança semanal.', reviewInDays: 14 },
  { title: 'Credencial provisória de integração com vencimento próximo', category: 'tecnologia', probability: 4, impact: 4, ownerLabel: 'Responsável pelo portal',
    description: 'Uma credencial de integração foi criada com validade curta. Quando vencer, a integração para.',
    mitigation: 'Trocar por credencial institucional antes do vencimento e registrar a troca.', reviewOn: '2026-11-23' },
  { title: 'Limite diário de publicações do portal dividido com outro projeto', category: 'tecnologia', probability: 3, impact: 3, ownerLabel: 'Responsável pelo portal',
    description: 'O serviço de hospedagem tem um limite diário de publicações, dividido com outro projeto. Muitas publicações num dia podem atrasar uma correção urgente.',
    mitigation: 'Agrupar mudanças, evitar publicar durante eventos e planejar uma conta própria da PROEX.', reviewInDays: 30 },
  { title: 'Planilha institucional fica inacessível', category: 'operacional', probability: 2, impact: 4, ownerLabel: 'Coordenação administrativa',
    description: 'Se a planilha mestre perder o compartilhamento ou a conta dona, os relatórios feitos na planilha param.',
    mitigation: 'Manter a planilha num drive institucional com mais de um dono e conferir a atualização no portal.', reviewInDays: 30 },
  { title: 'Brindes acabam antes do fim de um evento', category: 'operacional', probability: 3, impact: 3, ownerLabel: 'Equipe de eventos',
    description: 'Sem lote reservado por dia, o estoque de brindes pode acabar no primeiro dia de um evento longo.',
    mitigation: 'Separar lotes por dia na dinâmica, acompanhar o estoque baixo no painel e definir um mínimo antes do evento.', reviewInDays: 30 },
  { title: 'Ação ao ar livre prejudicada por chuva', category: 'operacional', probability: 3, impact: 2, ownerLabel: 'Coordenação do evento',
    description: 'Estandes e atividades externas podem ser cancelados ou esvaziados em dia de chuva.',
    mitigation: 'Ter local coberto alternativo, lonas e um plano de comunicação para avisar mudanças.', reviewInDays: 45 },
  { title: 'Saída de bolsistas no meio do projeto', category: 'pessoas', probability: 3, impact: 3, ownerLabel: 'Orientação do projeto',
    description: 'Quando um bolsista sai antes do fim, demandas ficam sem dono e o conhecimento se perde.',
    mitigation: 'Registrar rotinas no guia e nas demandas, ter um substituto indicado e revisar as atribuições a cada mês.', reviewInDays: 60 },
] as const;

function addDays(day: string, days: number): string { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function text(value: unknown, label: string, max: number, required = false): string {
  if (value === undefined || value === null) { if (required) throw new HttpError(400, `Informe ${label}.`, 'invalid_risk'); return ''; }
  if (typeof value !== 'string') throw new HttpError(400, `Informe ${label} como texto.`, 'invalid_risk');
  const clean = value.replace(/\r\n?/g, '\n').trim();
  if ((required && !clean) || clean.length > max) throw new HttpError(400, `${label[0].toUpperCase()}${label.slice(1)}: até ${max} caracteres${required ? ', obrigatório' : ''}.`, 'invalid_risk');
  return clean;
}
function scale(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) throw new HttpError(400, `Escolha ${label} de 1 a 5.`, 'invalid_risk');
  return number;
}
function choice<T extends string>(value: unknown, options: readonly T[], label: string, fallback: T): T {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !options.includes(value as T)) throw new HttpError(400, `Escolha ${label} válido.`, 'invalid_risk');
  return value as T;
}

function present(row: Row, today: string) {
  const probability = Number(row.probability), impact = Number(row.impact), closed = row.status === 'closed' || row.status === 'mitigated';
  return {
    id: row.id, projectId: row.project_id ?? null, projectName: row.project_name ?? null, campaignId: row.campaign_id ?? null, campaignName: row.campaign_name ?? null,
    title: row.title, description: row.description, category: row.category, probability, impact, score: probability * impact, level: riskLevel(probability, impact),
    ownerLabel: row.owner_label, mitigation: row.mitigation, status: row.status, reviewOn: row.review_on ?? null,
    reviewOverdue: !closed && !!row.review_on && String(row.review_on) < today, isExample: Number(row.is_example) === 1,
    version: Number(row.version), updatedAt: row.updated_at, canEdit: Number(row.can_edit) === 1,
  };
}

export async function risksWorkspace(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor), organizationId = identifier(input.organizationId, 'a organização');
  const organization = await requireOrganizationMember(db, actor, organizationId);
  const owner = organizationAuthoritySql(actor, organizationId), read = projectAuthoritySql(actor, [], 'r.project_id'), manage = projectAuthoritySql(actor, ['campaigns.manage'], 'r.project_id');
  const filter = typeof input.projectId === 'string' && input.projectId ? identifier(input.projectId, 'o projeto') : null;
  // Nome da dinâmica só para quem já vê dinâmicas no projeto; os outros veem "Dinâmica".
  const campaigns = projectAuthoritySql(actor, ['reports.read', 'campaigns.manage', 'participation.operate'], 'r.project_id');
  const rows = await all(db, `SELECT r.*,p.name project_name,CASE WHEN c.id IS NULL THEN NULL WHEN ${campaigns.sql} THEN c.name ELSE 'Dinâmica' END campaign_name,
      CASE WHEN r.project_id IS NULL THEN (${owner.sql}) ELSE (${manage.sql}) OR (${owner.sql}) END can_edit
    FROM org_risks r LEFT JOIN projects p ON p.id=r.project_id LEFT JOIN campaigns c ON c.id=r.campaign_id
    WHERE r.organization_id=? AND ((r.project_id IS NULL AND (${owner.sql})) OR (r.project_id IS NOT NULL AND ${read.sql}))
      AND (? IS NULL OR r.project_id=?)
    ORDER BY CASE r.status WHEN 'closed' THEN 2 WHEN 'mitigated' THEN 1 ELSE 0 END,(r.probability*r.impact) DESC,r.review_on IS NULL,r.review_on,r.title LIMIT 500`,
    [...campaigns.values, ...owner.values, ...manage.values, ...owner.values, organizationId, ...owner.values, ...read.values, filter, filter]);
  const editableProjects = projectAuthoritySql(actor, ['campaigns.manage'], 'p.id'), visibleProjects = projectAuthoritySql(actor, [], 'p.id');
  const projects = await all(db, `SELECT p.id,p.name,(${editableProjects.sql}) can_edit FROM projects p WHERE p.organization_id=? AND p.status='active' AND ${visibleProjects.sql} ORDER BY p.name LIMIT 200`,
    [...editableProjects.values, organizationId, ...visibleProjects.values]);
  const today = todayBrasilia();
  return {
    organization: { id: organizationId, name: organization.name }, today,
    canEditOrganization: organization.owner,
    canLoadExamples: organization.owner && !rows.some(row => Number(row.is_example) === 1),
    projects: projects.map(row => ({ id: row.id, name: row.name, canEdit: Number(row.can_edit) === 1 })),
    risks: rows.map(row => present(row, today)),
  };
}

export async function riskAction(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor), organizationId = identifier(input.organizationId, 'a organização');
  const organization = await requireOrganizationMember(db, actor, organizationId);
  const owner = organizationAuthoritySql(actor, organizationId), now = iso(), today = todayBrasilia();
  const audit = (action: string, id: string) => db.prepare(`INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,(SELECT project_id FROM org_risks WHERE id=?),?,?,?,? WHERE changes()=1`)
    .bind(uid(), actor.userId, id, action, id, JSON.stringify({ organizationId }), now);

  if (input.action === 'examples.load') {
    if (!organization.owner) throw new HttpError(403, 'Só a administração carrega exemplos.', 'risk_forbidden');
    if (await one(db, 'SELECT 1 FROM org_risks WHERE organization_id=? AND is_example=1', [organizationId])) throw new HttpError(409, 'Os exemplos já foram carregados.', 'risk_examples_loaded');
    const statements = EXAMPLE_RISKS.map(example => db.prepare(`INSERT INTO org_risks(id,organization_id,project_id,campaign_id,title,description,category,probability,impact,owner_label,mitigation,status,review_on,is_example,version,created_by,updated_by,created_at,updated_at)
      SELECT ?,?,NULL,NULL,?,?,?,?,?,?,?,'open',?,1,1,?,?,?,? WHERE ${owner.sql} AND NOT EXISTS(SELECT 1 FROM org_risks WHERE organization_id=? AND is_example=1 AND created_at<>?)`)
      .bind(uid(), organizationId, example.title, example.description, example.category, example.probability, example.impact, example.ownerLabel, example.mitigation,
        'reviewOn' in example ? example.reviewOn : addDays(today, example.reviewInDays), actor.userId, actor.userId, now, now, ...owner.values, organizationId, now));
    await db.batch(statements);
    return risksWorkspace(db, actor, { organizationId });
  }

  const projectId = typeof input.projectId === 'string' && input.projectId ? identifier(input.projectId, 'o projeto') : null;
  const campaignId = typeof input.campaignId === 'string' && input.campaignId ? identifier(input.campaignId, 'a dinâmica') : null;
  // Quem pode escrever no escopo escolhido, conferido no banco na própria gravação.
  // Valores na ordem exata dos `?`: [projeto do CASE], administração, gestor (projeto no fim), administração.
  const columnGuard = () => {
    const manage = projectAuthoritySql(actor, ['campaigns.manage'], 'org_risks.project_id');
    return { sql: `CASE WHEN org_risks.project_id IS NULL THEN (${owner.sql}) ELSE (${manage.sql}) OR (${owner.sql}) END`, values: [...owner.values, ...manage.values, ...owner.values] };
  };
  const valueGuard = (project: string | null) => {
    const manage = projectAuthoritySql(actor, ['campaigns.manage'], '?');
    return { sql: `CASE WHEN ? IS NULL THEN (${owner.sql}) ELSE (${manage.sql}) OR (${owner.sql}) END`, values: [project, ...owner.values, ...manage.values, project, ...owner.values] };
  };

  if (input.action === 'delete') {
    const id = identifier(input.id, 'o risco');
    const guard = columnGuard();
    const results = await db.batch([db.prepare(`DELETE FROM org_risks WHERE id=? AND organization_id=? AND is_example=1 AND version=? AND ${guard.sql}`).bind(id, organizationId, Number(input.expectedVersion), ...guard.values), audit('risk.delete', id)]);
    if (results[0].meta.changes !== 1) throw new HttpError(409, 'Só exemplos podem ser apagados; riscos reais são encerrados. O risco pode ter mudado.', 'risk_conflict');
    return risksWorkspace(db, actor, { organizationId });
  }
  if (input.action !== 'create' && input.action !== 'update') throw new HttpError(400, 'Ação inválida.', 'invalid_action');
  if (projectId && !await one(db, 'SELECT 1 FROM projects WHERE id=? AND organization_id=?', [projectId, organizationId])) throw new HttpError(400, 'O projeto não pertence a esta organização.', 'invalid_risk_scope');
  if (campaignId && (!projectId || !await one(db, 'SELECT 1 FROM campaigns WHERE id=? AND project_id=?', [campaignId, projectId]))) throw new HttpError(400, 'A dinâmica precisa ser do projeto escolhido.', 'invalid_risk_scope');
  const reviewOn = input.reviewOn === undefined || input.reviewOn === null || input.reviewOn === '' ? null : input.reviewOn;
  if (reviewOn !== null && !isCivilDate(reviewOn)) throw new HttpError(400, 'Escolha uma data de revisão válida.', 'invalid_risk');
  const fields = {
    title: text(input.title, 'o título', 160, true), description: text(input.description, 'a descrição', 2000),
    category: choice(input.category, RISK_CATEGORIES, 'uma categoria', 'operacional'),
    probability: scale(input.probability, 'a probabilidade'), impact: scale(input.impact, 'o impacto'),
    ownerLabel: text(input.ownerLabel, 'o dono', 120), mitigation: text(input.mitigation, 'a mitigação', 2000),
    status: choice(input.status, RISK_STATUSES, 'uma situação', 'open'), reviewOn: reviewOn as string | null,
  };
  if (input.action === 'create') {
    if (Number((await one(db, 'SELECT COUNT(*) n FROM org_risks WHERE organization_id=?', [organizationId]))?.n) >= RISK_LIMIT) throw new HttpError(409, `A organização já tem ${RISK_LIMIT} riscos. Encerre ou revise os antigos antes de criar outros.`, 'risk_limit');
    const guard = valueGuard(projectId);
    const id = uid();
    const results = await db.batch([
      db.prepare(`INSERT INTO org_risks(id,organization_id,project_id,campaign_id,title,description,category,probability,impact,owner_label,mitigation,status,review_on,is_example,version,created_by,updated_by,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,?,?,? WHERE ${guard.sql}`)
        .bind(id, organizationId, projectId, campaignId, fields.title, fields.description, fields.category, fields.probability, fields.impact, fields.ownerLabel, fields.mitigation, fields.status, fields.reviewOn,
          actor.userId, actor.userId, now, now, ...guard.values),
      audit('risk.create', id),
    ]);
    if (results[0].meta.changes !== 1) throw new HttpError(403, projectId ? 'Só responsável ou gestor do projeto registra riscos nele.' : 'Só a administração registra riscos da organização.', 'risk_forbidden');
    return risksWorkspace(db, actor, { organizationId });
  }
  const id = identifier(input.id, 'o risco'), expected = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expected) || expected < 1) throw new HttpError(400, 'Atualize a página e tente de novo.', 'invalid_version');
  const current = await one(db, 'SELECT project_id FROM org_risks WHERE id=? AND organization_id=?', [id, organizationId]);
  if (!current) throw new HttpError(404, 'Risco não encontrado.', 'risk_not_found');
  if ((current.project_id ?? null) !== projectId) throw new HttpError(400, 'Para mudar o escopo, encerre este risco e registre outro.', 'invalid_risk_scope');
  const guard = columnGuard();
  const results = await db.batch([
    db.prepare(`UPDATE org_risks SET campaign_id=?,title=?,description=?,category=?,probability=?,impact=?,owner_label=?,mitigation=?,status=?,review_on=?,version=version+1,updated_by=?,updated_at=?
      WHERE id=? AND organization_id=? AND version=? AND ${guard.sql}`)
      .bind(campaignId, fields.title, fields.description, fields.category, fields.probability, fields.impact, fields.ownerLabel, fields.mitigation, fields.status, fields.reviewOn, actor.userId, now,
        id, organizationId, expected, ...guard.values),
    audit('risk.update', id),
  ]);
  if (results[0].meta.changes !== 1) throw new HttpError(409, 'O risco mudou ou seu acesso mudou. Atualize e tente de novo.', 'risk_conflict');
  return risksWorkspace(db, actor, { organizationId });
}
