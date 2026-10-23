import {database} from '@/lib/platform';
import {boundedJson} from '@/lib/http';
import {HttpError} from '@/lib/errors';
import {rateLimit} from '@/lib/rate-limit';
import {actorFromSyncToken} from '@/lib/sync/tokens';
import {callSyncTool} from '@/lib/sync/tools';
import {syncDigest} from '@/lib/sync/contracts';
export const dynamic='force-dynamic';
// Conector servidor-a-servidor da planilha (Apps Script). Sem cookies nem CORS:
// a única credencial aceita é a chave de sincronização no cabeçalho Authorization.
export async function POST(request:Request){try{
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new HttpError(415,'Envie JSON.','invalid_content_type');
 const db=database(),authorization=request.headers.get('authorization');
 await rateLimit(db,`sync-connector:${(await syncDigest(authorization??'')).slice(0,32)}`,2000,600000);
 const actor=await actorFromSyncToken(db,authorization);
 const body=await boundedJson(request,144*1024);
 const args=body.args&&typeof body.args==='object'&&!Array.isArray(body.args)?body.args as Record<string,unknown>:{};
 const result=await callSyncTool(db,actor,body.tool,args,new URL(request.url).origin);
 if(result===undefined)throw new HttpError(400,'Ferramenta desconhecida.','unknown_tool');
 return Response.json({ok:true,result},{headers:{'Cache-Control':'no-store'}});
 }catch(error){const known=error instanceof HttpError;return Response.json({ok:false,code:known?error.code:'sync_failed',error:known?error.message:'Não foi possível concluir a operação.'},{status:known?error.status:500,headers:{'Cache-Control':'no-store'}});}}
