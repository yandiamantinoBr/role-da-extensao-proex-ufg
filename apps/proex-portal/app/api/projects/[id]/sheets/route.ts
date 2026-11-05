import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { boundedJson } from '@/lib/http';
import { HttpError, publicError } from '@/lib/errors';
import { configureProjectSheet, createProjectSheetToken, projectSheetStatus, revokeProjectSheetToken } from '@/lib/sync/project-sheets';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){try{const db=database(),{id}=await context.params;return Response.json(await projectSheetStatus(db,await getActor(db,await getPortalUser()),id),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return publicError(error);}}
export async function POST(request:Request,context:Context){try{
 const url=new URL(request.url),origin=request.headers.get('origin');
 if(request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('content-type')?.includes('application/json')||(origin&&origin!==url.origin))throw new HttpError(403,'Origem inválida.');
 const db=database(),{id}=await context.params,actor=await getActor(db,await getPortalUser()),input=await boundedJson(request,8192);
 const result=input.action==='configure'?await configureProjectSheet(db,actor,id,input):input.action==='token.create'?await createProjectSheetToken(db,actor,id,input):input.action==='token.revoke'?await revokeProjectSheetToken(db,actor,id,input):null;
 if(!result)throw new HttpError(400,'Ação desconhecida.');
 return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return publicError(error);}}
