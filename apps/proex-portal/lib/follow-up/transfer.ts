import { memberProjectScopeSql, type PortalActor } from '../access';
import { all, one, uid, iso, type Row } from '../database';
import { isRateLimitedError, rateLimitedError } from '../rate-limit';
import { fail } from './contracts';
import { authority, activeAccount, actorRequired, fanout, recipientLimit } from './scope';
import { transferInput, transferTaskId, type TransferBlocker, type TransferPreview, type TransferReceipt } from './transfer-contracts';

/**
 * Preserving transfer of a SIMPLE follow-up task to another active project of the same
 * organization (see drizzle/0031). Nothing is cloned, cancelled or deleted: the same
 * task row changes project_id/version/updated_at in ONE atomic batch together with an
 * immutable receipt, a history snapshot, two audit references, email invalidation and
 * in-app notices for currently authorized recipients only. No role, membership, MCP
 * token, email preference or e-mail send is ever created here.
 */
const ACTION = 'followup.transfer';
const CANDIDATE_LIMIT = 200;

/** Live owner/manager (campaigns.manage, never inventory/viewer) on an ACTIVE project of an
 * ACTIVE organization, by an ACTIVE account. Double fence: the shared authority() rule AND a
 * strict membership whose organization provenance matches the project's organization. */
export function transferManageSql(userSql:string,orgSql:string,projectSql:string,requireActive=true):string {
 return `(${authority(userSql,orgSql,projectSql,true,true)} AND EXISTS(SELECT 1 FROM members fence
 JOIN portal_users fence_user ON fence_user.user_id=fence.user_id
 JOIN organizations fence_org ON fence_org.id=${orgSql} AND fence_org.status='active'
 JOIN projects fence_project ON fence_project.id=${projectSql} AND fence_project.organization_id=fence_org.id ${requireActive?"AND fence_project.status='active'":''}
 WHERE fence.user_id=${userSql} AND fence.revoked_at IS NULL AND fence.role IN ('owner','manager') AND ${activeAccount('fence_user')}
 AND ((fence.project_id IS NULL AND fence.role='owner' AND fence.organization_id IS NULL)
  OR (fence.project_id IS NULL AND fence.organization_id=fence_org.id)
  OR (fence.project_id=fence_project.id AND (fence.organization_id IS NULL OR fence.organization_id=fence_org.id)))))`;
}

