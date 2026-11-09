import {getActor} from '@/lib/access';
import {database} from '@/lib/platform';
import {getPortalUser} from '@/lib/session';
import {boundedJson} from '@/lib/http';
import {rateLimitStatements} from '@/lib/rate-limit';
import {HttpError,publicError} from '@/lib/errors';
import {prizeTiersAction,prizeTiersWorkspace} from '@/lib/prize-tiers/service';
export const dynamic='force-dynamic';
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;};
/** GET /api/prize-tiers?campaignId=... Read-only: no business or rate-limit writes. */
export async function GET(request:Request){try{
 const query=new URL(request.url).searchParams;
 if([...query.keys()].some(key=>key!=='campaignId')||query.getAll('campaignId').length!==1)throw new HttpError(400,'Escolha uma consulta válida.','prize_tiers_query');
 const db=database(),actor=await getActor(db,await getPortalUser());
 return privateResponse(Response.json(await prizeTiersWorkspace(db,actor,{campaignId:query.get('campaignId')})));
 }catch(error){return privateResponse(publicError(error));}}
/** POST JSON {action:'tier.set'|'percent.set'|'option.create',...}; same origin and X-Proex-Action: 1 required. */
export async function POST(request:Request){try{
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(403,'Atualize o portal antes de salvar.','invalid_origin');
 const input=await boundedJson(request,16*1024),db=database(),actor=await getActor(db,await getPortalUser());
 // A full bucket refuses here with a read only; otherwise the count joins the action's own batch (one commit).
 const rateCount=actor?await rateLimitStatements(db,[{bucket:`prize-tiers:${actor.userId}`,limit:60,windowMs:60000}]):[];
 return privateResponse(Response.json(await prizeTiersAction(db,actor,input,rateCount)));
 }catch(error){return privateResponse(publicError(error));}}
