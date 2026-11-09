import type {PortalActor} from '../access';
import {one,iso,uid,type Row} from '../database';
import {HttpError} from '../errors';
import {prepareMutation} from '../mutations';
import {isRateLimitedError,rateLimitedError} from '../rate-limit';
import {id,text,integer,choices,onlyKeys} from '../follow-up/contracts';
import {actorRequired,authority} from '../follow-up/scope';
import {PLANNING_ACTIONS,PLANNING_LIMITS,SESSION_STATUSES,isCivilDate,isLocalTime,sessionTimeProblem,type PlanningActionResult,type PlanningHost,type PlanningSession,type PlanningWorkspace,type SessionStatus} from './contracts';

/*
 * Access model (no inheritance):
 * - read: any current role on the campaign's PRIMARY project (campaigns.project_id). A user who
 *   only reaches a host project gets 403 and no campaign metadata.
 * - hosts are listed only when the viewer can also read that host project right now; hidden
 *   hosts are filtered inside SQL, so neither ids, names nor counts reach the DTO.
 * - session mutations: campaigns.manage (owner/manager) on the primary project.
 * - host link/unlink: campaigns.manage on primary AND host, same organization.
 * All checks are live SQL over members/portal_users/projects/organizations (authority()), never
 * the actor snapshot, and are repeated inside the write transaction and after commit.
 */
function fail(message:string,code='planning_invalid',status=400):never{throw new HttpError(status,message,code);}
const FORBIDDEN='Você não tem acesso ao planejamento desta ação ou seu acesso mudou.';

/** Server-owned SQL. Placeholders, in order: campaignId, projectId, userId[, hostProjectId, userId]. */
function manageExists(host:boolean){
 return `EXISTS(SELECT 1 FROM campaigns guard_c JOIN projects guard_p ON guard_p.id=guard_c.project_id JOIN organizations guard_o ON guard_o.id=guard_p.organization_id
 WHERE guard_c.id=? AND guard_c.project_id=? AND guard_o.status='active' AND guard_p.status='active' AND ${authority('?','guard_p.organization_id','guard_c.project_id',true,true)}${host?`
 AND EXISTS(SELECT 1 FROM projects guard_h WHERE guard_h.id=? AND guard_h.organization_id=guard_p.organization_id AND guard_h.id!=guard_c.project_id AND ${authority('?','guard_p.organization_id','guard_h.id',true,true)})`:''})`;
}
function guardValues(userId:string,campaignId:string,projectId:string,hostProjectId:string|null){return hostProjectId?[campaignId,projectId,userId,hostProjectId,userId]:[campaignId,projectId,userId];}
/** Live authority fence that also reports the header version in the same statement. */
async function fence(db:D1Database,userId:string,campaignId:string,projectId:string,hostProjectId:string|null):Promise<number>{
 const row=await one(db,`SELECT COALESCE((SELECT version FROM campaign_planning WHERE campaign_id=?),0) version WHERE ${manageExists(!!hostProjectId)}`,[campaignId,...guardValues(userId,campaignId,projectId,hostProjectId)]);
 if(!row)fail('Seu acesso mudou. Atualize a página antes de continuar.','planning_access_changed',403);
 return Number(row.version);
}

