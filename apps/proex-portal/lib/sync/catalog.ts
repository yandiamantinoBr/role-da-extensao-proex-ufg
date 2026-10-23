import catalog from '../catalog/proex-2026.json';
import { one, all } from '../database';
import { type PortalActor } from '../access';
import { requireSyncOwner } from './contracts';
import { applyPortableChanges } from './apply';
import { HttpError } from '../errors';

export function catalogPreview(){return {verifiedAt:catalog.verifiedAt,projects:[...catalog.publicProjects,...catalog.relatedEntities].map(p=>({key:p.key,name:p.name,description:p.description,officialUrl:p.officialUrl,entityType:p.entityType,catalogStatus:p.catalogStatus})),notice:'Referências históricas permanecem no catálogo, sem inferir encerramento. Saldos iniciais zero; nenhum empréstimo, participação, entrega ou evento realizado é inventado.'};}
const materials=[['Button laranja — 2,5 cm','gift'],['Button roxo — 2,5 cm','gift'],['Button azul — 2,5 cm','gift'],['Planner — conjunto de folhas','gift'],['Caneta PROEX — tinta preta','gift'],['Sacochila Rolê da Extensão','gift'],['Squeeze branca PROEX','gift'],['Agenda PROEX','gift'],['Banner Rolê da Extensão','equipment'],['Dado Rolê da Extensão','equipment'],['Fantasia Rolê da Extensão','equipment']] as const;
function canonicalName(value:unknown){return typeof value==='string'?value.normalize('NFC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('pt-BR'):'';}
function canonicalUrl(value:unknown){if(typeof value!=='string')return '';try{const url=new URL(value);url.hash='';return url.href.replace(/\/$/,'');}catch{return '';}}
export async function seedCatalog(db:D1Database,actor:PortalActor|null){
 await requireSyncOwner(db,actor);if(!actor)throw new Error('unauthenticated');
 const summary:{kind:string;name:string;status:string}[]=[];
 const newlyCreated=new Set<string>();
 async function create(changeKey:string,action:string,input:Record<string,unknown>){const r=await applyPortableChanges(db,actor,{changes:[{changeKey,action,input}]});const result=r.results[0];if(!['applied','duplicate'].includes(result.status))throw new HttpError(409,'Uma referência do catálogo precisa de revisão. Consulte os conflitos da integração.',result.code||'catalog_write_failed');if(result.status==='applied')newlyCreated.add(changeKey);return result.entityId;}
 const types:Record<string,string>={};
 for(const [key,label] of Object.entries({project:'Projeto',program:'Programa',event:'Evento',funding_program:'Programa de fomento'})){
  let row=await one(db,'SELECT id,status FROM project_types WHERE key=?',[key]);
  if(!row){await create(`catalog-v4-type-${key}`,'project.type.create',{key,label,description:'Classificação institucional; pode ser complementada pela equipe.'});row=await one(db,'SELECT id FROM project_types WHERE key=?',[key]);}
  if(row&&row.status!=='archived')types[key]=row.id;
 }
 for(const project of [...catalog.publicProjects,...catalog.relatedEntities]){
  // SQLite lower() is ASCII-only. Compare NFC Unicode names in JS so an existing
  // ROLÊ DA EXTENSÃO (or decomposed accent) is preserved instead of duplicated.
  const projects=await all(db,'SELECT id,name,official_url FROM projects ORDER BY created_at,id');
  const existing=projects.find(row=>canonicalUrl(row.official_url)===canonicalUrl(project.officialUrl))
   ??projects.find(row=>canonicalName(row.name)===canonicalName(project.name));
  let id=existing?.id;
  if(!id){id=await create(`catalog-v4-project-${project.key}`,'project.create',{name:project.name,shortName:project.name.slice(0,40),description:project.description+(project.catalogStatus.startsWith('historical')?' Referência do índice institucional 2022–2025; situação atual a confirmar.':''),officialUrl:project.officialUrl,typeId:types[project.entityType],lifecycle:project.catalogStatus.startsWith('historical')?'catalog':'active',status:'active',color:'#54216C'});}
  if(!id)throw new Error('catalog_project_missing');
  summary.push({kind:'project',name:project.name,status:newlyCreated.has(`catalog-v4-project-${project.key}`)?'created':'preserved'});
  if(!await one(db,'SELECT id FROM project_links WHERE project_id=? AND url=?',[id,project.officialUrl]))await create(`catalog-v4-link-${project.key}`,'project.link.create',{projectId:id,label:'Fonte institucional',url:project.officialUrl,kind:'official'});
  if('calls' in project)for(const call of project.calls){
   if(!await one(db,'SELECT id FROM calls WHERE project_id=? AND reference_code=?',[id,call.referenceCode]))await create(`catalog-v4-call-${project.key}-${call.referenceCode.replace(/[^a-zA-Z0-9]/g,'')}`,'call.create',{projectId:id,title:call.title,referenceCode:call.referenceCode,description:call.statusFact+' Confira o cronograma e os documentos na fonte oficial.',officialUrl:call.officialUrl,status:'draft'});
  }
  if(project.key==='role-da-extensao'){
   const existingItems=await all(db,'SELECT name FROM items WHERE project_id=?',[id]);
   for(const [index,[name,category]] of materials.entries())if(!existingItems.some(item=>canonicalName(item.name)===canonicalName(name))){const changeKey=`catalog-v4-material-${index}`;await create(changeKey,'item.create',{projectId:id,name,category,unit:'unidade',lowStock:0,description:'Pré-cadastro de referência. Faça a contagem física e registre uma entrada para informar o saldo real. Composição dos kits e características devem ser conferidas pela equipe.',assetCode:''});summary.push({kind:'item',name,status:newlyCreated.has(changeKey)?'created_zero_stock':'preserved'});}
  }
 }
 return {summary,notice:catalogPreview().notice};
}
