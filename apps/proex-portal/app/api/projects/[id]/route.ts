import { getPortalUser } from '@/lib/session';
import { getActor } from '@/lib/access';
import { projectDetail } from '@/lib/projects';
import { database } from '@/lib/platform';
import { publicError } from '@/lib/errors';
export const dynamic='force-dynamic';
export async function GET(_request:Request,context:{params:Promise<{id:string}>}):Promise<Response>{
  try{const db=database(),actor=await getActor(db,await getPortalUser()),{id}=await context.params;return Response.json(await projectDetail(db,actor,id),{headers:{'Cache-Control':'private, no-store'}});}
  catch(error){const response=publicError(error);response.headers.set('Cache-Control','private, no-store');return response;}
}
