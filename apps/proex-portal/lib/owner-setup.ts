import {one,iso,text} from './database';
import {HttpError} from './errors';
import {getActor} from './access';

// Configuração inicial da hospedagem própria. Substitui a comprovação nativa do Sites
// por três condições simultâneas: SETUP_TOKEN do runtime, e-mail igual a OWNER_EMAIL
// e inexistência histórica de responsável global. Depois da primeira conclusão o
// fluxo fica permanentemente indisponível, mesmo que os segredos continuem definidos.
export async function ownerExists(db:D1Database):Promise<boolean>{
 return !!await one(db,"SELECT 1 AS present FROM members WHERE role='owner' AND project_id IS NULL LIMIT 1");
}
async function sameSecret(supplied:string,expected:string):Promise<boolean>{
 const encoder=new TextEncoder();
 const [a,b]=await Promise.all([supplied,expected].map(value=>crypto.subtle.digest('SHA-256',encoder.encode(value))));
 const x=new Uint8Array(a),y=new Uint8Array(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
export async function verifyOwnerSetup(db:D1Database,config:{expectedToken?:string;ownerEmail?:string},input:Record<string,unknown>):Promise<{email:string;name:string}>{
 const configured=config.ownerEmail?.trim().toLowerCase();
 if(!config.expectedToken||!configured)throw new HttpError(404,'A configuração inicial não está habilitada neste ambiente.','setup_unavailable');
 if(await ownerExists(db))throw new HttpError(409,'A configuração inicial já foi concluída. Entre com e-mail e senha.','setup_completed');
 if(!await sameSecret(text(input.setupToken,300),config.expectedToken))throw new HttpError(403,'Código de configuração inválido.','setup_forbidden');
 const email=text(input.email,254).toLowerCase();
 if(email!==configured)throw new HttpError(403,'Use o e-mail definido como responsável na configuração do servidor.','setup_forbidden');
 const name=text(input.name,120);if(!name)throw new HttpError(400,'Informe como deseja ser chamado.');
 return {email,name};
}
export async function completeOwnerSetup(db:D1Database,account:{email:string;name:string;credentialId:string;principalId:string},configuredOwnerEmail?:string){
 const now=iso(),{email,name,credentialId,principalId}=account;
 await db.batch([
  db.prepare("INSERT OR IGNORE INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at) VALUES(?,?,'active',0,?,?)").bind(principalId,email,now,now),
  db.prepare('INSERT OR IGNORE INTO profiles(user_id,display_name,version,created_at,updated_at) VALUES(?,?,1,?,?)').bind(principalId,name,now,now),
  db.prepare("INSERT OR IGNORE INTO identity_aliases(provider,subject,user_id,created_at) VALUES('password',?,?,?)").bind(credentialId,principalId,now)]);
 const linked=await one(db,"SELECT user_id FROM identity_aliases WHERE provider='password' AND subject=?",[credentialId]);
 if(linked?.user_id!==principalId)throw new HttpError(409,'Não foi possível vincular a conta. Tente novamente.');
 // getActor executa o bootstrap guardado por NOT EXISTS: só um responsável global nasce.
 const actor=await getActor(db,{userId:principalId,email,displayName:name},configuredOwnerEmail);
 if(!actor?.members.some(member=>member.role==='owner'&&member.project_id===null))throw new HttpError(409,'A configuração inicial já foi concluída por outra conta.','setup_completed');
 return actor;
}
