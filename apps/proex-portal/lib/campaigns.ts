import {one,all,uid,iso,text} from './database';
import {HttpError} from './errors';
import {requireCapability,type PortalActor} from './access';
import {prepareMutation} from './mutations';

function projectText(value:unknown,label:string,max:number,optional=false):string{
 if(value===undefined||value===null){if(optional)return '';throw new HttpError(400,`Informe ${label}.`,'invalid_input');}
 if(typeof value!=='string')throw new HttpError(400,`Informe ${label} como texto.`,'invalid_input');
 const result=value.trim();if((!optional&&!result)||result.length>max)throw new HttpError(400,`${label} deve ter ${optional?'até':'entre 1 e'} ${max} caracteres.`,'invalid_input');return result;
}
function projectDate(value:unknown,label:string):string|null{
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value))throw new HttpError(400,`${label} deve conter data, horário e fuso horário.`,'invalid_date');
 const time=Date.parse(value),[year,month,day]=value.slice(0,10).split('-').map(Number);
 if(!Number.isFinite(time)||year<2000||year>2200||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())throw new HttpError(400,`${label} não é uma data válida.`,'invalid_date');
 return new Date(time).toISOString();
}

export async function campaignAction(db:D1Database,actor:PortalActor,action:string,input:any):Promise<any|null>{
 if(action==='project.create'||action==='project.update'){
  const existing=action==='project.update'?await one(db,'SELECT * FROM projects WHERE id=?',[projectText(input.id,'o projeto',100)]):null;
  if(action==='project.update'&&!existing)throw new HttpError(404,'Projeto não encontrado.','project_not_found');
  if(existing){
   requireCapability(actor,'campaigns.manage',existing.id);
   if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)throw new HttpError(400,'Informe a versão do projeto. Atualize a página.','invalid_version');
   if(input.expectedVersion!==existing.version)throw new HttpError(409,'O projeto foi alterado em outra sessão. Atualize a página.','project_changed');
  }else requireCapability(actor,'projects.manage',null);
  const creation=existing?null:await prepareMutation(db,actor.userId,action,input);
  if(creation?.existingId)return {id:creation.existingId,project:await one(db,'SELECT * FROM projects WHERE id=?',[creation.existingId]),duplicate:true};
  const name=projectText(input.name??existing?.name,'o nome do projeto',120);
  const shortName=projectText(input.shortName??existing?.short_name,'o nome curto',40,true);
  const description=projectText(input.description??existing?.description,'a descrição',2000,true);
  const status=projectText(input.status??existing?.status??'active','a situação',20);
  if(!['active','archived'].includes(status))throw new HttpError(400,'Escolha projeto ativo ou arquivado.','invalid_status');
  const color=projectText(input.color??existing?.color??'#54216C','a cor',7).toUpperCase();
  if(!/^#[0-9A-F]{6}$/.test(color))throw new HttpError(400,'Use uma cor no formato #54216C.','invalid_color');
  const officialUrl=projectText(input.officialUrl??existing?.official_url,'o endereço oficial',500,true);
  if(officialUrl){let url:URL;try{url=new URL(officialUrl);}catch{throw new HttpError(400,'Informe um endereço oficial válido.','invalid_url');}if(url.protocol!=='https:'||url.username||url.password)throw new HttpError(400,'O endereço oficial deve começar com https:// e não conter credenciais.','invalid_url');}
  const startsAt=projectDate(input.startsAt===undefined?existing?.starts_at:input.startsAt,'A data inicial');
  const endsAt=projectDate(input.endsAt===undefined?existing?.ends_at:input.endsAt,'A data final');
  if(startsAt&&endsAt&&endsAt<=startsAt)throw new HttpError(400,'A data final deve ocorrer depois da data inicial.','invalid_interval');
  const location=projectText(input.location??existing?.location,'o local',200,true),id=existing?.id||uid(),now=iso();
  const mutation=existing
   ?db.prepare(`UPDATE projects SET name=?,short_name=?,description=?,status=?,color=?,official_url=?,starts_at=?,ends_at=?,location=?,version=version+1
     WHERE id=? AND version=? AND EXISTS (SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN ('owner','manager') AND (m.project_id IS NULL OR m.project_id=projects.id))`)
     .bind(name,shortName,description,status,color,officialUrl,startsAt,endsAt,location,id,input.expectedVersion,actor.userId)
   :db.prepare(`INSERT INTO projects(id,name,short_name,description,status,color,official_url,starts_at,ends_at,location,version,created_at)
     VALUES(CASE WHEN EXISTS (SELECT 1 FROM members m WHERE m.user_id=? AND m.role='owner' AND m.project_id IS NULL AND m.revoked_at IS NULL) THEN ? ELSE NULL END,?,?,?,?,?,?,?,?,?,1,?)`)
     .bind(actor.userId,id,name,shortName,description,status,color,officialUrl,startsAt,endsAt,location,now);
  let result:D1Result[];
  try{result=await db.batch([...(creation?[creation.claimStatement(id)]:[]),mutation,db.prepare('INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1')
   .bind(uid(),actor.userId,id,action,id,JSON.stringify({previousVersion:existing?.version??null,status}),now)]);}
  catch(error){if(!creation)throw error;const replayId=await creation.recover(error);return {id:replayId,project:await one(db,'SELECT * FROM projects WHERE id=?',[replayId]),duplicate:true};}
  if(result[creation?1:0].meta.changes!==1)throw new HttpError(existing?409:403,'O projeto ou seu acesso mudou. Atualize a página.',existing?'project_changed':'access_changed');
  return {id,project:await one(db,'SELECT * FROM projects WHERE id=?',[id])};
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
  const projectId=existing?.project_id||text(input.projectId,100);requireCapability(actor,'campaigns.manage',projectId);if(existing){if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)throw new HttpError(400,'Informe a versão do rascunho. Atualize e abra a edição novamente.','invalid_version');if(input.expectedVersion!==existing.version)throw new HttpError(409,'O rascunho mudou em outra sessão. Preserve suas anotações e abra a edição novamente.','campaign_changed');}if(!await one(db,'SELECT id FROM projects WHERE id=?',[projectId]))throw new HttpError(404,'Projeto não encontrado.');
  const name=text(input.name,150),rules=text(input.rulesText,8000),start=new Date(input.startsAt),end=new Date(input.endsAt);
  if(!name||!Number.isFinite(+start)||!Number.isFinite(+end)||+end<=+start)throw new HttpError(400,'Informe nome e intervalo de datas válido.');
  const retry=input.retryLimit===null||input.retryLimit===undefined||input.retryLimit===''?null:Number(input.retryLimit);
  if(retry!==null&&(!Number.isInteger(retry)||retry<0||retry>3))throw new HttpError(400,'Escolha de zero a três repetições para o resultado tente novamente.');
  const brinde=text(input.brindeOfferId,100)||null,superId=text(input.superOfferId,100)||null;
  for(const [id,kind] of [[brinde,'brinde'],[superId,'super']])if(id&&!await one(db,'SELECT id FROM offers WHERE id=? AND project_id=? AND kind=? AND active=1',[id,projectId,kind]))throw new HttpError(400,'A oferta deve pertencer ao projeto e à categoria correta.');
  const id=existing?.id||uid(),now=iso();if(existing){const result=await db.batch([db.prepare("UPDATE campaigns SET name=?,location=?,starts_at=?,ends_at=?,retry_limit=?,brinde_offer_id=?,super_offer_id=?,rules_text=?,version=version+1 WHERE id=? AND version=? AND status='draft' AND NOT EXISTS(SELECT 1 FROM participations WHERE campaign_id=?)").bind(name,text(input.location,200),start.toISOString(),end.toISOString(),retry,brinde,superId,rules,id,input.expectedVersion,id),db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,?,'campaign.update',?,'{}',? WHERE changes()>0").bind(uid(),actor.userId,projectId,id,now)]);if(!result[0].meta.changes)throw new HttpError(409,'O rascunho foi alterado em outra sessão. Atualize a página.');}else{await db.batch([db.prepare("INSERT INTO campaigns(id,project_id,name,location,starts_at,ends_at,status,retry_limit,brinde_offer_id,super_offer_id,rules_text,version,created_at) VALUES(?,?,?,?,?,?,'draft',?,?,?,?,1,?)").bind(id,projectId,name,text(input.location,200),start.toISOString(),end.toISOString(),retry,brinde,superId,rules,now),audit(db,actor,'campaign.create',id,projectId,now)]);}return {id};
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
