import { accessibleProjects, projectAuthoritySql, type PortalActor } from './access';
import { all, type Row } from './database';
import { HttpError } from './errors';
import { followupReportRows } from './follow-up/reports';
import { detailedOutflowRows } from './outflow-details';

// Central de relatórios: conjuntos de dados tabulares, já filtrados pelas permissões
// de cada pessoa. Contatos, identificadores de conta e chaves de arquivos ficam fora.
// Saídas rastreáveis podem incluir o nome atual do operador sob permissão operacional
// vigente. Agregações e gráficos são feitos na interface.
export const REPORT_DATASETS = {
  projects: { label: 'Projetos e ações', capabilities: [] as string[] },
  materials: { label: 'Materiais e estoque', capabilities: ['inventory.read', 'reports.read'] },
  movements: { label: 'Movimentações de estoque', capabilities: ['inventory.read', 'reports.read'] },
  outflows: { label: 'Saídas institucionais', capabilities: ['inventory.read', 'reports.read'] },
  outflow_details: { label: 'Saídas rastreáveis', capabilities: ['inventory.read', 'loans.read', 'reports.read'] },
  loans: { label: 'Empréstimos', capabilities: ['loans.read', 'reports.read'] },
  records: { label: 'Registros', capabilities: ['reports.read', 'inventory.read', 'loans.read'] },
  campaigns: { label: 'Eventos e dinâmicas', capabilities: ['reports.read', 'campaigns.manage'] },
  demands: { label: 'Demandas e prioridades', capabilities: [] as string[] },
  reviews: { label: 'Conferências e avarias', capabilities: [] as string[] },
} as const;
export type ReportDataset = keyof typeof REPORT_DATASETS;
const MAX_ROWS = 5000;
// Leave room below the host's non-streamed response cap, even with optional notes.
const MAX_OUTFLOW_BYTES = 3 * 1024 * 1024;

function scope(actor: PortalActor, capabilities: readonly string[]): string[] | null {
  if (!capabilities.length) return accessibleProjects(actor);
  let union: Set<string> | null = new Set();
  for (const capability of capabilities) {
    const projects = accessibleProjects(actor, capability);
    if (projects === null) { union = null; break; }
    projects.forEach(project => union!.add(project));
  }
  return union === null ? null : [...union];
}
function inScope(column: string, projects: string[] | null): { sql: string; params: unknown[] } {
  if (projects === null) return { sql: '1=1', params: [] };
  if (!projects.length) return { sql: '1=0', params: [] };
  return { sql: `${column} IN (${projects.map(() => '?').join(',')})`, params: projects };
}
function day(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `Informe ${label} como data (AAAA-MM-DD).`, 'invalid_report_date');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new HttpError(400, `Informe ${label} como uma data existente.`, 'invalid_report_date');
  return value;
}

// Mesma regra da lista de registros: empréstimos para quem cuida de empréstimos, materiais
// para quem cuida do estoque e registros do projeto para coordenação e consulta.
function recordVisibility(actor: PortalActor, extra: { clauses: string[]; values: unknown[] }) {
  const authorized=(capability:string)=>{const scope=inScope('p.id',accessibleProjects(actor,capability)),live=projectAuthoritySql(actor,[capability],'p.id');return{sql:`(${scope.sql}) AND (${live.sql})`,params:[...scope.params,...live.values]};};
  const loan=authorized('loans.read'),inventory=authorized('inventory.read'),project=authorized('reports.read');
  return {
    clauses: [...extra.clauses, `(((r.kind='loan' OR r.loan_id IS NOT NULL) AND ${loan.sql}) OR (r.loan_id IS NULL AND r.kind IN ('maintenance','distribution','consumption','material') AND ${inventory.sql}) OR (r.loan_id IS NULL AND r.kind IN ('project','observation') AND ${project.sql}))`],
    values: [...extra.values, ...loan.params, ...inventory.params, ...project.params],
  };
}