async function digest(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function assertion(db:D1Database,condition:string,values:unknown[],code:string){return db.prepare(`SELECT CASE WHEN ${condition} THEN 1 ELSE json_extract('[]','${code}') END`).bind(...values);}
const forbidden=()=>fail('Você não tem autorização de gestão nos dois projetos ou seu acesso mudou.','followup_transfer_forbidden',403);
const conflict=()=>fail('A demanda mudou desde a pré-visualização. Atualize e confira novamente.','followup_conflict',409);
const linked=()=>fail('Somente demandas simples, sem conferência, ação, material ou empréstimo vinculados, podem ser movidas.','followup_transfer_linked',409);

const taskSql=`SELECT t.id,t.organization_id,t.project_id,t.version,t.campaign_id,t.item_id,t.loan_id,p.name project_name,
 (EXISTS(SELECT 1 FROM followup_checklists WHERE task_id=t.id) OR EXISTS(SELECT 1 FROM followup_checklist_actions WHERE task_id=t.id)) has_checklist,
 (COALESCE(p.status,'')='active' AND EXISTS(SELECT 1 FROM organizations o WHERE o.id=t.organization_id AND o.status='active')) source_active,
 CASE WHEN t.project_id IS NULL THEN ${authority('caller.user_id','t.organization_id','t.project_id',true,true)} ELSE ${transferManageSql('caller.user_id','t.organization_id','t.project_id',false)} END can_manage
 FROM followup_tasks t JOIN(SELECT ? user_id) caller LEFT JOIN projects p ON p.id=t.project_id
 WHERE t.id=? AND ${authority('caller.user_id','t.organization_id','t.project_id')}`;

function blockerOf(task:Row):TransferBlocker|null {
 if(task.project_id===null)return 'organization_scope';
 if(task.has_checklist)return 'checklist';
 if(task.campaign_id!==null||task.item_id!==null||task.loan_id!==null)return 'linked_resource';
 if(!task.source_active)return 'inactive_source';
 return null;
}
async function visibleTask(db:D1Database,actor:PortalActor,taskId:string):Promise<Row>{
 const task=await one(db,taskSql,[actor.userId,taskId]);
 if(!task)fail('Demanda não encontrada neste contexto ou seu acesso mudou.','followup_not_found',404);
 if(!task!.can_manage)forbidden();
 return task!;
}
// Only individual assignees the manager can currently see at the source and that would
// lose visibility at the candidate are counted. No names or ids leave the server.
const candidatesSql=`SELECT d.id project_id,d.name,
 (SELECT COUNT(*) FROM followup_assignees a JOIN portal_users person ON person.user_id=a.user_id
  WHERE a.task_id=t.id AND a.removed_at IS NULL AND ${activeAccount('person')} AND ${authority('a.user_id','t.organization_id','t.project_id')}
  AND NOT ${authority('a.user_id','t.organization_id','d.id')}) lost
 FROM followup_tasks t JOIN(SELECT ? user_id) caller JOIN projects d ON d.organization_id=t.organization_id AND d.status='active' AND d.id<>t.project_id
 WHERE t.id=? AND t.project_id IS NOT NULL AND ${transferManageSql('caller.user_id','t.organization_id','d.id')}
 ORDER BY d.name,d.id LIMIT ${CANDIDATE_LIMIT}`;

/** Read-only preview. Two snapshots: the second re-validates the ACL/version so a revocation
 * or concurrent move between reads never yields a stale DTO. Performs no writes. */
export async function transferPreview(db:D1Database,actor:PortalActor|null,taskIdInput:unknown):Promise<TransferPreview>{
 actorRequired(actor);const taskId=transferTaskId(taskIdInput);
 const task=await visibleTask(db,actor,taskId);
 let blocker=blockerOf(task);
 const candidates=blocker?[]:await all(db,candidatesSql,[actor.userId,taskId]);
 const counts=await one(db,`SELECT
  (SELECT COUNT(*) FROM followup_assignees a JOIN portal_users person ON person.user_id=a.user_id WHERE a.task_id=t.id AND a.removed_at IS NULL AND ${activeAccount('person')} AND ${authority('a.user_id','t.organization_id','t.project_id')}) people,
  (SELECT COUNT(*) FROM followup_assignees a JOIN followup_teams team ON team.id=a.team_id WHERE a.task_id=t.id AND a.removed_at IS NULL AND team.organization_id=t.organization_id AND team.status='active') teams
  FROM followup_tasks t WHERE t.id=?`,[taskId]);
 // Second snapshot: same viewer, same version/project, management still live on both sides.
 const again=await one(db,`SELECT t.version,t.project_id,${task.project_id===null?'0':transferManageSql('caller.user_id','t.organization_id','t.project_id',false)} can_manage,
  (SELECT COALESCE(json_group_array(d.id),'[]') FROM projects d WHERE d.organization_id=t.organization_id AND d.status='active' AND d.id<>t.project_id AND ${transferManageSql('caller.user_id','t.organization_id','d.id')}) allowed
  FROM followup_tasks t JOIN(SELECT ? user_id) caller WHERE t.id=? AND ${authority('caller.user_id','t.organization_id','t.project_id')}`,[actor.userId,taskId]);
 if(!again)fail('Demanda não encontrada neste contexto ou seu acesso mudou.','followup_not_found',404);
 if(task.project_id!==null&&!again!.can_manage)forbidden();
 if(again!.version!==task.version||again!.project_id!==task.project_id)conflict();
 const allowed=new Set<string>(JSON.parse(again!.allowed??'[]'));
 const visible=candidates.filter(c=>allowed.has(c.project_id)).map(c=>({projectId:String(c.project_id),name:String(c.name),assigneesWithoutAccess:Number(c.lost)||0}));
 if(!blocker&&!visible.length)blocker='no_candidates';
 return {viewerId:actor.userId,taskId,version:Number(task.version),source:{projectId:task.project_id??'',name:task.project_id?String(task.project_name):''},
  eligible:!blocker,reason:blocker,assignments:{people:Number(counts?.people)||0,teams:Number(counts?.teams)||0},candidates:blocker?[]:visible};
}

async function receiptFor(db:D1Database,actor:PortalActor,operationHash:string){
 return one(db,`SELECT r.task_id,r.dest_project_id,r.to_version,r.fingerprint,r.state,
  ${transferManageSql('caller.user_id','r.organization_id','r.source_project_id')} source_ok,
  ${transferManageSql('caller.user_id','r.organization_id','r.dest_project_id')} dest_ok
  FROM followup_task_transfers r JOIN(SELECT ? user_id) caller WHERE r.actor_id=caller.user_id AND r.operation_hash=?`,[actor.userId,operationHash]);
}
/** Lost-reply replay: same key + same payload returns the receipt's captured result, but only
 * while the caller still manages BOTH the captured source and destination. */
function replay(actor:PortalActor,row:Row,fingerprint:string):TransferReceipt{
 if(!row.source_ok||!row.dest_ok)forbidden();
 if(row.fingerprint!==fingerprint)fail('Esta operação já foi usada com outros dados. Atualize o formulário.','operation_changed',409);
 if(row.state!=='applied')conflict();
 return {viewerId:actor.userId,taskId:String(row.task_id),projectId:String(row.dest_project_id),version:Number(row.to_version),duplicate:true};
}

/** `rateCount` (from rateLimitStatements) enters the same write batch: an allowed transfer costs one commit. */
export async function transferTask(db:D1Database,actor:PortalActor|null,raw:Record<string,unknown>,rateCount:D1PreparedStatement[]=[]):Promise<TransferReceipt>{
 actorRequired(actor);const input=transferInput(raw);
 const operationHash=await digest(`${actor.userId}\n${ACTION}\n${input.operationKey}`);
 const fingerprint=await digest(JSON.stringify({taskId:input.taskId,targetProjectId:input.targetProjectId,expectedVersion:input.expectedVersion,reason:input.reason}));
 const previous=await receiptFor(db,actor,operationHash);if(previous)return replay(actor,previous,fingerprint);

 const task=await visibleTask(db,actor,input.taskId);
 const blocker=blockerOf(task);
 if(blocker==='organization_scope')fail('Demandas da organização, sem projeto, não podem ser movidas por aqui.','followup_transfer_unsupported',409);
 if(input.targetProjectId===task.project_id)fail('A demanda já está neste projeto.','followup_transfer_noop',409);
 if(Number(task.version)!==input.expectedVersion)conflict();
 if(blocker==='checklist'||blocker==='linked_resource')linked();
 if(blocker==='inactive_source')fail('O projeto de origem está arquivado. Reative-o antes de mover a demanda.','followup_transfer_inactive_source',409);
 const destination=await one(db,`SELECT d.id FROM projects d JOIN(SELECT ? user_id) caller WHERE d.id=? AND d.organization_id=? AND ${transferManageSql('caller.user_id','d.organization_id','d.id')}`,[actor.userId,input.targetProjectId,task.organization_id]);
 if(!destination)forbidden();

 const at=iso(),receiptId=uid(),org=String(task.organization_id),source=String(task.project_id),dest=input.targetProjectId,from=input.expectedVersion,to=from+1;
 const statements=[
  ...rateCount,
  // Live authority inside the transaction: a revocation between validation and commit rolls back.
  assertion(db,`EXISTS(SELECT 1 FROM projects s JOIN(SELECT ? user_id) caller WHERE s.id=? AND s.organization_id=? AND ${transferManageSql('caller.user_id','s.organization_id','s.id')})`,[actor.userId,source,org],'followup_transfer_forbidden'),
  assertion(db,`EXISTS(SELECT 1 FROM projects d JOIN(SELECT ? user_id) caller WHERE d.id=? AND d.organization_id=? AND ${transferManageSql('caller.user_id','d.organization_id','d.id')})`,[actor.userId,dest,org],'followup_transfer_forbidden'),
  assertion(db,'EXISTS(SELECT 1 FROM followup_tasks WHERE id=? AND organization_id=? AND project_id=? AND version=?)',[input.taskId,org,source,from],'followup_transfer_conflict'),
  assertion(db,`EXISTS(SELECT 1 FROM followup_tasks t WHERE t.id=? AND t.campaign_id IS NULL AND t.item_id IS NULL AND t.loan_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM followup_checklists WHERE task_id=t.id) AND NOT EXISTS(SELECT 1 FROM followup_checklist_actions WHERE task_id=t.id))`,[input.taskId],'followup_transfer_linked'),
  db.prepare(`INSERT INTO followup_task_transfers(id,task_id,organization_id,source_project_id,dest_project_id,from_version,to_version,actor_id,reason,operation_hash,fingerprint,state,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?)`).bind(receiptId,input.taskId,org,source,dest,from,to,actor.userId,input.reason,operationHash,fingerprint,at),
  // Only project/version/updatedAt change; every other column is kept as-is.
  db.prepare('UPDATE followup_tasks SET project_id=?,version=version+1,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND version=?').bind(dest,at,input.taskId,org,source,from),
  db.prepare(`INSERT INTO followup_history(id,task_id,version,snapshot_json,actor_id,created_at) SELECT ?,id,version,json_object('title',title,'body',body,'priority',priority,'importance',importance,'status',status,'dueAt',due_at,'campaignId',campaign_id,'itemId',item_id,'loanId',loan_id,'progressNote','',
   'transfer',json_object('transferId',?,'fromProjectId',?,'toProjectId',?,'fromVersion',?,'reason',?)),?,? FROM followup_tasks WHERE id=? AND project_id=? AND version=?`).bind(uid(),receiptId,source,dest,from,input.reason,actor.userId,at,input.taskId,dest,to),
  // Audit references in both scopes; the free-text reason stays in the receipt/history only.
  db.prepare('INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(uid(),actor.userId,source,org,'followup.task.transfer_out',input.taskId,JSON.stringify({transferId:receiptId,counterpartProjectId:dest,fromVersion:from,toVersion:to}),at),
  db.prepare('INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(uid(),actor.userId,dest,org,'followup.task.transfer_in',input.taskId,JSON.stringify({transferId:receiptId,counterpartProjectId:source,fromVersion:from,toVersion:to}),at),
  // Grant rows are preserved, but a grant whose grantor has no live management at the
  // destination is revoked so it can never become valid there. Live policy still re-checks the rest.
  db.prepare(`UPDATE followup_work_grants SET revoked_at=? WHERE task_id=? AND revoked_at IS NULL AND NOT EXISTS(
   SELECT 1 FROM members issuer LEFT JOIN portal_users issuer_user ON issuer_user.user_id=issuer.user_id JOIN followup_tasks gt ON gt.id=followup_work_grants.task_id
   WHERE issuer.id=followup_work_grants.grantor_member_id AND issuer.revoked_at IS NULL AND issuer.role IN ('owner','manager')
   AND COALESCE(issuer_user.status,'active')='active' AND COALESCE(issuer_user.activation_pending,0)=0 AND issuer_user.anonymized_at IS NULL
   AND ${memberProjectScopeSql('issuer','gt.project_id')})`).bind(at,input.taskId),
  // Pending e-mails composed under the old context are invalidated; sending/uncertain/accepted rows are kept.
  db.prepare("UPDATE followup_email_queue SET status='cancelled',updated_at=? WHERE task_id=? AND status IN ('queued','claimed')").bind(at,input.taskId),
  recipientLimit(db,input.taskId),
  fanout(db,input.taskId,`task:${to}`,at),
  // Every notification of this task not yet materialized as e-mail (old ones and the new
  // transfer notice) gets a cancelled queue row, so no real e-mail is sent for them.
  db.prepare(`INSERT OR IGNORE INTO followup_email_queue(id,notification_id,organization_id,task_id,user_id,event_key,status,created_at,updated_at)
   SELECT lower(hex(randomblob(16))),n.id,t.organization_id,t.id,n.user_id,n.cause_key,'cancelled',?,? FROM followup_notifications n JOIN followup_tasks t ON t.id=n.task_id
   WHERE n.task_id=? AND NOT EXISTS(SELECT 1 FROM followup_email_queue q WHERE q.notification_id=n.id)`).bind(at,at,input.taskId),
  assertion(db,`EXISTS(SELECT 1 FROM followup_task_transfers r JOIN followup_tasks t ON t.id=r.task_id WHERE r.id=? AND r.state='applied' AND t.project_id=r.dest_project_id AND t.version=r.to_version AND t.organization_id=r.organization_id)
   AND NOT EXISTS(SELECT 1 FROM followup_task_transfers WHERE task_id=? AND state='pending')`,[receiptId,input.taskId],'followup_transfer_conflict'),
 ];
 try{await db.batch(statements);}catch(error){
  if(isRateLimitedError(error))rateLimitedError();
  const message=String(error);
  // A concurrent request with the same key may have committed first (lost reply): the
  // receipt, not this attempt's error, is the answer, still under the live replay fence.
  const committed=await receiptFor(db,actor,operationHash);if(committed)return replay(actor,committed,fingerprint);
  if(message.includes('followup_transfer_forbidden')||message.includes('followup_transfer_scope'))forbidden();
  if(message.includes('followup_transfer_linked'))linked();
  if(message.includes('followup_too_many_recipients'))fail('Há destinatários demais para notificar. Fale com a gestão.','followup_conflict',409);
  if(/followup_transfer_conflict|followup_scope_immutable|followup_version_changed|followup_task_transfers\.task_id/.test(message))conflict();
  throw error;
 }
 // Post-commit fence: if management at the destination vanished right after commit,
 // the move stays recorded but no DTO is disclosed.
 if(!await one(db,`SELECT 1 ok FROM projects s JOIN projects d ON d.organization_id=s.organization_id JOIN(SELECT ? user_id) caller WHERE s.id=? AND d.id=? AND ${transferManageSql('caller.user_id','s.organization_id','s.id')} AND ${transferManageSql('caller.user_id','d.organization_id','d.id')}`,[actor.userId,source,dest]))forbidden();
 return {viewerId:actor.userId,taskId:input.taskId,projectId:dest,version:to,duplicate:false};
}
