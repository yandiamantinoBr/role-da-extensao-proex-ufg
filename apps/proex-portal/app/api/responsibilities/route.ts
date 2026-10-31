import { getActor } from '@/lib/access';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';
import { boundedJson } from '@/lib/http';
import { HttpError, publicError } from '@/lib/errors';
import { responsibilityAction, responsibilityCatalog, responsibilityDetail, responsibilityList } from '@/lib/responsibilities/service';
export const dynamic='force-dynamic';
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;};
export async function GET(request:Request){try{const db=database(),actor=await getActor(db,await getPortalUser()),input:Record<string,unknown>=Object.fromEntries(new URL(request.url).searchParams);for(const key of ['limit','offset'])if(key in input)input[key]=Number(input[key]);const result=input.view==='catalog'?await responsibilityCatalog(db,actor,input):input.view==='detail'?await responsibilityDetail(db,actor,input.id):input.view===undefined||input.view==='list'?await responsibilityList(db,actor,input):null;if(!result)throw new HttpError(400,'Escolha uma consulta válida.');return privateResponse(Response.json(result));}catch(error){return privateResponse(publicError(error));}}
export async function POST(request:Request){try{if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(403,'Atualize o portal antes de salvar.','invalid_origin');const input=await boundedJson(request,64*1024);if(typeof input.action!=='string')throw new HttpError(400,'Escolha uma operação válida.');const db=database();return privateResponse(Response.json(await responsibilityAction(db,await getActor(db,await getPortalUser()),input.action,input)));}catch(error){return privateResponse(publicError(error));}}
