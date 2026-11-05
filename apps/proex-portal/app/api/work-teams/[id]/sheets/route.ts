import { database } from '@/lib/platform';
import { getActor } from '@/lib/access';
import { getPortalUser } from '@/lib/session';
import { boundedJson } from '@/lib/http';
import { HttpError, publicError } from '@/lib/errors';
import { configureTeamSheet, createTeamSheetToken, revokeTeamSheetToken, teamSheetStatus } from '@/lib/sync/team-sheets';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;};
export async function GET(request:Request,context:Context){try{const {id}=await context.params,db=database();return privateResponse(Response.json(await teamSheetStatus(db,await getActor(db,await getPortalUser()),id,new URL(request.url).searchParams.get('projectId')??'')));}catch(error){return privateResponse(publicError(error));}}
export async function POST(request:Request,context:Context){try{
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new HttpError(403,'Atualize o portal antes de configurar.','invalid_origin');
 const {id}=await context.params,projectId=new URL(request.url).searchParams.get('projectId')??'',db=database(),actor=await getActor(db,await getPortalUser()),input=await boundedJson(request,8192);
 const value=input.action==='configure'?await configureTeamSheet(db,actor,id,projectId,input):input.action==='token.create'?await createTeamSheetToken(db,actor,id,projectId,input):input.action==='token.revoke'?await revokeTeamSheetToken(db,actor,id,projectId,input):null;
 if(!value)throw new HttpError(400,'Ação indisponível neste vínculo.');return privateResponse(Response.json(value));
 }catch(error){return privateResponse(publicError(error));}}
