import {getActor} from '@/lib/access';
import {database} from '@/lib/platform';
import {getPortalUser} from '@/lib/session';
import {boundedJson} from '@/lib/http';
import {rateLimit} from '@/lib/rate-limit';
import {HttpError,publicError} from '@/lib/errors';
import {planningAction,planningWorkspace} from '@/lib/campaign-planning/service';
export const dynamic='force-dynamic';
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;};
/** GET /api/campaign-planning?campaignId=...[&projectId=primary]. Read-only: no business or rate-limit writes. */
export async function GET(request:Request){try{
 const query=new URL(request.url).searchParams;
 if([...query.keys()].some(key=>!['campaignId','projectId'].includes(key))||query.getAll('campaignId').length!==1||query.getAll('projectId').length>1||(query.has('projectId')&&!query.get('projectId')?.trim()))throw new HttpError(400,'Escolha uma consulta válida.','planning_query');
 const db=database(),actor=await getActor(db,await getPortalUser());
 return privateResponse(Response.json(await planningWorkspace(db,actor,{campaignId:query.get('campaignId'),...(query.has('projectId')?{projectId:query.get('projectId')}:{})})));
 }catch(error){return privateResponse(publicError(error));}}
/** POST JSON {action:'host.link'|'session.save'|'session.status',...}; same origin and X-Proex-Action: 1 required. */
export async function POST(request:Request){try{
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(403,'Atualize o portal antes de salvar.','invalid_origin');
 const input=await boundedJson(request,16*1024),db=database(),actor=await getActor(db,await getPortalUser());
 if(actor)await rateLimit(db,`campaign-planning:${actor.userId}`,60,60000);
 return privateResponse(Response.json(await planningAction(db,actor,input)));
 }catch(error){return privateResponse(publicError(error));}}
