import {database,inviteSecret} from '@/lib/platform';
import {getPortalUser} from '@/lib/session';
import {getActor} from '@/lib/access';
import {boundedJson} from '@/lib/http';
import {HttpError,publicError} from '@/lib/errors';
import {assistantConnectionStatus,testAssistantConnection} from '@/lib/assistant/connection';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function failed(error:unknown){const response=publicError(error);for(const [key,value]of Object.entries(headers))response.headers.set(key,value);return response;}
export async function GET(request:Request){try{const db=database(),actor=await getActor(db,await getPortalUser());if(!actor)throw new HttpError(401,'Entre para consultar o diagnóstico.','unauthenticated');return Response.json(await assistantConnectionStatus(db,actor,new URL(request.url).searchParams.get('organizationId')),{headers});}catch(error){return failed(error);}}
export async function POST(request:Request){try{if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??''))throw new HttpError(403,'Atualize o portal antes de testar.','invalid_origin');const db=database(),actor=await getActor(db,await getPortalUser());if(!actor)throw new HttpError(401,'Entre para testar.','unauthenticated');const secret=inviteSecret();if(!secret)throw new HttpError(503,'A segurança do assistente está indisponível.','assistant_unavailable');const input=await boundedJson(request,2048);return Response.json(await testAssistantConnection(db,actor,input,secret,{signal:request.signal}),{headers});}catch(error){return failed(error);}}
