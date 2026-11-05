import type {PortalActor} from '../access';
import {one,iso,uid,type Row} from '../database';
import {HttpError} from '../errors';
import {prepareMutation} from '../mutations';
import {id,text,date,integer,choices,onlyKeys} from '../follow-up/contracts';
import {actorRequired,authority,requireScope,scopeStatement,type Scope} from '../follow-up/scope';
import {NODE_KINDS,RELATIONS,OFFICIAL_SOURCE,OFFICIAL_TEMPLATE,type StructureNode,type StructureWorkspace,type TemplateNode} from './contracts';
function fail(message:string,code='structure_invalid',status=400):never{throw new HttpError(status,message,code);}

async function activeScope(db:D1Database,actor:PortalActor,scope:Scope,write=false){
 await requireScope(db,actor,scope,write);
 if(!await one(db,"SELECT 1 FROM organizations WHERE id=? AND status='active'",[scope.organizationId]))fail('A organização não está ativa.','structure_forbidden',403);
}
function nodeProjection(row:Row):StructureNode{return{id:row.id,parentId:row.parent_id,name:row.name,acronym:row.acronym,kind:row.kind,relation:row.relation,position:row.position,status:row.status};}
export async function structureWorkspace(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>={}):Promise<StructureWorkspace>{
 actorRequired(actor);onlyKeys(input,['organizationId','projectId','includeArchived']);
 const organizationId=id(input.organizationId)!,projectId=id(input.projectId,true),includeArchived=input.includeArchived??false;
 if(typeof includeArchived!=='boolean')fail('Escolha uma consulta válida.');
 const scope={organizationId,projectId};await activeScope(db,actor,scope);
 const read=async()=>{
  // ACL, source, names, tree and visible affiliations share one SQLite statement.
  // The second read is also the final asynchronous fence before returning.
  const result=await one(db,`WITH caller AS(SELECT ? user_id,? project_id,? organization_id),
   management AS(SELECT ${authority('caller.user_id','caller.organization_id','NULL',true)} can_manage FROM caller),
   visible_nodes AS(SELECT n.* FROM institutional_nodes n JOIN caller JOIN management WHERE n.organization_id=caller.organization_id AND(n.status='active' OR ?=1 AND management.can_manage=1) ORDER BY n.position,n.name,n.id LIMIT 201),
   visible_teams AS(SELECT team.id,team.name,team.status FROM followup_teams team JOIN caller JOIN management
   WHERE team.organization_id=caller.organization_id AND(team.status='active' OR management.can_manage=1) AND ${authority('caller.user_id','team.organization_id','caller.project_id')}
   AND(management.can_manage=1 OR EXISTS(SELECT 1 FROM followup_team_members mine WHERE mine.team_id=team.id AND mine.user_id=caller.user_id AND mine.removed_at IS NULL)
   OR EXISTS(SELECT 1 FROM followup_assignees a JOIN followup_tasks t ON t.id=a.task_id WHERE a.team_id=team.id AND a.removed_at IS NULL AND t.organization_id=team.organization_id AND(caller.project_id IS NULL OR t.project_id=caller.project_id) AND ${authority('caller.user_id','t.organization_id','t.project_id')}))
   ORDER BY team.name,team.id LIMIT 501)
   SELECT o.name organization_name,COALESCE(p.name,'Organização') project_name,management.can_manage,
   (SELECT json_object('version',version,'source_label',source_label,'source_revision',source_revision,'source_issued_on',source_issued_on,'source_url',source_url,'adapted',adapted) FROM institutional_structures WHERE organization_id=caller.organization_id) header,
   (SELECT json_group_array(json_object('id',id,'parent_id',parent_id,'name',name,'acronym',acronym,'kind',kind,'relation',relation,'position',position,'status',status)) FROM visible_nodes) nodes,
   (SELECT json_group_array(json_object('id',id,'name',name,'status',status)) FROM visible_teams) teams,
   (SELECT json_group_array(json_object('node_id',node_id,'team_id',team_id)) FROM(SELECT l.node_id,l.team_id FROM institutional_team_links l JOIN visible_nodes n ON n.id=l.node_id JOIN visible_teams t ON t.id=l.team_id WHERE l.organization_id=caller.organization_id AND l.revoked_at IS NULL ORDER BY l.node_id,l.team_id LIMIT 501)) links
   FROM caller JOIN management JOIN organizations o ON o.id=caller.organization_id LEFT JOIN projects p ON p.id=caller.project_id AND p.organization_id=o.id
   WHERE o.status='active' AND(caller.project_id IS NULL OR p.id IS NOT NULL) AND(?=0 OR management.can_manage=1) AND ${authority('caller.user_id','caller.organization_id','caller.project_id')}`,[actor.userId,projectId,organizationId,includeArchived?1:0,includeArchived?1:0]);
  if(!result)fail('Seu acesso à estrutura ou a este recorte mudou.','structure_forbidden',403);
  const header=result.header?JSON.parse(result.header) as Row:null,nodes=JSON.parse(result.nodes) as Row[],teams=JSON.parse(result.teams) as Row[],links=JSON.parse(result.links) as Row[];
  if(nodes.length>200||teams.length>500||links.length>500)fail('Este conjunto excede o limite de consulta. Peça uma revisão aos responsáveis.','structure_limit',409);
  return{organizationName:result.organization_name as string,projectName:result.project_name as string,canManage:Boolean(result.can_manage),header,nodes,teams,links};
 };
 const first=await read(),last=await read();
 if(JSON.stringify(first)!==JSON.stringify(last))fail('A estrutura ou seus vínculos mudaram durante a consulta. Atualize o recorte.','structure_access_changed',403);
 const h=last.header;
 return{viewerId:actor.userId,scope:{organizationId,organizationName:last.organizationName,projectId,projectName:last.projectName,canManage:last.canManage},version:h?.version??0,
  source:h?.source_label?{label:h.source_label,revision:h.source_revision,issuedOn:h.source_issued_on,referenceUrl:h.source_url,adapted:Boolean(h.adapted)}:null,
  nodes:last.nodes.map(nodeProjection),teams:last.teams.map(t=>({id:t.id,name:t.name,status:t.status})),links:last.links.map(l=>({nodeId:l.node_id,teamId:l.team_id})),asOf:iso()};
}
function expected(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)fail('Atualize a estrutura antes de salvar.','structure_version');return value;}
function nodeInput(input:Record<string,unknown>){const parentId=id(input.parentId,true),relation=choices(input.relation,RELATIONS);if((parentId===null)!==(relation==='root'))fail('Uma unidade raiz não tem superior; as demais exigem uma relação e uma unidade superior.');return{parentId,name:text(input.name,160),acronym:text(input.acronym??'',24,true),kind:choices(input.kind,NODE_KINDS),relation,position:integer(input.position??0,999)};}
function nodeInsert(db:D1Database,org:string,nodeId:string,value:ReturnType<typeof nodeInput>,at:string){return db.prepare('INSERT INTO institutional_nodes(id,organization_id,parent_id,name,acronym,kind,relation,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(nodeId,org,value.parentId,value.name,value.acronym,value.kind,value.relation,value.position,at,at);}
function translate(error:unknown):never{
 const cause=String(error);
 if(cause.includes('followup_authority_changed'))fail('Seu acesso à organização mudou.','structure_forbidden',403);
 if(cause.includes('structure_version_changed'))fail('Outra pessoa atualizou a estrutura. Reabra a edição.','structure_conflict',409);
 if(/structure_(cycle|depth_limit|archive_in_use|parent_inactive|link_inactive|node_limit|link_limit)|FOREIGN KEY constraint failed/.test(cause))fail(cause.includes('archive_in_use')?'Desvincule as equipes e arquive os setores subordinados antes de arquivar esta unidade.':cause.includes('cycle')?'Esta relação criaria um ciclo. Escolha outra unidade superior.':'A unidade superior ou a equipe mudou, está arquivada ou ultrapassa os limites da estrutura. Atualize a edição.','structure_relationship',409);
 throw error;
}
/** Only organization owners (including global owners) can mutate formal structure. */
export async function structureAction(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>){
 actorRequired(actor);const action=choices(input.action,['source.save','node.save','node.status','link.save','template.apply'] as const),organizationId=id(input.organizationId)!,scope={organizationId,projectId:null};
 await activeScope(db,actor,scope,true);const revision=expected(input.expectedVersion),at=iso();
 const base=['action','organizationId','expectedVersion','operationKey'];
 onlyKeys(input,[...base,...(action==='node.save'?['id','parentId','name','acronym','kind','relation','position']:action==='node.status'?['id','status']:action==='link.save'?['nodeId','teamId','linked']:action==='source.save'?['label','revision','issuedOn']:['nodes'])]);
 const mutation=await prepareMutation(db,actor.userId,`structure.${action}`,input);
 if(mutation.existingId){await activeScope(db,actor,scope,true);return{viewerId:actor.userId,organizationId,entityId:mutation.existingId,duplicate:true};}
 const entityId=(action==='node.save'?id(input.id,true):action==='node.status'?id(input.id):null)??uid();
 const changes:D1PreparedStatement[]=[];let adapted=false;
 if(action==='source.save'){
  changes.push(db.prepare('UPDATE institutional_structures SET source_label=?,source_revision=?,source_issued_on=?,source_url=NULL,adapted=1 WHERE organization_id=?').bind(text(input.label,120),text(input.revision??'',40,true),date(input.issuedOn),organizationId));
 }else if(action==='node.save'){
  const value=nodeInput(input);adapted=true;
  if(input.id){if(!await one(db,"SELECT 1 FROM institutional_nodes WHERE id=? AND organization_id=? AND status='active'",[entityId,organizationId]))fail('Unidade não encontrada ou arquivada.','structure_not_found',404);
   changes.push(db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM institutional_nodes WHERE id=? AND organization_id=? AND status='active') THEN 1 ELSE json_extract('[]','structure_version_changed') END").bind(entityId,organizationId));
   changes.push(db.prepare('UPDATE institutional_nodes SET parent_id=?,name=?,acronym=?,kind=?,relation=?,position=?,updated_at=? WHERE id=? AND organization_id=?').bind(value.parentId,value.name,value.acronym,value.kind,value.relation,value.position,at,entityId,organizationId));
  }else changes.push(nodeInsert(db,organizationId,entityId,value,at));
 }else if(action==='node.status'){
  const status=choices(input.status,['active','archived']);adapted=true;
  if(!await one(db,'SELECT 1 FROM institutional_nodes WHERE id=? AND organization_id=?',[entityId,organizationId]))fail('Unidade não encontrada neste contexto.','structure_not_found',404);
  changes.push(db.prepare('UPDATE institutional_nodes SET status=?,updated_at=? WHERE id=? AND organization_id=?').bind(status,at,entityId,organizationId));
 }else if(action==='link.save'){
  const nodeId=id(input.nodeId)!,teamId=id(input.teamId)!;if(typeof input.linked!=='boolean')fail('Escolha vincular ou desvincular.');
  // Unlinking remains possible if a team was archived since the original link.
  if(!await one(db,'SELECT 1 FROM followup_teams t JOIN institutional_nodes n ON n.organization_id=t.organization_id WHERE t.id=? AND n.id=? AND n.organization_id=?',[teamId,nodeId,organizationId]))fail('Equipe e unidade devem pertencer à organização escolhida.','structure_not_found',404);
  changes.push(input.linked?db.prepare('INSERT INTO institutional_team_links(organization_id,node_id,team_id,created_at) VALUES(?,?,?,?) ON CONFLICT(organization_id,node_id,team_id) DO UPDATE SET revoked_at=NULL,created_at=excluded.created_at').bind(organizationId,nodeId,teamId,at):db.prepare('UPDATE institutional_team_links SET revoked_at=? WHERE organization_id=? AND node_id=? AND team_id=? AND revoked_at IS NULL').bind(at,organizationId,nodeId,teamId));
 }else{
  if(!Array.isArray(input.nodes)||input.nodes.length<1||input.nodes.length>50)fail('Revise um modelo de 1 a 50 unidades.');
  const ids=new Map<string,string>(),parsed:TemplateNode[]=[];
  for(const item of input.nodes){if(!item||typeof item!=='object'||Array.isArray(item))fail('Modelo inválido.');const row=item as Record<string,unknown>;onlyKeys(row,['key','parentKey','name','acronym','kind','relation','position']);const key=id(row.key)!,parentKey=id(row.parentKey,true);if(ids.has(key)||parentKey&&!ids.has(parentKey))fail('Ordene o modelo com a unidade superior antes de seus setores, sem chaves repetidas.');ids.set(key,uid());const {parentId:ignored,...value}=nodeInput({...row,parentId:parentKey});void ignored;parsed.push({key,parentKey,...value});}
  const official=parsed.length===OFFICIAL_TEMPLATE.length&&parsed.every((row,i)=>Object.keys(row).every(key=>row[key as keyof TemplateNode]===OFFICIAL_TEMPLATE[i][key as keyof TemplateNode]));
  changes.push(db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM institutional_nodes WHERE organization_id=?) THEN 1 ELSE json_extract('[]','structure_version_changed') END").bind(organizationId));
  changes.push(db.prepare('UPDATE institutional_structures SET source_label=?,source_revision=?,source_issued_on=?,source_url=?,adapted=? WHERE organization_id=?').bind(OFFICIAL_SOURCE.label,OFFICIAL_SOURCE.revision,OFFICIAL_SOURCE.issuedOn,OFFICIAL_SOURCE.referenceUrl,official?0:1,organizationId));
  for(const row of parsed)changes.push(nodeInsert(db,organizationId,ids.get(row.key)!,nodeInput({...row,parentId:row.parentKey?ids.get(row.parentKey):null}),at));
 }
 const statements=[scopeStatement(db,actor,scope,true),db.prepare('INSERT OR IGNORE INTO institutional_structures(organization_id,created_at,updated_at) VALUES(?,?,?)').bind(organizationId,at,at),db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM institutional_structures WHERE organization_id=? AND version=?) THEN 1 ELSE json_extract('[]','structure_version_changed') END").bind(organizationId,revision),mutation.claimStatement(entityId),...changes,
  db.prepare(`UPDATE institutional_structures SET version=version+1,updated_at=?${adapted?',adapted=1':''} WHERE organization_id=?`).bind(at,organizationId),
  db.prepare('INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,NULL,?,?,?,?,?)').bind(uid(),actor.userId,organizationId,`structure.${action}`,entityId,JSON.stringify({version:revision+1,kind:action}),at)];
 try{await db.batch(statements);}catch(error){try{const recovered=await mutation.recover(error);await activeScope(db,actor,scope,true);return{viewerId:actor.userId,organizationId,entityId:recovered,duplicate:true};}catch(recovered){translate(recovered);}}
 await activeScope(db,actor,scope,true);
 return{viewerId:actor.userId,organizationId,entityId,version:revision+1,duplicate:false};
}
