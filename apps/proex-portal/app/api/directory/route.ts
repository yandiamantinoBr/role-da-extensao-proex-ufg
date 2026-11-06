import {getActor} from '@/lib/access';
import {database} from '@/lib/platform';
import {getPortalUser} from '@/lib/session';
import {boundedJson} from '@/lib/http';
import {HttpError,publicError} from '@/lib/errors';
import {directoryAction,directoryDetail,directoryWorkspace} from '@/lib/directory/service';
export const dynamic='force-dynamic';
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;};
export async function GET(request:Request){try{
 const q=new URL(request.url).searchParams;if([...q.keys()].some(key=>!['organizationId','personId'].includes(key))||[...q.keys()].some(key=>q.getAll(key).length!==1))throw new HttpError(400,'Escolha uma consulta válida.','directory_query');
 const db=database(),actor=await getActor(db,await getPortalUser()),organizationId=q.get('organizationId');return privateResponse(Response.json(q.has('personId')?await directoryDetail(db,actor,{organizationId,personId:q.get('personId')}):await directoryWorkspace(db,actor,{organizationId})));
 }catch(error){return privateResponse(publicError(error));}}
export async function POST(request:Request){try{
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(403,'Atualize o portal antes de salvar.','invalid_origin');
 const input=await boundedJson(request,8*1024),db=database();return privateResponse(Response.json(await directoryAction(db,await getActor(db,await getPortalUser()),input)));
 }catch(error){return privateResponse(publicError(error));}}
