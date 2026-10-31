import { getActor } from '@/lib/access';
import { database, inviteSecret } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { HttpError, publicError } from '@/lib/errors';
import { boundedImportForm } from '@/lib/importer/documents';
import { transcribeSpeech } from '@/lib/assistant/speech';
export const dynamic='force-dynamic';
export async function POST(request:Request):Promise<Response>{try{
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1')throw new HttpError(403,'Atualize o portal antes de transcrever.','invalid_origin');
 const db=database(),actor=await getActor(db,await getPortalUser()),secret=inviteSecret();if(!actor)throw new HttpError(401,'Entre para transcrever.','unauthenticated');if(!secret)throw new HttpError(503,'A configuração de segurança está indisponível.','assistant_unavailable');
 const form=await boundedImportForm(request),file=form.get('audio');if(!(file instanceof File))throw new HttpError(400,'Selecione um áudio.','speech_input');
 const result=await transcribeSpeech(db,actor,{projectId:String(form.get('projectId')??''),operationKey:String(form.get('operationKey')??''),consent:form.get('consent')==='true',mime:file.type,bytes:new Uint8Array(await file.arrayBuffer())},secret,{signal:request.signal});return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return publicError(error);}}
