import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getActor} from '@/lib/access';
import {database} from '@/lib/platform';
import {boundedJson} from '@/lib/http';
import {HttpError} from '@/lib/errors';
import {syncStatus,configureSync,startSyncRun,finishSyncRun} from '@/lib/sync/control';
import {exportPortablePage} from '@/lib/sync/portable';
import {applyPortableChanges} from '@/lib/sync/apply';
import {seedCatalog,catalogPreview} from '@/lib/sync/catalog';
import {listSyncAttachments,createAttachmentTicket,acknowledgeAttachmentExport,acknowledgeAttachmentCleanup} from '@/lib/sync/attachments';
export const dynamic='force-dynamic';
const schema=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'};
const tools=[
 {name:'proex_sync_describe',description:'Leia a configuração, o histórico e os esquemas seguros da sincronização PROEX. Somente mantenedor geral.',inputSchema:schema({})},
 {name:'proex_sync_read',description:'Leia uma página operacional explícita. Continue com after e expectedDigest; uma alteração exige reiniciar a tabela. Nunca exporta credenciais ou CPF.',inputSchema:schema({table:str,after:str,expectedDigest:str,limit:{type:'integer',minimum:1,maximum:100}},['table'])},
 {name:'proex_sync_apply',description:'Importe até 25 alterações com chave estável. Somente campos editáveis e operações de domínio permitidas; respeita versões, estoque, escopo e recibos. Leia os resultados e preserve conflitos.',inputSchema:schema({connectionId:str,runId:str,changes:{type:'array',minItems:1,maxItems:25,items:{type:'object'}}},['changes'])},
 {name:'proex_sync_configure',description:'Vincule IDs observados da planilha e das pastas privadas do Drive. Salvar configuração não atesta sincronização.',inputSchema:schema({spreadsheetId:str,folderId:str,attachmentsFolderId:str},['spreadsheetId','folderId','attachmentsFolderId'])},
 {name:'proex_sync_run_start',description:'Inicie uma execução para a planilha configurada. Se já houver execução ativa, aguarde.',inputSchema:schema({requestId:str})},
 {name:'proex_sync_run_finish',description:'Encerre uma execução. Confirme completed somente após releitura real de todas as abas. Em falha ou conflito, preserve linhas pendentes.',inputSchema:schema({id:str,status:{type:'string',enum:['completed','conflict','failed']},exportedCount:{type:'integer',minimum:0},readbackVerified:{type:'boolean'},tablesVerified:{type:'integer',minimum:0}},['id','status'])},
 {name:'proex_catalog_preview',description:'Consulte o catálogo institucional verificado e a política de pré-preenchimento, sem gravar.',inputSchema:schema({})},
 {name:'proex_catalog_seed',description:'Pré-cadastre projetos, fontes, editais de referência e materiais Rolê com saldo zero. Não sobrescreve cadastros existentes nem inventa operações.',inputSchema:schema({})},
 {name:'proex_sync_attachment_list',description:'Liste fotos e termos privados por IDs, sem nomes ou chaves R2. Reutilize a cópia Drive existente. Retorna também pendências de limpeza quando disponíveis.',inputSchema:schema({after:str,cleanupAfter:str,limit:{type:'integer',minimum:1,maximum:100}})},
 {name:'proex_sync_attachment_ticket',description:'Crie um download privado de um anexo para cópia no Drive. Expira em 60 segundos e funciona uma vez. Nunca grave o ticket na planilha.',inputSchema:schema({kind:{type:'string',enum:['record','loan','avatar']},id:str},['kind','id'])},
 {name:'proex_sync_attachment_ack',description:'Registre a cópia privada já enviada e relida no Drive. Hash e tamanho precisam corresponder ao recibo de download real. Nunca confirme antes do upload e da verificação de privacidade.',inputSchema:schema({kind:{type:'string',enum:['record','loan','avatar']},id:str,driveFileId:str,driveUrl:str,contentHash:str,size:{type:'integer',minimum:1},privateConfirmed:{type:'boolean'},readbackVerified:{type:'boolean'}},['kind','id','driveFileId','driveUrl','contentHash','size','privateConfirmed','readbackVerified'])},
 {name:'proex_sync_attachment_cleanup',description:'Registre que uma cópia externa foi efetivamente excluída após revisão de privacidade. Exige confirmação explícita; não exclui o arquivo do Google por si só.',inputSchema:schema({exportId:str,reason:str,confirmedDeleted:{type:'boolean'}},['exportId','reason','confirmedDeleted'])},
];
export async function POST(request:Request){let id:unknown=null;try{
 const origin=request.headers.get('origin');
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')||(origin&&origin!==new URL(request.url).origin&&origin!=='https://chatgpt.com'))throw new HttpError(403,'Origem da ferramenta inválida.','invalid_mcp_origin');
 const body=await boundedJson(request,144*1024);id=body.id??null;
 if(body.jsonrpc!=='2.0'||typeof body.method!=='string')return Response.json({jsonrpc:'2.0',id,error:{code:-32600,message:'Invalid request'}},{status:400});
 let result:unknown;
 if(body.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities:{tools:{}}};
 else if(body.method==='tools/list')result={tools};
 else if(body.method==='tools/call'){
  const db=database(),actor=await getActor(db,await getChatGPTUser());
  const params=body.params&&typeof body.params==='object'?body.params as Record<string,unknown>:{};
  const args=params.arguments&&typeof params.arguments==='object'&&!Array.isArray(params.arguments)?params.arguments as Record<string,unknown>:{};
  const name=params.name;
  // Native identity is supplied by Sites dispatch; no browser cookie, email claim,
  // OWNER_EMAIL bootstrap, service bypass bearer or sheet cell grants owner access.
  const value=name==='proex_sync_describe'?await syncStatus(db,actor):name==='proex_sync_read'?await exportPortablePage(db,actor,args as any):name==='proex_sync_apply'?await applyPortableChanges(db,actor,args as any):name==='proex_sync_configure'?await configureSync(db,actor,args):name==='proex_sync_run_start'?await startSyncRun(db,actor,args):name==='proex_sync_run_finish'?await finishSyncRun(db,actor,args):name==='proex_catalog_seed'?await seedCatalog(db,actor):name==='proex_catalog_preview'?(await syncStatus(db,actor),catalogPreview()):name==='proex_sync_attachment_list'?await listSyncAttachments(db,actor,args):name==='proex_sync_attachment_ticket'?await createAttachmentTicket(db,actor,{kind:args.kind,id:args.id,origin:new URL(request.url).origin}):name==='proex_sync_attachment_ack'?await acknowledgeAttachmentExport(db,actor,args as any):name==='proex_sync_attachment_cleanup'?await acknowledgeAttachmentCleanup(db,actor,args as any):undefined;
  if(value===undefined)throw new HttpError(400,'Ferramenta desconhecida.','unknown_tool');
  result={content:[{type:'text',text:JSON.stringify(value)}]};
 }else return Response.json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}},{status:400});
 return Response.json({jsonrpc:'2.0',id,result},{headers:{'Cache-Control':'no-store'}});
 }catch(error){const known=error instanceof HttpError;return Response.json({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:JSON.stringify({code:known?error.code:'sync_failed',error:known?error.message:'Não foi possível concluir a ferramenta.'})}]}},{headers:{'Cache-Control':'no-store'}});}}
