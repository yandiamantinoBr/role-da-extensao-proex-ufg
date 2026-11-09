import {requireCapability,requireLiveCapability,capabilityBatch,type PortalActor} from './access';
import {HttpError} from './errors';
import {prepareMutation} from './mutations';

/*
 * Primary photo of a material. The photo itself is a regular record attachment (uploaded first);
 * this module only appends a pointer. Nothing is deleted: earlier photos remain attachments and
 * the pointer log keeps who changed it, when, and the before/after images.
 * Write: inventory.manage on the material's project (live SQL in the same batch).
 * Read: whoever can read the material (materialDetail already fences inventory.read).
 */
export type PrimaryPhotoChange={id:string;attachmentId:string;previousAttachmentId:string|null;url:string;previousUrl:string|null;actorName:string;createdAt:string};
const PHOTO_RECORD=`r.item_id=? AND r.project_id=? AND r.loan_id IS NULL AND r.kind IN ('material','maintenance','distribution','consumption')`;
const fileUrl=(attachmentId:string)=>`/api/records/files/${attachmentId}`;
function identifier(value:unknown,label:string,optional=false):string|null{
 if(optional&&(value===null||value===undefined||value===''))return null;
 if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value))throw new HttpError(400,`Selecione ${label}.`,'invalid_input');
 return value;
}
/**
 * Lista de materiais: id da foto principal de cada item, na mesma regra de `currentPrimaryPhoto`
 * (última escolha registrada ou, antes dela, a primeira foto da galeria). `items` é o alias da tabela.
 */
export const LIST_PRIMARY_PHOTO_SQL=`COALESCE(
 (SELECT pp.attachment_id FROM item_primary_photos pp WHERE pp.item_id=items.id AND pp.project_id=items.project_id ORDER BY pp.sequence DESC LIMIT 1),
 (SELECT a.id FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id
  WHERE r.item_id=items.id AND r.project_id=items.project_id AND r.loan_id IS NULL AND r.kind IN ('material','maintenance','distribution','consumption')
  AND a.deleted_at IS NULL AND a.mime LIKE 'image/%' ORDER BY a.display_order,a.created_at DESC,a.id LIMIT 1))`;
