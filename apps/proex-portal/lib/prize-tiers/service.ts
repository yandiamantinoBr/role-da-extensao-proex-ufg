import type {PortalActor} from '../access';
import {one,iso,uid} from '../database';
import {HttpError} from '../errors';
import {prepareMutation} from '../mutations';
import {isRateLimitedError,rateLimitedError} from '../rate-limit';
import {id,text,integer,choices,onlyKeys} from '../follow-up/contracts';
import {actorRequired,authority} from '../follow-up/scope';
import {DEFAULT_SUPER_SUPER_PERCENT,PRIZE_TIERS,PRIZE_TIER_ACTIONS,PRIZE_TIER_LIMITS,type PrizeHistoryEntry,type PrizeOption,type PrizeTier,type PrizeTierActionResult,type PrizeTiersWorkspace} from './contracts';

/*
 * Access model, all from live SQL (authority()), repeated inside the write batch and after commit:
 * - read: any current role on the dynamic's project;
 * - write: owner/manager (campaigns.manage) on that project, active organization/project, dynamic not closed.
 * Levels are configuration. No statement here touches items, stock_movements, reservations or entitlements.
 */
function fail(message:string,code='prize_tiers_invalid',status=400):never{throw new HttpError(status,message,code);}
const FORBIDDEN='Você não tem acesso aos níveis desta dinâmica ou seu acesso mudou.';
/** Placeholders: campaignId, userId. */
const MANAGE=`EXISTS(SELECT 1 FROM campaigns guard_c JOIN projects guard_p ON guard_p.id=guard_c.project_id JOIN organizations guard_o ON guard_o.id=guard_p.organization_id
 WHERE guard_c.id=? AND guard_c.status!='closed' AND guard_o.status='active' AND guard_p.status='active' AND ${authority('?','guard_p.organization_id','guard_c.project_id',true,true)})`;
const manageFence=(db:D1Database,campaignId:string,userId:string)=>db.prepare(`SELECT CASE WHEN ${MANAGE} THEN 1 ELSE json_extract('[]','prize_authority_changed') END`).bind(campaignId,userId);
async function currentVersion(db:D1Database,userId:string,campaignId:string):Promise<number>{
 const row=await one(db,`SELECT COALESCE((SELECT version FROM campaign_prize_settings WHERE campaign_id=?),0) version WHERE ${MANAGE}`,[campaignId,campaignId,userId]);
 if(!row)fail('Seu acesso ou a situação da dinâmica mudou. Atualize a página.','prize_access_changed',403);
 return Number(row.version);
}

const READ_SQL=`WITH caller AS(SELECT ? user_id,? campaign_id),
 base AS(SELECT c.id,c.project_id,c.name,c.status,c.retry_limit,p.organization_id org_id,p.status project_status FROM caller JOIN campaigns c ON c.id=caller.campaign_id
  JOIN projects p ON p.id=c.project_id JOIN organizations o ON o.id=p.organization_id WHERE o.status='active' AND ${authority('caller.user_id','p.organization_id','c.project_id')}),
 management AS(SELECT (base.status!='closed' AND base.project_status='active' AND ${authority('caller.user_id','base.org_id','base.project_id',true,true)}) can_manage FROM caller JOIN base),
 opts AS(SELECT o.id,o.name,t.tier,t.updated_at,COALESCE(NULLIF(pf.display_name,''),CASE WHEN t.updated_by IS NULL THEN NULL ELSE 'Equipe' END) updated_by
  FROM base JOIN offers o ON o.project_id=base.project_id LEFT JOIN campaign_prize_tiers t ON t.campaign_id=base.id AND t.offer_id=o.id LEFT JOIN profiles pf ON pf.user_id=t.updated_by
  WHERE o.active=1 OR t.tier IS NOT NULL ORDER BY o.name,o.id LIMIT ${PRIZE_TIER_LIMITS.options+1}),
 hist AS(SELECT h.id,h.kind,o.name offer_name,h.previous_tier,h.tier,h.previous_percent,h.percent,COALESCE(NULLIF(pf.display_name,''),'Equipe') actor_name,h.created_at,h.sequence
  FROM base JOIN campaign_prize_history h ON h.campaign_id=base.id LEFT JOIN offers o ON o.id=h.offer_id LEFT JOIN profiles pf ON pf.user_id=h.actor_id ORDER BY h.sequence DESC LIMIT ${PRIZE_TIER_LIMITS.history}),
 mats AS(SELECT i.id,i.name,i.unit FROM base JOIN management ON management.can_manage=1 JOIN items i ON i.project_id=base.project_id WHERE i.category='gift' AND i.condition='active' ORDER BY i.name,i.id LIMIT 300)
 SELECT base.id,base.project_id,base.name,base.status,base.retry_limit,management.can_manage,
 s.version,s.super_super_percent,NOT EXISTS(SELECT 1 FROM campaign_prize_history ph WHERE ph.campaign_id=base.id AND ph.kind='percent') percent_default,
 (SELECT json_group_array(json_object('offerId',id,'name',name,'tier',tier,'updatedAt',updated_at,'updatedBy',updated_by,'components',json((SELECT json_group_array(json_object('itemId',i.id,'name',i.name,'unit',i.unit,'quantity',oc.quantity)) FROM offer_components oc JOIN items i ON i.id=oc.item_id WHERE oc.offer_id=opts.id)))) FROM opts) options,
 (SELECT json_group_array(json_object('id',id,'kind',kind,'offerName',offer_name,'previousTier',previous_tier,'tier',tier,'previousPercent',previous_percent,'percent',percent,'actorName',actor_name,'createdAt',created_at)) FROM (SELECT * FROM hist ORDER BY sequence DESC)) history,
 (SELECT json_group_array(json_object('id',id,'name',name,'unit',unit)) FROM mats) materials
 FROM base JOIN management LEFT JOIN campaign_prize_settings s ON s.campaign_id=base.id`;

