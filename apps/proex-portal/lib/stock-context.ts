import { effectiveMovementSql } from './movement-ledger';
import { projectAuthoritySql, requireLiveCapability, memberProjectScopeSql, type PortalActor } from './access';
import { all, one, type Row } from './database';
import { HttpError } from './errors';

export type StockContextInput = {
 counterpartyType: 'unit'|'project'|null; counterpartyId: string|null;
 processReference: string; beneficiaryReference: string; occurredAt: string; dateSource:'registration'|'declared';
};
export type StockContext = StockContextInput & {counterpartyName:string|null;canOpen:boolean;href:string|null;measurementUnit:string;materialName:string};
type StockItem = {id:string;project_id:string;name:string;unit:string};
function invalid(message:string, code='invalid_stock_context', status=400):never {throw new HttpError(status,message,code);}
function clean(value:unknown,label:string,max:number):string {
 if(value===undefined||value===null||value==='')return '';
 if(typeof value!=='string')invalid(`Informe ${label} como texto.`);
 const result=value.normalize('NFC').trim();
 if(result.length>max||/[\u0000-\u001f\u007f-\u009f]/u.test(result))invalid(`Use até ${max} caracteres válidos para ${label}.`);
 return result;
}
function identifier(value:unknown):string|null {const result=clean(value,'a referência',200);if(!result)return null;if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(result))invalid('Escolha uma referência válida.');return result;}
export function stockContextInput(input:Record<string,unknown>,now:string):StockContextInput {
 const counterpartyId=identifier(input.counterpartyId),type=input.counterpartyType;
 const counterpartyType=type===undefined||type===null||type===''?null:type;
 if(counterpartyType!==null&&counterpartyType!=='unit'&&counterpartyType!=='project')invalid('Escolha unidade ou projeto para a origem ou o destino.');
 if(Boolean(counterpartyType)!==Boolean(counterpartyId))invalid('Selecione o tipo e a origem ou o destino correspondente.');
 const processReference=clean(input.processReference,'o processo SEI',120),beneficiaryReference=clean(input.beneficiaryReference,'o responsável ou beneficiário informado',160);
 const date=clean(input.occurredAt,'a data da movimentação',40);
 let occurredAt=now;
 if(date){
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(date))invalid('Informe data, horário e fuso da movimentação.','invalid_stock_date');
  const time=Date.parse(date),[year,month,day]=date.slice(0,10).split('-').map(Number);
  if(!Number.isFinite(time)||year<2000||year>2200||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||time>Date.parse(now)+300_000)invalid('Use uma data existente, até o momento atual.','invalid_stock_date');
  occurredAt=new Date(time).toISOString();
 }
 return {counterpartyType,counterpartyId,processReference,beneficiaryReference,occurredAt,dateSource:date?'declared':'registration'};
}
export function stockContextWasProvided(input:StockContextInput) {return Boolean(input.counterpartyId||input.processReference||input.beneficiaryReference||input.dateSource==='declared');}
function storedInput(row:Row):StockContextInput {return {counterpartyType:row.counterparty_unit_id?'unit':row.counterparty_project_id?'project':null,counterpartyId:row.counterparty_unit_id??row.counterparty_project_id??null,processReference:row.process_reference,beneficiaryReference:row.beneficiary_reference,occurredAt:row.occurred_at,dateSource:row.date_source};}
export async function matchingStockContext(db:D1Database,movementId:string,input:StockContextInput) {
 const row=await one(db,'SELECT * FROM stock_movement_contexts WHERE movement_id=?',[movementId]);
 if(!row){if(stockContextWasProvided(input))invalid('A operação anterior não registrou esses dados. Use uma nova operação para corrigir o registro.','operation_conflict',409);return;}
 const stored=storedInput(row);
 if(stored.counterpartyType!==input.counterpartyType||stored.counterpartyId!==input.counterpartyId||stored.processReference!==input.processReference||stored.beneficiaryReference!==input.beneficiaryReference||stored.dateSource!==input.dateSource||(input.dateSource==='declared'&&stored.occurredAt!==input.occurredAt))invalid('Esta operação já foi confirmada com outros dados de origem, destino ou processo.','operation_conflict',409);
}
/** Validated again inside the ledger batch; labels never grant authority. */
export async function prepareStockContext(db:D1Database,actor:PortalActor,item:StockItem,input:StockContextInput) {
 const owner=await one(db,"SELECT p.organization_id FROM projects p JOIN organizations o ON o.id=p.organization_id WHERE p.id=? AND p.status='active' AND o.status='active'",[item.project_id]);
 if(!owner)invalid('O projeto está indisponível para movimentações.','stock_context_scope',409);
 const assertions:D1PreparedStatement[]=[db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM projects p JOIN organizations o ON o.id=p.organization_id WHERE p.id=? AND p.organization_id=? AND p.status='active' AND o.status='active') THEN 1 ELSE json_extract('[]','stock_context_scope') END").bind(item.project_id,owner.organization_id)];
 if(input.counterpartyType==='unit'){
  if(!await one(db,"SELECT id FROM organizational_units WHERE id=? AND status='active'",[input.counterpartyId]))invalid('Escolha uma unidade ativa.','stock_context_counterparty');
 }else if(input.counterpartyType==='project'){
  const authority=projectAuthoritySql(actor,['inventory.read','reports.read'],'p.id');
  const sql=`EXISTS(SELECT 1 FROM projects p WHERE p.id=? AND p.id<>? AND p.organization_id=? AND p.status='active' AND (${authority.sql}))`,values=[input.counterpartyId,item.project_id,owner.organization_id,...authority.values];
  if(!await one(db,`SELECT 1 allowed WHERE ${sql}`,values))invalid('Escolha outro projeto ativo da mesma organização ao qual você tenha acesso.','stock_context_counterparty',403);
  assertions.push(db.prepare(`SELECT CASE WHEN ${sql} THEN 1 ELSE json_extract('[]','stock_context_counterparty') END`).bind(...values));
 }
 return {assertions,insert:(movementId:string,now:string)=>db.prepare('INSERT INTO stock_movement_contexts(movement_id,project_id,counterparty_unit_id,counterparty_project_id,process_reference,beneficiary_reference,occurred_at,date_source,material_name,measurement_unit,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(movementId,item.project_id,input.counterpartyType==='unit'?input.counterpartyId:null,input.counterpartyType==='project'?input.counterpartyId:null,input.processReference,input.beneficiaryReference,input.occurredAt,input.dateSource,item.name,item.unit,now)};
}
function contextStatement(db:D1Database,actor:PortalActor,movementIds:string[]) {
 const permission=projectAuthoritySql(actor,['inventory.read','reports.read'],'other.id');
 return db.prepare(`SELECT c.*,u.name unit_name,other.name project_name,CASE WHEN other.id IS NOT NULL THEN (${permission.sql}) ELSE 0 END can_open FROM stock_movement_contexts c LEFT JOIN organizational_units u ON u.id=c.counterparty_unit_id LEFT JOIN projects other ON other.id=c.counterparty_project_id WHERE c.movement_id IN(${movementIds.map(()=>'?').join(',')||'NULL'}) ORDER BY c.movement_id`).bind(...permission.values,...movementIds);
}
function projectContexts(rows:Row[]):Map<string,StockContext> {
 return new Map(rows.map(row=>{
  const value=storedInput(row),canOpen=value.counterpartyType==='unit'||Boolean(row.can_open),name=value.counterpartyType==='unit'?row.unit_name:canOpen?row.project_name:null;
  return [row.movement_id,{...value,counterpartyId:canOpen?value.counterpartyId:null,counterpartyName:name??null,canOpen,href:canOpen&&value.counterpartyId?value.counterpartyType==='unit'?`/?module=materials&unitId=${encodeURIComponent(value.counterpartyId)}`:`/?module=projects&project=${encodeURIComponent(value.counterpartyId)}&detailProject=${encodeURIComponent(value.counterpartyId)}`:null,measurementUnit:row.measurement_unit,materialName:row.material_name}];
 }));
}
export async function movementContexts(db:D1Database,actor:PortalActor,movementIds:string[]):Promise<Map<string,StockContext>> {
 return projectContexts((await contextStatement(db,actor,movementIds).all<Row>()).results??[]);
}
/** One atomic read guards the owner and the counterpart labels at the return fence. */
export async function fencedMovementContexts(db:D1Database,actor:PortalActor,projectId:string,movementIds:string[]) {
 const permission=projectAuthoritySql(actor,['inventory.read'],'p.id');
 const results=await db.batch([
  db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM projects p JOIN organizations org ON org.id=p.organization_id AND org.status='active' WHERE p.id=? AND (${permission.sql})) THEN 1 ELSE json_extract('[]','stock_context_access_changed') END`).bind(projectId,...permission.values),
  contextStatement(db,actor,movementIds),
 ]);
 return projectContexts((results[1].results??[]) as Row[]);
}
export async function stockContextCatalog(db:D1Database,actor:PortalActor|null,projectId:unknown) {
 if(!actor)invalid('Entre para consultar os materiais.','unauthenticated',401);
 const project=identifier(projectId);if(!project)invalid('Escolha o projeto dos materiais.');
 await requireLiveCapability(db,actor,'inventory.read',project);
 const owner=await one(db,"SELECT p.organization_id FROM projects p JOIN organizations o ON o.id=p.organization_id WHERE p.id=? AND p.status='active' AND o.status='active'",[project]);if(!owner)invalid('Projeto indisponível.','stock_context_scope',404);
 const authority=projectAuthoritySql(actor,['inventory.read','reports.read'],'p.id'),source=projectAuthoritySql(actor,['inventory.read'],'p.id');
 try{
  const result=await db.batch([
   db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM projects p JOIN organizations org ON org.id=p.organization_id AND org.status='active' WHERE p.id=? AND p.organization_id=? AND p.status='active' AND (${source.sql})) THEN 1 ELSE json_extract('[]','stock_context_access_changed') END`).bind(project,owner.organization_id,...source.values),
   db.prepare("SELECT id,name,acronym FROM organizational_units WHERE status='active' ORDER BY name,id"),
   db.prepare(`SELECT p.id,p.name,p.unit_id unitId FROM projects p WHERE p.organization_id=? AND p.id<>? AND p.status='active' AND (${authority.sql}) ORDER BY p.name,p.id`).bind(owner.organization_id,project,...authority.values),
  ]);
  return {projectId:project,units:result[1].results??[],projects:result[2].results??[],notice:'A origem ou o destino informado não transfere saldo entre projetos e não concede acesso.'};
 }catch(error){if(String(error).includes('stock_context_access_changed'))invalid('Seu acesso mudou. Atualize a página.','stock_context_forbidden',403);throw error;}
}
/** Existing duties determine the visual alert; they never grant inventory access. */
function assignmentStatement(db:D1Database,projectIds:string[],actor:PortalActor) {
 const authorized=(user:string)=>`EXISTS(SELECT 1 FROM portal_users person JOIN members member ON member.user_id=person.user_id WHERE person.user_id=${user} AND person.status='active' AND person.activation_pending=0 AND person.anonymized_at IS NULL AND member.revoked_at IS NULL AND member.role IN('owner','manager','inventory') AND ${memberProjectScopeSql('member','s.project_id')})`;
 return db.prepare(`SELECT s.id scopeId,s.project_id projectId,s.item_id itemId,a.user_id userId,a.team_id teamId,
 CASE WHEN a.user_id IS NOT NULL THEN COALESCE(NULLIF(profile.display_name,''),'Integrante') ELSE team.name END name,
 CASE WHEN a.user_id=? OR EXISTS(SELECT 1 FROM followup_team_members own WHERE own.team_id=a.team_id AND own.user_id=? AND own.removed_at IS NULL AND ${authorized('own.user_id')}) THEN 1 ELSE 0 END assignedToMe
 FROM work_responsibility_scopes s JOIN work_responsibility_assignees a ON a.scope_id=s.id AND a.revoked_at IS NULL LEFT JOIN profiles profile ON profile.user_id=a.user_id LEFT JOIN followup_teams team ON team.id=a.team_id AND team.organization_id=s.organization_id AND team.status='active'
 WHERE s.status='active' AND s.area='materials' AND s.project_id IN(${projectIds.map(()=>'?').join(',')}) AND ((a.user_id IS NOT NULL AND ${authorized('a.user_id')}) OR (team.id IS NOT NULL AND EXISTS(SELECT 1 FROM followup_team_members tm WHERE tm.team_id=team.id AND tm.removed_at IS NULL AND ${authorized('tm.user_id')}))) ORDER BY s.id,a.id`).bind(actor.userId,actor.userId,...projectIds);
}
function day(value:unknown,fallback:string):string {if(value===undefined||value===null||value==='')return fallback;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)invalid('Use uma data válida no formato AAAA-MM-DD.','invalid_stock_date');return value;}
const DAY=86_400_000;
/** Read-only, contextual statistics. Never totals unlike units or fabricates history. */
export async function stockConsumption(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>={}) {
 if(!actor)invalid('Entre para consultar as movimentações.','unauthenticated',401);
 const asOf=new Date().toISOString(),today=new Date(Date.parse(asOf)-3*3_600_000).toISOString().slice(0,10),projectId=identifier(input.projectId),unitId=identifier(input.unitId),organizationId=identifier(input.organizationId);
 const from=day(input.from,new Date(Date.parse(today)-30*DAY).toISOString().slice(0,10)),to=day(input.to,today);
 if(from>to||Date.parse(to)-Date.parse(from)>366*DAY)invalid('Escolha um período de até 366 dias, com início anterior ao fim.','invalid_stock_date');
 const authority=projectAuthoritySql(actor,['inventory.read','reports.read'],'p.id'),where=[authority.sql],params:unknown[]=[...authority.values];
 if(projectId){where.push('p.id=?');params.push(projectId);}if(organizationId){where.push('p.organization_id=?');params.push(organizationId);}
 const visible=await all(db,`SELECT p.id,p.name,p.unit_id,p.organization_id FROM projects p JOIN organizations org ON org.id=p.organization_id AND org.status='active' WHERE ${where.join(' AND ')} ORDER BY p.id`,params);
 if(projectId&&!visible.length)invalid('Projeto não encontrado neste acesso.','stock_context_forbidden',403);
 const unit=unitId?await one(db,'SELECT id,name,acronym FROM organizational_units WHERE id=?',[unitId]):null;if(unitId&&!unit)invalid('Unidade não encontrada.','stock_context_unit_not_found',404);
 const scopedProjects=visible.map(row=>row.id as string);if(!scopedProjects.length)return {asOf,scope:{projectId,unitId,organizationId,from,to},unit,projects:[],movements:[],groups:[],items:[],truncated:false,notice:'Nenhum projeto autorizado neste recorte.'};
 const beneficiaryPermission=projectAuthoritySql(actor,['inventory.read','reports.read'],'beneficiary.id');
 const ids=scopedProjects.map(()=>'?').join(','),effective='COALESCE(c.occurred_at,m.created_at)',period=`date(${effective},'-3 hours') BETWEEN ? AND ?`,unitFilter=unitId?` AND (c.counterparty_unit_id=? OR EXISTS(SELECT 1 FROM projects beneficiary WHERE beneficiary.id=c.counterparty_project_id AND beneficiary.unit_id=? AND (${beneficiaryPermission.sql})))`:'',unitParams=unitId?[unitId,unitId,...beneficiaryPermission.values]:[];
 const rows=await all(db,`SELECT m.id,m.item_id,m.kind,m.delta,m.created_at,${effective} occurred_at,c.date_source,c.measurement_unit,c.material_name,i.unit current_unit,i.name current_name,p.id project_id,p.name project_name,c.counterparty_unit_id,c.counterparty_project_id FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id LEFT JOIN stock_movement_contexts c ON c.movement_id=m.id WHERE p.id IN(${ids}) AND ${period}${unitFilter} AND ${effectiveMovementSql('m')} ORDER BY ${effective} DESC,m.id DESC LIMIT 501`,[...scopedProjects,from,to,...unitParams]);
 const movementIds=rows.slice(0,500).map(row=>row.id as string),contexts=await movementContexts(db,actor,movementIds);
 const movements=rows.slice(0,500).map(row=>({id:row.id,itemId:row.item_id,projectId:row.project_id,projectName:row.project_name,material:row.material_name??row.current_name,measurementUnit:row.measurement_unit??row.current_unit,unitSource:row.measurement_unit?'recorded':'current-catalog',kind:row.kind,delta:row.delta,createdAt:row.created_at,occurredAt:row.occurred_at,context:contexts.get(row.id)??null}));
 // Aggregation is independent of the history display limit. Each item and recorded
 // unit keeps its own quantity; a recipient unit is not the project's owner unit.
 const counterpartPermission=projectAuthoritySql(actor,['inventory.read','reports.read'],'other.id');
 const groupSql=`WITH contexts AS(SELECT c.*,u.name unit_name,other.name project_name,CASE WHEN other.id IS NOT NULL THEN (${counterpartPermission.sql}) ELSE 0 END can_open FROM stock_movement_contexts c LEFT JOIN organizational_units u ON u.id=c.counterparty_unit_id LEFT JOIN projects other ON other.id=c.counterparty_project_id)
 SELECT i.id itemId,p.id projectId,p.name projectName,COALESCE(c.material_name,i.name) material,COALESCE(c.measurement_unit,i.unit) measurementUnit,
 c.counterparty_unit_id counterpartyUnitId,CASE WHEN c.can_open=1 THEN c.counterparty_project_id ELSE NULL END counterpartyProjectId,
 CASE WHEN c.counterparty_unit_id IS NOT NULL THEN 'unit' WHEN c.counterparty_project_id IS NOT NULL THEN 'project' ELSE NULL END counterpartyType,
 CASE WHEN c.counterparty_unit_id IS NOT NULL THEN c.unit_name WHEN c.can_open=1 THEN c.project_name ELSE NULL END counterpartyName,
 CASE WHEN c.counterparty_unit_id IS NOT NULL OR c.can_open=1 THEN 1 ELSE 0 END canOpen,
 m.kind,COUNT(*) movementCount,SUM(ABS(m.delta)) quantity,CASE WHEN c.movement_id IS NULL THEN 'not-recorded' ELSE 'recorded' END contextSource
 FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id LEFT JOIN contexts c ON c.movement_id=m.id WHERE p.id IN(${ids}) AND ${period}${unitFilter} AND ${effectiveMovementSql('m')}
 GROUP BY i.id,p.id,material,measurementUnit,counterpartyUnitId,CASE WHEN c.can_open=1 THEN c.counterparty_project_id ELSE NULL END,counterpartyType,counterpartyName,canOpen,m.kind,contextSource ORDER BY p.name,material,m.kind,counterpartyType,counterpartyName`;
 const groupParams=[...counterpartPermission.values,...scopedProjects,from,to,...unitParams],groupRows=await all(db,groupSql,groupParams);
 const groups=groupRows.map(row=>({...row,canOpen:Boolean(row.canOpen),href:row.canOpen?row.counterpartyType==='unit'?`/?module=materials&unitId=${encodeURIComponent(row.counterpartyUnitId)}`:`/?module=projects&project=${encodeURIComponent(row.counterpartyProjectId)}&detailProject=${encodeURIComponent(row.counterpartyProjectId)}`:null}));
 const endComplete=to<today?to:new Date(Date.parse(today)-DAY).toISOString().slice(0,10);
 const items=await all(db,`SELECT i.id itemId,i.project_id projectId,i.name material,i.unit measurementUnit,i.stock physical,i.reserved reserved,i.stock-i.reserved available,i.low_stock lowStock,
 (SELECT MIN(date(observed.occurred_at,'-3 hours')) FROM stock_movements first_move JOIN stock_movement_contexts observed ON observed.movement_id=first_move.id WHERE first_move.item_id=i.id AND observed.measurement_unit=i.unit) observedFrom
 FROM items i WHERE i.project_id IN(${ids}) AND i.category<>'equipment' AND i.condition='active' ORDER BY i.project_id,i.name,i.id`,scopedProjects);
 const outflows=await all(db,`SELECT m.item_id itemId,SUM(CASE WHEN c.measurement_unit=i.unit THEN -m.delta ELSE 0 END) quantity,COUNT(DISTINCT CASE WHEN c.measurement_unit=i.unit THEN date(${effective},'-3 hours') END) activeDays,MIN(date(${effective},'-3 hours')) firstDate,MAX(date(${effective},'-3 hours')) lastDate,SUM(CASE WHEN c.movement_id IS NULL THEN 1 ELSE 0 END) legacyRows,SUM(CASE WHEN c.movement_id IS NOT NULL AND c.measurement_unit<>i.unit THEN 1 ELSE 0 END) mismatchedRows FROM stock_movements m JOIN items i ON i.id=m.item_id LEFT JOIN stock_movement_contexts c ON c.movement_id=m.id WHERE i.project_id IN(${ids}) AND m.delta<0 AND m.kind IN('consume','distribute','redeem') AND ${effectiveMovementSql('m')} AND date(${effective},'-3 hours') BETWEEN ? AND ? GROUP BY m.item_id`,[...scopedProjects,from,endComplete]);
 const byItem=new Map(outflows.map(row=>[row.itemId,row]));
 const assignments=(await assignmentStatement(db,scopedProjects,actor).all<Row>()).results??[];
 const itemRows=items.map(item=>{const out=byItem.get(item.itemId),sampleFrom=item.observedFrom&&item.observedFrom>from?String(item.observedFrom):from,sampleDays=item.observedFrom?Math.max(0,Math.round((Date.parse(endComplete)-Date.parse(sampleFrom))/DAY)+1):0,enough=sampleDays>=7&&Number(out?.activeDays??0)>=3&&Number(out?.legacyRows??0)===0&&Number(out?.mismatchedRows??0)===0,rate=enough?Number(out!.quantity)/sampleDays:null,days=rate&&rate>0?Number(item.available)/rate:null;
  const responsible=assignments.filter(row=>row.projectId===item.projectId&&(!row.itemId||row.itemId===item.itemId)),assignees=[...new Map(responsible.map(row=>[`${row.userId?'person':'team'}:${row.userId??row.teamId}`,{kind:row.userId?'person':'team',id:row.userId??row.teamId,name:row.name}])).values()],low=Number(item.available)<=Number(item.lowStock);
  return {...item,low,attention:{active:low,assignedToMe:responsible.some(row=>Boolean(row.assignedToMe)),assignees,href:`/?module=materials&project=${encodeURIComponent(item.projectId)}&itemId=${encodeURIComponent(item.itemId)}`,delivery:'visual-only'},forecast:{available:enough,reason:enough?null:Number(out?.legacyRows??0)>0?'Há saídas sem unidade de medida registrada no histórico.':Number(out?.mismatchedRows??0)>0?'A unidade de medida mudou no período; confira o histórico antes de projetar.':'São necessários sete dias completos de histórico e saídas registradas em pelo menos três dias.',sampleFrom:item.observedFrom?sampleFrom:null,sampleTo:endComplete,sampleDays,activeDays:Number(out?.activeDays??0),outflowQuantity:Number(out?.quantity??0),dailyAverage:rate,daysRemaining:days,estimatedDepletion:days===null||days>36500?null:new Date(Date.parse(today)+Math.ceil(days)*DAY).toISOString().slice(0,10),scope:'all-project-outflows',method:'Saldo disponível atual ÷ média diária de consumo, distribuição e entrega de brindes no período medido desde a primeira movimentação com esta unidade de medida; não considera reposições futuras nem transferências; movimentações corrigidas contam pela versão atual e as desfeitas não contam.'}};});
 // Re-read the same authority after every asynchronous lookup; revocation or a
 // changed project filter suppresses the whole payload instead of partial labels.
 const fences=await db.batch([
  db.prepare(`SELECT p.id,p.name,p.unit_id,p.organization_id FROM projects p JOIN organizations org ON org.id=p.organization_id AND org.status='active' WHERE ${where.join(' AND ')} ORDER BY p.id`).bind(...params),
  assignmentStatement(db,scopedProjects,actor),contextStatement(db,actor,movementIds),db.prepare(groupSql).bind(...groupParams),
 ]),final=fences[0].results??[];
 if(JSON.stringify(final)!==JSON.stringify(visible))invalid('Seu acesso ou o contexto mudou durante a consulta. Atualize a página.','stock_context_forbidden',403);
 const finalAssignments=fences[1].results??[],finalContexts=projectContexts((fences[2].results??[]) as Row[]);
 if(JSON.stringify(finalAssignments)!==JSON.stringify(assignments)||JSON.stringify([...finalContexts])!==JSON.stringify([...contexts]))invalid('As permissões ou os responsáveis mudaram durante a consulta. Atualize a página.','stock_context_forbidden',403);
 if(JSON.stringify(fences[3].results??[])!==JSON.stringify(groupRows))invalid('As movimentações ou os vínculos mudaram durante a consulta. Atualize a página.','stock_context_changed',409);
 return {asOf,scope:{projectId,unitId,organizationId,from,to},unit,projects:visible,movements,groups,items:itemRows,truncated:rows.length>500,notice:'Somente projetos autorizados. Unidade indica a origem ou o destino informado na movimentação. Histórico antigo sem contraparte fica sem classificação; previsão usa todas as saídas do estoque do projeto, mesmo ao filtrar uma unidade. Alertas de saldo são visuais; não há envio automático de e-mail.'};
}
