import {memberProjectScopeSql,type PortalActor} from './access';
import {one,iso,uid} from './database';
import {HttpError} from './errors';
import {prepareMutation} from './mutations';
import {activeAccount} from './follow-up/scope';
import {responsibilityDirect,responsibilityTeam} from './responsibilities/scope';
import {choices,ids,onlyKeys} from './follow-up/contracts';
import type {MaterialAttentionInbox,MaterialAttentionNotice} from './material-attention-contracts';

const PAGE=6;
function fail(message:string,code='material_attention_invalid',status=400):never{throw new HttpError(status,message,code);}
function actorRequired(actor:PortalActor|null):asserts actor is PortalActor{if(!actor)fail('Entre para consultar seus avisos de materiais.','unauthenticated',401);}
function positive(value:unknown,optional=false):number|null{if(optional&&(value===null||value===undefined||value===''))return null;if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)fail('Consulte novamente a página de avisos.');return value as number;}
/** Duty is not permission. Material access AND a current explicit item/area/project duty are required. */
function eligibility(user:string){return `e.resolved_at IS NULL AND i.category!='equipment' AND i.condition='active' AND i.stock-i.reserved<=i.low_stock
 AND o.status='active' AND EXISTS(SELECT 1 FROM portal_users attention_user WHERE attention_user.user_id=${user} AND ${activeAccount('attention_user')})
 AND EXISTS(SELECT 1 FROM members attention_member WHERE attention_member.user_id=${user} AND attention_member.revoked_at IS NULL AND attention_member.role IN('owner','manager','inventory') AND ${memberProjectScopeSql('attention_member','p.id')})
 AND EXISTS(SELECT 1 FROM work_responsibility_scopes s WHERE s.organization_id=p.organization_id AND s.project_id=p.id AND s.status='active'
 AND(s.area='projects' OR(s.area='materials' AND(s.item_id IS NULL OR s.item_id=i.id)))
 AND(${responsibilityDirect(user)} OR ${responsibilityTeam(user)}))`;}
const from=`material_attention_episodes e JOIN items i ON i.id=e.item_id AND i.project_id=e.project_id JOIN projects p ON p.id=i.project_id JOIN organizations o ON o.id=p.organization_id`;
async function activeUser(db:D1Database,actor:PortalActor){if(!await one(db,`SELECT 1 FROM portal_users attention_account WHERE attention_account.user_id=? AND ${activeAccount('attention_account')}`,[actor.userId]))fail('Sua conta mudou. Entre novamente para consultar.','unauthenticated',401);}
export async function materialAttentionInbox(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>={}):Promise<MaterialAttentionInbox>{
 actorRequired(actor);onlyKeys(input,['before','includeDismissed']);const before=positive(input.before,true),includeDismissed=input.includeDismissed??false;if(typeof includeDismissed!=='boolean')fail('Escolha uma consulta válida.');await activeUser(db,actor);
 const read=()=>one(db,`WITH caller AS(SELECT ? user_id), eligible AS(
 SELECT e.id,e.sequence,e.opened_at,e.opened_available,e.opened_threshold,e.cause,i.id item_id,i.project_id,i.name material,i.unit,i.stock-i.reserved available,i.low_stock threshold,p.name project_name,r.read_at,r.dismissed_at
 FROM caller JOIN ${from} LEFT JOIN material_attention_receipts r ON r.episode_id=e.id AND r.user_id=caller.user_id WHERE ${eligibility('caller.user_id')}),
 page AS(SELECT * FROM eligible WHERE(?=1 OR dismissed_at IS NULL) AND(? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ${PAGE+1})
 SELECT (SELECT COUNT(*) FROM eligible WHERE read_at IS NULL AND dismissed_at IS NULL) unread,(SELECT COUNT(*) FROM eligible WHERE ?=1 OR dismissed_at IS NULL) total,
 (SELECT json_group_array(json_object('id',id,'sequence',sequence,'itemId',item_id,'projectId',project_id,'material',material,'unit',unit,'projectName',project_name,'available',available,'threshold',threshold,'openedAt',opened_at,'openedAvailable',opened_available,'openedThreshold',opened_threshold,'cause',cause,'readAt',read_at,'dismissedAt',dismissed_at)) FROM page) notices
 FROM portal_users account JOIN caller ON account.user_id=caller.user_id WHERE ${activeAccount('account')}`,[actor.userId,includeDismissed?1:0,before,before,includeDismissed?1:0]);
 const first=await read(),last=await read();if(!first||!last)fail('Sua conta mudou. Entre novamente.','unauthenticated',401);if(JSON.stringify(first)!==JSON.stringify(last))fail('Os avisos ou seus acessos mudaram. Atualize para conferir.','material_attention_changed',409);
 const notices=JSON.parse(last.notices) as MaterialAttentionNotice[],hasMore=notices.length>PAGE;return{viewerId:actor.userId,notices:notices.slice(0,PAGE),unread:last.unread,total:last.total,hasMore,nextBefore:hasMore?notices[PAGE-1].sequence:null,asOf:iso(),includeDismissed};
}
export async function materialAttentionAction(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>){
 actorRequired(actor);onlyKeys(input,['action','episodeIds','operationKey']);const action=choices(input.action,['read','dismiss','restore'] as const),episodeIds=ids(input.episodeIds,PAGE);if(!episodeIds.length)fail('Escolha um aviso de materiais.');await activeUser(db,actor);
 const mutation=await prepareMutation(db,actor.userId,`material-attention.${action}`,{...input,episodeIds});
 const assertions=episodeIds.map(episodeId=>db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${from} WHERE e.id=? AND ${eligibility('?')}) THEN 1 ELSE json_extract('[]','material_attention_access_changed') END`).bind(episodeId,...Array(4).fill(actor.userId)));
 // eligibility repeats the caller in account, membership, direct and team expressions.
 const statements=[...assertions];let duplicate=Boolean(mutation.existingId);
 if(!mutation.existingId){
  const at=iso();statements.push(mutation.claimStatement(episodeIds[0]));
  for(const episodeId of episodeIds)statements.push(db.prepare(`INSERT INTO material_attention_receipts(episode_id,user_id,read_at,dismissed_at,updated_at) VALUES(?,?,?,?,?)
   ON CONFLICT(episode_id,user_id) DO UPDATE SET read_at=COALESCE(material_attention_receipts.read_at,excluded.read_at),dismissed_at=${action==='read'?'material_attention_receipts.dismissed_at':'excluded.dismissed_at'},updated_at=excluded.updated_at`).bind(episodeId,actor.userId,action==='restore'?null:at,action==='dismiss'?at:null,at));
  statements.push(db.prepare('INSERT INTO audit(id,actor_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),actor.userId,`material-attention.${action}`,episodeIds[0],JSON.stringify({episodeIds}),at));
 }
 try{await db.batch(statements);}catch(error){if(String(error).includes('material_attention_access_changed'))fail('O estoque, sua designação ou seu acesso mudou. Atualize os avisos.','material_attention_forbidden',403);try{await mutation.recover(error);duplicate=true;}catch(recovered){throw recovered;}}
 // No title or receipt is returned without a new live authorization fence.
 try{await db.batch(assertions);}catch{fail('Seu acesso ou o estoque mudou. Atualize os avisos.','material_attention_forbidden',403);}
 return{viewerId:actor.userId,episodeIds,action,saved:true,duplicate};
}
