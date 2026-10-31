import {all,one,iso,uid} from './database';
import {requireCapability,type PortalActor} from './access';
import {HttpError} from './errors';

const OWNER=`EXISTS(SELECT 1 FROM members m JOIN portal_users a ON a.user_id=m.user_id WHERE m.user_id=? AND m.role='owner' AND m.project_id IS NULL AND m.organization_id IS NULL AND m.revoked_at IS NULL AND a.status='active' AND a.activation_pending=0 AND a.anonymized_at IS NULL)`;
const ACTIVE="status='active' AND activation_pending=0 AND anonymized_at IS NULL";
export const privacyScopeNotice='Esta solicitação remove os dados da sua conta, seus identificadores de entrada, credenciais e foto. A equipe analisa a solicitação antes de executá-la. Contagens, histórico operacional e auditoria com identificador interno são preservados. Textos, termos assinados e anexos de terceiros não são apagados automaticamente e podem exigir análise institucional. A conta anonimizada não pode ser reativada.';

export async function listPrivacyRequests(db:D1Database,actor:PortalActor){
 const owner=await one(db,`SELECT 1 permitted WHERE ${OWNER}`,[actor.userId]);
 const rows=await all(db,`SELECT r.id,r.user_id,r.status,r.requested_at,r.reviewed_at,r.completed_at,u.email,p.display_name FROM privacy_requests r JOIN portal_users u ON u.user_id=r.user_id LEFT JOIN profiles p ON p.user_id=r.user_id WHERE ${owner?OWNER:'r.user_id=?'} ORDER BY CASE WHEN r.status IN ('pending','cleanup_pending') THEN 0 ELSE 1 END,r.requested_at DESC LIMIT 200`,[actor.userId]);
 return {requests:rows.map(r=>({id:r.id,userId:r.user_id,status:r.status,requestedAt:r.requested_at,reviewedAt:r.reviewed_at,completedAt:r.completed_at,...(owner?{email:r.email,displayName:r.display_name||null}:{})})),canReview:!!owner,notice:privacyScopeNotice};
}
/** Password proof is performed by the account route before invoking this service. */
export async function requestPrivacy(db:D1Database,userId:string){
 const id=uid(),now=iso();
 const result=await db.batch([
  db.prepare(`INSERT INTO privacy_requests(id,user_id,status,requested_at,reason) SELECT ?,?,'pending',?,'account_anonymization' FROM portal_users WHERE user_id=? AND ${ACTIVE} AND NOT EXISTS(SELECT 1 FROM privacy_requests WHERE user_id=? AND status IN ('pending','cleanup_pending'))`).bind(id,userId,now,userId,userId),
  db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,NULL,'privacy.request',?,'{}',? WHERE changes()=1").bind(uid(),userId,id,now),
 ]);
 const saved=await one(db,"SELECT id,status,requested_at FROM privacy_requests WHERE user_id=? AND status IN ('pending','cleanup_pending') ORDER BY requested_at DESC LIMIT 1",[userId]);
 if(!saved)throw new HttpError(403,'Seu acesso mudou. Entre novamente.','account_blocked');
 return {ok:true,id:saved.id,status:saved.status,replayed:result[0].meta.changes!==1};
}

async function cleanupPrivateObjects(db:D1Database,actor:PortalActor,requestId:string,userId:string,storage:R2Bucket){
 // Object keys are internal and never returned by the account API.
 const pending=await all(db,`SELECT q.id,q.object_key FROM private_object_deletions q WHERE q.user_id=? AND q.deleted_at IS NULL AND EXISTS(SELECT 1 FROM privacy_requests WHERE id=? AND status='cleanup_pending') AND ${OWNER} ORDER BY q.created_at,q.id LIMIT 100`,[userId,requestId,actor.userId]);
 for(const entry of pending){
  if(!await one(db,`SELECT 1 permitted WHERE ${OWNER}`,[actor.userId]))throw new HttpError(403,'Seu acesso mudou. Atualize a página.');
  try{if(entry.object_key)await storage.delete(entry.object_key);}catch{continue;}
  await db.prepare(`UPDATE private_object_deletions SET deleted_at=?,object_key=NULL,mime=NULL WHERE id=? AND user_id=? AND ${OWNER}`).bind(iso(),entry.id,userId,actor.userId).run();
 }
 await db.prepare(`UPDATE privacy_requests SET status='completed',completed_at=? WHERE id=? AND user_id=? AND status='cleanup_pending'
  AND NOT EXISTS(SELECT 1 FROM private_object_deletions WHERE user_id=? AND deleted_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM sync_attachment_exports e WHERE e.deleted_at IS NULL AND
    ((e.attachment_kind='avatar' AND e.attachment_id=?)
    OR (e.attachment_kind='record' AND e.attachment_id IN(SELECT id FROM record_attachments WHERE created_by=?))
    OR (e.attachment_kind='loan' AND e.attachment_id IN(SELECT id FROM documents WHERE created_by=?))))
  AND ${OWNER}`).bind(iso(),requestId,userId,userId,userId,userId,userId,actor.userId).run();
 const current=await one(db,'SELECT status,completed_at FROM privacy_requests WHERE id=?',[requestId]);
 return {ok:true,id:requestId,status:current?.status,completedAt:current?.completed_at??null};
}

