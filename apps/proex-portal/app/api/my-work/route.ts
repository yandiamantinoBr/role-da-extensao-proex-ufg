import { getActor } from '@/lib/access';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { publicError } from '@/lib/errors';
import { myWork } from '@/lib/my-work/service';
export const dynamic='force-dynamic';
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;};
export async function GET(request:Request){try{const db=database(),input:Record<string,unknown>=Object.fromEntries(new URL(request.url).searchParams);for(const key of ['limit','taskOffset','responsibilityOffset'])if(key in input)input[key]=Number(input[key]);return privateResponse(Response.json(await myWork(db,await getActor(db,await getPortalUser()),input)));}catch(error){return privateResponse(publicError(error));}}
