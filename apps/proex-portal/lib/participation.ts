import {one,all,uid,iso,text,type Row} from './database';
import {HttpError} from './errors';
import {requireLiveCapability,capabilityBatch,requireLiveAccount,accountBatch,type PortalActor} from './access';
import {activeCampaign,prizeComponents,audit} from './campaigns';
const outcomes=['brinde','retry','brinde','super','miss','brinde'] as const;
function randomResult(){const n=new Uint32Array(1);do{crypto.getRandomValues(n);}while(n[0]>=4294967292);return outcomes[n[0]%6];}
function operation(value:unknown){const key=text(value,120);if(!/^[\w-]{8,120}$/.test(key))throw new HttpError(400,'Identificador da operação inválido.');return key;}
export async function participationView(db:D1Database,id:string):Promise<Row|null>{const p=await one(db,'SELECT id,state,modality,attempt_count,identity_method,created_at FROM participations WHERE id=?',[id]);if(!p)return null;return {...p,attempts:await all(db,'SELECT id,number,result,state FROM attempts WHERE participation_id=? ORDER BY number',[id]),entitlements:await all(db,'SELECT e.id,e.state,o.name offer_name FROM entitlements e JOIN offers o ON o.id=e.offer_id WHERE e.participation_id=?',[id])};}
async function replay(db:D1Database,attempt:Row){return {attempt:{id:attempt.id,number:attempt.number,result:attempt.result},participation:await participationView(db,attempt.participation_id),entitlement:await one(db,'SELECT e.id,e.state,o.name offer_name FROM entitlements e JOIN offers o ON o.id=e.offer_id WHERE e.attempt_id=?',[attempt.id])};}
// Row preserva o contrato legado das consultas e dos serviços de participação.
export async function draw(db:D1Database,campaignId:string,user:{userId:string},input:Record<string,unknown>){
 await requireLiveAccount(db,user.userId);
 const modality=text(input.modality,20);if(!['wheel','dice','physical'].includes(modality))throw new HttpError(400,'Escolha roleta, dado ou atendimento presencial.');const key=`${campaignId}:${user.userId}:${operation(input.operationKey)}`;
 const existing=await one(db,'SELECT a.* FROM attempts a JOIN participations p ON p.id=a.participation_id WHERE a.idempotency_key=? AND p.identity_id=? AND p.campaign_id=?',[key,user.userId,campaignId]);if(existing)return replay(db,existing);
 const c=await activeCampaign(db,campaignId),components=await prizeComponents(db,c);
 const p=await one(db,'SELECT * FROM participations WHERE campaign_id=? AND identity_id=?',[campaignId,user.userId]);
 if(p&&!['ready','retry_ready'].includes(p.state))throw new HttpError(409,'Sua participação nesta ação já foi utilizada.');if(p&&p.modality!==modality)throw new HttpError(409,'Continue na modalidade escolhida na primeira tentativa.');
 const pid=p?.id||uid(),number=(p?.attempt_count||0)+1,attemptId=uid(),now=iso();let result:string=modality==='physical'?'pending':randomResult();if(result==='retry'&&number>c.retry_limit)result='retry_exhausted';
 const chosen=result==='brinde'?c.brinde_offer_id:result==='super'?c.super_offer_id:null;
 const statements:D1PreparedStatement[]=[];
 if(!p)statements.push(db.prepare("INSERT INTO participations(id,campaign_id,identity_id,identity_method,modality,attempt_count,state,created_at) VALUES(?,?,?,'account',?,0,'ready',?)").bind(pid,c.id,user.userId,modality,now));
 statements.push(db.prepare("INSERT INTO attempts(id,participation_id,number,idempotency_key,result,state,created_at) VALUES(?,?,?,?,?,?,?)").bind(attemptId,pid,number,key,result,result==='pending'?'pending':'done',now));
 for(const row of components)statements.push(db.prepare("INSERT INTO reservations(id,participation_id,attempt_id,offer_id,item_id,quantity,state) VALUES(?,?,?,?,?,?,'held')").bind(uid(),pid,attemptId,row.offer_id,row.item_id,row.quantity));
 if(result!=='pending')statements.push(db.prepare("UPDATE reservations SET state='released' WHERE attempt_id=? AND (? IS NULL OR offer_id<>?)").bind(attemptId,chosen,chosen));
 if(chosen)statements.push(db.prepare("INSERT INTO entitlements(id,attempt_id,participation_id,offer_id,state,created_at) VALUES(?,?,?,?,'reserved',?)").bind(uid(),attemptId,pid,chosen,now));
 statements.push(audit(db,user,'participation.draw',pid,c.project_id,now));
 try{await accountBatch(db,user.userId,statements);}catch(error){if(error instanceof HttpError&&error.status===403)throw error;const duplicate=await one(db,'SELECT * FROM attempts WHERE idempotency_key=?',[key]);if(duplicate){await requireLiveAccount(db,user.userId);return replay(db,duplicate);}throw error;}
 return replay(db,{id:attemptId,participation_id:pid,number,result});
}
export async function participationAction(db:D1Database,actor:PortalActor,action:string,input:Row):Promise<Row|null>{
 if(action==='participation.ticket'){
  const campaignId=text(input.campaignId,100),ticketKey=`ticket:${campaignId}:${actor.userId}:${operation(input.operationKey)}`;const repeated=await one(db,'SELECT a.*,c.project_id FROM attempts a JOIN participations p ON p.id=a.participation_id JOIN campaigns c ON c.id=p.campaign_id WHERE a.idempotency_key=? AND p.campaign_id=?',[ticketKey,campaignId]);if(repeated){await requireLiveCapability(db,actor,'participation.operate',repeated.project_id);return {participationId:repeated.participation_id,attemptId:repeated.id,state:(await participationView(db,repeated.participation_id))?.state};}const c=await activeCampaign(db,campaignId);await requireLiveCapability(db,actor,'participation.operate',c.project_id);const components=await prizeComponents(db,c);
  const previous=input.participationId?await one(db,"SELECT * FROM participations WHERE id=? AND campaign_id=? AND modality='physical'",[text(input.participationId,100),c.id]):null;
  if(input.participationId&&(!previous||previous.state!=='retry_ready'))throw new HttpError(409,'Este atendimento não tem repetição pendente.');
  const pid=previous?.id||uid(),attemptId=uid(),now=iso(),number=(previous?.attempt_count||0)+1,statements:D1PreparedStatement[]=[];
  if(!previous)statements.push(db.prepare("INSERT INTO participations(id,campaign_id,identity_id,identity_method,modality,attempt_count,state,created_at) VALUES(?,?,?,'ticket','physical',0,'ready',?)").bind(pid,c.id,`ticket:${uid()}`,now));
  statements.push(db.prepare("INSERT INTO attempts(id,participation_id,number,idempotency_key,result,state,created_at) VALUES(?,?,?,?,'pending','pending',?)").bind(attemptId,pid,number,ticketKey,now));
  for(const r of components)statements.push(db.prepare("INSERT INTO reservations(id,participation_id,attempt_id,offer_id,item_id,quantity,state) VALUES(?,?,?,?,?,?,'held')").bind(uid(),pid,attemptId,r.offer_id,r.item_id,r.quantity));
  statements.push(audit(db,actor,'participation.ticket',pid,c.project_id,now));try{await capabilityBatch(db,actor,'participation.operate',c.project_id,statements);}catch(error){if(error instanceof HttpError&&error.status===403)throw error;const repeat=await one(db,'SELECT * FROM attempts WHERE idempotency_key=?',[ticketKey]);if(repeat){await requireLiveCapability(db,actor,'participation.operate',c.project_id);return {participationId:repeat.participation_id,attemptId:repeat.id,state:(await participationView(db,repeat.participation_id))?.state};}throw error;}return {participationId:pid,attemptId,state:'physical_pending'};
 }
 if(action==='participation.physical'){
  const a=await one(db,'SELECT a.*,p.campaign_id,c.project_id,c.brinde_offer_id,c.super_offer_id,c.retry_limit FROM attempts a JOIN participations p ON p.id=a.participation_id JOIN campaigns c ON c.id=p.campaign_id WHERE a.id=?',[text(input.attemptId,100)]);if(!a)throw new HttpError(404,'Atendimento não encontrado.');await requireLiveCapability(db,actor,'participation.operate',a.project_id);
  if(a.state!=='pending')return replay(db,a);let result=text(input.result,30);if(!['brinde','super','miss','retry'].includes(result))throw new HttpError(400,'Resultado inválido.');if(result==='retry'&&a.number>a.retry_limit)result='retry_exhausted';
  const now=iso(),chosen=result==='brinde'?a.brinde_offer_id:result==='super'?a.super_offer_id:null;
  const statements=[db.prepare("UPDATE attempts SET result=?,state='done' WHERE id=? AND state='pending'").bind(result,a.id),db.prepare("UPDATE reservations SET state='released' WHERE attempt_id=? AND state='held' AND offer_id NOT IN (SELECT CASE result WHEN 'brinde' THEN ? WHEN 'super' THEN ? ELSE '' END FROM attempts WHERE id=?)").bind(a.id,a.brinde_offer_id,a.super_offer_id,a.id)];
  if(chosen)statements.push(db.prepare("INSERT OR IGNORE INTO entitlements(id,attempt_id,participation_id,offer_id,state,created_at) SELECT ?,?,?,?,'reserved',? WHERE EXISTS(SELECT 1 FROM attempts WHERE id=? AND result=? AND state='done')").bind(uid(),a.id,a.participation_id,chosen,now,a.id,result));
  statements.push(audit(db,actor,'participation.physical',a.participation_id,a.project_id,now));await capabilityBatch(db,actor,'participation.operate',a.project_id,statements);return replay(db,(await one(db,'SELECT * FROM attempts WHERE id=?',[a.id]))!);
 }
 if(action==='prize.redeem'){
  const e=await one(db,'SELECT e.*,o.project_id,o.name offer_name FROM entitlements e JOIN offers o ON o.id=e.offer_id WHERE e.id=?',[text(input.code,100)]);if(!e)throw new HttpError(404,'Código de brinde não encontrado.');await requireLiveCapability(db,actor,'inventory.deliver',e.project_id);operation(input.operationKey);
  if(e.state==='delivered')return {delivered:true,alreadyDelivered:true,offerName:e.offer_name};if(e.state!=='reserved')throw new HttpError(409,'Este código não pode ser entregue.');
  const rows=await all(db,"SELECT * FROM reservations WHERE attempt_id=? AND offer_id=? AND state='held'",[e.attempt_id,e.offer_id]);if(!rows.length)throw new HttpError(409,'A reserva do brinde precisa ser conferida.');const now=iso();
  const statements=[db.prepare("UPDATE entitlements SET state='delivered',delivered_at=?,delivered_by=? WHERE id=? AND state='reserved'").bind(now,actor.userId,e.id),db.prepare("UPDATE reservations SET state='consumed' WHERE attempt_id=? AND offer_id=? AND state='held'").bind(e.attempt_id,e.offer_id)];
  for(const r of rows)statements.push(db.prepare("INSERT OR IGNORE INTO stock_movements(id,item_id,delta,kind,note,ref_id,actor_id,created_at) VALUES(?,?,?,'redeem','Entrega de prêmio',?,?,?)").bind(uid(),r.item_id,-r.quantity,`prize:${e.id}:${r.item_id}`,actor.userId,now));
  statements.push(db.prepare("INSERT OR IGNORE INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,'prize.redeem',?,'{}',?)").bind(`redeem:${e.id}`,actor.userId,e.project_id,e.id,now));await capabilityBatch(db,actor,'inventory.deliver',e.project_id,statements);return {delivered:true,offerName:e.offer_name};
 }
 return null;
}