export async function resolvePrivacy(db:D1Database,actor:PortalActor,input:Record<string,unknown>,storage:R2Bucket){
 requireCapability(actor,'organization.manage',null);
 if(typeof input.requestId!=='string'||!['anonymize','reject'].includes(String(input.decision)))throw new HttpError(400,'Escolha uma solicitação e uma decisão válidas.');
 const request=await one(db,`SELECT r.* FROM privacy_requests r WHERE r.id=? AND ${OWNER}`,[input.requestId,actor.userId]);
 if(!request)throw new HttpError(404,'Solicitação não encontrada ou seu acesso mudou.');
 if(request.user_id===actor.userId)throw new HttpError(409,'Outro responsável deve revisar sua solicitação.','self_anonymization_forbidden');
 if(request.status==='completed'||request.status==='rejected')return {ok:true,id:request.id,status:request.status,replayed:true};
 if(request.status==='cleanup_pending'){
  if(input.decision!=='anonymize')throw new HttpError(409,'A conta já foi anonimizada; conclua a remoção da foto.');
  return cleanupPrivateObjects(db,actor,request.id,request.user_id,storage);
 }
 const now=iso(),auditId=uid();
 if(input.decision==='reject'){
  const result=await db.batch([
   db.prepare(`UPDATE privacy_requests SET status='rejected',reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending' AND ${OWNER}`).bind(actor.userId,now,request.id,actor.userId),
   db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,NULL,'privacy.rejected',?,'{}',? WHERE changes()=1").bind(auditId,actor.userId,request.user_id,now),
  ]);
  if(result[0].meta.changes!==1)throw new HttpError(409,'A solicitação ou seu acesso mudou.');
  return {ok:true,id:request.id,status:'rejected'};
 }
 const confirmed=`EXISTS(SELECT 1 FROM audit WHERE id=?)`;
 const conditions=`user_id=? AND anonymized_at IS NULL AND ${OWNER} AND EXISTS(SELECT 1 FROM privacy_requests WHERE id=? AND user_id=portal_users.user_id AND status='pending') AND (NOT EXISTS(SELECT 1 FROM members WHERE members.user_id=portal_users.user_id AND role='owner' AND project_id IS NULL AND organization_id IS NULL AND revoked_at IS NULL) OR (SELECT COUNT(DISTINCT m.user_id) FROM members m LEFT JOIN portal_users u ON u.user_id=m.user_id WHERE m.role='owner' AND m.project_id IS NULL AND m.organization_id IS NULL AND m.revoked_at IS NULL AND COALESCE(u.status,'active')='active' AND COALESCE(u.activation_pending,0)=0 AND u.anonymized_at IS NULL)>1)`;
 const target=request.user_id;
 const cleanup=(sql:string,...parameters:unknown[])=>db.prepare(sql).bind(...parameters,auditId);
 const results=await db.batch([
  db.prepare(`UPDATE portal_users SET email=NULL,status='blocked',activation_pending=0,anonymized_at=?,updated_at=? WHERE ${conditions}`).bind(now,now,target,actor.userId,request.id),
  db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,NULL,'privacy.anonymized',?,'{}',? WHERE changes()=1").bind(auditId,actor.userId,target,now),
  cleanup(`INSERT INTO private_object_deletions(id,user_id,object_key,mime,created_at) SELECT ?,user_id,avatar_key,mime,? FROM profiles WHERE user_id=? AND avatar_key IS NOT NULL AND ${confirmed}`,uid(),now,target),
  cleanup(`DELETE FROM login_identifiers WHERE user_id=? AND ${confirmed}`,target),
  cleanup(`UPDATE members SET email='',revoked_at=COALESCE(revoked_at,?) WHERE user_id=? AND ${confirmed}`,now,target),
  cleanup(`UPDATE invites SET revoked_at=COALESCE(revoked_at,?),email=CASE WHEN accepted_by=? THEN '' ELSE email END WHERE (created_by=? OR accepted_by=?) AND ${confirmed}`,now,target,target,target),
  cleanup(`UPDATE calendar_feeds SET revoked_at=COALESCE(revoked_at,?) WHERE owner_id=? AND ${confirmed}`,now,target),
  cleanup(`UPDATE sync_attachment_tickets SET used_at=COALESCE(used_at,?) WHERE (owner_id=? OR (attachment_kind='avatar' AND attachment_id=?)) AND ${confirmed}`,now,target,target),
  cleanup(`DELETE FROM auth_verification WHERE value IN(SELECT subject FROM identity_aliases WHERE user_id=? AND provider='password') AND ${confirmed}`,target),
  cleanup(`DELETE FROM auth_session WHERE user_id IN(SELECT subject FROM identity_aliases WHERE user_id=? AND provider='password') AND ${confirmed}`,target),
  cleanup(`DELETE FROM auth_account WHERE user_id IN(SELECT subject FROM identity_aliases WHERE user_id=? AND provider='password') AND ${confirmed}`,target),
  cleanup(`DELETE FROM auth_user WHERE id IN(SELECT subject FROM identity_aliases WHERE user_id=? AND provider='password') AND ${confirmed}`,target),
  cleanup(`DELETE FROM identity_aliases WHERE user_id=? AND ${confirmed}`,target),
  // The whole profile is removed, including unit_id, affiliation and private enrollment/contact fields.
  cleanup(`DELETE FROM profiles WHERE user_id=? AND ${confirmed}`,target),
  cleanup(`UPDATE privacy_requests SET status='cleanup_pending',reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending' AND ${confirmed}`,actor.userId,now,request.id),
 ]);
 if(results[0].meta.changes!==1||results[1].meta.changes!==1)throw new HttpError(409,'A solicitação ou seu acesso mudou. Preserve ao menos um responsável ativo.','privacy_conflict');
 return cleanupPrivateObjects(db,actor,request.id,target,storage);
}
