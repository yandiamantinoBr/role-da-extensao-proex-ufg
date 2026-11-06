import {getActor} from '@/lib/access';
import {database} from '@/lib/platform';
import {getPortalUser} from '@/lib/session';
import {boundedJson} from '@/lib/http';
import {HttpError,publicError} from '@/lib/errors';
import {materialAttentionInbox,materialAttentionAction} from '@/lib/material-attention';
export const dynamic='force-dynamic';
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;};
export async function GET(request:Request){try{const q=new URL(request.url).searchParams;if([...q.keys()].some(key=>!['before','includeDismissed'].includes(key)||q.getAll(key).length!==1)||q.has('includeDismissed')&&!['true','false'].includes(q.get('includeDismissed')!))throw new HttpError(400,'Escolha uma consulta válida.');const db=database(),actor=await getActor(db,await getPortalUser());return privateResponse(Response.json(await materialAttentionInbox(db,actor,{before:q.has('before')?Number(q.get('before')):null,includeDismissed:q.get('includeDismissed')==='true'})));}catch(error){return privateResponse(publicError(error));}}
export async function POST(request:Request){try{if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(403,'Atualize o portal antes de salvar.','invalid_origin');const input=await boundedJson(request,4*1024),db=database();return privateResponse(Response.json(await materialAttentionAction(db,await getActor(db,await getPortalUser()),input)));}catch(error){return privateResponse(publicError(error));}}
