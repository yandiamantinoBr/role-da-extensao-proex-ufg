import {getPortalUser} from '@/lib/session';
import {database} from '@/lib/platform';
import {getActor} from '@/lib/access';
import {HttpError,publicError} from '@/lib/errors';
import {boundedJson} from '@/lib/http';
import {syncStatus,configureSync,requestSync} from '@/lib/sync/control';
import {exportPortablePage} from '@/lib/sync/portable';
import {applyPortableChanges} from '@/lib/sync/apply';
import {seedCatalog,catalogPreview} from '@/lib/sync/catalog';
import {createSyncToken,listSyncTokens,revokeSyncToken} from '@/lib/sync/tokens';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const db=database(),actor=await getActor(db,await getPortalUser()),q=new URL(request.url).searchParams;const result=q.get('table')?await exportPortablePage(db,actor,{table:q.get('table')!,after:q.get('after')??undefined,expectedDigest:q.get('digest')??undefined}):{...await syncStatus(db,actor),catalog:catalogPreview()};return Response.json(result,{headers:{'Cache-Control':'no-store'}});}catch(e){return publicError(e);}}
export async function POST(request:Request){try{
 const url=new URL(request.url),origin=request.headers.get('origin');if(request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('content-type')?.includes('application/json')||(origin&&origin!==url.origin))throw new HttpError(403,'Origem inválida.');
 const input=await boundedJson(request,144*1024),db=database(),actor=await getActor(db,await getPortalUser());
 const result=input.action==='configure'?await configureSync(db,actor,input):input.action==='request'?await requestSync(db,actor):input.action==='seed'?await seedCatalog(db,actor):input.action==='apply'?await applyPortableChanges(db,actor,{connectionId:input.connectionId,changes:input.changes}):input.action==='token.create'?await createSyncToken(db,actor,input):input.action==='token.revoke'?await revokeSyncToken(db,actor,input):input.action==='token.list'?{tokens:await listSyncTokens(db,actor)}:null;
 if(!result)throw new HttpError(400,'Ação desconhecida.');return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return publicError(e);}}