const READ_SQL=`WITH planning_caller AS(SELECT ? user_id,? campaign_id),
 base AS(SELECT c.id,c.project_id,c.name,c.status,p.organization_id org_id,p.name project_name,p.status project_status FROM planning_caller JOIN campaigns c ON c.id=planning_caller.campaign_id
  JOIN projects p ON p.id=c.project_id JOIN organizations o ON o.id=p.organization_id
  WHERE o.status='active' AND ${authority('planning_caller.user_id','p.organization_id','c.project_id')}),
 management AS(SELECT (base.project_status='active' AND ${authority('planning_caller.user_id','base.org_id','base.project_id',true,true)}) can_manage FROM planning_caller JOIN base),
 visible_hosts AS(SELECT h.host_project_id,hp.name,hp.status,h.created_at,(management.can_manage=1 AND ${authority('planning_caller.user_id','base.org_id','h.host_project_id',true,true)}) can_manage
  FROM planning_caller JOIN base JOIN management JOIN campaign_host_contexts h ON h.campaign_id=base.id JOIN projects hp ON hp.id=h.host_project_id AND hp.organization_id=base.org_id
  WHERE h.revoked_at IS NULL AND hp.id!=base.project_id AND ${authority('planning_caller.user_id','base.org_id','h.host_project_id')} ORDER BY hp.name,h.host_project_id LIMIT ${PLANNING_LIMITS.hosts+1}),
 visible_sessions AS(SELECT s.id,s.session_date,s.ordinal,s.label,s.starts_at,s.ends_at,s.status,s.note,s.version FROM base JOIN campaign_sessions s ON s.campaign_id=base.id ORDER BY s.session_date,s.ordinal,s.id LIMIT ${PLANNING_LIMITS.sessions+1})
 SELECT base.id,base.project_id,base.name,base.status,base.project_name,management.can_manage,
 COALESCE((SELECT version FROM campaign_planning WHERE campaign_id=base.id),0) version,
 (SELECT json_group_array(json_object('id',host_project_id,'name',name,'status',status,'linked_at',created_at,'can_manage',can_manage)) FROM visible_hosts) hosts,
 (SELECT json_group_array(json_object('id',id,'session_date',session_date,'ordinal',ordinal,'label',label,'starts_at',starts_at,'ends_at',ends_at,'status',status,'note',note,'version',version)) FROM visible_sessions) sessions
 FROM base JOIN management`;

/** GET performs no writes. Two identical reads are required; the second is the final fence. */
export async function planningWorkspace(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>={}):Promise<PlanningWorkspace>{
 actorRequired(actor);onlyKeys(input,['campaignId','projectId']);
 const campaignId=id(input.campaignId)!,projectId=id(input.projectId,true);
 const read=async()=>{
  const row=await one(db,READ_SQL,[actor.userId,campaignId]);
  if(!row)fail(FORBIDDEN,'planning_forbidden',403);
  if(projectId!==null&&row.project_id!==projectId)fail('Esta ação pertence a outro projeto principal. Abra o planejamento pelo projeto responsável.','planning_scope_mismatch',409);
  const hosts=JSON.parse(row.hosts) as Row[],sessions=JSON.parse(row.sessions) as Row[];
  if(hosts.length>PLANNING_LIMITS.hosts||sessions.length>PLANNING_LIMITS.sessions)fail('O planejamento excede o limite de consulta. Peça uma revisão aos responsáveis.','planning_limit',409);
  return{
   primaryProjectId:row.project_id as string,campaign:{name:row.name,status:row.status,primaryProjectName:row.project_name},canManage:Boolean(row.can_manage),version:Number(row.version),
   hosts:hosts.map((h):PlanningHost=>({projectId:h.id,projectName:h.name,projectStatus:h.status,linkedAt:h.linked_at,canManage:Boolean(h.can_manage)})).sort((a,b)=>a.projectName.localeCompare(b.projectName,'pt-BR')||(a.projectId<b.projectId?-1:1)),
   sessions:sessions.map((s):PlanningSession=>({id:s.id,sessionDate:s.session_date,ordinal:s.ordinal,label:s.label,startsAt:s.starts_at,endsAt:s.ends_at,status:s.status,note:s.note,version:s.version})).sort((a,b)=>a.sessionDate<b.sessionDate?-1:a.sessionDate>b.sessionDate?1:a.ordinal-b.ordinal||(a.id<b.id?-1:1)),
  };
 };
 const first=await read(),last=await read();
 if(JSON.stringify(first)!==JSON.stringify(last)){
  // Authorization-visible changes keep the stricter error; content edits are a conflict.
  // No further await happens after the final snapshot.
  const visibility=(value:typeof first)=>JSON.stringify({canManage:value.canManage,hosts:value.hosts.map(h=>[h.projectId,h.canManage])});
  if(visibility(first)!==visibility(last))fail('Seu acesso ou os projetos anfitriões visíveis mudaram. Atualize a página.','planning_access_changed',403);
  fail('O planejamento mudou durante a consulta. Atualize para conferir a nova versão.','planning_changed',409);
 }
 return{viewerId:actor.userId,campaignId,...last,asOf:iso()};
}

