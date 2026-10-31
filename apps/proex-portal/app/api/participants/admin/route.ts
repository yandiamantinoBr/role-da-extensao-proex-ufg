import {database,participantEmailEnvironment,inviteSecret} from '@/lib/platform';
import {getPortalUser} from '@/lib/session';
import {getActor} from '@/lib/access';
import {boundedJson} from '@/lib/http';
import {HttpError,publicError} from '@/lib/errors';
import {rateLimit} from '@/lib/rate-limit';
import {participantAdministration,configureParticipants} from '@/lib/public-participants';
export const dynamic='force-dynamic';
const runtime=()=>({email:participantEmailEnvironment(),secret:inviteSecret()});
function privateResponse(response:Response){response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');return response;}
export async function GET(){try{const db=database();return privateResponse(Response.json(await participantAdministration(db,await getActor(db,await getPortalUser()),runtime())));}catch(error){return privateResponse(publicError(error));}}
export async function POST(request:Request){try{
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(403,'Atualize a página antes de continuar.','invalid_origin');
 const input=await boundedJson(request,12000),db=database(),actor=await getActor(db,await getPortalUser());
 const fields=input.action==='verifySender'?['action','expectedVersion']:['action','expectedVersion','enabled','notice','eligibility','noticeApproved','eligibilityApproved'];if(Object.keys(input).some(key=>!fields.includes(key)))throw new HttpError(400,'Use somente os campos desta configuração.','participant_invalid_input');
 await participantAdministration(db,actor,runtime());await rateLimit(db,`participant:administration:${actor!.userId}`,12,600000);
 return privateResponse(Response.json(await configureParticipants(db,actor,runtime(),input)));
 }catch(error){return privateResponse(publicError(error));}}
