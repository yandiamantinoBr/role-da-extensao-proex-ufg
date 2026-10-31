import {database,participantEmailEnvironment,inviteSecret} from '@/lib/platform';
import {getPortalUser} from '@/lib/session';
import {boundedJson} from '@/lib/http';
import {HttpError,publicError} from '@/lib/errors';
import {participantAvailability,requestParticipantEmail,inspectParticipantProof,completeParticipantProof,ownParticipantAccount} from '@/lib/public-participants';
import {waitForPublicEnvelope} from '@/lib/public-response';
export const dynamic='force-dynamic';
const runtime=()=>({email:participantEmailEnvironment(),secret:inviteSecret()});
function privateResponse(response:Response){for(const[key,value]of Object.entries({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}))response.headers.set(key,value);return response;}
export async function GET(request:Request){try{const db=database();if(new URL(request.url).searchParams.get('self')==='1'){const user=await getPortalUser();if(!user)throw new HttpError(401,'Entre para consultar sua conta.','unauthenticated');return privateResponse(Response.json(await ownParticipantAccount(db,user.userId)));}return privateResponse(Response.json(await participantAvailability(db,runtime())));}catch(error){return privateResponse(publicError(error));}}
export async function POST(request:Request){const started=Date.now();let envelope=false;try{
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(403,'Atualize a página antes de continuar.','invalid_origin');
 const input=await boundedJson(request,4096),db=database(),environment=runtime();
 const allowed:Record<string,string[]>={request:['action','email','purpose','noticeAccepted','eligibilityConfirmed','returnTo'],inspect:['action','token'],complete:['action','token','name','password','noticeAccepted','eligibilityConfirmed']};
 if(typeof input.action!=='string'||!allowed[input.action]||Object.keys(input).some(key=>!allowed[input.action as string].includes(key)))throw new HttpError(400,'Envie somente os dados deste formulário.','participant_invalid_input');
 if(input.action==='request'){envelope=true;return privateResponse(Response.json(await requestParticipantEmail(db,environment,request,input),{status:202}));}
 if(input.action==='inspect')return privateResponse(Response.json(await inspectParticipantProof(db,environment,request,input.token)));
 return privateResponse(Response.json(await completeParticipantProof(db,environment,request,input)));
 }catch(error){return privateResponse(publicError(error));}finally{if(envelope)await waitForPublicEnvelope(started);}}