function headerVersion(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)fail('Atualize o planejamento antes de salvar.','planning_version');return value;}
function rowVersion(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)fail('Atualize a sessão antes de salvar.','planning_version');return value;}
function localTime(value:unknown):string|null{if(value===undefined||value===null||value==='')return null;if(!isLocalTime(value))fail('Use horários no formato HH:MM.','planning_session_times');return value;}
function sessionInput(input:Record<string,unknown>){
 if(!isCivilDate(input.sessionDate))fail('Informe uma data válida (AAAA-MM-DD).','planning_session_date');
 const ordinal=integer(input.ordinal,PLANNING_LIMITS.ordinalMax);if(ordinal<PLANNING_LIMITS.ordinalMin)fail('A ordem da sessão no dia vai de 1 a 10.');
 const status=choices(input.status??'tentative',SESSION_STATUSES),startsAt=localTime(input.startsAt),endsAt=localTime(input.endsAt);
 const problem=sessionTimeProblem(status,startsAt,endsAt);if(problem)fail(problem,'planning_session_times');
 return{sessionDate:input.sessionDate as string,ordinal,label:text(input.label??'',PLANNING_LIMITS.label,true),startsAt,endsAt,status,note:text(input.note??'',PLANNING_LIMITS.note,true)};
}
function translate(error:unknown):never{
 const cause=String(error);
 if(cause.includes('planning_authority_changed')||cause.includes('followup_authority_changed'))fail('Seu acesso mudou. Atualize a página.','planning_access_changed',403);
 if(cause.includes('planning_version_changed'))fail('Outra pessoa atualizou o planejamento. Reabra a edição.','planning_conflict',409);
 if(cause.includes('planning_session_version'))fail('Esta sessão foi alterada por outra pessoa. Reabra a edição.','planning_session_conflict',409);
 if(cause.includes('planning_no_change'))fail('Não há alteração a aplicar. Atualize e confira o estado atual.','planning_unchanged',409);
 if(/UNIQUE constraint failed: campaign_sessions/.test(cause))fail('Já existe uma sessão nesta data com essa ordem.','planning_slot_taken',409);
 if(/planning_host_(invalid|limit)/.test(cause))fail('O projeto anfitrião precisa ser outro projeto ativo da mesma organização, dentro do limite de 20 anfitriões.','planning_host_invalid',409);
 if(cause.includes('planning_session_limit'))fail('A ação atingiu o limite de 200 sessões planejadas.','planning_limit',409);
 if(cause.includes('CHECK constraint failed'))fail('Os dados não passaram na conferência de integridade. Atualize e revise os campos.','planning_invalid',409);
 if(/planning_(owner|identity)_immutable|planning_version_step|FOREIGN KEY constraint failed/.test(cause))fail('A ação ou um projeto vinculado mudou. Atualize o planejamento.','planning_relationship',409);
 throw error;
}

/**
 * Mutations. Idempotency keys are scoped per actor + action + campaign.
 * `rateCount` (from rateLimitStatements) enters the same write batch: an allowed action costs one commit,
 * and a replay or refused attempt writes nothing.
 */
