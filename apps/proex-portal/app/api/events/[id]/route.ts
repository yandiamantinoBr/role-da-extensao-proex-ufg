import {getPortalUser} from '@/lib/session';
import {database} from '../../../../lib/platform';
import {one,all,text} from '../../../../lib/database';
import {HttpError,publicError} from '../../../../lib/errors';
import {boundedJson} from '../../../../lib/http';
import {draw,participationView} from '../../../../lib/participation';
import {publicEvent} from '../../../../lib/public-events';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){try{
 const {id}=await context.params,db=database(),c=await publicEvent(db,id);if(!c)throw new HttpError(404,'Evento indisponível. Confira o link ou consulte os eventos publicados.');
 const user=await getPortalUser(),p=user?await one(db,'SELECT id FROM participations WHERE campaign_id=? AND identity_id=?',[id,user.userId]):null;
 const settings=Object.fromEntries((await all(db,"SELECT name,value FROM settings WHERE name IN ('instagramUrl','privacyNotice')")).map(r=>[r.name,r.value]));
 // Abrir um evento é somente leitura. No alvo Node, gravar cada visita
 // publicaria o banco inteiro novamente; os contadores antigos são históricos.
 const participation=p?await participationView(db,p.id):null,latest=await publicEvent(db,id);if(!latest||JSON.stringify(latest)!==JSON.stringify(c))throw new HttpError(404,'Evento indisponível. Confira o link ou consulte os eventos publicados.');
 return Response.json({campaign:c,authenticated:!!user,participation,instagramUrl:settings.instagramUrl||null,privacyNotice:settings.privacyNotice||null},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){return publicError(e);}}
export async function POST(request:Request,context:Context){try{
 const url=new URL(request.url),origin=request.headers.get('origin');if(request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('content-type')?.includes('application/json')||(origin&&origin!==url.origin))throw new HttpError(403,'Origem da solicitação inválida.');
 const input=await boundedJson(request,4096);if(input.action!=='draw')throw new HttpError(400,'Ação inválida.');
 const user=await getPortalUser();if(!user)throw new HttpError(401,'Entre para participar.');const {id}=await context.params;return Response.json({ok:true,...await draw(database(),text(id,100),user,input)},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return publicError(e);}}
