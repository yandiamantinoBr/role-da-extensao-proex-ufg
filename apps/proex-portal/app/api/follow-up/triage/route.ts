import { getActor } from '@/lib/access';
import { assistantCredentialKeys, database, inviteSecret, taskTriageEnabled } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { boundedJson } from '@/lib/http';
import { HttpError, publicError } from '@/lib/errors';
import { actorRequired } from '@/lib/follow-up/scope';
import { applyTaskTriage, prepareTaskTriage, taskTriageAvailable } from '@/lib/follow-up/triage';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
function failure(error:unknown) {
 const response=publicError(error);
 for(const [key,value] of Object.entries(headers))response.headers.set(key,value);
 return response;
}
export async function GET(request:Request) {
 try {
  const db=database(), actor=await getActor(db,await getPortalUser());
  actorRequired(actor);
  const enabled=taskTriageEnabled() && Boolean(inviteSecret()) &&
   await taskTriageAvailable(db,actor,new URL(request.url).searchParams.get('id'));
  return Response.json({enabled},{headers});
 } catch(error) {return failure(error);}
}
export async function POST(request:Request) {
 try {
  if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||
   !request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(403,'Atualize o portal antes de salvar.','invalid_origin');
  const db=database(), actor=await getActor(db,await getPortalUser()), secret=inviteSecret();
  actorRequired(actor);
  if(!taskTriageEnabled()||!secret)throw new HttpError(503,'A triagem com JEV está desativada. Você pode classificar a demanda manualmente.','triage_disabled');
  const input=await boundedJson(request,8*1024);
  if(input.action==='task.triage.apply')return Response.json(await applyTaskTriage(db,actor,input),{headers});
  return Response.json(await prepareTaskTriage(db,actor,input,secret,{keys:assistantCredentialKeys()}),{headers});
 } catch(error) {return failure(error);}
}
