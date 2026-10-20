import {getChatGPTUser} from '../../../chatgpt-auth';
import {database} from '../../../../lib/platform';
import {one,all,iso,text} from '../../../../lib/database';
import {HttpError,publicError} from '../../../../lib/errors';
import {boundedJson} from '../../../../lib/http';
import {draw,participationView} from '../../../../lib/participation';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){try{
 const {id}=await context.params,db=database(),c=await one(db,'SELECT id,name,project_id,location,status,rules_text,retry_limit,starts_at,ends_at FROM campaigns WHERE id=? AND status<>?',[id,'draft']);if(!c)throw new HttpError(404,'Ação não encontrada ou ainda não publicada.');
 const user=await getChatGPTUser(),p=user?await one(db,'SELECT id FROM participations WHERE campaign_id=? AND identity_id=?',[id,user.userId]):null;
 const settings=Object.fromEntries((await all(db,"SELECT name,value FROM settings WHERE name IN ('instagramUrl','privacyNotice')")).map(r=>[r.name,r.value]));
 await db.prepare('INSERT INTO visits(campaign_id,day,hits) VALUES(?,?,1) ON CONFLICT(campaign_id,day) DO UPDATE SET hits=hits+1').bind(id,new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())).run();
 return Response.json({campaign:c,authenticated:!!user,participation:p?await participationView(db,p.id):null,instagramUrl:settings.instagramUrl||null,privacyNotice:settings.privacyNotice||null},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return publicError(e);}}
export async function POST(request:Request,context:Context){try{
 const url=new URL(request.url),origin=request.headers.get('origin');if(request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('content-type')?.includes('application/json')||(origin&&origin!==url.origin))throw new HttpError(403,'Origem da solicitação inválida.');
 const input=await boundedJson(request,4096);if(input.action!=='draw')throw new HttpError(400,'Ação inválida.');
 const user=await getChatGPTUser();if(!user)throw new HttpError(401,'Entre para participar.');const {id}=await context.params;return Response.json({ok:true,...await draw(database(),text(id,100),user,input)},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return publicError(e);}}
