import {capabilityBatch,requireCapability,requireLiveCapability,type PortalActor} from './access';
import {all,one,type Row} from './database';
import {HttpError} from './errors';
import {prepareMutation} from './mutations';
import {movementContexts,prepareStockContext,stockContextInput,type StockContext} from './stock-context';
import {movementDestinations,resolveDestination,type DestinationSummary} from './material-destinations';

/*
 * Corrections, undo, detail and evidence of stock movements.
 * - Nothing is edited or deleted: a correction appends a mirror of the current version (cancels it)
 *   and a replacement with the right values; an undo appends only the mirror. The balance follows the
 *   ledger triggers. stock_movement_revisions links them and keeps who, when, why, before and after.
 * - Only the current version of a chain can be corrected or undone, by whoever can move the stock of
 *   the material's project (inventory.manage, rechecked in SQL inside the batch).
 * - Every write is idempotent by operationKey.
 */
const MANUAL_KINDS=['receive','distribute','consume','adjust'];
const MAX_QUANTITY=1_000_000;
const KIND_LABELS:Record<string,string>={receive:'Recebimento',distribute:'Distribuição',consume:'Consumo interno',adjust:'Ajuste de contagem',redeem:'Entrega de brinde',transfer:'Transferência'};
type MovementRow={id:string;item_id:string;delta:number;kind:string;note:string;ref_id:string|null;actor_id:string;created_at:string;group_id:string|null};
type ItemRow={id:string;project_id:string;name:string;unit:string;stock:number;reserved:number;category:string;condition:string};
export type MovementSnapshot={delta:number;note:string;counterpartyType:'unit'|'project'|null;counterpartyId:string|null;counterpartyName:string|null;processReference:string;beneficiaryReference:string;occurredAt:string;destinationId:string|null;destinationName:string|null;unit:string};
export type RevisionView={id:string;kind:'correction'|'reversal';actorName:string;createdAt:string;reason:string;targetMovementId:string;reversalMovementId:string;replacementMovementId:string|null;before:MovementSnapshot|null;after:MovementSnapshot|null};
export type MovementOrigin={via:'assistant'|'manual';label:string};

