import {database} from '@/lib/platform';
import {authForRequest} from '@/lib/session';
import {publicError} from '@/lib/errors';
export const dynamic='force-dynamic';
// The public API exposes only session lifecycle and password recovery. Account
// creation and administrative endpoints remain inaccessible through this route.
const allowed=new Set(['get-session','sign-out','reset-password','change-password','list-sessions','revoke-session','revoke-sessions','revoke-other-sessions']);
async function handle(request:Request){try{const path=new URL(request.url).pathname.split('/api/auth/')[1]?.split('/')[0];if(!allowed.has(path))return Response.json({error:'Operação de conta indisponível.'},{status:404,headers:{'Cache-Control':'no-store'}});const response=await (await authForRequest(database())).handler(request);response.headers.set('Cache-Control','private, no-store');return response;}catch(e){return publicError(e);}}
export const GET=handle;export const POST=handle;
