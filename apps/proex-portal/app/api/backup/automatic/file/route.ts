import { database } from '@/lib/platform';
import { completeBackupBinding } from '@/lib/backup';
import { boundedJson } from '@/lib/http';
import { HttpError } from '@/lib/errors';
import { consumeAutomaticBackup } from '@/lib/backup-automation';
import { automaticBackupError,backupHeaders,backupPrincipal } from '@/lib/backup-automatic-http';
export const dynamic='force-dynamic';
async function download(request:Request,ticket:unknown){try{
 const db=database(),principal=await backupPrincipal(db,request,true),result=await consumeAutomaticBackup(db,principal,ticket,completeBackupBinding(),{signal:request.signal});
 let offset=0;const clear=()=>{result.encrypted.fill(0);};
 const body=new ReadableStream<Uint8Array>({pull(controller){if(offset>=result.encrypted.byteLength){clear();controller.close();return;}const end=Math.min(offset+65536,result.encrypted.byteLength);controller.enqueue(Uint8Array.from(result.encrypted.subarray(offset,end)));offset=end;},cancel:clear});
 return new Response(body,{headers:{...backupHeaders,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${result.filename}"`,'X-Proex-Backup-SHA256':result.sha256,'X-Proex-Backup-Size':String(result.size),'X-Proex-Backup-Key-Id':result.keyId,'X-Proex-Backup-Run-Id':result.runId}});
 }catch(error){return automaticBackupError(error);}}
// GAS uses bearer GET. Browser session download uses JSON POST, for which the
// browser supplies Origin; a cookie GET cannot bypass the action/origin guard.
export async function GET(request:Request){if(!request.headers.has('Authorization'))return automaticBackupError(new HttpError(401,'Use a chave do conector ou POST autenticado no portal.','sync_token_required'));return download(request,new URL(request.url).searchParams.get('ticket'));}
export async function POST(request:Request){try{if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??''))throw new HttpError(415,'Envie JSON.','backup_invalid');await backupPrincipal(database(),request,true);const input=await boundedJson(request,1024);if(Object.keys(input).length!==1||typeof input.ticket!=='string')throw new HttpError(400,'Envie somente o ticket.','backup_invalid');return download(request,input.ticket);}catch(error){return automaticBackupError(error);}}