function invalid(message:string,code='invalid_input',status=400):never{throw new HttpError(status,message,code);}
function identifier(value:unknown,label:string):string{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value))invalid(`Selecione ${label}.`);return value;}
function textValue(value:unknown,label:string,min:number,max:number):string{
 if(typeof value!=='string')invalid(`Informe ${label}.`);
 const result=value.normalize('NFC').trim();
 if(result.length<min||result.length>max||/[\u0000\u000b\u000c\u007f]/u.test(result))invalid(`${label[0].toUpperCase()}${label.slice(1)} deve ter entre ${min} e ${max} caracteres.`);
 return result;
}
function onlyKeys(input:Record<string,unknown>,keys:string[]){if(Object.keys(input).some(key=>!keys.includes(key)))invalid('Há campos não permitidos nesta operação.');}
async function movementWithItem(db:D1Database,movementId:unknown):Promise<{movement:MovementRow;item:ItemRow}>{
 const id=identifier(movementId,'a movimentação');
 const movement=await one(db,'SELECT * FROM stock_movements WHERE id=?',[id]) as MovementRow|null;
 if(!movement)invalid('Movimentação não encontrada.','movement_not_found',404);
 const item=await one(db,'SELECT id,project_id,name,unit,stock,reserved,category,condition FROM items WHERE id=?',[movement.item_id]) as ItemRow|null;
 if(!item)invalid('Material não encontrado.','item_not_found',404);
 return{movement,item};
}
function canManage(actor:PortalActor,projectId:string):boolean{try{requireCapability(actor,'inventory.manage',projectId);return true;}catch{return false;}}
function snapshotOf(movement:Pick<MovementRow,'delta'|'note'|'created_at'>,context:Row|null,names:{counterpartyName:string|null},destination:{id:string;name:string}|null,unit:string):MovementSnapshot{
 return{delta:movement.delta,note:movement.note,counterpartyType:context?.counterparty_unit_id?'unit':context?.counterparty_project_id?'project':null,counterpartyId:context?.counterparty_unit_id??context?.counterparty_project_id??null,counterpartyName:names.counterpartyName,
  processReference:String(context?.process_reference??''),beneficiaryReference:String(context?.beneficiary_reference??''),occurredAt:String(context?.occurred_at??movement.created_at),destinationId:destination?.id??null,destinationName:destination?.name??null,unit:String(context?.measurement_unit??unit)};
}
async function counterpartyName(db:D1Database,context:{counterpartyType:string|null;counterpartyId:string|null}):Promise<string|null>{
 if(context.counterpartyType==='unit')return(await one(db,'SELECT name FROM organizational_units WHERE id=?',[context.counterpartyId]))?.name??null;
 if(context.counterpartyType==='project')return(await one(db,'SELECT name FROM projects WHERE id=?',[context.counterpartyId]))?.name??null;
 return null;
}
async function rawContextName(db:D1Database,context:Row|null):Promise<string|null>{
 if(!context)return null;
 return counterpartyName(db,{counterpartyType:context.counterparty_unit_id?'unit':context.counterparty_project_id?'project':null,counterpartyId:context.counterparty_unit_id??context.counterparty_project_id??null});
}
function translate(error:unknown):never{
 if(error instanceof HttpError)throw error;
 const message=String(error).toLowerCase();
 if(message.includes('stock_revision_chain')||message.includes('stock_movement_revisions.target_movement_id'))invalid('Outra pessoa corrigiu ou desfez esta movimentação agora há pouco. Abra a versão atual e confira.','movement_already_revised',409);
 if(message.includes('stock_revision_'))invalid('A movimentação mudou. Atualize a ficha e tente de novo.','movement_changed',409);
 if(message.includes('stock_unavailable')||message.includes('items_quantities_check')||message.includes('insufficient_stock'))invalid('O saldo disponível mudou e não comporta esta correção. Atualize o estoque e confira.','insufficient_stock',409);
 if(message.includes('stock_destination_'))invalid('O destino escolhido está arquivado ou é de outra organização. Escolha outro.','stock_destination_scope',409);
 if(message.includes('stock_context_'))invalid('O projeto, a origem ou o destino mudou. Reabra a movimentação.','stock_context_changed',409);
 if(message.includes('stock_record_'))invalid('O comprovante não pôde ser vinculado a esta movimentação. Atualize a ficha.','evidence_changed',409);
 if(message.includes('primary_photo_immutable'))invalid('Troque a foto principal antes de excluir esta foto.','primary_photo_delete',409);
 if(message.includes('attachment_deletion_'))invalid('O arquivo já foi excluído ou mudou. Atualize a ficha.','attachment_changed',409);
 throw error;
}
async function revisionsFor(db:D1Database,where:string,params:unknown[]):Promise<RevisionView[]>{
 const rows=await all(db,`SELECT r.*,COALESCE(NULLIF(p.display_name,''),'Equipe') actor_name FROM stock_movement_revisions r LEFT JOIN profiles p ON p.user_id=r.actor_id WHERE ${where} ORDER BY r.sequence`,params);
 return rows.map(row=>{let changes:Row={};try{changes=JSON.parse(String(row.changes_json));}catch{/* kept as recorded */}
  return{id:String(row.id),kind:row.kind,actorName:String(row.actor_name),createdAt:String(row.created_at),reason:String(row.reason),targetMovementId:String(row.target_movement_id),reversalMovementId:String(row.reversal_movement_id),replacementMovementId:row.replacement_movement_id??null,before:changes.before??null,after:changes.after??null};});
}
/** Movement created by the assistant (Rolê) after the person confirmed the proposal. */
async function assistantMovements(db:D1Database,movements:{id:string;ref_id?:string|null}[]):Promise<Set<string>>{
 const ids=movements.map(movement=>movement.id),found=new Set(movements.filter(movement=>/^manual:[^:]+:ai_/.test(String(movement.ref_id??''))).map(movement=>movement.id));
 if(ids.length){for(const row of await all(db,`SELECT json_extract(result_json,'$.movementId') movement_id FROM ai_plans WHERE status='applied' AND json_valid(result_json) AND json_extract(result_json,'$.movementId') IN(${ids.map(()=>'?').join(',')})`,ids))found.add(String(row.movement_id));}
 return found;
}
function originLabel(viaAssistant:boolean,actorName:string):MovementOrigin{return viaAssistant?{via:'assistant',label:`Pedido ao Rolê, confirmado por ${actorName}`}:{via:'manual',label:`Registrado por ${actorName}`};}

