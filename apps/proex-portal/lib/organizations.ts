import { requireCapability, requireOrganizationCapability, organizationAuthoritySql, type PortalActor } from './access';
import { all, one, uid, iso } from './database';
import { HttpError } from './errors';

function identifier(value: unknown): string {
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value))throw new HttpError(400,'Escolha uma organização válida.','invalid_organization');
  return value;
}
function name(value: unknown): string {
  if(typeof value!=='string'||!value.trim()||value.trim().length>160||/[\u0000-\u001f]/.test(value))throw new HttpError(400,'Use um nome de organização com até 160 caracteres.','invalid_organization_name');
  return value.normalize('NFC').trim();
}
async function organizationBatch(db: D1Database, actor: PortalActor, organizationId: string, statements: D1PreparedStatement[]) {
  const permission=organizationAuthoritySql(actor,organizationId);
  try{return(await db.batch([db.prepare(`SELECT CASE WHEN ${permission.sql} THEN 1 ELSE json_extract('[]','organization_authority_changed') END`).bind(...permission.values),...statements])).slice(1);}
  catch(error){if(String(error).includes('organization_authority_changed'))throw new HttpError(403,'Seu acesso à organização mudou. Atualize a página.','organization_access_changed');if(String(error).includes('organization_target_changed'))throw new HttpError(409,'O cadastro ou a organização mudou. Atualize a página.','organization_admin_changed');throw error;}
}
export async function listOrganizations(db: D1Database, actor: PortalActor|null) {
  if(!actor)throw new HttpError(401,'Entre para consultar suas organizações.','unauthenticated');
  const rows=await all(db,`SELECT o.id,o.name,o.slug,o.status,o.version,EXISTS(
    SELECT 1 FROM members admin LEFT JOIN portal_users account ON account.user_id=admin.user_id WHERE admin.user_id=?
    AND admin.role='owner' AND admin.project_id IS NULL AND (admin.organization_id IS NULL OR admin.organization_id=o.id)
    AND admin.revoked_at IS NULL AND COALESCE(account.status,'active')='active' AND COALESCE(account.activation_pending,0)=0 AND account.anonymized_at IS NULL) canManage
    FROM organizations o WHERE EXISTS(
    SELECT 1 FROM members m LEFT JOIN portal_users u ON u.user_id=m.user_id WHERE m.user_id=? AND m.revoked_at IS NULL
    AND COALESCE(u.status,'active')='active' AND COALESCE(u.activation_pending,0)=0 AND u.anonymized_at IS NULL
    AND ((m.role='owner' AND m.project_id IS NULL AND m.organization_id IS NULL) OR m.organization_id=o.id)) ORDER BY o.name,o.id`,[actor.userId,actor.userId]);
  return rows.map(row=>({...row,canManage:Boolean(row.canManage)}));
}
export async function organizationDetail(db:D1Database,actor:PortalActor|null,id:unknown){
  const organizationId=identifier(id);requireOrganizationCapability(actor,'organization.manage',organizationId);
  const permission=organizationAuthoritySql(actor!,organizationId);
  const organization=await one(db,`SELECT id,name,slug,status,version FROM organizations WHERE id=? AND ${permission.sql}`,[organizationId,...permission.values]);
  if(!organization)throw new HttpError(403,'A organização ou seu acesso mudou.','organization_access_changed');
  const members=await all(db,`SELECT m.id,m.user_id,m.role,m.project_id,m.organization_id,m.revoked_at,u.status,u.activation_pending,p.display_name
    FROM members m LEFT JOIN portal_users u ON u.user_id=m.user_id LEFT JOIN profiles p ON p.user_id=m.user_id
    WHERE m.organization_id=? AND ${permission.sql} ORDER BY m.created_at,m.id`,[organizationId,...permission.values]);
  return{organization,members};
}
export async function organizationAction(db: D1Database, actor: PortalActor|null, action: string, input: Record<string,unknown>) {
  if(!actor)throw new HttpError(401,'Entre para continuar.','unauthenticated');
  if(!['organization.create','organization.update','organization.admin.grant','organization.admin.revoke'].includes(action))throw new HttpError(400,'Operação de organização inválida.','invalid_organization_action');
  const creating=action==='organization.create',id=creating?uid():identifier(input.organizationId),now=iso();
  if(creating)requireCapability(actor,'organization.manage',null);else requireOrganizationCapability(actor,'organization.manage',id);
  const current=creating?null:await one(db,'SELECT * FROM organizations WHERE id=?',[id]);
  if(!creating&&!current)throw new HttpError(404,'Organização não encontrada.','organization_not_found');
  if(creating||action==='organization.update'){
    const label=name(input.name??current?.name),slug=creating?(typeof input.slug==='string'?input.slug:''):current!.slug;
    if(!/^[a-z][a-z0-9-]{1,60}$/.test(slug))throw new HttpError(400,'Use uma identificação de 2 a 61 letras minúsculas, números e hífens.','invalid_organization_slug');
    const status=input.status??current?.status??'active';if(!['active','archived'].includes(String(status)))throw new HttpError(400,'Escolha organização ativa ou arquivada.','invalid_organization_status');
    if(!creating&&(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion!==current!.version))throw new HttpError(409,'A organização mudou. Reabra a edição.','organization_changed');
    if(creating&&await one(db,'SELECT id FROM organizations WHERE slug=?',[slug]))throw new HttpError(409,'Esta identificação de organização já existe.','organization_slug_exists');
    const results=await organizationBatch(db,actor,id,[creating
      ?db.prepare('INSERT INTO organizations(id,name,slug,status,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').bind(id,label,slug,status,now,now)
      :db.prepare('UPDATE organizations SET name=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(label,status,now,id,input.expectedVersion),
      db.prepare('INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at,organization_id) SELECT ?,?,NULL,?,?,?, ?,? WHERE changes()=1').bind(uid(),actor.userId,action,id,'{}',now,id)]);
    if(!results[0].meta.changes)throw new HttpError(409,'A organização mudou. Reabra a edição.','organization_changed');
    return {organization:await one(db,'SELECT id,name,slug,status,version FROM organizations WHERE id=?',[id])};
  }
  if(input.confirmed!==true)throw new HttpError(400,'Confirme a alteração da administração desta organização.','organization_admin_confirmation_required');
  if(action==='organization.admin.grant'){
    const userId=identifier(input.userId),platformOwner=actor.members.some(member=>member.role==='owner'&&member.project_id===null&&member.organization_id==null&&member.revoked_at===null);
    const target=await one(db,`SELECT user_id,email FROM portal_users WHERE user_id=? AND status='active' AND activation_pending=0 AND anonymized_at IS NULL
      ${platformOwner?'':'AND EXISTS(SELECT 1 FROM members m WHERE m.user_id=portal_users.user_id AND m.organization_id=? AND m.revoked_at IS NULL)'}`,[userId,...(platformOwner?[]:[id])]);
    if(!target||typeof target.email!=='string')throw new HttpError(404,'Pessoa ativa não encontrada nesta organização.','organization_user_not_found');
    const previous=await one(db,'SELECT id,role FROM members WHERE user_id=? AND project_id IS NULL AND organization_id=? AND revoked_at IS NULL',[userId,id]);
    const memberId=uid();
    const targetActive="EXISTS(SELECT 1 FROM portal_users WHERE user_id=? AND status='active' AND activation_pending=0 AND anonymized_at IS NULL) AND EXISTS(SELECT 1 FROM organizations WHERE id=? AND status='active')";
    const eligible=`(EXISTS(SELECT 1 FROM members target_member WHERE target_member.user_id=? AND target_member.organization_id=? AND target_member.revoked_at IS NULL)
      OR EXISTS(SELECT 1 FROM members platform LEFT JOIN portal_users account ON account.user_id=platform.user_id WHERE platform.user_id=? AND platform.role='owner' AND platform.project_id IS NULL AND platform.organization_id IS NULL AND platform.revoked_at IS NULL AND COALESCE(account.status,'active')='active' AND COALESCE(account.activation_pending,0)=0 AND account.anonymized_at IS NULL))`;
    const targetAssertion=db.prepare(`SELECT CASE WHEN (${targetActive}) AND (${eligible}) THEN 1 ELSE json_extract('[]','organization_target_changed') END`).bind(userId,id,userId,id,actor.userId);
    if(previous?.role==='owner'){await organizationBatch(db,actor,id,[targetAssertion]);return{member:{id:previous.id,user_id:userId,role:'owner',organization_id:id},duplicate:true};}
    await organizationBatch(db,actor,id,[targetAssertion,...(previous?[db.prepare(`UPDATE members SET revoked_at=? WHERE id=? AND role=? AND organization_id=? AND revoked_at IS NULL AND ${targetActive}`).bind(now,previous.id,previous.role,id,userId,id)]:[]),db.prepare(`INSERT OR IGNORE INTO members(id,user_id,email,role,project_id,revoked_at,created_at,organization_id)
      SELECT ?,?,?,'owner',NULL,NULL,?,? WHERE ${targetActive}`).bind(memberId,userId,target.email,now,id,userId,id),
      db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at,organization_id) SELECT ?,?,NULL,'organization.admin.grant',?,?,?,? WHERE changes()=1").bind(uid(),actor.userId,memberId,JSON.stringify({previousMemberId:previous?.id??null}),now,id)]);
    const member=await one(db,"SELECT id,user_id,role,organization_id FROM members WHERE user_id=? AND role='owner' AND organization_id=? AND project_id IS NULL AND revoked_at IS NULL",[userId,id]);
    if(!member)throw new HttpError(409,'O cadastro ou a organização mudou. Atualize a página.','organization_admin_changed');
    return {member};
  }
  const memberId=identifier(input.memberId),target=await one(db,"SELECT id,revoked_at FROM members WHERE id=? AND role='owner' AND project_id IS NULL AND organization_id=?",[memberId,id]);
  if(!target)throw new HttpError(404,'Administrador não encontrado nesta organização.','organization_admin_not_found');
  if(target.revoked_at){await organizationBatch(db,actor,id,[]);return{revoked:true,memberId,duplicate:true};}
  const result=await organizationBatch(db,actor,id,[db.prepare(`UPDATE members SET revoked_at=? WHERE id=? AND organization_id=? AND revoked_at IS NULL
    AND EXISTS(SELECT 1 FROM members other LEFT JOIN portal_users u ON u.user_id=other.user_id WHERE other.id!=members.id AND other.role='owner' AND other.project_id IS NULL AND other.organization_id=members.organization_id AND other.revoked_at IS NULL AND COALESCE(u.status,'active')='active' AND COALESCE(u.activation_pending,0)=0 AND u.anonymized_at IS NULL)`).bind(now,memberId,id),
    db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at,organization_id) SELECT ?,?,NULL,'organization.admin.revoke',?,'{}',?,? WHERE changes()=1").bind(uid(),actor.userId,memberId,now,id)]);
  if(!result[0].meta.changes)throw new HttpError(409,'Mantenha outro administrador ativo antes de revogar este vínculo.','last_organization_admin');
  return {revoked:true,memberId};
}
