import { accessibleProjects, projectAuthoritySql, requireCapability, type PortalActor } from './access';
import { all, one, uid, iso, type Row } from './database';
import { HttpError } from './errors';
import { projectDetail } from './projects';
import { reportRows } from './reports';
import { authority as followAuthority } from './follow-up/scope';
import { teamsWorkspace } from './follow-up/teams';
import { projectSheetStatus } from './sync/project-sheets';
import { areaLabel, lineLabel } from './extension-catalog';
import {
  normalizeReportConfig, ReportConfigError, REPORT_TEMPLATE_LIMIT, REPORT_TEMPLATE_NAME_LIMIT, referenceType,
} from './project-report-config';

/*
 * Relatório do projeto (montador). Uma única consulta reúne o que a pessoa já pode ver na
 * ficha do projeto e nos relatórios: cada parte reaproveita a função de leitura que já aplica
 * a permissão correspondente. Seções sem permissão voltam como `null` e somem do relatório.
 * Contatos, identificadores de conta e chaves de arquivos ficam fora.
 */

const SNAPSHOT_SKIP = new Set(['id', 'version', 'created_at', 'updated_at', 'project_id', 'organization_id']);
function permitted(actor: PortalActor, capability: string, projectId: string): boolean {
  try { requireCapability(actor, capability, projectId); return true; } catch { return false; }
}
function day(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `Informe ${label} como data (AAAA-MM-DD).`, 'invalid_report_date');
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new HttpError(400, `Informe ${label} como uma data existente.`, 'invalid_report_date');
  return value;
}
/** Dia civil de Brasília de um instante ISO, de milissegundos ou de uma data civil. */
export function brasiliaDay(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const time = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(time)) return null;
  return new Date(time - 3 * 3600_000).toISOString().slice(0, 10);
}
function inPeriod(value: unknown, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  const date = brasiliaDay(value);
  return !!date && (!from || date >= from) && (!to || date <= to);
}
function overlaps(start: unknown, end: unknown, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  const first = brasiliaDay(start), last = brasiliaDay(end) ?? first;
  if (!first || !last) return false;
  return (!to || first <= to) && (!from || last >= from);
}
function parse(json: unknown): Row | null {
  try { const value = JSON.parse(String(json)); return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null; } catch { return null; }
}
function changedFields(previous: Row | null, current: Row | null): string[] {
  if (!current) return [];
  if (!previous) return ['__created__'];
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .filter(key => !SNAPSHOT_SKIP.has(key) && JSON.stringify(previous[key] ?? null) !== JSON.stringify(current[key] ?? null)).sort();
}
function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try { const url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}
async function optional<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch (error) { if (error instanceof HttpError && [401, 403, 404, 409].includes(error.status)) return null; throw error; }
}

export type ProjectReportData = Awaited<ReturnType<typeof projectReportData>>;

