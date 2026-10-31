import { database } from '@/lib/platform';
import { completeBackupBinding } from '@/lib/backup';
import { boundedJson } from '@/lib/http';
import { HttpError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';
import { acknowledgeAutomaticBackup,backupAutomationStatus,configureBackupAutomation,prepareAutomaticBackup } from '@/lib/backup-automation';
import { automaticBackupError,backupJson,backupPrincipal } from '@/lib/backup-automatic-http';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const db=database(),principal=await backupPrincipal(db,request);return backupJson(await backupAutomationStatus(db,principal,completeBackupBinding()));}catch(error){return automaticBackupError(error);}}
export async function POST(request:Request){try{
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??''))throw new HttpError(415,'Envie JSON.','backup_invalid');
 const db=database(),principal=await backupPrincipal(db,request,true),input=await boundedJson(request,8192),binding=completeBackupBinding();
 if(input.action==='configure')return backupJson(await configureBackupAutomation(db,principal,input,binding));
 if(input.action==='prepare'){await rateLimit(db,'backup:global',3,10*60000);return backupJson(await prepareAutomaticBackup(db,principal,input,binding));}
 if(input.action==='ack')return backupJson(await acknowledgeAutomaticBackup(db,principal,input));
 throw new HttpError(400,'Ação de backup desconhecida.','backup_invalid');
 }catch(error){return automaticBackupError(error);}}
