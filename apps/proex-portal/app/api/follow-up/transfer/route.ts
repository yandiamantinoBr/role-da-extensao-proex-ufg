import {getActor} from '@/lib/access';
import {database} from '@/lib/platform';
import {getPortalUser} from '@/lib/session';
import {boundedJson} from '@/lib/http';
import {rateLimit} from '@/lib/rate-limit';
import {HttpError,publicError} from '@/lib/errors';
import {transferPreview,transferTask} from '@/lib/follow-up/transfer';
export const dynamic='force-dynamic';
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;};
/** GET /api/follow-up/transfer?taskId=... Read-only preview: no business or rate-limit writes. */
export async function GET(request:Request){try{
 const query=new URL(request.url).searchParams;
 if([...query.keys()].some(key=>key!=='taskId')||query.getAll('taskId').length!==1||!query.get('taskId')?.trim())throw new HttpError(400,'Escolha uma demanda válida.','followup_transfer_query');
 const db=database(),actor=await getActor(db,await getPortalUser());
 if(!actor)throw new HttpError(401,'Entre para acompanhar as demandas.','unauthenticated');
 return privateResponse(Response.json(await transferPreview(db,actor,query.get('taskId'))));
 }catch(error){return privateResponse(publicError(error));}}
/** POST JSON {taskId,targetProjectId,expectedVersion,reason,operationKey,confirmed:true}; same origin and X-Proex-Action: 1 required. */
export async function POST(request:Request){try{
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(403,'Atualize o portal antes de salvar.','invalid_origin');
 const input=await boundedJson(request,16*1024),db=database(),actor=await getActor(db,await getPortalUser());
 if(!actor)throw new HttpError(401,'Entre para acompanhar as demandas.','unauthenticated');
 await rateLimit(db,`followup-transfer:${actor.userId}`,60,60000);
 return privateResponse(Response.json(await transferTask(db,actor,input)));
 }catch(error){return privateResponse(publicError(error));}}