/** GET performs no writes. Two identical reads; the second is the final fence. */
export async function prizeTiersWorkspace(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>={}):Promise<PrizeTiersWorkspace>{
 actorRequired(actor);onlyKeys(input,['campaignId']);const campaignId=id(input.campaignId)!;
 const read=async()=>{
  const row=await one(db,READ_SQL,[actor.userId,campaignId]);if(!row)fail(FORBIDDEN,'prize_tiers_forbidden',403);
  const options=JSON.parse(row.options) as PrizeOption[];if(options.length>PRIZE_TIER_LIMITS.options)fail('Há opções demais para mostrar. Peça uma revisão aos responsáveis.','prize_tiers_limit',409);
  return{projectId:row.project_id as string,campaign:{name:row.name,status:row.status,retryLimit:row.retry_limit??null},canManage:Boolean(row.can_manage),
   version:Number(row.version??0),superSuperPercent:row.super_super_percent??DEFAULT_SUPER_SUPER_PERCENT,percentIsDefault:Boolean(row.percent_default),
   options:options.map(o=>({...o,components:(o.components??[]).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))})),history:JSON.parse(row.history) as PrizeHistoryEntry[],materials:JSON.parse(row.materials)};
 };
 const first=await read(),last=await read();
 if(JSON.stringify(first)!==JSON.stringify(last)){
  if(first.canManage!==last.canManage)fail('Seu acesso mudou. Atualize a página.','prize_access_changed',403);
  fail('Os níveis mudaram durante a consulta. Atualize para conferir a nova versão.','prize_tiers_changed',409);
 }
 return{viewerId:actor.userId,campaignId,...last,asOf:iso()};
}

function translate(error:unknown):never{
 const cause=String(error);
 if(cause.includes('prize_authority_changed')||cause.includes('portal_authority_changed'))fail('Seu acesso ou a situação da dinâmica mudou. Atualize a página.','prize_access_changed',403);
 if(cause.includes('prize_version_changed')||cause.includes('prize_settings_version'))fail('Outra pessoa mudou os níveis agora há pouco. Atualize e confira antes de salvar.','prize_tiers_conflict',409);
 if(cause.includes('prize_no_change'))fail('Esta opção já está nesse nível. Atualize e confira o estado atual.','prize_tiers_unchanged',409);
 if(cause.includes('prize_tier_scope')||cause.includes('FOREIGN KEY constraint failed'))fail('A opção precisa ser um brinde ou kit do mesmo projeto da dinâmica.','prize_tier_scope',409);
 if(cause.includes('CHECK constraint failed'))fail('Os dados não passaram na conferência de integridade. Atualize e revise.','prize_tiers_invalid',409);
 throw error;
}

/**
 * Mutations. Idempotency keys are scoped per actor + action + dynamic.
 * `rateCount` (from rateLimitStatements) enters the same write batch: an allowed action costs one commit,
 * and a replay or refused attempt writes nothing.
 */
