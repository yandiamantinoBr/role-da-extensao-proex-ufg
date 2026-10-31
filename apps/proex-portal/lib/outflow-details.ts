import { projectAuthoritySql, type PortalActor } from './access';
import { all } from './database';
import { HttpError } from './errors';

type Range = { clauses: string[]; values: unknown[] };
type Context = { base: string; projectColumns: string; where: string[]; params: unknown[]; period: (column: string) => Range; limit: number };

/** One scoped read: reservations are excluded and each loan is one registered equipment unit. */
export async function detailedOutflowRows(db: D1Database, actor: PortalActor, input: Record<string, unknown>, context: Context) {
  const type = input.outflowType ?? 'all', returned = input.returnState ?? 'all';
  if (typeof type !== 'string' || typeof returned !== 'string' || !['all', 'distribute', 'redeem', 'loan'].includes(type) || !['all', 'not_applicable', 'out', 'returned'].includes(returned)) {
    throw new HttpError(400, 'Escolha um tipo de saída e uma situação de devolução válidos.', 'invalid_outflow_filter');
  }
  const notes = input.includeNotes === true || input.includeNotes === '1';
  const stockRead = projectAuthoritySql(actor, ['inventory.read', 'reports.read'], 'p.id');
  const loanRead = projectAuthoritySql(actor, ['loans.read', 'reports.read'], 'p.id');
  const stockOperator = projectAuthoritySql(actor, ['inventory.read'], 'p.id');
  const loanOperator = projectAuthoritySql(actor, ['loans.read'], 'p.id');
  const stockRange = context.period('m.created_at'), loanDate = 'COALESCE(l.checked_out_at,checkout.created_at)', loanRange = context.period(loanDate);
  const stockWhere = ['p.stock_read=1', 'm.delta<0', "m.kind IN ('distribute','redeem')", ...stockRange.clauses];
  const loanWhere = ['p.loan_read=1', "i.category='equipment'", "l.status IN ('out','returned')", ...loanRange.clauses];
  const stockParams = [...stockRange.values], loanParams = [...loanRange.values];
  if (type === 'loan' || returned === 'out' || returned === 'returned') stockWhere.push('0=1');
  if (type === 'distribute' || type === 'redeem') { stockWhere.push('m.kind=?'); stockParams.push(type); }
  if (type === 'distribute' || type === 'redeem' || returned === 'not_applicable') loanWhere.push('0=1');
  if (returned === 'out' || returned === 'returned') { loanWhere.push('l.status=?'); loanParams.push(returned); }
  const metadata = 'p.projeto,p.unidade_sigla,p.unidade,p.unidade_grupo,p.area_tematica,p.modalidade';
  // The stored actor identifies who registered the operation, not who received the material.
  // Names come from the current profile and never fall back to an email/account identifier.
  const operator = (permission: string) => `CASE WHEN ${permission}=0 THEN 'Restrito ao perfil operacional'
    WHEN person.user_id IS NOT NULL AND person.anonymized_at IS NULL AND trim(profile.display_name)<>'' THEN profile.display_name
    ELSE 'Nome não registrado ou indisponível' END`;
  const operatorSource = (permission: string, source: string) => `CASE WHEN ${permission}=0 THEN 'Nome não consultado neste perfil' ELSE '${source}; nome atual do perfil quando disponível' END`;
  const sql = `WITH visible_projects AS (
    SELECT p.id,${context.projectColumns},${stockRead.sql} stock_read,${loanRead.sql} loan_read,
      ${stockOperator.sql} stock_operator,${loanOperator.sql} loan_operator
    FROM ${context.base} WHERE ${context.where.join(' AND ')}
  ), checkout_audit AS (
    SELECT a.id,a.entity_id,a.project_id,a.actor_id,a.created_at,
      ROW_NUMBER() OVER (PARTITION BY a.project_id,a.entity_id ORDER BY a.created_at,a.id) position
    FROM audit a JOIN visible_projects p ON p.id=a.project_id AND p.loan_read=1
    WHERE a.action='loan.status' AND CASE WHEN json_valid(a.details) THEN json_extract(a.details,'$.status') END='out'
  )
  SELECT 'movement:'||m.id id,${metadata},i.name material,i.category classe,COALESCE(mc.label,i.category) categoria,
    i.unit unidade_medida,'Cadastro atual do material; unidade histórica não armazenada na saída' unidade_origem,
    m.kind tipo,-m.delta quantidade,date(m.created_at,'-3 hours') data_saida,m.created_at instante_saida_utc,
    'Movimentação de estoque' fonte_data,
    CASE WHEN g.id IS NOT NULL THEN g.title WHEN c.id IS NOT NULL THEN c.name ELSE 'Não registrada' END acao,
    CASE WHEN g.id IS NOT NULL THEN 'Atividade vinculada' WHEN c.id IS NOT NULL THEN 'Campanha do prêmio' ELSE 'Sem vínculo de ação registrado' END acao_fonte,
    g.id atividade_id,c.id evento_id,${operator('p.stock_operator')} registrado_por,
    ${operatorSource('p.stock_operator', 'Operador da movimentação')} operador_fonte,
    i.stock saldo_atual,i.reserved reservado_atual,i.stock-i.reserved disponivel_atual,
    'Saldo atual do cadastro; não é saldo histórico após esta saída' saldo_origem,
    'not_applicable' situacao_retorno,NULL devolucao_prevista,NULL devolucao_registrada,
    'Movimentação de estoque' origem,m.id origem_id
    ${notes ? ',CASE WHEN p.stock_operator=1 THEN m.note END finalidade_registrada,CASE WHEN p.stock_operator=1 THEN g.note END observacao_atividade,NULL condicao_saida,NULL condicao_retorno' : ''}
  FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN visible_projects p ON p.id=i.project_id
  LEFT JOIN material_categories mc ON mc.id=i.category_id AND mc.project_id=p.id
  LEFT JOIN activity_groups g ON g.id=m.group_id AND g.project_id=p.id
  LEFT JOIN entitlements e ON m.kind='redeem' AND e.id=substr(m.ref_id,7,length(m.ref_id)-length(m.item_id)-7) AND m.ref_id='prize:'||e.id||':'||m.item_id
  LEFT JOIN participations participation ON participation.id=e.participation_id
  LEFT JOIN campaigns c ON c.id=participation.campaign_id AND c.project_id=p.id
  LEFT JOIN portal_users person ON person.user_id=m.actor_id
  LEFT JOIN profiles profile ON profile.user_id=person.user_id
  WHERE ${stockWhere.join(' AND ')}
  UNION ALL
  SELECT 'loan:'||l.id id,${metadata},i.name material,i.category classe,COALESCE(mc.label,i.category) categoria,
    i.unit unidade_medida,'Cadastro atual do material; uma unidade individual por reserva de equipamento' unidade_origem,
    'loan' tipo,1 quantidade,date(${loanDate},'-3 hours') data_saida,${loanDate} instante_saida_utc,
    CASE WHEN l.checked_out_at IS NOT NULL THEN 'Retirada registrada no empréstimo' WHEN checkout.id IS NOT NULL THEN 'Auditoria da retirada' ELSE 'Data efetiva não registrada; previsão não utilizada' END fonte_data,
    COALESCE(NULLIF(trim(l.action_name),''),g.title,'Não registrada') acao,
    CASE WHEN trim(l.action_name)<>'' THEN 'Ação informada no empréstimo' WHEN g.id IS NOT NULL THEN 'Atividade vinculada' ELSE 'Sem vínculo de ação registrado' END acao_fonte,
    g.id atividade_id,NULL evento_id,${operator('p.loan_operator')} registrado_por,
    ${operatorSource('p.loan_operator', 'Auditoria da retirada')} operador_fonte,
    i.stock saldo_atual,i.reserved reservado_atual,i.stock-i.reserved disponivel_atual,
    'Saldo atual do cadastro; retirada de empréstimo não baixa o estoque' saldo_origem,
    l.status situacao_retorno,date(l.ends_at/1000,'unixepoch','-3 hours') devolucao_prevista,date(l.returned_at,'-3 hours') devolucao_registrada,
    'Empréstimo de equipamento individual' origem,l.id origem_id
    ${notes ? ',CASE WHEN p.loan_operator=1 THEN l.note END finalidade_registrada,CASE WHEN p.loan_operator=1 THEN g.note END observacao_atividade,CASE WHEN p.loan_operator=1 THEN l.condition_out END condicao_saida,CASE WHEN p.loan_operator=1 THEN l.condition_in END condicao_retorno' : ''}
  FROM loans l JOIN items i ON i.id=l.item_id AND i.project_id=l.project_id JOIN visible_projects p ON p.id=l.project_id
  LEFT JOIN material_categories mc ON mc.id=i.category_id AND mc.project_id=p.id
  LEFT JOIN activity_groups g ON g.id=l.group_id AND g.project_id=p.id
  LEFT JOIN checkout_audit checkout ON checkout.entity_id=l.id AND checkout.project_id=l.project_id AND checkout.position=1
  LEFT JOIN portal_users person ON person.user_id=checkout.actor_id
  LEFT JOIN profiles profile ON profile.user_id=person.user_id
  WHERE ${loanWhere.join(' AND ')}
  ORDER BY instante_saida_utc DESC,id LIMIT ?`;
  return all(db, sql, [...stockRead.values, ...loanRead.values, ...stockOperator.values, ...loanOperator.values, ...context.params, ...stockParams, ...loanParams, context.limit]);
}