export async function projectReportData(db: D1Database, actor: PortalActor | null, projectId: string, input: Record<string, unknown> = {}) {
  if (!actor) throw new HttpError(401, 'Entre para consultar o relatório.', 'unauthenticated');
  const from = day(input.from, 'a data inicial'), to = day(input.to, 'a data final');
  if (from && to && from > to) throw new HttpError(400, 'A data inicial deve ser anterior ou igual à final.', 'invalid_report_date');
  // A mesma leitura da ficha do projeto: quem não vê o projeto recebe 404 aqui.
  const detail = await projectDetail(db, actor, projectId);
  const project = detail.project as Row, permissions = detail.permissions as Record<string, boolean>;
  const range = { projectId, ...(from ? { from } : {}), ...(to ? { to } : {}) };
  // Só os campos que o documento usa: resposta menor e nada além do necessário.
  const FIELDS: Record<string, string[]> = {
    projects: ['materiais', 'eventos', 'emprestimos', 'registros', 'marcos_agenda'],
    demands: ['id', 'demanda', 'prioridade', 'situacao', 'data', 'prazo', 'em_atraso', 'atualizada_em'],
    materials: ['material', 'categoria', 'classe', 'saldo', 'disponivel', 'unidade_medida', 'situacao_estoque'],
    movements: ['id', 'data', 'material', 'tipo', 'quantidade', 'unidade_medida', 'observacao'],
    loans: ['material', 'acao', 'inicio', 'fim', 'situacao', 'em_atraso'],
    campaigns: ['evento', 'local', 'inicio', 'fim', 'situacao', 'participacoes', 'tentativas', 'premios_entregues'],
    records: ['data', 'categoria', 'titulo', 'anexos'],
  };
  const rowsOf = async (dataset: string, extra: Record<string, unknown> = range) => {
    const result = await reportRows(db, actor, { dataset, ...extra });
    return { rows: result.rows.map(row => Object.fromEntries(FIELDS[dataset].map(key => [key, row[key] ?? null]))), truncated: result.truncated };
  };
  const inventory = permitted(actor, 'inventory.read', projectId);
  const materialsAllowed = inventory || permitted(actor, 'reports.read', projectId);
  const loansAllowed = permitted(actor, 'loans.read', projectId) || permitted(actor, 'reports.read', projectId);
  const campaignsAllowed = permitted(actor, 'reports.read', projectId) || permitted(actor, 'campaigns.manage', projectId);

  const [summary, demands, materials, movements, loans, campaigns, records, team, sheet] = await Promise.all([
    rowsOf('projects', { projectId }),
    rowsOf('demands'),
    materialsAllowed ? rowsOf('materials', { projectId }) : Promise.resolve(null),
    materialsAllowed ? rowsOf('movements') : Promise.resolve(null),
    loansAllowed ? rowsOf('loans') : Promise.resolve(null),
    campaignsAllowed ? rowsOf('campaigns') : Promise.resolve(null),
    rowsOf('records'),
    optional(() => teamsWorkspace(db, actor, { projectId })),
    optional(() => projectSheetStatus(db, actor, projectId)),
  ]);

  // Conclusões das demandas visíveis: primeira versão do histórico com a situação "concluída".
  const completions = demands.rows.length ? await all(db, `SELECT h.task_id id,MIN(h.created_at) completed_at FROM followup_history h JOIN followup_tasks f ON f.id=h.task_id
    WHERE f.project_id=? AND json_extract(h.snapshot_json,'$.status')='completed' AND ${followAuthority('?', 'f.organization_id', 'f.project_id')} GROUP BY h.task_id LIMIT 5001`, [projectId, actor.userId]) : [];
  const completedAt = new Map(completions.map(row => [String(row.id), row.completed_at]));
  const demandRows = demands.rows.map(row => ({ ...row, concluida_em: row.situacao === 'completed' ? brasiliaDay(completedAt.get(String(row.id)) ?? row.atualizada_em) : null }));

  // Correções no cadastro de materiais e anexos dos registros de material: só com acesso ao estoque.
  let corrections: Row[] = [], attachments: Row[] = [];
  if (inventory && materials) {
    const live = projectAuthoritySql(actor, ['inventory.read'], 'p.id');
    const [itemVersions, files] = await Promise.all([
      all(db, `SELECT v.entity_id item_id,i.name material,v.version,v.snapshot_json,v.created_at,COALESCE(NULLIF(pr.display_name,''),'') por FROM entity_versions v JOIN items i ON i.id=v.entity_id AND i.project_id=v.project_id
        JOIN projects p ON p.id=v.project_id LEFT JOIN profiles pr ON pr.user_id=v.actor_id WHERE v.entity_type='item' AND v.project_id=? AND ${live.sql} ORDER BY v.entity_id,v.version LIMIT 2000`, [projectId, ...live.values]),
      all(db, `SELECT a.id,a.name arquivo,a.mime,a.size,a.created_at,r.title registro,i.name material FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id
        JOIN items i ON i.id=r.item_id AND i.project_id=r.project_id JOIN projects p ON p.id=r.project_id
        WHERE a.project_id=? AND a.deleted_at IS NULL AND r.loan_id IS NULL AND r.kind IN ('maintenance','distribution','consumption','material') AND ${live.sql}
        ORDER BY a.created_at DESC LIMIT 501`, [projectId, ...live.values]),
    ]);
    let previous: Row | null = null, previousItem = '';
    for (const version of itemVersions) {
      const snapshot = parse(version.snapshot_json);
      if (version.item_id !== previousItem) { previous = null; previousItem = String(version.item_id); }
      if (previous && inPeriod(version.created_at, from, to)) {
        const fields = changedFields(previous, snapshot);
        if (fields.length) corrections.push({ material: version.material, versao: version.version, data: brasiliaDay(version.created_at), momento: version.created_at, por: version.por, campos: fields });
      }
      previous = snapshot;
    }
    corrections = corrections.sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 500);
    attachments = files.filter(file => inPeriod(file.created_at, from, to)).slice(0, 500)
      .map(file => ({ material: file.material, registro: file.registro, arquivo: file.arquivo, tipo: file.mime, tamanho: file.size, data: brasiliaDay(file.created_at) }));
  }

  // Históricos e versões: as mesmas que a ficha mostra para quem edita o projeto.
  const versions = (detail.versions as Row[]) ?? [];
  // Quem salvou cada versão (nome do perfil), só para quem já vê o histórico na ficha.
  const authors = versions.length ? new Map((await all(db, `SELECT v.id,COALESCE(NULLIF(pr.display_name,''),'') por FROM entity_versions v LEFT JOIN profiles pr ON pr.user_id=v.actor_id WHERE v.project_id=? AND v.entity_type IN ('project','call','project_link','project_schedule_item') ORDER BY v.created_at DESC LIMIT 400`, [projectId])).map(row => [String(row.id), String(row.por)])) : new Map<string, string>();
  const sortedVersions = [...versions].sort((a, b) => String(a.entity_id).localeCompare(String(b.entity_id)) || Number(a.version) - Number(b.version));
  const history: Row[] = [];
  let before: Row | null = null, entity = '';
  for (const version of sortedVersions) {
    const snapshot = parse(version.snapshot_json);
    if (version.entity_id !== entity) { before = null; entity = String(version.entity_id); }
    const fields = before || Number(version.version) === 1 ? changedFields(before, snapshot) : ['__unknown__'];
    if (inPeriod(version.created_at, from, to)) history.push({
      tipo: version.entity_type, item: String(snapshot?.label ?? snapshot?.title ?? snapshot?.name ?? ''), versao: version.version,
      data: brasiliaDay(version.created_at), momento: version.created_at, por: authors.get(String(version.id)) ?? '', campos: fields,
    });
    before = snapshot;
  }
  history.sort((a, b) => String(b.momento).localeCompare(String(a.momento)) || Number(b.versao) - Number(a.versao));

  // Referências: links do projeto, fonte oficial, editais, agenda e planilhas já vinculadas.
  const references: Row[] = [];
  const add = (title: unknown, url: unknown, source: string, kind?: string) => {
    const safe = safeHttpUrl(url);
    if (!safe || references.some(reference => reference.url === safe)) return;
    references.push({ titulo: String(title || safe).slice(0, 200), url: safe, origem: source, tipo: kind ?? referenceType(safe) });
  };
  add('Página oficial do projeto', project.official_url, 'Ficha do projeto');
  for (const link of detail.links as Row[]) add(link.label, link.url, link.communication_channel ? 'Comunicação' : 'Vinculado ao projeto');
  if (sheet?.connection) add(sheet.connection.label || 'Planilha do projeto', sheet.connection.spreadsheetUrl, 'Planilha sincronizada', 'spreadsheet');
  const materialsUrl = (detail.spreadsheetLinks as { materialsUrl: string | null }).materialsUrl;
  if (materialsUrl) add('Materiais do projeto na planilha mestre', materialsUrl, 'Planilha mestre', 'spreadsheet');
  for (const call of detail.calls as Row[]) add(call.title, call.official_url, 'Edital');
  for (const item of detail.schedule as Row[]) add(item.title, item.url, 'Agenda');

  const schedule = (detail.schedule as Row[]).filter(item => overlaps(item.starts_at, item.ends_at, from, to))
    .map(item => ({ titulo: item.title, inicio: item.starts_at, fim: item.ends_at, situacao: item.status, observacao: item.note ?? '' }));

  return {
    generatedAt: iso(),
    period: { from, to },
    project: {
      id: project.id, name: project.name, shortName: project.short_name ?? '', description: project.description ?? '', status: project.status, lifecycle: project.lifecycle,
      unit: project.unit_name ? `${project.unit_acronym ? `${project.unit_acronym} · ` : ''}${project.unit_name}` : '', type: project.type_label ?? '',
      thematicArea: project.thematic_area ?? '', thematicAreaLabel: areaLabel(project.thematic_area), extensionLine: project.extension_line ?? '', extensionLineLabel: lineLabel(project.extension_line), scope: project.scope ?? '', location: project.location ?? '',
      startsAt: project.starts_at ?? null, endsAt: project.ends_at ?? null, officialUrl: safeHttpUrl(project.official_url), prizesEnabled: Boolean(project.prizes_enabled),
      counts: summary.rows[0] ?? null,
    },
    permissions: {
      canSaveTemplates: canSaveTemplates(actor, projectId),
      canAddReferences: Boolean(permissions.canEdit),
    },
    sections: {
      team: team ? { teams: team.teams.map(entry => ({ name: entry.name, status: entry.status, members: entry.members.map(member => member.name), counts: entry.counts })), truncated: team.teamsTruncated } : null,
      demands: { rows: demandRows, truncated: demands.truncated },
      materials: materials && movements ? { items: materials.rows, movements: movements.rows, corrections, attachments, truncated: materials.truncated || movements.truncated, detailed: inventory } : null,
      loans,
      campaigns,
      schedule: { rows: schedule },
      records,
      history: permissions.canEdit ? { rows: history.slice(0, 300) } : null,
      references: { rows: references },
    },
  };
}

