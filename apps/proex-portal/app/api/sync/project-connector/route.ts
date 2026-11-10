import { database } from '@/lib/platform';
import { boundedJson } from '@/lib/http';
import { HttpError } from '@/lib/errors';
import { memoryRateLimit } from '@/lib/rate-limit';
import { projectSheetPrincipal, isObject } from '@/lib/sync/project-sheets';
import { callProjectSheetTool } from '@/lib/sync/project-sheets-data';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new HttpError(415,'Envie JSON.','invalid_content_type');
 const body=await boundedJson(request,144*1024),db=database(),principal=await projectSheetPrincipal(db,request.headers.get('authorization'),body.spreadsheetId);
 memoryRateLimit(`project-sheet:${principal.tokenId}`,2000,600000);
 const result=await callProjectSheetTool(db,principal,body.tool,isObject(body.args)?body.args:{},new URL(request.url).origin);
 return Response.json({ok:true,result},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){const known=error instanceof HttpError;return Response.json({ok:false,code:known?error.code:'sync_failed',error:known?error.message:'Não foi possível concluir a integração do projeto.'},{status:known?error.status:500,headers:{'Cache-Control':'private, no-store'}});}}
