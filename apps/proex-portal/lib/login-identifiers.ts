import {HttpError} from './errors';
import {all,one,iso,uid} from './database';

export type LoginKind='username'|'cpf';
const ACTIVE="status='active' AND activation_pending=0 AND anonymized_at IS NULL";
export const accountPrivacyNotice='Nome de usuário e CPF são opcionais e servem apenas para localizar sua conta neste portal, usando a mesma senha. O CPF não será exibido nem enviado a relatórios ou planilhas; guardamos um identificador criptográfico para a busca. A conferência dos dígitos não comprova identidade ou titularidade do CPF. Nome de usuário não é login institucional ou SSO da UFG. Você pode remover esses atalhos e continuar entrando com e-mail.';

export function normalizeUsername(value:unknown):string {
 if(typeof value!=='string')throw new HttpError(400,'Informe um nome de usuário.','invalid_username');
 const result=value.trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9._-]{2,59}$/.test(result)||(/^[\d.-]+$/.test(result)&&result.replace(/\D/g,'').length===11))throw new HttpError(400,'Use de 3 a 60 caracteres: letras sem acento, números, ponto, hífen ou sublinhado. Não use um CPF como nome de usuário.','invalid_username');
 return result;
}
export function normalizeCpf(value:unknown):string {
 if(typeof value!=='string'||!/^\s*(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})\s*$/.test(value))throw new HttpError(400,'Confira os 11 dígitos do CPF.','invalid_cpf');
 const digits=value.replace(/\D/g,'');
 if(/^(\d)\1{10}$/.test(digits))throw new HttpError(400,'Confira os dígitos verificadores do CPF.','invalid_cpf');
 for(const size of [9,10]){let total=0;for(let n=0;n<size;n++)total+=Number(digits[n])*(size+1-n);const check=(total*10)%11;if(Number(digits[size])!==(check===10?0:check))throw new HttpError(400,'Confira os dígitos verificadores do CPF.','invalid_cpf');}
 return digits;
}
export async function identifierHash(secret:string|undefined,kind:LoginKind,value:string):Promise<string>{
 if(!secret||secret.length<32)throw new HttpError(503,'A configuração segura dos identificadores ainda não está disponível.','identifier_unavailable');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(['proex.login-identifier.v1',kind,value])));
 return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function loginRateSubject(secret:string|undefined,value:unknown){
 const input=typeof value==='string'?value.trim().toLowerCase().slice(0,254):'';
 return `identifier:${await identifierHash(secret,'username',input)}`;
}
export async function resolveLogin(db:D1Database,secret:string|undefined,value:unknown){
 if(typeof value!=='string'||!value.trim()||value.length>254)return null;
 const input=value.trim().toLowerCase();let where:string,parameters:string[];
 if(input.includes('@')){where='lower(a.email)=?';parameters=[input];}
 else {
  const kind:LoginKind=/^[\d.\-\s]+$/.test(input)&&input.replace(/\D/g,'').length===11?'cpf':'username';
  let normalized:string;try{normalized=kind==='cpf'?normalizeCpf(input):normalizeUsername(input);}catch(error){if(error instanceof HttpError&&error.status===400)return null;throw error;}
  where="EXISTS(SELECT 1 FROM login_identifiers i WHERE i.user_id=u.user_id AND i.kind=? AND i.lookup_hash=?)";
  parameters=[kind,await identifierHash(secret,kind,normalized)];
 }
 const rows=await all(db,`SELECT a.id AS credential_id,a.email,u.user_id,u.status,u.activation_pending,u.anonymized_at FROM auth_user a JOIN identity_aliases l ON l.provider='password' AND l.subject=a.id JOIN portal_users u ON u.user_id=l.user_id WHERE ${where} AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL AND EXISTS(SELECT 1 FROM auth_account c WHERE c.user_id=a.id AND c.provider_id='credential' AND c.password IS NOT NULL) LIMIT 2`,parameters);
 return rows.length===1?{userId:rows[0].user_id as string,credentialId:rows[0].credential_id as string,email:rows[0].email as string}:null;
}
export async function identifierSettings(db:D1Database,userId:string,email:string){
 if(!await one(db,`SELECT user_id FROM portal_users WHERE user_id=? AND ${ACTIVE}`,[userId]))throw new HttpError(403,'Seu acesso mudou. Entre novamente.','account_blocked');
 const rows=await all(db,'SELECT kind,display_hint FROM login_identifiers WHERE user_id=?',[userId]);
 let suggestion:string|null=null;try{suggestion=normalizeUsername(email.split('@')[0]);}catch{}
 return {username:rows.find(row=>row.kind==='username')?.display_hint??null,cpfConfigured:rows.some(row=>row.kind==='cpf'),cpfHint:rows.some(row=>row.kind==='cpf')?'CPF cadastrado (oculto)':null,suggestedUsername:suggestion,privacyNotice:accountPrivacyNotice};
}
/** Call only after verifying the current session's password. SQL rechecks admission after scrypt. */
export async function changeIdentifier(db:D1Database,userId:string,secret:string|undefined,input:Record<string,unknown>,remove=false){
 if(input.kind!=='username'&&input.kind!=='cpf')throw new HttpError(400,'Escolha um identificador válido.');
 const kind=input.kind as LoginKind,now=iso(),auditId=uid();
 if(!remove&&input.acknowledged!==true)throw new HttpError(400,'Leia o aviso antes de cadastrar o identificador.','notice_required');
 const normalized=remove?'':kind==='cpf'?normalizeCpf(input.value):normalizeUsername(input.value);
 const hash=remove?'':await identifierHash(secret,kind,normalized),hint=kind==='username'?normalized:'CPF cadastrado (oculto)';
 const permitted=await one(db,`SELECT user_id FROM portal_users WHERE user_id=? AND ${ACTIVE}`,[userId]);if(!permitted)throw new HttpError(403,'Seu acesso mudou. Entre novamente.','account_blocked');
 try {
  const mutation=remove?db.prepare(`DELETE FROM login_identifiers WHERE user_id=? AND kind=? AND EXISTS(SELECT 1 FROM portal_users WHERE user_id=? AND ${ACTIVE})`).bind(userId,kind,userId):db.prepare(`INSERT INTO login_identifiers(id,user_id,kind,lookup_hash,display_hint,created_at,updated_at) SELECT ?,?,?,?,?,?,? FROM portal_users WHERE user_id=? AND ${ACTIVE} ON CONFLICT(user_id,kind) DO UPDATE SET lookup_hash=excluded.lookup_hash,display_hint=excluded.display_hint,updated_at=excluded.updated_at`).bind(uid(),userId,kind,hash,hint,now,now,userId);
  await db.batch([mutation,db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,NULL,?,?,?,? WHERE changes()=1").bind(auditId,userId,remove?'account.identifier-removed':'account.identifier-set',userId,JSON.stringify({kind}),now)]);
 }catch(error){if(String(error).includes('UNIQUE'))throw new HttpError(409,'Este identificador não está disponível. Escolha outro ou procure o responsável.','identifier_conflict');throw error;}
 if(!await one(db,`SELECT user_id FROM portal_users WHERE user_id=? AND ${ACTIVE}`,[userId]))throw new HttpError(403,'Seu acesso mudou. Entre novamente.','account_blocked');
 return {ok:true};
}