// ---- Modelos salvos por projeto ------------------------------------------------------------

function canSaveTemplates(actor: PortalActor, projectId: string): boolean {
  return permitted(actor, 'reports.read', projectId) || permitted(actor, 'campaigns.manage', projectId) || permitted(actor, 'projects.manage', projectId);
}
function canSee(actor: PortalActor, projectId: string): boolean {
  const scope = accessibleProjects(actor);
  return scope === null || scope.includes(projectId);
}
function writerAuthority(actor: PortalActor) { return projectAuthoritySql(actor, ['reports.read', 'campaigns.manage', 'projects.manage'], 'p.id'); }

export async function listReportTemplates(db: D1Database, actor: PortalActor | null, projectId: string): Promise<Row[]> {
  if (!actor) throw new HttpError(401, 'Entre para consultar o relatório.', 'unauthenticated');
  if (!canSee(actor, projectId)) throw new HttpError(404, 'Projeto não encontrado.');
  const live = projectAuthoritySql(actor, [], 'p.id');
  const rows = await all(db, `SELECT t.id,t.name,t.config_json,t.version,t.updated_at FROM project_report_templates t JOIN projects p ON p.id=t.project_id
    WHERE t.project_id=? AND ${live.sql} ORDER BY t.name COLLATE NOCASE,t.id LIMIT ${REPORT_TEMPLATE_LIMIT}`, [projectId, ...live.values]);
  return rows.flatMap(row => {
    try { return [{ id: row.id, name: row.name, version: row.version, updatedAt: row.updated_at, config: normalizeReportConfig(JSON.parse(String(row.config_json))) }]; } catch { return []; }
  });
}

