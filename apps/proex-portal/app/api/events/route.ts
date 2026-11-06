import { database } from '../../../lib/platform';
import { publicEvents } from '../../../lib/public-events';
import { publicError } from '../../../lib/errors';
export const dynamic='force-dynamic';
export async function GET(){
 let response:Response;
 try{const rows=await publicEvents(database());response=Response.json({events:rows.slice(0,500),truncated:rows.length>500});}
 catch(error){response=publicError(error);}
 response.headers.set('Cache-Control','no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;
}
