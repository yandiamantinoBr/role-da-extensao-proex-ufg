import {one,all,uid,iso,text} from './database';
import {HttpError} from './errors';
import {requireCapability,type PortalActor} from './access';

export async function campaignAction(db:D1Database,actor:PortalActor,action:string,input:any):Promise<any|null>{
 if(action==='project.create'){
  requireCapability(actor,'projects.manage'); const name=text(input.name,100); if(!name)throw new HttpError(400,'Informe o nome do projeto.');
  const id=uid(),now=iso();await db.batch([db.prepare('INSERT INTO projects(id,name,description,created_at) VALUES(?,?,?,?)').bind(id,name,text(input.description,1000),now),audit(db,actor,'project.create',id,id,now)]);return {id};
 }
 if(action==='setting.update'){
  requireCapability(actor,'organization.manage');const instagram=text(input.instagramUrl,300),notice=text(input.privacyNotice,12000);
  if(instagram){let url:URL;try{url=new URL(instagram);}catch{throw new HttpError(400,'Informe um endereço válido do Instagram.');}if(url.protocol!=='https:'||!['instagram.com','www.instagram.com'].includes(url.hostname)||url.username||url.password)throw new HttpError(400,'Use um endereço https://www.instagram.com/.');}
  const now=iso();await db.batch([db.prepare("INSERT INTO settings(name,value,updated_at) VALUES('instagramUrl',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(instagram,now),db.prepare("INSERT INTO settings(name,value,updated_at) VALUES('privacyNotice',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(notice,now),audit(db,actor,'setting.update','settings',null,now)]);return {};
 }
 if(action==='campaign.create'||action==='campaign.update'){
  const existing=action==='campaign.update'?await one(db,'SELECT * FROM campaigns WHERE id=?',[text(input.id,100)]):null;
  if(action==='campaign.update'&&!existing)throw new HttpError(404,'Ação não encontrada.');
  if(existing&&(existing.status!=='draft'||await one(db,'SELECT id FROM participations WHERE campaign_id=? LIMIT 1',[existing.id])))throw new HttpError(409,'Somente rascunhos sem participações podem ser editados.');
  const projectId=existing?.project_id||text(input.projectId,100);requireCapability(actor,'campaigns.manage',projectId);if(!await one(db,'SELECT id FROM projects WHERE id=?',[projectId]))throw new HttpError(404,'Projeto não encontrado.');
  const name=text(input.name,150),rules=text(input.rulesText,8000),start=new Date(input.startsAt),end=new Date(input.endsAt);
  if(!name||!Number.isFinite(+start)||!Number.isFinite(+end)||+end<=+start)throw new HttpError(400,'Informe nome e intervalo de datas válido.');
  const retry=input.retryLimit===null||input.retryLimit===undefined||input.retryLimit===''?null:Number(input.retryLimit);
  if(retry!==null&&(!Number.isInteger(retry)||retry<0||retry>3))throw new HttpError(400,'Escolha de zero a três repetições para o resultado tente novamente.');
  const brinde=text(input.brindeOfferId,100)||null,superId=text(input.superOfferId,100)||null;
  for(const [id,kind] of [[brinde,'brinde'],[superId,'super']])if(id&&!await one(db,'SELECT id FROM offers WHERE id=? AND project_id=? AND kind=? AND active=1',[id,projectId,kind]))throw new HttpError(400,'A oferta deve pertencer ao projeto e à categoria correta.');
  const id=existing?.id||uid(),now=iso();if(existing){const result=await db.batch([db.prepare("UPDATE campaigns SET name=?,location=?,starts_at=?,ends_at=?,retry_limit=?,brinde_offer_id=?,super_offer_id=?,rules_text=?,version=version+1 WHERE id=? AND version=? AND status='draft' AND NOT EXISTS(SELECT 1 FROM participations WHERE campaign_id=?)").bind(name,text(input.location,200),start.toISOString(),end.toISOString(),retry,brinde,superId,rules,id,existing.version,id),db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,?,'campaign.update',?,'{}',? WHERE changes()>0").bind(uid(),actor.userId,projectId,id,now)]);if(!result[0].meta.changes)throw new HttpError(409,'O rascunho foi alterado em outra sessão. Atualize a página.');}else{await db.batch([db.prepare("INSERT INTO campaigns(id,project_id,name,location,starts_at,ends_at,status,retry_limit,brinde_offer_id,super_offer_id,rules_text,version,created_at) VALUES(?,?,?,?,?,?,'draft',?,?,?,?,1,?)").bind(id,projectId,name,text(input.location,200),start.toISOString(),end.toISOString(),retry,brinde,superId,rules,now),audit(db,actor,'campaign.create',id,projectId,now)]);}return {id};
 }
 if(action==='campaign.status'){
  const c=await one(db,'SELECT * FROM campaigns WHERE id=?',[text(input.id,100)]);if(!c)throw new HttpError(404,'Ação não encontrada.');requireCapability(actor,'campaigns.manage',c.project_id);
  const status=text(input.status,20);if(!['active','paused','closed'].includes(status))throw new HttpError(400,'Estado inválido.');if(c.status==='closed')throw new HttpError(409,'A ação encerrada conserva seu histórico. Crie uma nova ação.');
  if(status==='active'){
   if(c.retry_limit===null||!c.rules_text.trim()||!c.brinde_offer_id||!c.super_offer_id)throw new HttpError(400,'Defina regulamento, limite de repetições e as duas ofertas antes de ativar.');
   if(!text((await one(db,"SELECT value FROM settings WHERE name='privacyNotice'"))?.value,12000))throw new HttpError(400,'Cadastre o aviso de privacidade institucional antes de ativar.');
   if(new Date(c.ends_at).getTime()<=Date.now())throw new HttpError(400,'O período dessa ação já terminou.');
   const components=await prizeComponents(db,c);const needed=new Map<string,number>();for(const row of components)needed.set(row.item_id,(needed.get(row.item_id)||0)+row.quantity);if(components.some(row=>row.stock-row.reserved<(needed.get(row.item_id)||0)))throw new HttpError(409,'Não há estoque disponível para cobrir as duas ofertas. Registre a entrada antes de ativar.');
  }
  const now=iso();const result=await db.batch([db.prepare("UPDATE campaigns SET status=?,version=version+1 WHERE id=? AND status<>'closed' AND version=?").bind(status,c.id,c.version),db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()>0").bind(uid(),actor.userId,c.project_id,`campaign.${status}`,c.id,'{}',now)]);if(!result[0].meta.changes)throw new HttpError(409,'A ação foi alterada em outra sessão. Atualize a página.');return {};
 }
 return null;
}
export function audit(db:D1Database,actor:{userId:string},action:string,id:string,project:string|null,now=iso()){return db.prepare('INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(uid(),actor.userId,project,action,id,'{}',now);}
export async function activeCampaign(db:D1Database,id:string){const c=await one(db,'SELECT * FROM campaigns WHERE id=?',[id]);if(!c)throw new HttpError(404,'Ação não encontrada.');if(c.status!=='active'||c.starts_at>iso()||c.ends_at<=iso())throw new HttpError(409,'Esta ação não está recebendo participações agora.');if(c.retry_limit===null||!c.rules_text||!c.brinde_offer_id||!c.super_offer_id)throw new HttpError(409,'A ação ainda não tem todas as regras configuradas.');if(!text((await one(db,"SELECT value FROM settings WHERE name='privacyNotice'"))?.value,12000))throw new HttpError(409,'O aviso de privacidade ainda precisa ser configurado.');return c;}
export async function prizeComponents(db:D1Database,c:any){
 const rows=await all(db,'SELECT oc.*,o.kind,o.project_id,i.category,i.condition,i.stock,i.reserved,i.project_id item_project_id FROM offer_components oc JOIN offers o ON o.id=oc.offer_id JOIN items i ON i.id=oc.item_id WHERE o.id IN (?,?) AND o.active=1',[c.brinde_offer_id,c.super_offer_id]);
 if(!rows.some(r=>r.offer_id===c.brinde_offer_id&&r.kind==='brinde')||!rows.some(r=>r.offer_id===c.super_offer_id&&r.kind==='super')||rows.some(r=>r.project_id!==c.project_id||r.item_project_id!==c.project_id||r.category!=='gift'||r.condition!=='active'))throw new HttpError(409,'Configure ofertas ativas de brindes deste projeto.');
 return rows;
}