function templateName(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'Dê um nome ao modelo.', 'invalid_template_name');
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name || name.length > REPORT_TEMPLATE_NAME_LIMIT) throw new HttpError(400, `Use um nome de 1 a ${REPORT_TEMPLATE_NAME_LIMIT} caracteres.`, 'invalid_template_name');
  return name;
}
function versionOf(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new HttpError(400, 'Atualize a página e tente novamente.', 'invalid_version');
  return value as number;
}

export async function reportTemplateAction(db: D1Database, actor: PortalActor | null, projectId: string, input: Record<string, unknown>): Promise<{ templates: Row[]; id?: string }> {
  if (!actor) throw new HttpError(401, 'Entre para salvar modelos.', 'unauthenticated');
  if (!canSee(actor, projectId)) throw new HttpError(404, 'Projeto não encontrado.');
  if (!canSaveTemplates(actor, projectId)) throw new HttpError(403, 'Seu acesso permite usar os modelos, mas não salvá-los.', 'report_template_forbidden');
  const live = writerAuthority(actor), now = iso();
  const guard = `EXISTS(SELECT 1 FROM projects p WHERE p.id=? AND ${live.sql})`;
  // Gravação e auditoria na mesma transação: a auditoria só entra se a gravação mudou uma linha.
  const writeWithAudit = async (write: D1PreparedStatement, action: string, entityId: string, config: { sections: { on: boolean }[] } | null) => {
    try {
      const [result] = await db.batch([write, db.prepare('INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1')
        .bind(uid(), actor.userId, projectId, action, entityId, JSON.stringify(config ? { sections: config.sections.filter(section => section.on).length } : {}), now)]);
      return result.meta.changes === 1;
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new HttpError(409, 'Já existe um modelo com esse nome neste projeto.', 'template_name_taken');
      throw error;
    }
  };
  if (input.action === 'save') {
    const name = templateName(input.name);
    let config;
    try { config = normalizeReportConfig(input.config); } catch (error) { if (error instanceof ReportConfigError) throw new HttpError(400, error.message, 'invalid_report_config'); throw error; }
    const json = JSON.stringify(config);
    const existing = await one(db, 'SELECT id,version FROM project_report_templates WHERE project_id=? AND name=?', [projectId, name]);
    let id: string;
    if (input.id !== undefined && input.id !== null) {
      if (typeof input.id !== 'string' || input.id.length > 64) throw new HttpError(400, 'Modelo inválido.', 'invalid_template');
      id = input.id;
      if (existing && existing.id !== id) throw new HttpError(409, 'Já existe outro modelo com esse nome neste projeto.', 'template_name_taken');
      const changed = await writeWithAudit(db.prepare(`UPDATE project_report_templates SET name=?,config_json=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND project_id=? AND version=? AND ${guard}`)
        .bind(name, json, actor.userId, now, id, projectId, versionOf(input.expectedVersion), projectId, ...live.values), 'project.report_template.save', id, config);
      if (!changed) throw new HttpError(409, 'O modelo mudou ou seu acesso mudou. Atualize a lista e tente de novo.', 'template_conflict');
    } else {
      if (existing) throw new HttpError(409, 'Já existe um modelo com esse nome. Escolha-o na lista para atualizar.', 'template_name_taken');
      id = uid();
      const changed = await writeWithAudit(db.prepare(`INSERT INTO project_report_templates(id,project_id,name,config_json,version,created_by,updated_by,created_at,updated_at)
        SELECT ?,?,?,?,1,?,?,?,? WHERE ${guard} AND (SELECT COUNT(*) FROM project_report_templates WHERE project_id=?)<?`)
        .bind(id, projectId, name, json, actor.userId, actor.userId, now, now, projectId, ...live.values, projectId, REPORT_TEMPLATE_LIMIT), 'project.report_template.save', id, config);
      if (!changed) throw new HttpError(409, `Este projeto já tem ${REPORT_TEMPLATE_LIMIT} modelos ou seu acesso mudou. Apague um modelo antigo.`, 'template_limit');
    }
    return { id, templates: await listReportTemplates(db, actor, projectId) };
  }
  if (input.action === 'delete') {
    if (typeof input.id !== 'string' || input.id.length > 64) throw new HttpError(400, 'Modelo inválido.', 'invalid_template');
    const changed = await writeWithAudit(db.prepare(`DELETE FROM project_report_templates WHERE id=? AND project_id=? AND version=? AND ${guard}`)
      .bind(input.id, projectId, versionOf(input.expectedVersion), projectId, ...live.values), 'project.report_template.delete', input.id, null);
    if (!changed) throw new HttpError(409, 'O modelo mudou ou já foi apagado. Atualize a lista.', 'template_conflict');
    return { templates: await listReportTemplates(db, actor, projectId) };
  }
  throw new HttpError(400, 'Ação inválida.', 'invalid_action');
}
