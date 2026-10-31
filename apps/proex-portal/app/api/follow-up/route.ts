import { getActor } from '@/lib/access';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { boundedJson } from '@/lib/http';
import { HttpError, publicError } from '@/lib/errors';
import { followupAction, followupCatalog, followupDetail, followupList, notificationInbox } from '@/lib/follow-up/service';
export const dynamic='force-dynamic';
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;};
export async function GET(request:Request){try{
 const db=database(),actor=await getActor(db,await getPortalUser()),query=new URL(request.url).searchParams,view=query.get('view')??'tasks';
 const input={projectId:query.get('projectId')??undefined,organizationId:query.get('organizationId')??undefined,status:query.get('status')??undefined,priority:query.get('priority')??undefined,search:query.get('search')??undefined,offset:query.has('offset')?Number(query.get('offset')):undefined};
 const result=view==='tasks'?await followupList(db,actor,input):view==='catalog'?await followupCatalog(db,actor,input):view==='detail'?await followupDetail(db,actor,query.get('id')):view==='inbox'?await notificationInbox(db,actor):null;
 if(!result)throw new HttpError(400,'Escolha uma consulta válida.','followup_view');return privateResponse(Response.json(result));
 }catch(error){return privateResponse(publicError(error));}}
export async function POST(request:Request){try{
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(403,'Atualize o portal antes de salvar.','invalid_origin');
 const input=await boundedJson(request,64*1024);if(typeof input.action!=='string')throw new HttpError(400,'Escolha uma operação válida.','followup_action');const db=database();return privateResponse(Response.json(await followupAction(db,await getActor(db,await getPortalUser()),input.action,input)));
 }catch(error){return privateResponse(publicError(error));}}
