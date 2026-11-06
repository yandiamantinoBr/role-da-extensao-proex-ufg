import type {PortalActor} from '../access';
import {one,iso,uid,type Row} from '../database';
import {HttpError} from '../errors';
import {prepareMutation} from '../mutations';
import {id,text,version,choices,onlyKeys} from '../follow-up/contracts';
import {authority,scopeStatement} from '../follow-up/scope';
import {PROEX_TEAM,PROEX_TEAM_SOURCE} from '../catalog/proex-team';
import {DIRECTORY_STATES,type DirectoryPerson,type DirectoryWorkspace,type DirectoryDetail} from './contracts';

function fail(message:string,code='directory_invalid',status=400):never{throw new HttpError(status,message,code);}
function actorRequired(actor:PortalActor|null):asserts actor is PortalActor{if(!actor)fail('Entre com sua conta para consultar os pré-cadastros.','unauthenticated',401);}
function projection(row:Row):DirectoryPerson{return{id:row.id,name:row.name,position:row.position,sector:row.sector,contact:row.contact,contactStatus:row.contact_status,status:row.status,version:row.version,sourceKind:row.source_kind,referenceId:row.reference_id,sourceUrl:row.source_url,sourceUpdatedOn:row.source_updated_on,checkedOn:row.checked_on,adapted:Boolean(row.adapted),createdAt:row.created_at,updatedAt:row.updated_at};}
async function requireAdmin(db:D1Database,actor:PortalActor,organizationId:string){
 if(!await one(db,`SELECT 1 FROM organizations org WHERE org.id=? AND org.status='active' AND ${authority('?','org.id','NULL',true)}`,[organizationId,actor.userId]))fail('Somente a administração desta organização pode consultar e preparar pré-cadastros.','directory_forbidden',403);
}
/** All directory fields and history are private to current organization administrators. */
async function snapshot(db:D1Database,actor:PortalActor,organizationId:string,personId:string|null){
 const read=()=>one(db,`WITH caller AS(SELECT ? user_id,? organization_id), visible AS(
 SELECT person.* FROM directory_people person JOIN caller WHERE person.organization_id=caller.organization_id AND (? IS NULL OR person.id=?) ORDER BY person.name,person.id LIMIT 501)
 SELECT org.name organization_name,(SELECT json_group_array(json_object('id',id,'name',name,'position',position,'sector',sector,'contact',contact,'contact_status',contact_status,'status',status,'version',version,'source_kind',source_kind,'reference_id',reference_id,'source_url',source_url,'source_updated_on',source_updated_on,'checked_on',checked_on,'adapted',adapted,'created_at',created_at,'updated_at',updated_at)) FROM visible) people,
 (SELECT json_group_array(json_object('version',version,'snapshot',snapshot_json,'created_at',created_at)) FROM(SELECT h.version,h.snapshot_json,h.created_at FROM directory_people_history h JOIN visible p ON p.id=h.person_id WHERE p.id=? ORDER BY h.version DESC LIMIT 51)) history
 FROM caller JOIN organizations org ON org.id=caller.organization_id WHERE org.status='active' AND ${authority('caller.user_id','org.id','NULL',true)}`,[actor.userId,organizationId,personId,personId,personId]);
 const first=await read(),last=await read();
 if(!first||!last)fail('Seu acesso ao diretório mudou. Atualize a página.','directory_forbidden',403);
 if(JSON.stringify(first)!==JSON.stringify(last))fail('Os pré-cadastros mudaram durante a consulta. Atualize para conferir.','directory_changed',409);
 const people=JSON.parse(last.people) as Row[],history=JSON.parse(last.history) as Row[];
 if(people.length>500)fail('Este diretório excede o limite de consulta. Peça uma revisão.','directory_limit',409);
 return{organizationName:last.organization_name as string,people:people.map(projection),history};
}
export async function directoryWorkspace(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>={}):Promise<DirectoryWorkspace>{
 actorRequired(actor);onlyKeys(input,['organizationId']);const organizationId=id(input.organizationId)!;await requireAdmin(db,actor,organizationId);const result=await snapshot(db,actor,organizationId,null);
 return{viewerId:actor.userId,scope:{organizationId,organizationName:result.organizationName},people:result.people,asOf:iso()};
}
export async function directoryDetail(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>):Promise<DirectoryDetail>{
 actorRequired(actor);onlyKeys(input,['organizationId','personId']);const organizationId=id(input.organizationId)!,personId=id(input.personId)!;await requireAdmin(db,actor,organizationId);const result=await snapshot(db,actor,organizationId,personId),person=result.people[0];
 if(!person)fail('Pré-cadastro não encontrado nesta organização.','directory_not_found',404);
 return{viewerId:actor.userId,organizationId,person,history:result.history.slice(0,50).map(row=>({version:row.version,at:row.created_at,person:projection(JSON.parse(row.snapshot))})),historyHasMore:result.history.length>50};
}
function contact(value:unknown){const result=text(value??'',254,true);if(result&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result))fail('Confira o e-mail de contato ou deixe o campo vazio.');return result;}
function translate(error:unknown):never{const message=String(error);if(message.includes('followup_authority_changed'))fail('Seu acesso à organização mudou.','directory_forbidden',403);if(message.includes('directory_version_changed'))fail('Outra pessoa editou este pré-cadastro. Reabra antes de salvar.','directory_conflict',409);if(message.includes('directory_limit'))fail('A organização atingiu o limite de pré-cadastros.','directory_limit',409);if(message.includes('directory_official_reference_idx')||message.includes('directory_people.organization_id, directory_people.reference_id'))fail('Esta referência já foi preparada. Consulte o cadastro existente, inclusive os arquivados.','directory_exists',409);throw error;}
export async function directoryAction(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>){
 actorRequired(actor);const action=choices(input.action,['person.create','official.prepare','person.update'] as const),organizationId=id(input.organizationId)!;
 await requireAdmin(db,actor,organizationId);const scope={organizationId,projectId:null};
 const base=['action','organizationId','operationKey'];onlyKeys(input,[...base,...(action==='official.prepare'?['referenceId']:action==='person.create'?['name','position','sector','contact','status']:['personId','expectedVersion','name','position','sector','contact','status'])]);
 const mutation=await prepareMutation(db,actor.userId,`directory.${action}`,input);
 if(mutation.existingId)return{...await directoryDetail(db,actor,{organizationId,personId:mutation.existingId}),duplicate:true};
 const at=iso(),today=at.slice(0,10);let row:Row,expected=0;
 if(action==='person.update'){
  const personId=id(input.personId)!;expected=version(input.expectedVersion);const existing=await one(db,'SELECT * FROM directory_people WHERE id=? AND organization_id=?',[personId,organizationId]);
  if(!existing)fail('Pré-cadastro não encontrado nesta organização.','directory_not_found',404);
  const suppliedContact=text(input.contact??'',254,true),nextContact=suppliedContact===existing.contact?suppliedContact:contact(suppliedContact),state=choices(input.status,DIRECTORY_STATES);
  row={...existing,name:text(input.name,160),position:text(input.position??'',160,true),sector:text(input.sector??'',160,true),contact:nextContact,status:state,contact_status:nextContact!==existing.contact?'entered':existing.contact_status,version:expected+1,updated_at:at};
  if(row.contact_status==='review'&&state==='pending')fail('Confira o contato antes de retirar a indicação de revisão.','directory_review');
  row.adapted=existing.adapted||['name','position','sector','contact'].some(key=>row[key]!==existing[key])?1:0;
 }else if(action==='official.prepare'){
  const entry=PROEX_TEAM.find(person=>person.id===id(input.referenceId));if(!entry)fail('Referência oficial não encontrada.','directory_reference',404);
  row={id:uid(),organization_id:organizationId,name:entry.name,position:entry.position??'',sector:entry.sector,contact:entry.email,contact_status:entry.contactStatus==='needs-review'?'review':'published',status:entry.contactStatus==='needs-review'?'review':'pending',source_kind:'official',reference_id:entry.id,source_url:PROEX_TEAM_SOURCE.url,source_updated_on:PROEX_TEAM_SOURCE.publishedUpdate,checked_on:PROEX_TEAM_SOURCE.verifiedAt,adapted:0,version:1,created_by:actor.userId,created_at:at,updated_at:at};
 }else{
  row={id:uid(),organization_id:organizationId,name:text(input.name,160),position:text(input.position??'',160,true),sector:text(input.sector??'',160,true),contact:contact(input.contact),contact_status:'entered',status:choices(input.status??'pending',DIRECTORY_STATES),source_kind:'manual',reference_id:null,source_url:null,source_updated_on:null,checked_on:today,adapted:0,version:1,created_by:actor.userId,created_at:at,updated_at:at};
 }
 const columns=['id','organization_id','name','position','sector','contact','contact_status','status','source_kind','reference_id','source_url','source_updated_on','checked_on','adapted','version','created_by','created_at','updated_at'];
 const cas=action==='person.update'?[db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM directory_people WHERE id=? AND organization_id=? AND version=?) THEN 1 ELSE json_extract('[]','directory_version_changed') END").bind(row.id,organizationId,expected)]:[];
 const write=action==='person.update'?db.prepare('UPDATE directory_people SET name=?,position=?,sector=?,contact=?,contact_status=?,status=?,adapted=?,version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=?').bind(row.name,row.position,row.sector,row.contact,row.contact_status,row.status,row.adapted,at,row.id,organizationId,expected):db.prepare(`INSERT INTO directory_people(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...columns.map(key=>row[key]));
 const statements=[scopeStatement(db,actor,scope,true),...cas,mutation.claimStatement(row.id),write,
  db.prepare('INSERT INTO directory_people_history(id,person_id,version,snapshot_json,actor_id,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),row.id,row.version,JSON.stringify(row),actor.userId,at),
  db.prepare('INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(uid(),actor.userId,organizationId,`directory.${action}`,row.id,JSON.stringify({version:row.version,status:row.status,sourceKind:row.source_kind}),at)];
 try{await db.batch(statements);}catch(error){try{const recovered=await mutation.recover(error);return{...await directoryDetail(db,actor,{organizationId,personId:recovered}),duplicate:true};}catch(recovered){translate(recovered);}}
 return{...await directoryDetail(db,actor,{organizationId,personId:row.id}),duplicate:false};
}