/** History rows of a material, enriched with revision state, destination, origin and evidence count. */
export async function annotateMovements(db:D1Database,rows:Row[]):Promise<Row[]>{
 const ids=rows.map(row=>String(row.id));if(!ids.length)return rows;
 const marks=ids.map(()=>'?').join(',');
 const revisions=await revisionsFor(db,`r.target_movement_id IN(${marks}) OR r.replacement_movement_id IN(${marks})`,[...ids,...ids]);
 const byTarget=new Map(revisions.map(revision=>[revision.targetMovementId,revision])),byReplacement=new Map(revisions.filter(revision=>revision.replacementMovementId).map(revision=>[revision.replacementMovementId!,revision]));
 const destinations=await movementDestinations(db,ids),assistant=await assistantMovements(db,rows.map(row=>({id:String(row.id),ref_id:row.ref_id})));
 const counts=new Map((await all(db,`SELECT l.movement_id,COUNT(a.id) n FROM stock_movement_records l JOIN record_attachments a ON a.record_id=l.record_id AND a.deleted_at IS NULL WHERE l.movement_id IN(${marks}) GROUP BY l.movement_id`,ids)).map(row=>[String(row.movement_id),Number(row.n)]));
 return rows.map(row=>{const id=String(row.id),superseded=byTarget.get(id),replaces=byReplacement.get(id);const{ref_id:_ref,...visible}=row;void _ref;
  return{...visible,status:superseded?superseded.kind==='reversal'?'undone':'corrected':'current',revision:superseded?{id:superseded.id,kind:superseded.kind,actorName:superseded.actorName,createdAt:superseded.createdAt,reason:superseded.reason,replacementMovementId:superseded.replacementMovementId}:null,
   correctionOf:replaces?{revisionId:replaces.id,targetMovementId:replaces.targetMovementId,actorName:replaces.actorName,createdAt:replaces.createdAt,reason:replaces.reason,before:replaces.before}:null,
   destination:destinations.get(id)??null,origin:replaces?{via:'manual',label:`Corrigido por ${replaces.actorName}`}:originLabel(assistant.has(id),String(row.actor_name??'Equipe')),attachmentCount:counts.get(id)??0};});
}
/** SQL fragment to hide mirror rows (bookkeeping of an undo or a correction) from a history list. */
export const HIDE_MIRRORS_SQL=(alias:string)=>`NOT EXISTS(SELECT 1 FROM stock_movement_revisions mirror_${alias} WHERE mirror_${alias}.reversal_movement_id=${alias}.id)`;

