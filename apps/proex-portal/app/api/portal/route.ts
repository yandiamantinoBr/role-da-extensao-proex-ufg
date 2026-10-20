import {getPortalUser} from '@/lib/session';
import {database,inviteSecret} from '../../../lib/platform';
import {getActor,accessAction} from '../../../lib/access';
import {portalSnapshot} from '../../../lib/portal-data';
import {campaignAction} from '../../../lib/campaigns';
import {usersAction} from '../../../lib/users';
import {materialsAction} from '../../../lib/materials';
import {cancelAttendance} from '../../../lib/attendance-cancel';
import {participationAction} from '../../../lib/participation';
import {HttpError,publicError} from '../../../lib/errors';
import {boundedJson} from '../../../lib/http';
export const dynamic='force-dynamic';
export async function GET(){try{const db=database(),actor=await getActor(db,await getPortalUser());if(!actor)throw new HttpError(401,'Entre para acessar o painel.');return Response.json(await portalSnapshot(db,actor),{headers:{'Cache-Control':'no-store'}});}catch(e){return publicError(e);}}
export async function POST(request:Request){try{
 const url=new URL(request.url),origin=request.headers.get('origin');if(request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('content-type')?.includes('application/json')||(origin&&origin!==url.origin))throw new HttpError(403,'Origem da solicitação inválida.');
 const input=await boundedJson(request);if(typeof input.action!=='string')throw new HttpError(400,'Ação inválida.');
 const db=database(),actor=await getActor(db,await getPortalUser());if(!actor)throw new HttpError(401,'Entre para continuar.');
 const action=input.action;let result=action==='participation.cancel'?await cancelAttendance(db,actor,input):await accessAction(db,actor,action,input,url.origin,inviteSecret());
 if(result===null)result=await usersAction(db,actor,action,input);
 if(result===null)result=await campaignAction(db,actor,action,input);
 if(result===null)result=await materialsAction(db,actor,action,input);
 if(result===null)result=await participationAction(db,actor,action,input);
 if(result===null)throw new HttpError(400,'Ação não reconhecida.');return Response.json({ok:true,...result},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return publicError(e);}}
