import {getActor} from '@/lib/access';
import {database} from '@/lib/platform';
import {getPortalUser} from '@/lib/session';
import {publicError} from '@/lib/errors';
import {myWorkSummary} from '@/lib/my-work/summary';
export const dynamic='force-dynamic';
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;};
export async function GET(request:Request){try{const db=database(),input=Object.fromEntries(new URL(request.url).searchParams);return privateResponse(Response.json(await myWorkSummary(db,await getActor(db,await getPortalUser()),input)));}catch(error){return privateResponse(publicError(error));}}
