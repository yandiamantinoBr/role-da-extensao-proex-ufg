import { getActor } from '../../../../lib/access';
import { publicError } from '../../../../lib/errors';
import { stockConsumption } from '../../../../lib/stock-context';
import { database } from '../../../../lib/platform';
import { getPortalUser } from '../../../../lib/session';
export const dynamic='force-dynamic';
export async function GET(request:Request):Promise<Response>{
 let response:Response;
 try{const db=database(),actor=await getActor(db,await getPortalUser()),input=Object.fromEntries(new URL(request.url).searchParams);response=Response.json(await stockConsumption(db,actor,input));}
 catch(error){response=publicError(error);}
 response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;
}
