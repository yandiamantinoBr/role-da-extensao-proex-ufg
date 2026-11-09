import {capabilityBatch,projectAuthoritySql,requireLiveCapability,type PortalActor} from './access';
import {all,one,type Row} from './database';
import {HttpError} from './errors';
import {prepareMutation} from './mutations';
import {effectiveMovementSql} from './movement-ledger';

/*
 * Destinations of materials: an event, a place (e.g. "Centro de Eventos da UFG"), a partner or an
 * organizational unit, shared by the projects of one organization. Each one has its own page with
 * the official link and everything that went to it. A destination never grants access: the page
 * lists only movements of projects the person can already read.
 */
export const DESTINATION_KINDS=['event','place','unit','partner','other'] as const;
export type DestinationKind=typeof DESTINATION_KINDS[number];
export const DESTINATION_KIND_LABELS:Record<DestinationKind,string>={event:'Evento',place:'Local',unit:'Unidade ou órgão',partner:'Parceiro',other:'Outro destino'};
export type DestinationSummary={id:string;name:string;kind:DestinationKind;officialUrl:string;status:string;href:string};
const READ=['inventory.read','reports.read'] as const;
function invalid(message:string,code='invalid_destination',status=400):never{throw new HttpError(status,message,code);}
function clean(value:unknown,label:string,max:number,optional=false):string{
 if(value===undefined||value===null||value===''){if(optional)return '';invalid(`Informe ${label}.`);}
 if(typeof value!=='string')invalid(`Informe ${label} como texto.`);
 const result=value.normalize('NFC').replace(/\s+/g,' ').trim();
 if((!optional&&result.length<2)||result.length>max||/[\u0000-\u001f\u007f-\u009f]/u.test(result))invalid(`${label[0].toUpperCase()}${label.slice(1)} deve ter ${optional?'até':'entre 2 e'} ${max} caracteres válidos.`);
 return result;
}
function identifier(value:unknown,label:string,optional=false):string|null{
 if(optional&&(value===undefined||value===null||value===''))return null;
 if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value))invalid(`Selecione ${label}.`);
 return value;
}
export function destinationKey(name:string):string{return name.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR');}
function kindValue(value:unknown,fallback:DestinationKind='place'):DestinationKind{
 if(value===undefined||value===null||value==='')return fallback;
 if(typeof value!=='string'||!(DESTINATION_KINDS as readonly string[]).includes(value))invalid('Escolha evento, local, unidade, parceiro ou outro destino.');
 return value as DestinationKind;
}
function officialUrl(value:unknown):string{
 const raw=clean(value,'o link oficial',500,true);if(!raw)return '';
 let url:URL;try{url=new URL(raw);}catch{invalid('Use um link oficial completo, começando com https://.');}
 if(url.protocol!=='https:'||url.username||url.password)invalid('Use um link oficial completo, começando com https://.');
 return url.toString();
}
export const destinationHref=(id:string)=>`/?module=materials&destinationId=${encodeURIComponent(id)}`;
function summary(row:Row):DestinationSummary{return{id:String(row.id),name:String(row.name),kind:row.kind as DestinationKind,officialUrl:String(row.official_url??''),status:String(row.status),href:destinationHref(String(row.id))};}
async function projectOrganization(db:D1Database,projectId:string):Promise<string>{
 const row=await one(db,"SELECT p.organization_id FROM projects p JOIN organizations o ON o.id=p.organization_id WHERE p.id=? AND p.status='active' AND o.status='active'",[projectId]);
 if(!row)invalid('O projeto está indisponível para movimentações.','stock_context_scope',409);
 return String(row.organization_id);
}
function organizationAuthority(actor:PortalActor,capabilities:readonly string[],organizationSql:string){
 const authority=projectAuthoritySql(actor,capabilities,'org_auth_project.id');
 return{sql:`EXISTS(SELECT 1 FROM projects org_auth_project WHERE org_auth_project.organization_id=${organizationSql} AND (${authority.sql}))`,values:authority.values};
}
/**
 * Destination chosen in a stock movement form or by the assistant: an existing id, or a name that is
 * matched (same organization, case-insensitive) or created in the same batch as the movement.
 */
export async function resolveDestination(db:D1Database,actor:PortalActor,projectId:string,input:Record<string,unknown>,now:string){
 const id=identifier(input.destinationId,'um destino válido',true),name=clean(input.destinationName,'o nome do destino',160,true);
 if(!id&&!name)return null;
 const organizationId=await projectOrganization(db,projectId);
 if(id){
  const row=await one(db,"SELECT * FROM material_destinations WHERE id=? AND organization_id=? AND status='active'",[id,organizationId]);
  if(!row)invalid('Escolha um destino ativo desta organização.','stock_destination_scope',409);
  return{id:row.id as string,name:row.name as string,kind:row.kind as DestinationKind,created:false,statements:[] as D1PreparedStatement[],link:(movementId:string,at:string)=>db.prepare('INSERT INTO stock_movement_destinations(movement_id,destination_id,project_id,created_at) VALUES(?,?,?,?)').bind(movementId,row.id,projectId,at)};
 }
 const key=destinationKey(name),existing=await one(db,'SELECT * FROM material_destinations WHERE organization_id=? AND name_key=?',[organizationId,key]);
 if(existing&&existing.status!=='active')invalid(`O destino “${existing.name}” está arquivado. Reative-o na página do destino ou escolha outro.`,'stock_destination_scope',409);
 const newId=existing?String(existing.id):crypto.randomUUID(),kind=existing?existing.kind as DestinationKind:kindValue(input.destinationKind);
 const statements=existing?[]:[db.prepare(`INSERT INTO material_destinations(id,organization_id,kind,name,name_key,official_url,description,unit_id,status,version,created_by,created_at,updated_by,updated_at)
  VALUES(?,?,?,?,?,'','',NULL,'active',1,?,?,?,?) ON CONFLICT(organization_id,name_key) DO NOTHING`).bind(newId,organizationId,kind,name,key,actor.userId,now,actor.userId,now)];
 return{id:newId,name:existing?String(existing.name):name,kind,created:!existing,statements,
  link:(movementId:string,at:string)=>db.prepare(`INSERT INTO stock_movement_destinations(movement_id,destination_id,project_id,created_at)
   SELECT ?,id,?,? FROM material_destinations WHERE organization_id=? AND name_key=?`).bind(movementId,projectId,at,organizationId,key)};
}
/** Destinations linked to movements, by movement id (labels only; access is the movement's own). */
export async function movementDestinations(db:D1Database,movementIds:string[]):Promise<Map<string,DestinationSummary>>{
 if(!movementIds.length)return new Map();
 const rows=await all(db,`SELECT l.movement_id,d.* FROM stock_movement_destinations l JOIN material_destinations d ON d.id=l.destination_id WHERE l.movement_id IN(${movementIds.map(()=>'?').join(',')})`,movementIds);
 return new Map(rows.map(row=>[String(row.movement_id),summary(row)]));
}
export async function listDestinations(db:D1Database,actor:PortalActor|null,projectId:unknown){
 if(!actor)invalid('Entre para consultar os destinos.','unauthenticated',401);
 const project=identifier(projectId,'o projeto')!;
 await requireLiveCapability(db,actor,'inventory.read',project);
 const organizationId=await projectOrganization(db,project);
 const rows=await all(db,`SELECT d.*,(SELECT COUNT(*) FROM stock_movement_destinations l JOIN stock_movements m ON m.id=l.movement_id WHERE l.destination_id=d.id AND ${effectiveMovementSql('m')}) movement_count
  FROM material_destinations d WHERE d.organization_id=? ORDER BY d.status,d.name_key,d.id LIMIT 500`,[organizationId]);
 return{organizationId,destinations:rows.map(row=>({...summary(row),description:String(row.description??''),unitId:row.unit_id??null,movementCount:Number(row.movement_count??0)})),kinds:DESTINATION_KIND_LABELS};
}
export async function destinationAction(db:D1Database,actor:PortalActor,action:string,input:Record<string,unknown>):Promise<Record<string,unknown>|null>{
 if(!['destination.create','destination.update'].includes(action))return null;
 const allowed=action==='destination.create'?['action','projectId','kind','name','officialUrl','description','unitId','operationKey']:['action','id','expectedVersion','kind','name','officialUrl','description','unitId','status','operationKey'];
 if(Object.keys(input).some(key=>!allowed.includes(key)))invalid('Há campos não permitidos nesta operação.','invalid_input');
 const now=new Date().toISOString();
 const unit=async(kind:DestinationKind,value:unknown)=>{const unitId=identifier(value,'uma unidade válida',true);if(!unitId)return null;if(kind!=='unit')invalid('Só um destino do tipo unidade pode apontar para uma unidade do cadastro institucional.');if(!await one(db,"SELECT id FROM organizational_units WHERE id=? AND status='active'",[unitId]))invalid('Escolha uma unidade ativa.');return unitId;};
 if(action==='destination.create'){
  const projectId=identifier(input.projectId,'o projeto')!;
  await requireLiveCapability(db,actor,'inventory.manage',projectId);
  const organizationId=await projectOrganization(db,projectId),name=clean(input.name,'o nome do destino',160),key=destinationKey(name),kind=kindValue(input.kind);
  const url=officialUrl(input.officialUrl),description=clean(input.description,'a descrição',1000,true),unitId=await unit(kind,input.unitId);
  const mutation=await prepareMutation(db,actor.userId,`destination.create:${organizationId}`,input);
  if(mutation.existingId)return{destination:summary((await one(db,'SELECT * FROM material_destinations WHERE id=?',[mutation.existingId]))!),duplicate:true};
  const existing=await one(db,'SELECT * FROM material_destinations WHERE organization_id=? AND name_key=?',[organizationId,key]);
  if(existing)return{destination:summary(existing),duplicate:true};
  const id=crypto.randomUUID();
  try{
   await capabilityBatch(db,actor,'inventory.manage',projectId,[mutation.claimStatement(id),
    db.prepare(`INSERT INTO material_destinations(id,organization_id,kind,name,name_key,official_url,description,unit_id,status,version,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,'active',1,?,?,?,?)`).bind(id,organizationId,kind,name,key,url,description,unitId,actor.userId,now,actor.userId,now),
    db.prepare('INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.userId,projectId,action,id,JSON.stringify({name,kind,officialUrl:url,unitId}),now)]);
  }catch(error){
   if(error instanceof HttpError)throw error;
   const replay=await mutation.recover(error).catch(()=>null);if(replay)return{destination:summary((await one(db,'SELECT * FROM material_destinations WHERE id=?',[replay]))!),duplicate:true};
   const raced=await one(db,'SELECT * FROM material_destinations WHERE organization_id=? AND name_key=?',[organizationId,key]);if(raced)return{destination:summary(raced),duplicate:true};
   throw error;
  }
  return{destination:summary((await one(db,'SELECT * FROM material_destinations WHERE id=?',[id]))!)};
 }
 const id=identifier(input.id,'o destino')!,previous=await one(db,'SELECT * FROM material_destinations WHERE id=?',[id]);
 if(!previous)invalid('Destino não encontrado.','destination_not_found',404);
 const manage=organizationAuthority(actor,['inventory.manage'],'?');
 if(!await one(db,`SELECT 1 allowed WHERE ${manage.sql}`,[previous.organization_id,...manage.values]))invalid('Somente quem cuida do estoque desta organização pode editar o destino.','forbidden',403);
 if(typeof input.expectedVersion!=='number'||input.expectedVersion!==previous.version)invalid('O destino foi alterado em outra sessão. Atualize a página.','destination_changed',409);
 const kind=kindValue(input.kind,previous.kind as DestinationKind),name=input.name===undefined?String(previous.name):clean(input.name,'o nome do destino',160),key=destinationKey(name);
 const url=input.officialUrl===undefined?String(previous.official_url):officialUrl(input.officialUrl),description=input.description===undefined?String(previous.description):clean(input.description,'a descrição',1000,true);
 const unitId=input.unitId===undefined?(kind==='unit'?previous.unit_id??null:null):await unit(kind,input.unitId);
 const status=input.status===undefined?String(previous.status):input.status;
 if(status!=='active'&&status!=='archived')invalid('Escolha destino ativo ou arquivado.');
 if(key!==previous.name_key&&await one(db,'SELECT id FROM material_destinations WHERE organization_id=? AND name_key=? AND id<>?',[previous.organization_id,key,id]))invalid('Já existe um destino com esse nome nesta organização.','destination_exists',409);
 const results=await db.batch([
  db.prepare(`UPDATE material_destinations SET kind=?,name=?,name_key=?,official_url=?,description=?,unit_id=?,status=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=? AND ${manage.sql}`).bind(kind,name,key,url,description,unitId,status,actor.userId,now,id,previous.version,previous.organization_id,...manage.values),
  db.prepare(`INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,NULL,?,?,?,? WHERE changes()=1`).bind(crypto.randomUUID(),actor.userId,action,id,JSON.stringify({before:{name:previous.name,kind:previous.kind,officialUrl:previous.official_url,description:previous.description,status:previous.status,unitId:previous.unit_id},after:{name,kind,officialUrl:url,description,status,unitId}}),now),
 ]);
 if(results[0].meta.changes!==1)invalid('O destino ou o seu acesso mudou. Atualize a página.','destination_changed',409);
 return{destination:summary((await one(db,'SELECT * FROM material_destinations WHERE id=?',[id]))!)};
}
/** Page of a destination: official link, what went to it (only readable projects) and links back. */
export async function destinationPage(db:D1Database,actor:PortalActor|null,destinationId:unknown){
 if(!actor)invalid('Entre para consultar o destino.','unauthenticated',401);
 const id=identifier(destinationId,'o destino')!,destination=await one(db,'SELECT d.*,u.name unit_name,u.acronym unit_acronym,u.official_url unit_url FROM material_destinations d LEFT JOIN organizational_units u ON u.id=d.unit_id WHERE d.id=?',[id]);
 if(!destination)invalid('Destino não encontrado.','destination_not_found',404);
 const read=organizationAuthority(actor,READ,'?'),manage=organizationAuthority(actor,['inventory.manage'],'?');
 const access=await one(db,`SELECT CASE WHEN ${read.sql} THEN 1 ELSE 0 END can_read,CASE WHEN ${manage.sql} THEN 1 ELSE 0 END can_manage`,[destination.organization_id,...read.values,destination.organization_id,...manage.values]);
 if(!access?.can_read)invalid('Você não tem acesso a este destino.','forbidden',403);
 const authority=projectAuthoritySql(actor,READ,'p.id');
 const unitClause=destination.unit_id?' OR c.counterparty_unit_id=?':'',unitParams=destination.unit_id?[destination.unit_id]:[];
 const rows=await all(db,`SELECT m.id,m.delta,m.kind,m.note,m.created_at,COALESCE(c.occurred_at,m.created_at) occurred_at,i.id item_id,i.name item_name,COALESCE(c.measurement_unit,i.unit) unit,p.id project_id,p.name project_name,
  COALESCE(NULLIF(profile.display_name,''),'Equipe') actor_name,
  (SELECT r.kind FROM stock_movement_revisions r WHERE r.target_movement_id=m.id) revised_as,
  CASE WHEN EXISTS(SELECT 1 FROM stock_movement_revisions r WHERE r.replacement_movement_id=m.id) THEN 1 ELSE 0 END is_correction,
  CASE WHEN l.movement_id IS NOT NULL THEN 'destination' ELSE 'unit' END link_source
  FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN projects p ON p.id=i.project_id
  LEFT JOIN stock_movement_destinations l ON l.movement_id=m.id AND l.destination_id=?
  LEFT JOIN stock_movement_contexts c ON c.movement_id=m.id LEFT JOIN profiles profile ON profile.user_id=m.actor_id
  WHERE (l.movement_id IS NOT NULL${unitClause}) AND p.organization_id=? AND (${authority.sql})
  AND NOT EXISTS(SELECT 1 FROM stock_movement_revisions mirror WHERE mirror.reversal_movement_id=m.id)
  ORDER BY occurred_at DESC,m.id DESC LIMIT 301`,[id,...unitParams,destination.organization_id,...authority.values]);
 const movements=rows.slice(0,300).map(row=>({id:row.id,delta:Number(row.delta),kind:row.kind,note:row.note,createdAt:row.created_at,occurredAt:row.occurred_at,itemId:row.item_id,itemName:row.item_name,unit:row.unit,projectId:row.project_id,projectName:row.project_name,actorName:row.actor_name,
  status:row.revised_as==='reversal'?'undone':row.revised_as==='correction'?'corrected':'current',isCorrection:Boolean(row.is_correction),linkSource:row.link_source,
  materialHref:`/?module=materials&project=${encodeURIComponent(row.project_id)}&itemId=${encodeURIComponent(row.item_id)}`}));
 const totals=new Map<string,{itemId:string;itemName:string;unit:string;projectName:string;outgoing:number;incoming:number;movementCount:number;materialHref:string}>();
 for(const row of movements){if(row.status!=='current')continue;const keyName=`${row.itemId}:${row.unit}`,total=totals.get(keyName)??{itemId:String(row.itemId),itemName:String(row.itemName),unit:String(row.unit),projectName:String(row.projectName),outgoing:0,incoming:0,movementCount:0,materialHref:row.materialHref};if(row.delta<0)total.outgoing-=row.delta;else total.incoming+=row.delta;total.movementCount++;totals.set(keyName,total);}
 const itemAuthority=projectAuthoritySql(actor,READ,'i.project_id');
 const destined=await all(db,`SELECT i.id,i.name,i.unit,i.stock,i.reserved,i.project_id,p.name project_name FROM items i JOIN projects p ON p.id=i.project_id WHERE i.event_destination_id=? AND (${itemAuthority.sql}) ORDER BY i.name,i.id LIMIT 200`,[id,...itemAuthority.values]);
 return{
  destination:{...summary(destination),description:String(destination.description??''),version:Number(destination.version),kindLabel:DESTINATION_KIND_LABELS[destination.kind as DestinationKind],unit:destination.unit_id?{id:destination.unit_id,name:destination.unit_name,acronym:destination.unit_acronym,officialUrl:destination.unit_url??''}:null,createdAt:destination.created_at,updatedAt:destination.updated_at},
  movements,movementsTruncated:rows.length>300,totals:[...totals.values()].sort((a,b)=>a.itemName.localeCompare(b.itemName,'pt-BR')),
  destinedItems:destined.map(row=>({id:row.id,name:row.name,unit:row.unit,stock:Number(row.stock),available:Number(row.stock)-Number(row.reserved),projectName:row.project_name,materialHref:`/?module=materials&project=${encodeURIComponent(row.project_id)}&itemId=${encodeURIComponent(row.id)}`})),
  permissions:{canManage:Boolean(access.can_manage)},kinds:DESTINATION_KIND_LABELS,
  notice:'Só aparecem movimentações dos projetos que você já pode consultar. O destino não transfere saldo nem concede acesso.',
 };
}
