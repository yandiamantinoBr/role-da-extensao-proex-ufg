import {getPortalUser} from '@/lib/session';
import {getActor} from '@/lib/access';
import {database} from '@/lib/platform';
import {boundedJson} from '@/lib/http';
import {HttpError,publicError} from '@/lib/errors';
import {listOrganizations,organizationAction,organizationDetail} from '@/lib/organizations';
export const dynamic='force-dynamic';
function privateResponse(response:Response){response.headers.set('Cache-Control','private, no-store');return response;}
export async function GET(request:Request){try{const db=database(),actor=await getActor(db,await getPortalUser()),organizationId=new URL(request.url).searchParams.get('organizationId');return privateResponse(Response.json(organizationId?await organizationDetail(db,actor,organizationId):{organizations:await listOrganizations(db,actor)}));}catch(error){return privateResponse(publicError(error));}}
export async function POST(request:Request){try{
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(403,'Atualize a página e tente novamente.','invalid_origin');
 const input=await boundedJson(request,12000),db=database();if(typeof input.action!=='string')throw new HttpError(400,'Escolha uma operação.','invalid_action');
 return privateResponse(Response.json(await organizationAction(db,await getActor(db,await getPortalUser()),input.action,input)));
 }catch(error){return privateResponse(publicError(error));}}