/** Before anyone chooses, the gallery order decides (newest first), as it always did. */
async function fallbackPhoto(db:D1Database,item:{id:string;project_id:string},exclude:string|null=null):Promise<string|null>{
 const row=await db.prepare(`SELECT a.id FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id
  WHERE ${PHOTO_RECORD} AND a.deleted_at IS NULL AND a.mime LIKE 'image/%' AND a.id IS NOT ? ORDER BY a.display_order,a.created_at DESC,a.id LIMIT 1`).bind(item.id,item.project_id,exclude).first<{id:string}>();
 return row?.id??null;
}
/** Current primary photo id: the latest explicit choice, or before any choice the first photo shown so far. */
export async function currentPrimaryPhoto(db:D1Database,item:{id:string;project_id:string}):Promise<{attachmentId:string|null;fromPointer:boolean}>{
 const pointer=await db.prepare('SELECT attachment_id FROM item_primary_photos WHERE item_id=? AND project_id=? ORDER BY sequence DESC LIMIT 1').bind(item.id,item.project_id).first<{attachment_id:string}>();
 if(pointer)return{attachmentId:pointer.attachment_id,fromPointer:true};
 return{attachmentId:await fallbackPhoto(db,item),fromPointer:false};
}
export async function primaryPhotoHistory(db:D1Database,item:{id:string;project_id:string},limit=20):Promise<PrimaryPhotoChange[]>{
 const rows=(await db.prepare(`SELECT h.id,h.attachment_id,h.previous_attachment_id,h.created_at,COALESCE(NULLIF(p.display_name,''),'Equipe') actor_name
  FROM item_primary_photos h LEFT JOIN profiles p ON p.user_id=h.actor_id WHERE h.item_id=? AND h.project_id=? ORDER BY h.sequence DESC LIMIT ?`).bind(item.id,item.project_id,limit).all<Record<string,string|null>>()).results??[];
 return rows.map(row=>({id:String(row.id),attachmentId:String(row.attachment_id),previousAttachmentId:row.previous_attachment_id??null,url:fileUrl(String(row.attachment_id)),previousUrl:row.previous_attachment_id?fileUrl(row.previous_attachment_id):null,actorName:String(row.actor_name),createdAt:String(row.created_at)}));
}
export async function setPrimaryPhoto(db:D1Database,actor:PortalActor,input:Record<string,unknown>):Promise<Record<string,unknown>>{
 if(Object.keys(input).some(key=>!['action','itemId','attachmentId','expectedAttachmentId','operationKey'].includes(key)))throw new HttpError(400,'Há campos não permitidos nesta operação.','invalid_input');
 const itemId=identifier(input.itemId,'o material')!,attachmentId=identifier(input.attachmentId,'a foto')!,expected=identifier(input.expectedAttachmentId,'a foto atual',true);
 const item=await db.prepare('SELECT id,project_id FROM items WHERE id=?').bind(itemId).first<{id:string;project_id:string}>();
 if(!item)throw new HttpError(404,'Material não encontrado.','not_found');
 requireCapability(actor,'inventory.manage',item.project_id);
 const mutation=await prepareMutation(db,actor.userId,`item.photo.primary:${item.id}`,{...input,expectedAttachmentId:expected});
 if(mutation.existingId){await requireLiveCapability(db,actor,'inventory.manage',item.project_id);return{primaryPhoto:{id:mutation.existingId,attachmentId},duplicate:true};}
 const photo=await db.prepare(`SELECT a.id FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id WHERE a.id=? AND ${PHOTO_RECORD} AND a.deleted_at IS NULL AND a.mime LIKE 'image/%'`).bind(attachmentId,item.id,item.project_id).first();
 if(!photo)throw new HttpError(409,'Esta foto não pertence a este material. Atualize a ficha.','primary_photo_invalid');
 const current=await currentPrimaryPhoto(db,item);let previous:string|null;
 const changed=()=>{throw new HttpError(409,'Outra pessoa trocou a foto principal agora há pouco. Atualize a ficha e confira antes de trocar.','primary_photo_changed');};
 if(current.fromPointer){
  if(current.attachmentId===attachmentId)throw new HttpError(409,'Esta já é a foto principal do material.','primary_photo_unchanged');
  if(current.attachmentId!==expected)changed();previous=current.attachmentId;
 }else{
  // First explicit choice. The photo the person saw as main is either the gallery's first photo
  // now, or the first one apart from a photo uploaded a moment ago for this very change.
  const others=await fallbackPhoto(db,item,attachmentId);
  if(expected!==current.attachmentId&&expected!==others)changed();previous=expected===attachmentId?null:expected;
 }
 const id=crypto.randomUUID(),now=new Date().toISOString();
 try{
  await capabilityBatch(db,actor,'inventory.manage',item.project_id,[
   mutation.claimStatement(id),
   db.prepare('INSERT INTO item_primary_photos(id,item_id,project_id,attachment_id,previous_attachment_id,actor_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,item.id,item.project_id,attachmentId,previous,actor.userId,now),
   db.prepare('INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.userId,item.project_id,'item.photo.primary',item.id,JSON.stringify({attachmentId,previousAttachmentId:previous}),now),
  ]);
 }catch(error){
  if(error instanceof HttpError)throw error;
  try{const replay=await mutation.recover(error);return{primaryPhoto:{id:replay,attachmentId},duplicate:true};}
  catch(cause){if(String(cause).includes('primary_photo_changed'))throw new HttpError(409,'Outra pessoa trocou a foto principal agora há pouco. Atualize a ficha e confira antes de trocar.','primary_photo_changed');throw cause;}
 }
 return{primaryPhoto:{id,attachmentId,previousAttachmentId:previous,createdAt:now}};
}
