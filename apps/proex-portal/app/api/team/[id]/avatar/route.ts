import {getPortalUser} from '../../../../../lib/session';
import {getActor} from '../../../../../lib/access';
import {database,bucket} from '../../../../../lib/platform';
import {managedUserAvatar} from '../../../../../lib/users';
import {HttpError,publicError} from '../../../../../lib/errors';
export const dynamic='force-dynamic';
function privateResponse(response:Response){
 response.headers.set('Cache-Control','private, no-store');
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Referrer-Policy','no-referrer');
 response.headers.set('Content-Security-Policy',"sandbox; default-src 'none'");
 return response;
}
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 try{
  const db=database(),actor=await getActor(db,await getPortalUser()),{id}=await context.params;
  const projectId=new URL(request.url).searchParams.get('projectId')??undefined;
  const before=await managedUserAvatar(db,actor,id,projectId),object=await bucket().get(before.key);
  if(!object)throw new HttpError(404,'Foto não encontrada.','user_avatar_not_found');
  const after=await managedUserAvatar(db,await getActor(db,await getPortalUser()),id,projectId);
  if(before.key!==after.key||before.version!==after.version)throw new HttpError(409,'A foto mudou. Atualize o perfil.','user_avatar_changed');
  return privateResponse(new Response(object.body,{headers:{'Content-Type':'image/png','Content-Length':String(object.size),'Content-Disposition':'inline; filename="profile.png"'}}));
 }catch(error){return privateResponse(publicError(error));}
}