async function reviseMovement(db:D1Database,actor:PortalActor,input:Record<string,unknown>):Promise<Record<string,unknown>>{
 onlyKeys(input,['action','movementId','mode','reason','quantity','direction','note','counterpartyType','counterpartyId','processReference','beneficiaryReference','occurredAt','destinationId','destinationName','destinationKind','operationKey']);
 const{movement:target,item}=await movementWithItem(db,input.movementId);
 requireCapability(actor,'inventory.manage',item.project_id);
 await requireLiveCapability(db,actor,'inventory.manage',item.project_id);
 const mode=input.mode;if(mode!=='correct'&&mode!=='undo')invalid('Escolha corrigir ou desfazer a movimentação.');
 const reason=textValue(input.reason,'o motivo da correção',3,2000);
 const mutation=await prepareMutation(db,actor.userId,`stock.revise:${target.id}`,input);
 if(mutation.existingId)return{revision:(await revisionsFor(db,'r.id=?',[mutation.existingId]))[0]??{id:mutation.existingId},item:await one(db,'SELECT * FROM items WHERE id=?',[item.id]),duplicate:true};
 if(item.category==='equipment')invalid('Equipamentos são corrigidos pelo cadastro do bem e pela agenda de empréstimos.','equipment_movement');
 if(!MANUAL_KINDS.includes(target.kind))invalid('Entregas de brinde são desfeitas pela dinâmica, não pelo estoque.','movement_not_revisable',409);
 if(await one(db,'SELECT id FROM stock_movement_revisions WHERE reversal_movement_id=?',[target.id]))invalid('Este lançamento só registra a anulação de outro. Abra a movimentação original.','movement_not_revisable',409);
 const already=(await revisionsFor(db,'r.target_movement_id=?',[target.id]))[0];
 if(already)invalid(`Esta movimentação já foi ${already.kind==='reversal'?'desfeita':'corrigida'} por ${already.actorName}. Abra a versão atual para mudar de novo.`,'movement_already_revised',409);
 const root=String((await one(db,'SELECT root_movement_id FROM stock_movement_revisions WHERE replacement_movement_id=?',[target.id]))?.root_movement_id??target.id);
 const targetContext=await one(db,'SELECT * FROM stock_movement_contexts WHERE movement_id=?',[target.id]);
 const targetDestination=(await movementDestinations(db,[target.id])).get(target.id)??null;
 const before=snapshotOf(target,targetContext,{counterpartyName:await rawContextName(db,targetContext)},targetDestination,item.unit);
 const now=new Date().toISOString(),revisionId=crypto.randomUUID(),mirrorId=crypto.randomUUID(),replacementId=mode==='correct'?crypto.randomUUID():null;
 // The mirror keeps the superseded version's date and, when still valid, its counterpart, so day and
 // destination totals cancel even in raw sums. Reports also skip superseded rows and mirrors.
 let mirrorUnit=targetContext?.counterparty_unit_id??null,mirrorProject=targetContext?.counterparty_project_id??null;
 if(mirrorUnit&&!await one(db,"SELECT id FROM organizational_units WHERE id=? AND status='active'",[mirrorUnit]))mirrorUnit=null;
 if(mirrorProject&&!await one(db,"SELECT other.id FROM projects owner JOIN projects other ON other.organization_id=owner.organization_id WHERE owner.id=? AND other.id=? AND other.status='active' AND other.id<>owner.id",[item.project_id,mirrorProject]))mirrorProject=null;
 const mirrorContext=await prepareStockContext(db,actor,item,{counterpartyType:null,counterpartyId:null,processReference:'',beneficiaryReference:'',occurredAt:before.occurredAt,dateSource:'declared'});
 const mirrorDelta=-target.delta,mirrorNote=`Anulação para ${mode==='undo'?'desfazer':'corrigir'}: ${reason}`.slice(0,2000);
 const statements:{delta:number;rows:D1PreparedStatement[]}[]=[{delta:mirrorDelta,rows:[
  db.prepare('INSERT INTO stock_movements(id,item_id,delta,kind,note,ref_id,actor_id,created_at,group_id) VALUES(?,?,?,?,?,?,?,?,?)').bind(mirrorId,item.id,mirrorDelta,target.kind,mirrorNote,`manual:${actor.userId}:${input.operationKey}.mirror`,actor.userId,now,target.group_id),
  db.prepare('INSERT INTO stock_movement_contexts(movement_id,project_id,counterparty_unit_id,counterparty_project_id,process_reference,beneficiary_reference,occurred_at,date_source,material_name,measurement_unit,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
   .bind(mirrorId,item.project_id,mirrorUnit,mirrorUnit?null:mirrorProject,before.processReference,before.beneficiaryReference,before.occurredAt,'declared',item.name,item.unit,now),
 ]}];
 const assertions=[...mirrorContext.assertions];
 let after:MovementSnapshot|null=null,finalStock=item.stock-target.delta;
 if(mode==='correct'){
  const quantity=input.quantity;
  if(typeof quantity!=='number'||!Number.isSafeInteger(quantity)||quantity<1||quantity>MAX_QUANTITY)invalid(`Informe uma quantidade inteira entre 1 e ${MAX_QUANTITY}.`,'invalid_quantity');
  const direction=input.direction===undefined||input.direction===null||input.direction===''?(target.delta>0?'add':'remove'):input.direction;
  if(direction!=='add'&&direction!=='remove')invalid('Escolha acrescentar ou retirar.','invalid_quantity');
  const delta=target.kind==='receive'?quantity:target.kind==='adjust'?(direction==='add'?quantity:-quantity):-quantity;
  const note=input.note===undefined?target.note:typeof input.note==='string'?input.note.normalize('NFC').trim():invalid('Informe a finalidade como texto.');
  if((target.kind!=='adjust'&&!note)||note.length>2000)invalid('A finalidade da movimentação deve ter entre 1 e 2000 caracteres.');
  // Fields left out keep the superseded version's value (the counterpart may be a project the editor cannot see).
  const keep=(name:string,value:unknown)=>input[name]===undefined?value:input[name];
  const contextInput=stockContextInput({...input,counterpartyType:keep('counterpartyType',before.counterpartyType),counterpartyId:keep('counterpartyId',before.counterpartyId),processReference:keep('processReference',before.processReference),beneficiaryReference:keep('beneficiaryReference',before.beneficiaryReference),occurredAt:input.occurredAt||before.occurredAt},now);
  const destination=await resolveDestination(db,actor,item.project_id,input,now);
  after={delta,note,counterpartyType:contextInput.counterpartyType,counterpartyId:contextInput.counterpartyId,counterpartyName:await counterpartyName(db,contextInput),processReference:contextInput.processReference,beneficiaryReference:contextInput.beneficiaryReference,occurredAt:contextInput.occurredAt,destinationId:destination?.id??null,destinationName:destination?.name??null,unit:item.unit};
  const changed=(['delta','note','counterpartyType','counterpartyId','processReference','beneficiaryReference','occurredAt','destinationId'] as const).some(key=>before[key]!==after![key])||(!destination&&Boolean(before.destinationId));
  if(!changed)invalid('Nada mudou. Altere a quantidade, a finalidade, o destino ou a data antes de salvar a correção.','revision_unchanged');
  const replacementContext=await prepareStockContext(db,actor,item,contextInput);
  assertions.push(...replacementContext.assertions);
  statements.push({delta,rows:[
   ...(destination?.statements??[]),
   db.prepare('INSERT INTO stock_movements(id,item_id,delta,kind,note,ref_id,actor_id,created_at,group_id) VALUES(?,?,?,?,?,?,?,?,?)').bind(replacementId,item.id,delta,target.kind,note,`manual:${actor.userId}:${input.operationKey}.replacement`,actor.userId,now,target.group_id),
   replacementContext.insert(replacementId!,now),
   ...(destination?[destination.link(replacementId!,now)]:[]),
  ]});
  finalStock+=delta;
 }
 if(finalStock<item.reserved)invalid(mode==='undo'?'Desfazer deixaria o saldo abaixo do que já está reservado ou entregue. Confira as saídas posteriores.':'A correção deixaria o saldo abaixo do que já está reservado. Confira as saídas posteriores.','insufficient_stock',409);
 // Positive rows first: intermediate balances are never below the final one.
 statements.sort((a,b)=>b.delta-a.delta);
 try{
  await capabilityBatch(db,actor,'inventory.manage',item.project_id,[
   mutation.claimStatement(revisionId),...assertions,...statements.flatMap(entry=>entry.rows),
   db.prepare('INSERT INTO stock_movement_revisions(id,item_id,project_id,root_movement_id,target_movement_id,kind,reversal_movement_id,replacement_movement_id,reason,changes_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(revisionId,item.id,item.project_id,root,target.id,mode==='undo'?'reversal':'correction',mirrorId,replacementId,reason,JSON.stringify({mode,before,after}),actor.userId,now),
   db.prepare('INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.userId,item.project_id,'stock.revise',revisionId,JSON.stringify({movementId:target.id,rootMovementId:root,mode,mirrorMovementId:mirrorId,replacementMovementId:replacementId,reason,before:{delta:before.delta},after:after?{delta:after.delta}:null}),now),
  ]);
 }catch(error){
  if(error instanceof HttpError&&error.status===403)throw error;
  const replay=await mutation.recover(error).catch(()=>null);
  if(replay)return{revision:(await revisionsFor(db,'r.id=?',[replay]))[0]??{id:replay},item:await one(db,'SELECT * FROM items WHERE id=?',[item.id]),duplicate:true};
  translate(error);
 }
 return{revision:(await revisionsFor(db,'r.id=?',[revisionId]))[0],currentMovementId:replacementId,item:await one(db,'SELECT * FROM items WHERE id=?',[item.id])};
}

async function evidenceRecord(db:D1Database,actor:PortalActor,input:Record<string,unknown>):Promise<Record<string,unknown>>{
 onlyKeys(input,['action','movementId','operationKey']);
 const{movement,item}=await movementWithItem(db,input.movementId);
 requireCapability(actor,'inventory.manage',item.project_id);
 await requireLiveCapability(db,actor,'inventory.manage',item.project_id);
 if(await one(db,'SELECT id FROM stock_movement_revisions WHERE reversal_movement_id=?',[movement.id]))invalid('Anexe o comprovante na movimentação original ou na correção.','movement_not_revisable',409);
 const linked=await one(db,'SELECT record_id FROM stock_movement_records WHERE movement_id=?',[movement.id]);
 if(linked)return{recordId:linked.record_id,movementId:movement.id,duplicate:true};
 const mutation=await prepareMutation(db,actor.userId,`stock.evidence:${movement.id}`,input);
 if(mutation.existingId)return{recordId:mutation.existingId,movementId:movement.id,duplicate:true};
 const context=await one(db,'SELECT occurred_at FROM stock_movement_contexts WHERE movement_id=?',[movement.id]);
 const now=new Date().toISOString(),recordId=crypto.randomUUID(),kind=movement.kind==='distribute'?'distribution':movement.kind==='consume'?'consumption':'material';
 const title=`Comprovante · ${KIND_LABELS[movement.kind]??'Movimentação'} de ${Math.abs(movement.delta)} ${item.unit} · ${item.name}`.slice(0,160);
 try{
  await capabilityBatch(db,actor,'inventory.manage',item.project_id,[mutation.claimStatement(recordId),
   db.prepare('INSERT INTO records(id,project_id,kind,title,body,occurred_at,item_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(recordId,item.project_id,kind,title,'Fotos e documentos da movimentação de estoque.',String(context?.occurred_at??movement.created_at),item.id,actor.userId,now),
   db.prepare('INSERT INTO stock_movement_records(movement_id,record_id,project_id,created_by,created_at) VALUES(?,?,?,?,?)').bind(movement.id,recordId,item.project_id,actor.userId,now),
   db.prepare('INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.userId,item.project_id,'stock.evidence',movement.id,JSON.stringify({recordId}),now),
  ]);
 }catch(error){
  if(error instanceof HttpError&&error.status===403)throw error;
  const raced=await one(db,'SELECT record_id FROM stock_movement_records WHERE movement_id=?',[movement.id]);
  if(raced)return{recordId:raced.record_id,movementId:movement.id,duplicate:true};
  translate(error);
 }
 return{recordId,movementId:movement.id};
}

const GALLERY_SQL="r.loan_id IS NULL AND r.kind IN ('material','maintenance','distribution','consumption') AND NOT EXISTS(SELECT 1 FROM stock_movement_records evidence WHERE evidence.record_id=r.id)";
async function deleteAttachment(db:D1Database,actor:PortalActor,action:string,input:Record<string,unknown>):Promise<Record<string,unknown>>{
 const photo=action==='item.photo.delete';
 onlyKeys(input,['action',photo?'itemId':'movementId','attachmentId','reason','operationKey']);
 const attachmentId=identifier(input.attachmentId,'o arquivo'),reason=textValue(input.reason,'o motivo da exclusão',3,500);
 let projectId:string,itemId:string,movementId:string|null=null;
 if(photo){
  const item=await one(db,'SELECT id,project_id FROM items WHERE id=?',[identifier(input.itemId,'o material')]);
  if(!item)invalid('Material não encontrado.','item_not_found',404);
  projectId=String(item.project_id);itemId=String(item.id);
 }else{
  const found=await movementWithItem(db,input.movementId);projectId=found.item.project_id;itemId=found.item.id;movementId=found.movement.id;
 }
 requireCapability(actor,'inventory.manage',projectId);
 await requireLiveCapability(db,actor,'inventory.manage',projectId);
 const mutation=await prepareMutation(db,actor.userId,`attachment.delete:${attachmentId}`,input);
 if(mutation.existingId)return{deleted:{attachmentId},duplicate:true};
 const scope=photo?`r.item_id=? AND ${GALLERY_SQL}`:'r.item_id=? AND EXISTS(SELECT 1 FROM stock_movement_records l WHERE l.record_id=r.id AND l.movement_id=?)';
 const attachment=await one(db,`SELECT a.id,a.name,a.mime,a.deleted_at FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id WHERE a.id=? AND a.project_id=? AND ${scope}`,photo?[attachmentId,projectId,itemId]:[attachmentId,projectId,itemId,movementId]);
 if(!attachment)invalid(photo?'Esta foto não pertence a este material.':'Este arquivo não pertence a esta movimentação.','attachment_not_found',404);
 if(attachment.deleted_at)invalid('Este arquivo já foi excluído.','attachment_changed',409);
 if(photo&&String(attachment.mime).startsWith('image/')){
  const pointer=await one(db,'SELECT attachment_id FROM item_primary_photos WHERE item_id=? ORDER BY sequence DESC LIMIT 1',[itemId]);
  const fallback=pointer?null:await one(db,`SELECT a.id FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id WHERE r.item_id=? AND r.project_id=? AND ${GALLERY_SQL} AND a.deleted_at IS NULL AND a.mime LIKE 'image/%' ORDER BY a.display_order,a.created_at DESC,a.id LIMIT 1`,[itemId,projectId]);
  const images=Number((await one(db,`SELECT COUNT(*) n FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id WHERE r.item_id=? AND r.project_id=? AND ${GALLERY_SQL} AND a.deleted_at IS NULL AND a.mime LIKE 'image/%'`,[itemId,projectId]))?.n??0);
  if(pointer?.attachment_id===attachmentId||(fallback?.id===attachmentId&&images>1))invalid('Esta é a foto principal. Escolha outra foto principal antes de excluir esta.','primary_photo_delete',409);
 }
 const now=new Date().toISOString();
 try{
  await capabilityBatch(db,actor,'inventory.manage',projectId,[mutation.claimStatement(attachmentId),
   db.prepare('INSERT INTO record_attachment_deletions(attachment_id,project_id,item_id,movement_id,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(attachmentId,projectId,itemId,movementId,reason,actor.userId,now),
   db.prepare('UPDATE record_attachments SET deleted_at=? WHERE id=? AND deleted_at IS NULL').bind(now,attachmentId),
   db.prepare('INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.userId,projectId,action,attachmentId,JSON.stringify({itemId,movementId,reason,name:attachment.name}),now),
  ]);
 }catch(error){
  if(error instanceof HttpError&&error.status===403)throw error;
  const replay=await mutation.recover(error).catch(()=>null);if(replay)return{deleted:{attachmentId},duplicate:true};
  translate(error);
 }
 return{deleted:{attachmentId,reason,createdAt:now}};
}

export async function movementAction(db:D1Database,actor:PortalActor,action:string,input:Record<string,unknown>):Promise<Record<string,unknown>|null>{
 if(action==='stock.revise')return reviseMovement(db,actor,input);
 if(action==='stock.evidence.prepare')return evidenceRecord(db,actor,input);
 if(action==='item.photo.delete'||action==='stock.attachment.delete')return deleteAttachment(db,actor,action,input);
 return null;
}

/** Deleted photos or files: who, when and why (the file itself is no longer served). */
export async function attachmentDeletions(db:D1Database,where:string,params:unknown[]):Promise<Row[]>{
 return(await all(db,`SELECT d.attachment_id attachmentId,d.movement_id movementId,a.name,a.mime,d.reason,d.created_at createdAt,COALESCE(NULLIF(p.display_name,''),'Equipe') actorName
  FROM record_attachment_deletions d JOIN record_attachments a ON a.id=d.attachment_id LEFT JOIN profiles p ON p.user_id=d.actor_id WHERE ${where} ORDER BY d.created_at DESC LIMIT 100`,params));
}

/** Everything about one movement: before/after balance, origin, destination, corrections and evidence. */
export async function movementDetail(db:D1Database,actor:PortalActor|null,movementId:unknown):Promise<Record<string,unknown>>{
 if(!actor)invalid('Entre para consultar a movimentação.','unauthenticated',401);
 const{movement,item}=await movementWithItem(db,movementId);
 await requireLiveCapability(db,actor,'inventory.read',item.project_id);
 const ownRevision=await one(db,'SELECT root_movement_id,reversal_movement_id FROM stock_movement_revisions WHERE replacement_movement_id=? OR reversal_movement_id=?',[movement.id,movement.id]);
 const root=String(ownRevision?.root_movement_id??movement.id),role=!ownRevision?'original':ownRevision.reversal_movement_id===movement.id?'mirror':'correction';
 const revisions=await revisionsFor(db,'r.root_movement_id=?',[root]);
 const versionIds=[root,...revisions.map(revision=>revision.replacementMovementId).filter((id):id is string=>Boolean(id))];
 const chainIds=[...new Set([...versionIds,...revisions.map(revision=>revision.reversalMovementId)])];
 const marks=chainIds.map(()=>'?').join(',');
 const rows=await all(db,`SELECT m.*,COALESCE(NULLIF(p.display_name,''),'Equipe') actor_name,g.title group_title FROM stock_movements m LEFT JOIN profiles p ON p.user_id=m.actor_id LEFT JOIN activity_groups g ON g.id=m.group_id WHERE m.id IN(${marks}) AND m.item_id=?`,[...chainIds,item.id]);
 const byId=new Map(rows.map(row=>[String(row.id),row]));
 let contexts:Map<string,StockContext>;try{contexts=await movementContexts(db,actor,chainIds);}catch(error){throw translateRead(error);}
 const destinations=await movementDestinations(db,chainIds),assistant=await assistantMovements(db,rows.map(row=>({id:String(row.id),ref_id:row.ref_id})));
 const last=revisions.at(-1),currentId=!last?root:last.kind==='reversal'?null:last.replacementMovementId;
 const attachments=await all(db,`SELECT l.movement_id movementId,a.id,a.name,a.mime,a.size,a.created_at createdAt,COALESCE(NULLIF(p.display_name,''),'Equipe') actorName FROM stock_movement_records l JOIN record_attachments a ON a.record_id=l.record_id AND a.deleted_at IS NULL LEFT JOIN profiles p ON p.user_id=a.created_by WHERE l.movement_id IN(${marks}) ORDER BY a.created_at,a.id`,chainIds);
 const evidence=await all(db,`SELECT movement_id,record_id FROM stock_movement_records WHERE movement_id IN(${marks})`,chainIds);
 const balance=await one(db,'SELECT COALESCE(SUM(delta),0) before FROM stock_movements WHERE item_id=? AND rowid<(SELECT rowid FROM stock_movements WHERE id=?)',[item.id,movement.id]);
 const view=(id:string)=>{const row=byId.get(id);if(!row)return null;const revision=revisions.find(entry=>entry.replacementMovementId===id),superseded=revisions.find(entry=>entry.targetMovementId===id);
  return{id,delta:Number(row.delta),kind:String(row.kind),kindLabel:KIND_LABELS[String(row.kind)]??String(row.kind),note:String(row.note),createdAt:String(row.created_at),actorName:String(row.actor_name),groupTitle:row.group_title??null,
   context:contexts.get(id)??null,destination:destinations.get(id)??null as DestinationSummary|null,
   origin:revision?{via:'manual',label:`Corrigido por ${revision.actorName}`}:originLabel(assistant.has(id),String(row.actor_name)),
   status:superseded?superseded.kind==='reversal'?'undone':'corrected':'current',isMirror:revisions.some(entry=>entry.reversalMovementId===id),
   attachments:attachments.filter(file=>file.movementId===id).map(file=>({...file,url:`/api/records/files/${file.id}`})),recordId:evidence.find(entry=>entry.movement_id===id)?.record_id??null};};
 const manage=canManage(actor,item.project_id),before=Number(balance?.before??0);
 const deleted=await attachmentDeletions(db,`d.movement_id IN(${marks})`,chainIds);
 return{
  movement:view(movement.id),role,rootMovementId:root,currentMovementId:currentId,
  item:{id:item.id,projectId:item.project_id,name:item.name,unit:item.unit,stock:item.stock,reserved:item.reserved,category:item.category},
  balance:{before,after:before+movement.delta,current:item.stock},
  versions:versionIds.map(view).filter(Boolean),revisions,deletedAttachments:deleted,
  permissions:{canManage:manage,canRevise:manage&&role!=='mirror'&&currentId===movement.id&&MANUAL_KINDS.includes(movement.kind)&&item.category!=='equipment',canAttach:manage&&role!=='mirror'},
 };
}
function translateRead(error:unknown){if(String(error).includes('stock_context_access_changed'))return new HttpError(403,'Seu acesso mudou. Atualize a página.','access_changed');return error;}
