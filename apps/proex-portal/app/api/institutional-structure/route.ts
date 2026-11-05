import {getActor} from '@/lib/access';
import {database} from '@/lib/platform';
import {getPortalUser} from '@/lib/session';
import {boundedJson} from '@/lib/http';
import {HttpError,publicError} from '@/lib/errors';
import {structureAction,structureWorkspace} from '@/lib/institutional-structure/service';
export const dynamic='force-dynamic';
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;};
export async function GET(request:Request){try{
 const query=new URL(request.url).searchParams;if([...query.keys()].some(key=>!['organizationId','projectId','includeArchived'].includes(key))||query.has('includeArchived')&&!['true','false'].includes(query.get('includeArchived')!))throw new HttpError(400,'Escolha uma consulta válida.','structure_query');
 const db=database(),actor=await getActor(db,await getPortalUser());return privateResponse(Response.json(await structureWorkspace(db,actor,{organizationId:query.get('organizationId'),projectId:query.get('projectId'),includeArchived:query.get('includeArchived')==='true'})));
 }catch(error){return privateResponse(publicError(error));}}
export async function POST(request:Request){try{
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(403,'Atualize o portal antes de salvar.','invalid_origin');
 const input=await boundedJson(request,48*1024),db=database();return privateResponse(Response.json(await structureAction(db,await getActor(db,await getPortalUser()),input)));
 }catch(error){return privateResponse(publicError(error));}}