export async function planningAction(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>,rateCount:D1PreparedStatement[]=[]):Promise<PlanningActionResult>{
 actorRequired(actor);if(!input||typeof input!=='object'||Array.isArray(input))fail('Dados inválidos.');
 const action=choices(input.action,PLANNING_ACTIONS);
 onlyKeys(input,['action','campaignId','projectId','expectedVersion','operationKey',...(action==='host.link'?['hostProjectId','linked']:action==='session.save'?['id','expectedSessionVersion','sessionDate','ordinal','label','startsAt','endsAt','status','note']:['id','expectedSessionVersion','status'])]);
 const campaignId=id(input.campaignId)!,projectId=id(input.projectId)!,revision=headerVersion(input.expectedVersion);
 // Every payload field is validated before any database access.
 const hostProjectId=action==='host.link'?id(input.hostProjectId)!:null;
 if(action==='host.link'&&typeof input.linked!=='boolean')fail('Escolha vincular ou desvincular o projeto anfitrião.');
 if(hostProjectId!==null&&hostProjectId===projectId)fail('O projeto anfitrião deve ser diferente do projeto responsável.','planning_host_invalid');
 const sessionId=action==='session.save'?id(input.id,true):action==='session.status'?id(input.id)!:null;
 const isUpdate=sessionId!==null;
 if(action!=='host.link'&&!isUpdate&&input.expectedSessionVersion!==undefined)fail('Uma nova sessão não tem versão anterior.');
 const expectedRow=isUpdate?rowVersion(input.expectedSessionVersion):null;
 if(action==='session.save'&&isUpdate&&['label','startsAt','endsAt','status','note'].some(key=>input[key]===undefined))fail('Ao editar, envie todos os campos da sessão para preservar seus dados.','planning_session_fields');
 const values=action==='session.save'?sessionInput(input):null,nextStatus:SessionStatus|null=action==='session.status'?choices(input.status,SESSION_STATUSES):null;

 // Primary (and host) authority, organization and the explicit owner project, from live SQL.
 const target=await one(db,`SELECT c.project_id,p.organization_id org_id${hostProjectId?`,EXISTS(SELECT 1 FROM projects hp WHERE hp.id=? AND hp.organization_id=p.organization_id AND hp.id!=c.project_id AND ${authority('?','p.organization_id','hp.id',true,true)}) host_ok`:''}
  FROM campaigns c JOIN projects p ON p.id=c.project_id JOIN organizations o ON o.id=p.organization_id WHERE c.id=? AND o.status='active' AND p.status='active' AND ${authority('?','p.organization_id','c.project_id',true,true)}`,
  [...(hostProjectId?[hostProjectId,actor.userId]:[]),campaignId,actor.userId]);
 if(!target)fail(FORBIDDEN,'planning_forbidden',403);
 if(target.project_id!==projectId)fail('Esta ação pertence a outro projeto principal. Atualize o planejamento.','planning_scope_mismatch',409);
 if(hostProjectId&&!target.host_ok)fail('Você precisa gerenciar campanhas no projeto anfitrião, da mesma organização.','planning_host_forbidden',403);

 const mutation=await prepareMutation(db,actor.userId,`campaign_planning.${action}:${campaignId}`,input);
 if(mutation.existingId){const version=await fence(db,actor.userId,campaignId,projectId,hostProjectId);return{viewerId:actor.userId,campaignId,entityId:mutation.existingId,version,duplicate:true};}

 let stored:Row|null=null;
 if(isUpdate){
  stored=await one(db,'SELECT version,session_date,ordinal,label,starts_at,ends_at,status,note FROM campaign_sessions WHERE id=? AND campaign_id=?',[sessionId,campaignId]);
  if(!stored)fail('Sessão não encontrada nesta ação.','planning_session_not_found',404);
  if(nextStatus){const problem=sessionTimeProblem(nextStatus,stored.starts_at,stored.ends_at);if(problem)fail(problem,'planning_session_times',409);}
 }
 const at=iso(),entityId=hostProjectId??sessionId??uid(),changes:D1PreparedStatement[]=[];
 const rowCas=()=>db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM campaign_sessions WHERE id=? AND campaign_id=? AND version=?) THEN 1 ELSE json_extract('[]','planning_session_version') END").bind(entityId,campaignId,expectedRow);
 let details:Record<string,unknown>;
 if(action==='host.link'){
  details={hostProjectId,linked:input.linked};
  changes.push(input.linked
   ?db.prepare('INSERT INTO campaign_host_contexts(campaign_id,host_project_id,created_at,created_by) VALUES(?,?,?,?) ON CONFLICT(campaign_id,host_project_id) DO UPDATE SET created_at=excluded.created_at,created_by=excluded.created_by,revoked_at=NULL WHERE campaign_host_contexts.revoked_at IS NOT NULL').bind(campaignId,hostProjectId,at,actor.userId)
   :db.prepare('UPDATE campaign_host_contexts SET revoked_at=? WHERE campaign_id=? AND host_project_id=? AND revoked_at IS NULL').bind(at,campaignId,hostProjectId));
 }else if(action==='session.save'&&!isUpdate){
  const v=values!;details={sessionId:entityId,created:true,status:v.status,sessionVersion:1};
  changes.push(db.prepare('INSERT INTO campaign_sessions(id,campaign_id,session_date,ordinal,label,starts_at,ends_at,status,note,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)').bind(entityId,campaignId,v.sessionDate,v.ordinal,v.label,v.startsAt,v.endsAt,v.status,v.note,at,at));
 }else if(action==='session.save'){
  const v=values!;details={sessionId:entityId,created:false,status:v.status,sessionVersion:expectedRow!+1};
  changes.push(rowCas(),
   db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM campaign_sessions WHERE id=? AND (session_date IS NOT ? OR ordinal IS NOT ? OR label IS NOT ? OR starts_at IS NOT ? OR ends_at IS NOT ? OR status IS NOT ? OR note IS NOT ?)) THEN 1 ELSE json_extract('[]','planning_no_change') END").bind(entityId,v.sessionDate,v.ordinal,v.label,v.startsAt,v.endsAt,v.status,v.note),
   db.prepare('UPDATE campaign_sessions SET session_date=?,ordinal=?,label=?,starts_at=?,ends_at=?,status=?,note=?,version=version+1,updated_at=? WHERE id=? AND campaign_id=? AND version=?').bind(v.sessionDate,v.ordinal,v.label,v.startsAt,v.endsAt,v.status,v.note,at,entityId,campaignId,expectedRow));
 }else{
  details={sessionId:entityId,status:nextStatus,sessionVersion:expectedRow!+1};
  changes.push(rowCas(),
   db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM campaign_sessions WHERE id=? AND status IS NOT ?) THEN 1 ELSE json_extract('[]','planning_no_change') END").bind(entityId,nextStatus),
   db.prepare('UPDATE campaign_sessions SET status=?,version=version+1,updated_at=? WHERE id=? AND campaign_id=? AND version=?').bind(nextStatus,at,entityId,campaignId,expectedRow));
 }
 if(action!=='host.link'){
  const before=stored?{sessionDate:stored.session_date,ordinal:stored.ordinal,label:stored.label,startsAt:stored.starts_at,endsAt:stored.ends_at,status:stored.status,note:stored.note}:null;
  const after=values?{...values}:{...before,status:nextStatus};
  details={...details,before,after};
 }
 // The header version moves exactly once, and only when the last domain statement changed a row
 // (an already-active link or an already-revoked unlink is an idempotent success: no version, no audit).
 const statements=[
  ...rateCount,
  db.prepare(`SELECT CASE WHEN ${manageExists(!!hostProjectId)} THEN 1 ELSE json_extract('[]','planning_authority_changed') END`).bind(...guardValues(actor.userId,campaignId,projectId,hostProjectId)),
  ...(action==='host.link'&&!input.linked?[db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM campaign_planning WHERE campaign_id=?) THEN 1 ELSE json_extract('[]','planning_no_change') END").bind(campaignId)]:[]),
  db.prepare('INSERT OR IGNORE INTO campaign_planning(campaign_id,version,created_at,updated_at) VALUES(?,0,?,?)').bind(campaignId,at,at),
  db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM campaign_planning WHERE campaign_id=? AND version=?) THEN 1 ELSE json_extract('[]','planning_version_changed') END").bind(campaignId,revision),
  mutation.claimStatement(entityId),...changes,
  db.prepare('UPDATE campaign_planning SET version=version+1,updated_at=? WHERE campaign_id=? AND changes()>0').bind(at,campaignId),
  db.prepare('INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0').bind(uid(),actor.userId,projectId,target.org_id,`campaign_planning.${action}`,hostProjectId?campaignId:entityId,JSON.stringify({version:revision+1,kind:action,campaignId,...details}),at),
 ];
 let applied=true;
 try{const results=await db.batch(statements);applied=Number(results[statements.length-2].meta?.changes??0)>0;}
 catch(error){
  if(isRateLimitedError(error))rateLimitedError();
  let recovered:string;try{recovered=await mutation.recover(error);}catch(cause){translate(cause);}
  const version=await fence(db,actor.userId,campaignId,projectId,hostProjectId);return{viewerId:actor.userId,campaignId,entityId:recovered,version,duplicate:true};
 }
 // Post-commit live fence: a receipt is not disclosed to an actor who lost authority meanwhile.
 await fence(db,actor.userId,campaignId,projectId,hostProjectId);
 return{viewerId:actor.userId,campaignId,entityId,version:revision+(applied?1:0),duplicate:false,...(action!=='host.link'&&applied?{sessionVersion:isUpdate?expectedRow!+1:1}:{})};
}
