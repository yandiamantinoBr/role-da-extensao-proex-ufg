import { getPortalUser } from './session';
import { getActor } from './access';
import { actorFromSyncToken } from './sync/tokens';
import { syncDigest } from './sync/contracts';
import { HttpError, publicError } from './errors';
import { requireBackupPrincipal, type BackupPrincipal } from './backup-automation';

export const backupHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function backupPrincipal(db:D1Database,request:Request,mutation=false):Promise<BackupPrincipal>{
 const authorization=request.headers.get('Authorization');let principal:BackupPrincipal;
 if(authorization!==null){const actor=await actorFromSyncToken(db,authorization);principal={actor,credentialHash:await syncDigest(authorization.replace(/^Bearer\s+/i,''))};}
 else {if(mutation&&(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'))throw new HttpError(403,'Ação de backup não reconhecida.','backup_csrf');const actor=await getActor(db,await getPortalUser());if(!actor)throw new HttpError(401,'Entre para acessar backups.','unauthenticated');principal={actor,credentialHash:null};}
 await requireBackupPrincipal(db,principal);return principal;
}
export function automaticBackupError(error:unknown){
 const code=(error as {code?:string})?.code;const known:Record<string,[number,string]>={backup_limit:[413,'O backup excedeu o limite; nenhum arquivo parcial será enviado.'],backup_forbidden:[403,'Seu acesso mudou durante o backup.'],backup_busy:[429,'Outro backup está em preparação.'],backup_runtime:[503,'Runtime sem suporte a backup completo.'],backup_source:[409,'Não foi possível obter uma cópia consistente.'],backup_sqlite:[409,'O banco não passou na verificação de integridade.'],backup_objects:[409,'Há divergências entre banco e arquivos.']};
 const response=code&&known[code]?publicError(new HttpError(known[code][0],known[code][1],code)):publicError(error);for(const [key,value]of Object.entries(backupHeaders))response.headers.set(key,value);return response;
}
export function backupJson(value:unknown){return Response.json(value,{headers:backupHeaders});}
