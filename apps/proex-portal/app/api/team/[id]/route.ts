import {getPortalUser} from '../../../../lib/session';
import {getActor} from '../../../../lib/access';
import {database} from '../../../../lib/platform';
import {getManagedUser} from '../../../../lib/users';
import {publicError} from '../../../../lib/errors';
export const dynamic='force-dynamic';
function privateResponse(response:Response){
 response.headers.set('Cache-Control','private, no-store');
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Referrer-Policy','no-referrer');
 return response;
}
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 try{
  const db=database(),actor=await getActor(db,await getPortalUser()),{id}=await context.params;
  const person=await getManagedUser(db,actor,id,new URL(request.url).searchParams.get('projectId')??undefined);
  return privateResponse(Response.json({person}));
 }catch(error){return privateResponse(publicError(error));}
}
