import { database } from '@/lib/platform';
import { boundedJson } from '@/lib/http';
import { HttpError } from '@/lib/errors';
import { memoryRateLimit } from '@/lib/rate-limit';
import { teamSheetPrincipal } from '@/lib/sync/team-sheets';
import { callTeamSheetTool } from '@/lib/sync/team-sheets-data';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new HttpError(415,'Envie JSON.','invalid_content_type');
 const body=await boundedJson(request,8192),db=database(),principal=await teamSheetPrincipal(db,request.headers.get('Authorization'),body.spreadsheetId);
 memoryRateLimit(`team-sheet:${principal.tokenId}`,1000,600000);
 const args=body.args&&typeof body.args==='object'&&!Array.isArray(body.args)?body.args as Record<string,unknown>:{};
 const result=await callTeamSheetTool(db,principal,body.tool,args,new URL(request.url).origin);
 return Response.json({ok:true,result},{headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){const known=error instanceof HttpError;return Response.json({ok:false,code:known?error.code:'team_sync_failed',error:known?error.message:'Não foi possível concluir a consulta da equipe.'},{status:known?error.status:500,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}}
