import {database} from '@/lib/platform';
import {getPortalUser} from '@/lib/session';
import {getActor} from '@/lib/access';
import {boundedJson} from '@/lib/http';
import {HttpError,publicError} from '@/lib/errors';
import {rateLimit} from '@/lib/rate-limit';
import {createEmailDispatchToken,emailDispatcherFromToken,listEmailDispatchTokens,revokeEmailDispatchToken} from '@/lib/follow-up/email-tokens';
import {followupEmailOrigin} from '@/lib/follow-up/email-platform';
import {acknowledgeEmail,beginEmail,beginPilotEmail,claimEmail,claimPilotEmail,configureEmail,dispatchEmailStatus,emailPreference,emailStatus,reconcileEmail,recoverEmail} from '@/lib/follow-up/email';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
function failure(error:unknown){const response=publicError(error);for(const[key,value]of Object.entries(headers))response.headers.set(key,value);return response;}
export async function GET(request:Request){try{const db=database(),actor=await getActor(db,await getPortalUser());const orgId=new URL(request.url).searchParams.get('organizationId'),status=await emailStatus(db,actor,orgId);return Response.json({...status,...(status.canManage?{dispatchTokens:await listEmailDispatchTokens(db,actor,orgId)}:{})},{headers});}catch(error){return failure(error);}}
export async function POST(request:Request){try{
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??''))throw new HttpError(415,'Envie JSON.','email_invalid');
 const db=database(),authorization=request.headers.get('Authorization'),origin=followupEmailOrigin();
 if(authorization!==null){const principal=await emailDispatcherFromToken(db,authorization);await rateLimit(db,'followup-email-dispatch:'+principal.tokenId,100,60000);const input=await boundedJson(request,4096);let result;
  switch(input.action){case'dispatch.status':result=await dispatchEmailStatus(db,principal,input,origin);break;case'dispatch.claim':result=await claimEmail(db,principal,input,origin);break;case'dispatch.pilot.claim':result=await claimPilotEmail(db,principal,input,origin);break;case'dispatch.pilot.begin':result=await beginPilotEmail(db,principal,input,origin);break;case'dispatch.begin':result=await beginEmail(db,principal,input,origin);break;case'dispatch.ack':result=await acknowledgeEmail(db,principal,input,origin);break;case'dispatch.recover':result=await recoverEmail(db,principal,input,origin);break;default:throw new HttpError(403,'O conector não configura remetentes ou preferências.','email_session_required');}return Response.json(result,{headers});
 }
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1')throw new HttpError(403,'Ação não reconhecida.','email_csrf');const actor=await getActor(db,await getPortalUser());if(!actor)throw new HttpError(401,'Entre para configurar avisos.','unauthenticated');const input=await boundedJson(request,4096);let result;
 switch(input.action){case'token.create':result=await createEmailDispatchToken(db,actor,input);break;case'token.revoke':result=await revokeEmailDispatchToken(db,actor,input);break;case'configure':result=await configureEmail(db,actor,input,origin);break;case'preference':result=await emailPreference(db,actor,input);break;case'reconcile':result=await reconcileEmail(db,actor,input);break;default:throw new HttpError(403,'Despacho disponível somente ao conector autorizado.','email_connector_required');}return Response.json(result,{headers});
 }catch(error){return failure(error);}}