export async function prizeTiersAction(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>,rateCount:D1PreparedStatement[]=[]):Promise<PrizeTierActionResult>{
 actorRequired(actor);if(!input||typeof input!=='object'||Array.isArray(input))fail('Dados inválidos.');
 const action=choices(input.action,PRIZE_TIER_ACTIONS);
 onlyKeys(input,['action','campaignId','expectedVersion','operationKey',...(action==='tier.set'?['offerId','tier']:action==='percent.set'?['superSuperPercent']:['name','tier','components'])]);
 const campaignId=id(input.campaignId)!,revision=input.expectedVersion;
 if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<0)fail('Atualize os níveis antes de salvar.','prize_tiers_version');
 // Every payload field is validated before any database access.
 let offerId:string|null=null,tier:PrizeTier|null=null,percent:number|null=null,name='';let components:{itemId:string;quantity:number}[]=[];
 if(action==='tier.set'){offerId=id(input.offerId)!;tier=input.tier===null?null:choices(input.tier,PRIZE_TIERS);}
 else if(action==='percent.set'){percent=integer(input.superSuperPercent,100);}
 else{
  name=text(input.name,PRIZE_TIER_LIMITS.name);tier=choices(input.tier,PRIZE_TIERS);
  if(!Array.isArray(input.components)||input.components.length<1||input.components.length>PRIZE_TIER_LIMITS.components)fail(`Inclua de 1 a ${PRIZE_TIER_LIMITS.components} materiais na opção.`);
  const seen=new Set<string>();
  components=input.components.map(component=>{
   if(!component||typeof component!=='object'||Array.isArray(component))fail('Composição inválida.');
   const row=component as Record<string,unknown>;onlyKeys(row,['itemId','quantity']);const itemId=id(row.itemId)!,quantity=integer(row.quantity,PRIZE_TIER_LIMITS.quantity);
   if(quantity<1)fail('A quantidade de cada material vai de 1 a 1000.');if(seen.has(itemId))fail('Um material foi incluído mais de uma vez.');seen.add(itemId);return{itemId,quantity};
  });
 }

 const target=await one(db,`SELECT c.project_id,c.status,p.organization_id org_id FROM campaigns c JOIN projects p ON p.id=c.project_id JOIN organizations o ON o.id=p.organization_id
  WHERE c.id=? AND o.status='active' AND p.status='active' AND ${authority('?','p.organization_id','c.project_id',true,true)}`,[campaignId,actor.userId]);
 if(!target)fail(FORBIDDEN,'prize_tiers_forbidden',403);
 if(target.status==='closed')fail('A dinâmica encerrada conserva seus níveis como histórico.','prize_tiers_closed',409);
 const projectId=target.project_id as string;
 if(offerId&&!await one(db,'SELECT id FROM offers WHERE id=? AND project_id=?',[offerId,projectId]))fail('A opção precisa ser um brinde ou kit do mesmo projeto da dinâmica.','prize_tier_scope',409);
 for(const component of components){
  const item=await one(db,'SELECT project_id,category,condition FROM items WHERE id=?',[component.itemId]);
  if(!item||item.project_id!==projectId)fail('Todos os materiais devem pertencer ao projeto da dinâmica.','prize_tier_scope',409);
  if(item.category!=='gift'||item.condition!=='active')fail('Use materiais ativos da categoria Brindes.','prize_tiers_invalid',409);
 }

 const mutation=await prepareMutation(db,actor.userId,`prize_tiers.${action}:${campaignId}`,input);
 if(mutation.existingId)return{viewerId:actor.userId,campaignId,entityId:mutation.existingId,version:await currentVersion(db,actor.userId,campaignId),duplicate:true};

 const at=iso(),entityId=offerId??(action==='option.create'?uid():campaignId),changes:D1PreparedStatement[]=[];
 const settings=action==='percent.set'
  ?db.prepare('INSERT INTO campaign_prize_settings(campaign_id,super_super_percent,version,updated_by,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(campaign_id) DO UPDATE SET super_super_percent=excluded.super_super_percent,version=campaign_prize_settings.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(campaignId,percent,actor.userId,at)
  :db.prepare('INSERT INTO campaign_prize_settings(campaign_id,super_super_percent,version,updated_by,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(campaign_id) DO UPDATE SET version=campaign_prize_settings.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(campaignId,DEFAULT_SUPER_SUPER_PERCENT,actor.userId,at);
 let details:Record<string,unknown>;
 if(action==='tier.set'){
  details={offerId,tier};
  changes.push(db.prepare("SELECT CASE WHEN (SELECT tier FROM campaign_prize_tiers WHERE campaign_id=? AND offer_id=?) IS NOT ? THEN 1 ELSE json_extract('[]','prize_no_change') END").bind(campaignId,offerId,tier),settings,
   db.prepare("INSERT INTO campaign_prize_history(id,campaign_id,project_id,kind,offer_id,previous_tier,tier,actor_id,created_at) SELECT ?,?,?,'tier',?,(SELECT tier FROM campaign_prize_tiers WHERE campaign_id=? AND offer_id=?),?,?,?").bind(uid(),campaignId,projectId,offerId,campaignId,offerId,tier,actor.userId,at),
   tier===null
    ?db.prepare('DELETE FROM campaign_prize_tiers WHERE campaign_id=? AND offer_id=?').bind(campaignId,offerId)
    :db.prepare('INSERT INTO campaign_prize_tiers(campaign_id,offer_id,tier,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(campaign_id,offer_id) DO UPDATE SET tier=excluded.tier,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(campaignId,offerId,tier,actor.userId,at));
 }else if(action==='percent.set'){
  details={superSuperPercent:percent};
    // Until someone saves a value, the 25% premise is unconfirmed: saving 25 then is a real decision.
  const confirmed="EXISTS(SELECT 1 FROM campaign_prize_history WHERE campaign_id=? AND kind='percent')";
  changes.push(db.prepare(`SELECT CASE WHEN NOT ${confirmed} OR (SELECT super_super_percent FROM campaign_prize_settings WHERE campaign_id=?) IS NOT ? THEN 1 ELSE json_extract('[]','prize_no_change') END`).bind(campaignId,campaignId,percent),
   db.prepare(`INSERT INTO campaign_prize_history(id,campaign_id,project_id,kind,previous_percent,percent,actor_id,created_at) SELECT ?,?,?,'percent',CASE WHEN ${confirmed} THEN (SELECT super_super_percent FROM campaign_prize_settings WHERE campaign_id=?) END,?,?,?`).bind(uid(),campaignId,projectId,campaignId,campaignId,percent,actor.userId,at),
   settings);
 }else{
  // A new option is a regular kit (offer) of the project; its legacy kind only mirrors Brinde vs Super.
  details={offerId:entityId,name,tier,components};
  changes.push(db.prepare('INSERT INTO offers(id,project_id,name,kind,active) VALUES(?,?,?,?,1)').bind(entityId,projectId,name,tier==='brinde'?'brinde':'super'),
   ...components.map(component=>db.prepare('INSERT INTO offer_components(offer_id,item_id,quantity) VALUES(?,?,?)').bind(entityId,component.itemId,component.quantity)),
   settings,
   db.prepare("INSERT INTO campaign_prize_history(id,campaign_id,project_id,kind,offer_id,previous_tier,tier,actor_id,created_at) VALUES(?,?,?,'tier',?,NULL,?,?,?)").bind(uid(),campaignId,projectId,entityId,tier,actor.userId,at),
   db.prepare('INSERT INTO campaign_prize_tiers(campaign_id,offer_id,tier,updated_by,updated_at) VALUES(?,?,?,?,?)').bind(campaignId,entityId,tier,actor.userId,at));
 }
 const statements=[
  ...rateCount,
  manageFence(db,campaignId,actor.userId),
  db.prepare("SELECT CASE WHEN COALESCE((SELECT version FROM campaign_prize_settings WHERE campaign_id=?),0)=? THEN 1 ELSE json_extract('[]','prize_version_changed') END").bind(campaignId,revision),
  mutation.claimStatement(entityId),...changes,
  db.prepare('INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(uid(),actor.userId,projectId,target.org_id,`prize_tiers.${action}`,entityId,JSON.stringify({campaignId,version:revision+1,...details}),at),
 ];
 try{await db.batch(statements);}
 catch(error){
  if(isRateLimitedError(error))rateLimitedError();
  let recovered:string;try{recovered=await mutation.recover(error);}catch(cause){translate(cause);}
  return{viewerId:actor.userId,campaignId,entityId:recovered,version:await currentVersion(db,actor.userId,campaignId),duplicate:true};
 }
 // Post-commit live fence: no receipt for an actor who lost authority meanwhile.
 await currentVersion(db,actor.userId,campaignId);
 return{viewerId:actor.userId,campaignId,entityId,version:revision+1,duplicate:false};
}