/** Filtros comuns: projeto, unidade, área temática e período (datas no horário de Brasília). */
export async function reportRows(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>): Promise<{ dataset: ReportDataset; rows: Row[]; truncated: boolean }> {
  if (!actor) throw new HttpError(401, 'Entre para consultar relatórios.', 'unauthenticated');
  const dataset = input.dataset as ReportDataset;
  if (!Object.hasOwn(REPORT_DATASETS, dataset)) throw new HttpError(400, 'Escolha um relatório válido.', 'invalid_report');
  if (dataset === 'demands' || dataset === 'reviews') return followupReportRows(db, actor, dataset, input, MAX_ROWS);
  const projects = scope(actor, REPORT_DATASETS[dataset].capabilities);
  if (projects !== null && !projects.length) return { dataset, rows: [], truncated: false };
  const from = day(input.from, 'a data inicial'), to = day(input.to, 'a data final');
  if (from && to && from > to) throw new HttpError(400, 'A data inicial deve ser anterior ou igual à final.', 'invalid_report_date');
  const where: string[] = [], params: unknown[] = [];
  const authority=projectAuthoritySql(actor,REPORT_DATASETS[dataset].capabilities,'p.id');where.push(authority.sql);params.push(...authority.values);
  const assetDetails = dataset === 'materials' && (input.assetDetails === true || input.assetDetails === '1');
  if(assetDetails){const privateAuthority=projectAuthoritySql(actor,['inventory.read'],'p.id');where.push(privateAuthority.sql);params.push(...privateAuthority.values);}
  if (projects !== null) { where.push(`p.id IN (${projects.map(() => '?').join(',')})`); params.push(...projects); }
  for (const [key, column] of [['projectId', 'p.id'], ['organizationId','p.organization_id'], ['unitId', 'p.unit_id'], ['thematicArea', 'p.thematic_area']] as const) {
    const value = input[key];
    if (typeof value === 'string' && value) {
      if (value.length > 200) throw new HttpError(400, 'Filtro inválido.', 'invalid_report_filter');
      if (value === '__none__') where.push(`(${column} IS NULL OR ${column}='')`); else { where.push(`${column}=?`); params.push(value); }
    }
  }
  const period = (column: string, milliseconds = false) => {
    const clauses: string[] = [], values: unknown[] = [];
    const calendarDay = milliseconds ? `date(${column}/1000,'unixepoch','-3 hours')` : `date(${column},'-3 hours')`;
    if (from) { clauses.push(`${calendarDay}>=?`); values.push(from); }
    if (to) { clauses.push(`${calendarDay}<=?`); values.push(to); }
    return { clauses, values };
  };
  const base = `projects p LEFT JOIN organizational_units u ON u.id=p.unit_id LEFT JOIN project_types t ON t.id=p.type_id`;
  const projectColumns = `p.name AS projeto,COALESCE(u.acronym,'') AS unidade_sigla,COALESCE(u.name,'') AS unidade,COALESCE(u.group_label,'') AS unidade_grupo,p.thematic_area AS area_tematica,COALESCE(t.label,'') AS modalidade`;
  const run = async (sql: string, extra: { clauses: string[]; values: unknown[] } = { clauses: [], values: [] }) => {
    const clauses = [...where, ...extra.clauses];
    return all(db, sql.replace('/*WHERE*/', clauses.length ? `WHERE ${clauses.join(' AND ')}` : '') + ` LIMIT ${MAX_ROWS + 1}`, [...params, ...extra.values]);
  };
  let rows: Row[];
  if (dataset === 'outflow_details') {
    rows = await detailedOutflowRows(db, actor, input, { base, projectColumns, where, params, period, limit: MAX_ROWS + 1 });
  } else if (dataset === 'projects') {
    rows = await run(`SELECT p.id,${projectColumns},p.short_name AS sigla,p.extension_line AS linha_extensao,p.scope AS abrangencia,p.status AS situacao,p.lifecycle AS etapa,
      date(p.starts_at,'-3 hours') AS inicio,date(p.ends_at,'-3 hours') AS fim,p.location AS local,
      (SELECT COUNT(*) FROM items i WHERE i.project_id=p.id) AS materiais,(SELECT COUNT(*) FROM campaigns c WHERE c.project_id=p.id) AS eventos,
      (SELECT COUNT(*) FROM loans l WHERE l.project_id=p.id) AS emprestimos,(SELECT COUNT(*) FROM records r WHERE r.project_id=p.id) AS registros,
      date(p.created_at,'-3 hours') AS criado_em FROM ${base} /*WHERE*/ ORDER BY p.name`);
  } else if (dataset === 'materials') {
    rows = await run(`SELECT i.id,${projectColumns},i.name AS material,i.category AS classe,COALESCE(mc.label,'') AS categoria,i.unit AS unidade_medida,
      i.stock AS saldo,i.reserved AS reservado,i.stock-i.reserved AS disponivel,i.low_stock AS alerta_minimo,
      CASE WHEN i.stock-i.reserved<=i.low_stock THEN 'baixo' ELSE 'ok' END AS situacao_estoque,i.condition AS condicao,i.asset_code AS patrimonio,
      ${assetDetails ? `i.description AS descricao_bem,i.brand AS marca,i.model AS modelo,i.serial_number AS numero_serie,i.asset_location AS localizacao_bem,
      i.responsible_unit AS unidade_responsavel,i.responsible_reference AS responsavel_documentado,i.conservation_state AS conservacao,i.asset_status AS situacao_patrimonial,
      i.origin AS origem,i.destination AS destino,i.process_reference AS processo,i.responsibility_term AS termo_responsabilidade,i.invoice_reference AS nota_fiscal,
      i.acquisition_date AS data_aquisicao,i.acquisition_value_cents AS valor_aquisicao_centavos,i.source_reference AS fonte_cadastro,` : ''}
      date(i.updated_at,'-3 hours') AS atualizado_em FROM items i JOIN ${base.replace('projects p', 'projects p ON p.id=i.project_id')} LEFT JOIN material_categories mc ON mc.id=i.category_id /*WHERE*/ ORDER BY p.name,i.name`);
  } else if (dataset === 'movements') {
    rows = await run(`SELECT m.id,date(m.created_at,'-3 hours') AS data,${projectColumns},i.name AS material,i.category AS classe,i.unit AS unidade_medida,m.kind AS tipo,m.delta AS quantidade,
      CASE WHEN m.delta>0 THEN 'entrada' ELSE 'saida' END AS sentido,m.note AS observacao
      FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN ${base.replace('projects p', 'projects p ON p.id=i.project_id')} /*WHERE*/ ORDER BY m.created_at DESC`, period('m.created_at'));
  } else if (dataset === 'outflows') {
    const range = period('m.created_at');
    rows = await run(`SELECT i.id||':'||m.kind AS id,${projectColumns},i.name AS material,i.category AS classe,i.unit AS unidade_medida,m.kind AS tipo,
      SUM(-m.delta) AS quantidade,COUNT(*) AS movimentacoes,MIN(date(m.created_at,'-3 hours')) AS primeira_saida,MAX(date(m.created_at,'-3 hours')) AS ultima_saida
      FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN ${base.replace('projects p', 'projects p ON p.id=i.project_id')} /*WHERE*/ GROUP BY i.id,m.kind ORDER BY p.name,i.name,m.kind`, { clauses: [...range.clauses, "m.delta<0", "m.kind IN ('distribute','redeem')"], values: range.values });
  } else if (dataset === 'loans') {
    rows = await run(`SELECT l.id,${projectColumns},i.name AS material,l.action_name AS acao,date(l.starts_at/1000,'unixepoch','-3 hours') AS inicio,date(l.ends_at/1000,'unixepoch','-3 hours') AS fim,
      l.status AS situacao,date(l.checked_out_at,'-3 hours') AS retirado_em,date(l.returned_at,'-3 hours') AS devolvido_em,
      CASE WHEN l.status='out' AND l.ends_at<CAST(strftime('%s','now') AS INTEGER)*1000 THEN 'sim' ELSE 'nao' END AS em_atraso,l.condition_out AS condicao_saida,l.condition_in AS condicao_retorno
      FROM loans l JOIN items i ON i.id=l.item_id JOIN ${base.replace('projects p', 'projects p ON p.id=l.project_id')} /*WHERE*/ ORDER BY l.starts_at DESC`, period('l.starts_at', true));
  } else if (dataset === 'records') {
    rows = await run(`SELECT r.id,date(r.occurred_at,'-3 hours') AS data,${projectColumns},r.kind AS categoria,r.title AS titulo,substr(r.body,1,500) AS descricao,
      (SELECT COUNT(*) FROM record_attachments a WHERE a.record_id=r.id AND a.deleted_at IS NULL) AS anexos
      FROM records r JOIN ${base.replace('projects p', 'projects p ON p.id=r.project_id')} /*WHERE*/ ORDER BY r.occurred_at DESC`, recordVisibility(actor, period('r.occurred_at')));
  } else {
    rows = await run(`SELECT c.id,${projectColumns},c.name AS evento,c.location AS local,date(c.starts_at,'-3 hours') AS inicio,date(c.ends_at,'-3 hours') AS fim,c.status AS situacao,
      (SELECT COUNT(*) FROM participations x WHERE x.campaign_id=c.id) AS participacoes,
      (SELECT COUNT(*) FROM attempts a JOIN participations x ON x.id=a.participation_id WHERE x.campaign_id=c.id) AS tentativas,
      (SELECT COUNT(*) FROM entitlements e JOIN participations x ON x.id=e.participation_id WHERE x.campaign_id=c.id AND e.state='delivered') AS premios_entregues
      FROM campaigns c JOIN ${base.replace('projects p', 'projects p ON p.id=c.project_id')} /*WHERE*/ ORDER BY c.starts_at DESC`, period('c.starts_at'));
  }
  if (dataset === 'outflow_details') {
    const selected: Row[] = [], encoder = new TextEncoder(); let bytes = 128;
    for (const row of rows.slice(0, MAX_ROWS)) {
      const size = encoder.encode(JSON.stringify(row)).byteLength + 1;
      if (bytes + size > MAX_OUTFLOW_BYTES) break;
      selected.push(row); bytes += size;
    }
    return { dataset, rows: selected, truncated: rows.length > selected.length };
  }
  return { dataset, rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS };
}
