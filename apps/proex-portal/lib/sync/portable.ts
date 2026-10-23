import { all, csv } from '../database';
import { HttpError } from '../errors';
import { type PortalActor } from '../access';
import { canonicalSyncJson, syncDigest, requireSyncOwner, MAX_PORTABLE_PAGE, MAX_PORTABLE_TABLE_ROWS, MAX_PORTABLE_TABLE_BYTES, PORTABLE_VERSION, type PortableSchema, type PortableRow, type PortableColumn } from './contracts';

type Definition = { label: string; fields: string; editable?: string; action?: string; mode?: PortableSchema['mode']; key?: string; where?: string; omitted?: string[] };
// Explicit projections are intentional. Adding a database column does not make it
// an exported column. Credentials, CPF hashes and private storage keys never enter.
const DEFINITIONS: Record<string, Definition> = {
 project_types: {label:'Tipos de projeto',fields:'id,key,label,description,status,version,created_at,updated_at',editable:'label,description,status',action:'project.type.update'},
 projects: {label:'Projetos',fields:'id,name,short_name,description,status,lifecycle,type_id,parent_id,color,official_url,starts_at,ends_at,location,version,created_at',editable:'name,short_name,description,status,lifecycle,type_id,parent_id,color,official_url,starts_at,ends_at,location',action:'project.update'},
 project_links: {label:'Links de projetos',fields:'id,project_id,label,url,kind,version,created_at,updated_at',editable:'label,url,kind',action:'project.link.update'},
 project_schedule_items: {label:'Agenda de projetos',fields:'id,project_id,title,starts_at,ends_at,status,note,url,version,created_at,updated_at',editable:'title,starts_at,ends_at,status,note,url',action:'project.schedule.update'},
 calls: {label:'Editais',fields:'id,project_id,title,reference_code,description,status,opens_at,closes_at,official_url,version,created_at,updated_at',editable:'title,reference_code,description,status,opens_at,closes_at,official_url',action:'call.update'},
 project_calls: {label:'Projetos e editais',fields:'call_id,project_id',key:'json_array(call_id,project_id)'},
 material_categories: {label:'Categorias de materiais',fields:'id,project_id,label,core_kind,description,status,version,created_at,updated_at',editable:'label,description,status',action:'material.category.update'},
 items: {label:'Materiais',fields:'id,project_id,name,category,category_id,unit,stock,reserved,low_stock,description,condition,asset_code,version,created_at,updated_at',editable:'name,category_id,unit,low_stock,description,condition,asset_code',action:'item.update'},
 stock_movements: {label:'Movimentações de estoque',fields:'id,item_id,delta,kind,note,ref_id,created_at,group_id',mode:'append_only',omitted:['actor_id']},
 activity_groups: {label:'Atividades e entregas',fields:'id,project_id,title,occurred_at,kind,note,created_at',mode:'append_only',omitted:['created_by']},
 loans: {label:'Empréstimos',fields:'id,project_id,item_id,action_name,starts_at,ends_at,status,note,condition_out,condition_in,created_at,returned_at,checked_out_at,updated_at,group_id',mode:'append_only',omitted:['borrower_name','borrower_contact','created_by']},
 documents: {label:'Termos anexados',fields:'id,loan_id,project_id,mime,size,created_at',omitted:['object_key','name','created_by','operation_key','content_hash']},
 records: {label:'Registros',fields:'id,project_id,kind,title,body,occurred_at,starts_at,ends_at,item_id,loan_id,group_id,created_at',mode:'append_only',omitted:['created_by']},
 record_attachments: {label:'Anexos de registros',fields:'id,record_id,project_id,mime,size,created_at,caption,attachment_role,display_order,deleted_at',omitted:['object_key','name','operation_key','created_by']},
 campaigns: {label:'Ações da roleta',fields:'id,project_id,name,location,starts_at,ends_at,status,retry_limit,brinde_offer_id,super_offer_id,rules_text,version,created_at',editable:'name,location,starts_at,ends_at,retry_limit,brinde_offer_id,super_offer_id,rules_text',action:'campaign.update'},
 offers: {label:'Ofertas de brindes',fields:'id,project_id,name,kind,active',mode:'append_only'},
 offer_components: {label:'Composição de ofertas',fields:'offer_id,item_id,quantity',key:'json_array(offer_id,item_id)'},
 participations: {label:'Participações',fields:'id,campaign_id,identity_method,modality,attempt_count,state,created_at',omitted:['identity_id']},
 attempts: {label:'Tentativas',fields:'id,participation_id,number,result,state,created_at',omitted:['idempotency_key']},
 reservations: {label:'Reservas de brindes',fields:'id,participation_id,attempt_id,offer_id,item_id,quantity,state'},
 entitlements: {label:'Direitos a brindes',fields:'id,attempt_id,participation_id,offer_id,state,created_at,delivered_at',omitted:['delivered_by']},
 members: {label:'Equipe e permissões',fields:'id,user_id,role,project_id,revoked_at,created_at',omitted:['email']},
 profiles: {label:'Perfis da equipe',fields:'user_id,display_name,unit,job_title,version,created_at,updated_at',key:'user_id',omitted:['phone','avatar_key','mime']},
 audit: {label:'Histórico de operações',fields:'id,project_id,action,entity_id,created_at',omitted:['actor_id','details']},
 entity_versions: {label:'Revisões de metadados',fields:'id,entity_type,entity_id,project_id,version,created_at',omitted:['actor_id','snapshot_json']},
 visits: {label:'Acessos por dia',fields:'campaign_id,day,hits',key:'json_array(campaign_id,day)'},
 settings: {label:'Configurações públicas',fields:'name,value,updated_at',key:'name',where:"name IN ('instagramUrl','privacyNotice')"},
};
const LABELS: Record<string,string>={id:'Identificador',project_id:'Projeto',name:'Nome',title:'Título',description:'Descrição',status:'Situação',version:'Versão',created_at:'Criado em',updated_at:'Atualizado em',stock:'Saldo calculado',reserved:'Reservado calculado',low_stock:'Alerta de estoque',unit:'Unidade',asset_code:'Patrimônio',condition:'Condição',label:'Categoria',starts_at:'Início',ends_at:'Fim',note:'Observação',delta:'Quantidade da movimentação',kind:'Tipo',role:'Papel',user_id:'Identidade interna',display_name:'Nome de exibição',job_title:'Função',unit_id:'Unidade'};
const NUMBER_FIELDS=new Set(['stock','reserved','low_stock','version','delta','quantity','number','attempt_count','retry_limit','size','display_order','hits']);
export function describePortableSchemas(): {formatVersion:number;tables:PortableSchema[];limits:{page:number;tableRows:number;tableBytes:number};notice:string} {
 return {formatVersion:PORTABLE_VERSION,tables:Object.entries(DEFINITIONS).map(([table,d])=>{
  const editable=new Set((d.editable||'').split(','));
  const systemColumns:PortableColumn[]=[{name:'_rowKey',label:'Chave da linha (sistema)',type:'text',editable:false,required:true,system:true,private:false},{name:'_rowHash',label:'Resumo original (sistema)',type:'text',editable:false,required:true,system:true,private:false}];
  return {table,label:d.label,sheetName:table,mode:d.mode||(d.action?'metadata':'read_only'),updateAction:d.action,versionColumn:d.fields.split(',').includes('version')?'version':undefined,omitted:d.omitted||[],columns:[...systemColumns,...d.fields.split(',').map(name=>({name,label:LABELS[name]||name,type:NUMBER_FIELDS.has(name)||(table==='loans'&&['starts_at','ends_at'].includes(name))?'number':name==='active'?'boolean':/(?:_at|^day$)/.test(name)?'datetime':'text',editable:editable.has(name),required:name==='id'||name==='version',system:!editable.has(name),private:false} as PortableColumn))]};
 }),limits:{page:MAX_PORTABLE_PAGE,tableRows:MAX_PORTABLE_TABLE_ROWS,tableBytes:MAX_PORTABLE_TABLE_BYTES},notice:'Planilha não concede acesso. Saldos, resultados, permissões e histórico são calculados no portal. Contatos, credenciais, CPF e arquivos privados não são exportados; textos operacionais devem evitar dados pessoais. Gravações em planilhas devem usar valores RAW, sem interpretar texto como fórmula. Cada tabela tem sua própria versão de leitura; não há uma transação de leitura entre tabelas.'};
}
export function portableDefinition(table:string): PortableSchema | undefined {return describePortableSchemas().tables.find(row=>row.table===table);}
/** UTF-8 BOM, semicolon separator and formula-safe text for opening in Excel. */
export function portablePageCsv(rows:PortableRow[]):string{return csv(rows);}
export async function exportPortablePage(db:D1Database,actor:PortalActor|null,input:{table:unknown;after?:unknown;limit?:unknown;expectedDigest?:unknown}) {
 await requireSyncOwner(db,actor);
 if(typeof input.table!=='string'||!Object.hasOwn(DEFINITIONS,input.table))throw new HttpError(400,'Escolha uma tabela operacional válida.','sync_invalid_table');
 const d=DEFINITIONS[input.table],limit=input.limit===undefined?100:Number(input.limit);
 if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_PORTABLE_PAGE)throw new HttpError(400,'Use de 1 a 100 linhas por página.','sync_invalid_limit');
 if(input.after!==undefined&&typeof input.after!=='string')throw new HttpError(400,'Cursor inválido.','sync_invalid_cursor');
 if(input.expectedDigest!==undefined&&(typeof input.expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedDigest)))throw new HttpError(400,'Resumo de versão inválido.','sync_invalid_digest');
 if(input.after&&!input.expectedDigest)throw new HttpError(400,'Continue a paginação com o resumo da primeira página.','sync_digest_required');
 const rows=await all(db,`SELECT ${d.key||'id'} AS _rowKey,${d.fields} FROM ${input.table}${d.where?' WHERE '+d.where:''} ORDER BY _rowKey COLLATE BINARY LIMIT ?`,[MAX_PORTABLE_TABLE_ROWS+1]);
 if(rows.length>MAX_PORTABLE_TABLE_ROWS)throw new HttpError(413,'Esta tabela excede o limite de exportação. Divida os dados antes de sincronizar.','sync_table_limit');
 const serialized=canonicalSyncJson(rows);
 if(new TextEncoder().encode(serialized).length>MAX_PORTABLE_TABLE_BYTES)throw new HttpError(413,'Esta tabela excede o tamanho permitido.','sync_table_bytes');
 const digest=await syncDigest(serialized);
 if(input.expectedDigest&&input.expectedDigest!==digest)throw new HttpError(409,'Os dados mudaram durante a leitura. Reinicie esta tabela sem sobrescrever edições pendentes.','sync_snapshot_changed');
 const after=String(input.after||''),start=after?rows.findIndex(row=>row._rowKey===after)+1:0;
 if(after&&start===0)throw new HttpError(409,'O cursor não pertence a esta versão da tabela. Reinicie a leitura.','sync_invalid_cursor');
 const selected=rows.slice(start,start+limit),page:PortableRow[]=[];
 for(const row of selected)page.push({...row,_rowHash:await syncDigest(canonicalSyncJson(row))} as PortableRow);
 await requireSyncOwner(db,actor);
 return {formatVersion:PORTABLE_VERSION,table:input.table,digest,rows:page,total:rows.length,nextCursor:start+limit<rows.length?selected[selected.length-1]._rowKey:null,readOnly:!d.action,schema:portableDefinition(input.table)};
}
