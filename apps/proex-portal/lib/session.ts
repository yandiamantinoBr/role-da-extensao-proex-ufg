import {headers} from 'next/headers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getActor} from './access';
import {one,iso,uid} from './database';
import {database,ownerEmail} from './platform';
import {passwordAuth,type PasswordAuthOptions} from './password-auth';
import {HttpError} from './errors';
export type PortalUser={userId:string,email:string,displayName:string,source:'password'|'native',credentialId?:string,hasPassword:boolean};
export async function authForRequest(db:D1Database,options:PasswordAuthOptions={}){
 // PROEX_LOCAL_HTTP permite testar o build de produção em http://localhost; outros hosts seguem exigindo HTTPS.
 const localProduction=(globalThis as {process?:{env?:Record<string,string|undefined>}}).process?.env?.PROEX_LOCAL_HTTP==='1';
 return passwordAuth(db,{...options,allowInsecureDevelopment:import.meta.env?.DEV===true||localProduction});
}
export async function getHasPassword(userId:string){return !!await one(database(),"SELECT a.id FROM identity_aliases l JOIN auth_account a ON a.user_id=l.subject AND a.provider_id='credential' AND a.password IS NOT NULL WHERE l.provider='password' AND l.user_id=? LIMIT 1",[userId]);}
async function present(db:D1Database,id:string,email:string,source:'native'|'password',credentialId?:string):Promise<PortalUser|null>{
 const row=await one(db,'SELECT u.*,p.display_name FROM portal_users u LEFT JOIN profiles p ON p.user_id=u.user_id WHERE u.user_id=?',[id]);
 if(!row||row.activation_pending)return null;
 if(row.status!=='active'||row.anonymized_at)throw new HttpError(403,'Seu acesso está bloqueado. Procure o responsável da equipe.','account_blocked');
 return {userId:id,email,displayName:row.display_name||email,source,credentialId,hasPassword:await getHasPassword(id)};
}
export async function ensureNativePrincipal(){
 const native=await getChatGPTUser();if(!native)return null;const db=database();
 const existing=await one(db,'SELECT status,activation_pending,anonymized_at FROM portal_users WHERE user_id=?',[native.userId]);
 if(existing&&(existing.status!=='active'||existing.activation_pending||existing.anonymized_at))throw new HttpError(403,'Este cadastro está bloqueado. Procure o responsável.','account_blocked');
 const actor=await getActor(db,native,ownerEmail());if(!actor?.members.length&&!await one(db,"SELECT id FROM participations WHERE identity_id=? AND identity_method='account' LIMIT 1",[native.userId]))return null;
 const now=iso(),email=native.email.trim().toLowerCase();
 await db.batch([
 db.prepare("INSERT OR IGNORE INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at) VALUES(?,?,'active',0,?,?)").bind(native.userId,email,now,now),
 db.prepare("INSERT OR IGNORE INTO profiles(user_id,display_name,version,created_at,updated_at) SELECT ?,?,1,?,? FROM portal_users WHERE user_id=? AND status='active' AND activation_pending=0 AND anonymized_at IS NULL").bind(native.userId,native.displayName||email,now,now,native.userId),
 db.prepare("INSERT OR IGNORE INTO identity_aliases(provider,subject,user_id,created_at) SELECT 'native',?,?,? FROM portal_users WHERE user_id=? AND status='active' AND activation_pending=0 AND anonymized_at IS NULL").bind(native.userId,native.userId,now,native.userId)]);
 return present(db,native.userId,email,'native');
}
export async function getPortalUser():Promise<PortalUser|null>{
 const h=await headers(),db=database();
 if((h.get('cookie')||'').includes('proex.')){
  const auth=await authForRequest(db),session=await auth.api.getSession({headers:h,query:{disableCookieCache:true}});
  if(session){const alias=await one(db,"SELECT user_id FROM identity_aliases WHERE provider='password' AND subject=?",[session.user.id]);return alias?present(db,alias.user_id,session.user.email.toLowerCase(),'password',session.user.id):null;}
 }
 // Native proof is accepted only by the explicit initial-password bridge.
 return null;
}
export function newPrincipalId(){return `usr_${uid()}`;}
