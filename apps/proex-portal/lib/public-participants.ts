import { hashPassword } from 'better-auth/crypto';
import { all, one, iso, uid, type Row } from './database';
import { requireCapability, type PortalActor } from './access';
import { HttpError } from './errors';
import { identifierHash } from './login-identifiers';
import { rateLimit, clientIp } from './rate-limit';
import { digest, senderConfiguration, senderFingerprint, verifyParticipantSender, sendParticipantEmail, type ParticipantEmailEnvironment } from './participant-email';

const OWNER=`EXISTS(SELECT 1 FROM members m JOIN portal_users u ON u.user_id=m.user_id WHERE m.user_id=? AND m.role='owner' AND m.project_id IS NULL AND m.organization_id IS NULL AND m.revoked_at IS NULL AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL)`;
const ACTIVE="u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL";
const NO_TEAM="NOT EXISTS(SELECT 1 FROM members history WHERE history.user_id=u.user_id)";
const DAY=86400000,TTL=900000;
type Config=Row&{enabled:number;version:number;notice_text:string;eligibility_text:string;notice_approved:number;eligibility_approved:number;sender_fingerprint:string|null;sender_verified_at:number|null};
export type ParticipantRuntime={email:ParticipantEmailEnvironment;secret:string|undefined};
async function configuration(db:D1Database){const row=await one(db,'SELECT * FROM public_participant_config WHERE id=1');if(!row)throw new HttpError(503,'O cadastro público ainda não está disponível.','participant_unavailable');return row as Config;}
function policyText(value:unknown,label:string,minimum:number,maximum:number){if(typeof value!=='string'||value.trim().length<minimum||value.length>maximum||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new HttpError(400,`Confira ${label}.`,'participant_invalid_policy');return value.normalize('NFC').trim();}
function emailAddress(value:unknown){if(typeof value!=='string'||value.length>254)throw new HttpError(400,'Informe um e-mail válido.','participant_invalid_email');const email=value.trim().toLowerCase();if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email))throw new HttpError(400,'Informe um e-mail válido.','participant_invalid_email');return email;}
async function readiness(config:Config,runtime:ParticipantRuntime){
 const sender=senderConfiguration(runtime.email),reasons:string[]=[];
 if(!config.notice_approved||config.notice_text.trim().length<80)reasons.push('Aprovar e configurar o aviso de privacidade do público.');
 if(config.eligibility_text.trim()&&!config.eligibility_approved)reasons.push('Aprovar os critérios oficiais de participação informados, ou remover o campo se não houver critérios definidos.');
 if(!runtime.secret||runtime.secret.length<32)reasons.push('Configurar a segurança da autenticação.');
 if(!sender)reasons.push('Configurar o provedor e os nomes de ambiente dedicados ao e-mail público.');
 else if(config.sender_fingerprint!==await senderFingerprint(sender)||!config.sender_verified_at||config.sender_verified_at>Date.now()||config.sender_verified_at<Date.now()-DAY)reasons.push('Conferir o domínio no provedor; a comprovação de envio sem rastreamento vale por 24 horas.');
 return{ready:reasons.length===0,reasons,sender};
}
export async function participantAvailability(db:D1Database,runtime:ParticipantRuntime){const config=await configuration(db),state=await readiness(config,runtime);return{available:!!config.enabled&&state.ready,notice:config.notice_approved?config.notice_text:null,eligibility:config.eligibility_approved?config.eligibility_text:null,reason:config.enabled&&state.ready?null:'A conta de participante por celular ainda não está disponível. No evento, procure o atendimento assistido da equipe.'};}
export async function participantAdministration(db:D1Database,actor:PortalActor|null,runtime:ParticipantRuntime){requireCapability(actor,'organization.manage',null);if(!await one(db,`SELECT 1 allowed WHERE ${OWNER}`,[actor!.userId]))throw new HttpError(403,'Seu acesso administrativo mudou.','participant_access_changed');const config=await configuration(db),state=await readiness(config,runtime);return{config:{enabled:Boolean(config.enabled),notice:config.notice_text,eligibility:config.eligibility_text,noticeApproved:Boolean(config.notice_approved),eligibilityApproved:Boolean(config.eligibility_approved),version:config.version},readiness:{ready:state.ready,reasons:state.reasons,senderDomain:state.sender?.domain??null,senderVerifiedAt:config.sender_verified_at??null,provider:'resend',requiredNames:['PUBLIC_PARTICIPANT_EMAIL_PROVIDER','PUBLIC_PARTICIPANT_EMAIL_API_KEY','PUBLIC_PARTICIPANT_EMAIL_FROM','PUBLIC_PARTICIPANT_EMAIL_DOMAIN_ID','BETTER_AUTH_URL','BETTER_AUTH_SECRET']}};}
async function ownerBatch(db:D1Database,actor:PortalActor,statements:D1PreparedStatement[]){try{return(await db.batch([db.prepare(`SELECT CASE WHEN ${OWNER} THEN 1 ELSE json_extract('[]','participant_owner_changed') END`).bind(actor.userId),...statements])).slice(1);}catch(error){if(String(error).includes('participant_owner_changed'))throw new HttpError(403,'Seu acesso administrativo mudou.','participant_access_changed');throw error;}}
export async function configureParticipants(db:D1Database,actor:PortalActor|null,runtime:ParticipantRuntime,input:Row){
 requireCapability(actor,'organization.manage',null);const current=await configuration(db);if(input.expectedVersion!==current.version)throw new HttpError(409,'A configuração mudou. Recarregue antes de salvar.','participant_config_changed');
 if(input.action==='verifySender'){
  // Revalidate before spending a provider request; it is read-only and never sends email.
  await ownerBatch(db,actor!,[]);const sender=senderConfiguration(runtime.email);if(!sender)throw new HttpError(503,'A infraestrutura dedicada de e-mail não está configurada.','participant_sender_unavailable');
  const proof=await verifyParticipantSender(sender);const result=await ownerBatch(db,actor!,[db.prepare('UPDATE public_participant_config SET sender_fingerprint=?,sender_verified_at=?,sender_domain=?,sender_status=?,version=version+1,updated_by=?,updated_at=? WHERE id=1 AND version=?').bind(proof.fingerprint,proof.verifiedAt,proof.domain,'verified',actor!.userId,iso(),current.version)]);if(!result[0].meta.changes)throw new HttpError(409,'A configuração mudou. Recarregue antes de conferir novamente.','participant_config_changed');
 }else{
  if(input.action!=='configure'||typeof input.enabled!=='boolean'||typeof input.noticeApproved!=='boolean'||typeof input.eligibilityApproved!=='boolean')throw new HttpError(400,'Confira a configuração do cadastro público.','participant_invalid_config');
  const notice=policyText(input.notice,'o aviso de privacidade',0,6000),eligibility=policyText(input.eligibility,'os critérios de participação',0,2000);
  const next={...current,enabled:input.enabled?1:0,notice_text:notice,eligibility_text:eligibility,notice_approved:input.noticeApproved?1:0,eligibility_approved:input.eligibilityApproved?1:0};
  if(input.enabled&&!(await readiness(next,runtime)).ready)throw new HttpError(409,'Conclua todos os requisitos de prontidão antes de abrir o cadastro.','participant_not_ready');
  const now=iso(),results=await ownerBatch(db,actor!,[db.prepare('UPDATE public_participant_config SET enabled=?,notice_text=?,eligibility_text=?,notice_approved=?,eligibility_approved=?,version=version+1,updated_by=?,updated_at=? WHERE id=1 AND version=?').bind(next.enabled,notice,eligibility,next.notice_approved,next.eligibility_approved,actor!.userId,now,current.version),db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,NULL,'participant.configuration','public','{}',? WHERE changes()=1").bind(uid(),actor!.userId,now)]);if(!results[0].meta.changes)throw new HttpError(409,'A configuração mudou. Recarregue antes de salvar.','participant_config_changed');
 }
 return participantAdministration(db,actor,runtime);
}
async function requireAvailable(db:D1Database,runtime:ParticipantRuntime){const config=await configuration(db),state=await readiness(config,runtime);if(!config.enabled||!state.ready||!state.sender)throw new HttpError(503,'O cadastro e a recuperação de participante por e-mail estão temporariamente indisponíveis. Procure a equipe do evento.','participant_unavailable');return{config,sender:state.sender};}
export const genericParticipantResponse={accepted:true,message:'Se o pedido puder prosseguir, você receberá um link pessoal por e-mail. Confira também a pasta de spam. Para contas da equipe, use o convite ou a recuperação orientada pelo responsável.'};
export async function requestParticipantEmail(db:D1Database,runtime:ParticipantRuntime,request:Request,input:Row){
 const {config,sender}=await requireAvailable(db,runtime),email=emailAddress(input.email),purpose=input.purpose;
 if(!['signup','recovery'].includes(purpose)||input.noticeAccepted!==true||(!!config.eligibility_text.trim()&&input.eligibilityConfirmed!==true))throw new HttpError(400,'Leia o aviso e confirme os critérios de participação.','participant_consent_required');
 await rateLimit(db,'participant:requests:global',100,3600000);const ip=clientIp(request);if(ip)await rateLimit(db,`participant:requests:ip:${ip}`,20,3600000);
 try{await rateLimit(db,`participant:email:${await identifierHash(runtime.secret,'username',`public-participant:${email}`)}`,3,900000);}catch(error){if(error instanceof HttpError&&error.status===429)return genericParticipantResponse;throw error;}
 let returnTo='/participante';if(typeof input.returnTo==='string'&&/^\/events\/[A-Za-z0-9._:-]{1,200}$/.test(input.returnTo)&&await one(db,"SELECT id FROM campaigns WHERE id=? AND status<>'draft'",[input.returnTo.slice(8)]))returnTo=input.returnTo;
 const existing=await one(db,`SELECT u.user_id FROM participant_accounts p JOIN portal_users u ON u.user_id=p.user_id WHERE lower(u.email)=? AND ${ACTIVE} AND ${NO_TEAM} AND EXISTS(SELECT 1 FROM identity_aliases l JOIN auth_account a ON a.user_id=l.subject AND a.provider_id='credential' WHERE l.provider='password' AND l.user_id=u.user_id)`,[email]);
 const occupied=await one(db,'SELECT id FROM auth_user WHERE lower(email)=? UNION ALL SELECT user_id FROM portal_users WHERE lower(email)=? LIMIT 1',[email,email]);
 if(purpose==='signup'?!!occupied:!existing)return genericParticipantResponse;
 try{await rateLimit(db,'participant:delivery:daily',50,DAY);}catch(error){if(error instanceof HttpError&&error.status===429)return genericParticipantResponse;throw error;}
 const token=[...crypto.getRandomValues(new Uint8Array(32))].map(byte=>byte.toString(16).padStart(2,'0')).join(''),id=uid(),now=iso();
 const claims=await db.batch([db.prepare('DELETE FROM participant_email_challenges WHERE id IN(SELECT id FROM participant_email_challenges WHERE expires_at<? LIMIT 100)').bind(Date.now()-DAY),db.prepare('INSERT INTO participant_email_challenges(id,token_hash,email,purpose,expires_at,config_version,notice_hash,eligibility_hash,return_to,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM public_participant_config WHERE id=1 AND version=? AND enabled=1 AND notice_approved=1 AND (length(eligibility_text)=0 OR eligibility_approved=1) AND sender_fingerprint=? AND sender_verified_at>?)').bind(id,await digest(token),email,purpose,Date.now()+TTL,config.version,await digest(config.notice_text),await digest(config.eligibility_text),returnTo,now,config.version,config.sender_fingerprint,Date.now()-DAY)]);
 if(claims[1].meta.changes!==1)return genericParticipantResponse;
 try{await sendParticipantEmail(sender,{email,token,challengeId:id,purpose});await db.prepare('UPDATE participant_email_challenges SET provider_accepted_at=? WHERE id=? AND used_at IS NULL').bind(iso(),id).run();}catch{ /* Public envelope never reveals provider errors, recipient/account existence, token or delivery result. */ }
 return genericParticipantResponse;
}
function invalidProof(){return new HttpError(400,'O link é inválido, já foi usado ou expirou. Solicite outro link.','participant_invalid_proof');}
async function challenge(db:D1Database,runtime:ParticipantRuntime,request:Request,token:unknown){
 await rateLimit(db,'participant:proof:global',120,60000);const ip=clientIp(request);if(ip)await rateLimit(db,`participant:proof:ip:${ip}`,20,900000);
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw invalidProof();const hash=await digest(token);await rateLimit(db,`participant:proof:${hash}`,12,900000);
 const {config}=await requireAvailable(db,runtime),row=await one(db,'SELECT * FROM participant_email_challenges WHERE token_hash=? AND used_at IS NULL AND provider_accepted_at IS NOT NULL AND expires_at>? AND config_version=?',[hash,Date.now(),config.version]);if(!row)throw invalidProof();return{row,config};
}
export async function inspectParticipantProof(db:D1Database,runtime:ParticipantRuntime,request:Request,token:unknown){const{row,config}=await challenge(db,runtime,request,token);return{purpose:row.purpose,notice:config.notice_text,eligibility:config.eligibility_text};}
export async function completeParticipantProof(db:D1Database,runtime:ParticipantRuntime,request:Request,input:Row){
 const {row,config}=await challenge(db,runtime,request,input.token);
 if(input.noticeAccepted!==true||(!!config.eligibility_text.trim()&&input.eligibilityConfirmed!==true))throw new HttpError(400,'Confirme o aviso e os critérios de participação.','participant_consent_required');
 if(typeof input.password!=='string'||input.password.length<12||input.password.length>128)throw new HttpError(400,'Use uma senha de 12 a 128 caracteres.','participant_invalid_password');
 const name=row.purpose==='signup'?policyText(input.name,'o nome de exibição',1,80):'';
 const password=await hashPassword(input.password),now=iso(),milliseconds=Date.now(),credentialId=uid(),userId=`usr_${uid()}`;
 const existing=row.purpose==='recovery'?await one(db,`SELECT u.user_id,l.subject credential_id FROM participant_accounts p JOIN portal_users u ON u.user_id=p.user_id JOIN identity_aliases l ON l.user_id=u.user_id AND l.provider='password' WHERE lower(u.email)=? AND ${ACTIVE} AND ${NO_TEAM}`,[row.email]):null;
 if(row.purpose==='recovery'&&!existing)throw invalidProof();
 const eligibility=row.purpose==='signup'?{sql:'NOT EXISTS(SELECT 1 FROM portal_users WHERE lower(email)=?) AND NOT EXISTS(SELECT 1 FROM auth_user WHERE lower(email)=?)',values:[row.email,row.email]}:{sql:`EXISTS(SELECT 1 FROM participant_accounts p JOIN portal_users u ON u.user_id=p.user_id JOIN identity_aliases l ON l.user_id=u.user_id AND l.provider='password' WHERE u.user_id=? AND lower(u.email)=? AND l.subject=? AND ${ACTIVE} AND ${NO_TEAM})`,values:[existing!.user_id,row.email,existing!.credential_id]};
 const statements=[db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM participant_email_challenges WHERE id=? AND token_hash=? AND used_at IS NULL AND provider_accepted_at IS NOT NULL AND expires_at>?) AND EXISTS(SELECT 1 FROM public_participant_config WHERE id=1 AND enabled=1 AND version=? AND notice_approved=1 AND (length(eligibility_text)=0 OR eligibility_approved=1) AND sender_fingerprint=? AND sender_verified_at>?) AND (${eligibility.sql}) THEN 1 ELSE json_extract('[]','participant_proof_changed') END`).bind(row.id,row.token_hash,milliseconds,config.version,config.sender_fingerprint,milliseconds-DAY,...eligibility.values),db.prepare("UPDATE participant_email_challenges SET used_at=?,email='' WHERE id=? AND used_at IS NULL").bind(now,row.id)];
 if(row.purpose==='signup')statements.push(
  db.prepare("INSERT INTO auth_user(id,name,email,email_verified,role,created_at,updated_at) VALUES(?,?,?,1,'user',?,?)").bind(credentialId,name,row.email,milliseconds,milliseconds),
  db.prepare("INSERT INTO auth_account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").bind(uid(),credentialId,credentialId,password,milliseconds,milliseconds),
  db.prepare("INSERT INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at) VALUES(?,?,'active',0,?,?)").bind(userId,row.email,now,now),
  db.prepare("INSERT INTO identity_aliases(provider,subject,user_id,created_at) VALUES('password',?,?,?)").bind(credentialId,userId,now),
  db.prepare('INSERT INTO profiles(user_id,display_name,version,created_at,updated_at) VALUES(?,?,1,?,?)').bind(userId,name,now,now),
  db.prepare('INSERT INTO participant_accounts(user_id,verified_at,notice_hash,eligibility_hash,created_at) VALUES(?,?,?,?,?)').bind(userId,now,row.notice_hash,row.eligibility_hash,now),
 );else statements.push(db.prepare("UPDATE auth_account SET password=?,updated_at=? WHERE user_id=? AND provider_id='credential'").bind(password,milliseconds,existing!.credential_id),db.prepare('UPDATE auth_user SET email_verified=1,updated_at=? WHERE id=?').bind(milliseconds,existing!.credential_id),db.prepare('DELETE FROM auth_session WHERE user_id=?').bind(existing!.credential_id));
 statements.push(db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,NULL,?,?,'{}',?)").bind(uid(),existing?.user_id??userId,`participant.${row.purpose}`,existing?.user_id??userId,now));
 try{await db.batch(statements);}catch(error){if(String(error).includes('participant_proof_changed')||String(error).includes('UNIQUE constraint'))throw invalidProof();throw error;}
 return{ok:true,purpose:row.purpose,returnTo:row.return_to};
}
export async function ownParticipantAccount(db:D1Database,userId:string){const account=await one(db,`SELECT u.email,p.display_name,a.verified_at FROM participant_accounts a JOIN portal_users u ON u.user_id=a.user_id LEFT JOIN profiles p ON p.user_id=u.user_id WHERE u.user_id=? AND ${ACTIVE}`,[userId]);if(!account)throw new HttpError(403,'Esta página é destinada à conta de participante. Use o acesso da equipe se você recebeu convite.','participant_account_required');const participations=await all(db,`SELECT c.id campaign_id,c.name,p.state,p.modality FROM participations p JOIN campaigns c ON c.id=p.campaign_id JOIN portal_users u ON u.user_id=p.identity_id WHERE p.identity_id=? AND p.identity_method='account' AND c.status<>'draft' AND ${ACTIVE} ORDER BY p.created_at DESC LIMIT 20`,[userId]);return{account,participations};}
