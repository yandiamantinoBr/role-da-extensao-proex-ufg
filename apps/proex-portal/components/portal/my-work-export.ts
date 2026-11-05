import {priorityLabels,stateLabels} from '@/lib/follow-up/contracts';
import {isWorkDay} from '@/lib/follow-up/presentation';
import {isMyWorkResponse,type AssignmentFilter,type MyWorkResponse,type MyWorkStatus,type OperationalArea} from '@/lib/my-work/contracts';
import type {ExportColumn,ExportRow} from './report-export';
import type {ReportPdfPresentation} from './report-pdf';

export const MY_WORK_PAGE_SIZE=6;
export const MY_WORK_STATUS_LABELS:Record<MyWorkStatus,string>={pending:'Pendentes',all:'Todas',completed:'Concluídas',attention:'Precisam de atenção',overdue:'Em atraso',due_today:'Prazo hoje',in_progress:'Em andamento',blocked:'Bloqueadas',open:'Abertas',cancelled:'Canceladas'};
const assignmentLabels:Record<AssignmentFilter,string>={all:'Diretas e por equipe',direct:'Diretas',team:'Por equipe'};
const areaLabels:Record<OperationalArea,string>={projects:'Projetos',materials:'Materiais',loans:'Empréstimos',campaigns:'Dinâmicas e eventos',general:'Organização'};
export type MyWorkExportQuery={userId:string;organizationId:string|null;projectId:string|null;assignment:AssignmentFilter;status:MyWorkStatus;taskOffset:number;responsibilityOffset:number};
export function myWorkQuery(query:MyWorkExportQuery){
 const params=new URLSearchParams({assignment:query.assignment,status:query.status,taskOffset:String(query.taskOffset),responsibilityOffset:String(query.responsibilityOffset),limit:String(MY_WORK_PAGE_SIZE)});
 if(query.organizationId)params.set('organizationId',query.organizationId);if(query.projectId)params.set('projectId',query.projectId);
 return `/api/my-work?${params}`;
}
export function assertMyWorkContext(value:unknown,query:MyWorkExportQuery):asserts value is MyWorkResponse {
 if(!isMyWorkResponse(value)||value.viewerId!==query.userId||value.scope.organizationId!==query.organizationId||value.scope.projectId!==query.projectId||value.scope.assignment!==query.assignment||value.scope.status!==query.status||value.tasks.items.length>MY_WORK_PAGE_SIZE||value.responsibilities.items.length>MY_WORK_PAGE_SIZE||[...value.tasks.items,...value.responsibilities.items].some(row=>query.organizationId&&row.organization_id!==query.organizationId||query.projectId&&row.project_id!==query.projectId))throw new Error('A sessão ou o contexto da resposta mudou. Atualize a página.');
}
const clean=(value:string)=>value.replace(/\p{Cc}|\p{Bidi_Control}/gu,' ').replace(/\s+/gu,' ').trim();
const restricted='Registro de acesso restrito';
const range=(offset:number,length:number,total:number)=>length?`${offset+1}–${offset+length} de ${total}`:`0 de ${total}`;
const timestamp=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium',timeZone:'America/Sao_Paulo'}).format(new Date(value));
export const myWorkExportColumns:ExportColumn[]=[{key:'tipo',label:'Tipo'},{key:'registro',label:'Registro'},{key:'contexto',label:'Contexto'},{key:'estado',label:'Estado'},{key:'prioridade',label:'Prioridade'},{key:'prazo',label:'Prazo'}];
/** An allowlist creates new plain rows. Never pass raw DTOs, IDs, URLs, bodies,
 * contacts or assignees to a serializer, even for an authorized record. */
export function myWorkExportRows(data:MyWorkResponse):ExportRow[]{
 const hidden=(tipo:string)=>({tipo,registro:restricted,contexto:'',estado:'',prioridade:'',prazo:''});
 const tasks=data.tasks.items.map(task=>!task.target.canOpen?hidden('Demanda'):{tipo:'Demanda',registro:clean(task.title),contexto:clean([areaLabels[task.area],task.organization_name,task.project_name].filter(Boolean).join(' · ')),estado:stateLabels[task.status],prioridade:priorityLabels[task.priority],prazo:isWorkDay(task.due_at)?task.due_at.split('-').reverse().join('/'):'Sem prazo'});
 const responsibilities=data.responsibilities.items.map(row=>!row.target.canOpen?hidden('Designação'):{tipo:'Designação',registro:clean(row.target.name??'Registro designado'),contexto:clean([areaLabels[row.area],row.organization_name,row.project_name].filter(Boolean).join(' · ')),estado:'Designação ativa',prioridade:'Não se aplica',prazo:'Sem prazo'});
 return [...tasks,...responsibilities];
}
export function myWorkExportReport(data:MyWorkResponse,query:MyWorkExportQuery){
 assertMyWorkContext(data,query);const rows=myWorkExportRows(data),restrictedCount=rows.filter(row=>row.registro===restricted).length;
 const info:[string,string][]=[
  ['Instituição e escopo','PROEX UFG. Somente as páginas atuais de Meu trabalho; até 6 demandas e 6 acompanhamentos. Não é o conjunto completo.'],
  ['Filtros',`${query.organizationId?'Organização selecionada':'Organizações permitidas'} · ${query.projectId?'Projeto selecionado':'Projetos permitidos'} · ${assignmentLabels[query.assignment]} · ${MY_WORK_STATUS_LABELS[query.status]}`],
  ['Páginas e limites',`Demandas ${range(query.taskOffset,data.tasks.items.length,data.tasks.total)} (deslocamento ${query.taskOffset}); acompanhamentos ${range(query.responsibilityOffset,data.responsibilities.items.length,data.responsibilities.total)} (deslocamento ${query.responsibilityOffset}). Limite 6 por lista.`],
  ['Totais do contexto',`${data.totals.tasks.total} demandas e ${data.totals.responsibilities.total} acompanhamentos; abrangem as páginas do contexto e da origem, antes do filtro de estado.`],
  ['Consulta e geração',`Dados em ${timestamp(data.asOf)} · arquivo em ${timestamp(new Date().toISOString())} (Brasília)`],
 ];
 const presentation:ReportPdfPresentation={columnWeights:[1.35,1.9,1.9,1.4,1.4,1.45],metrics:[{label:'Demandas nesta página',value:data.tasks.items.length},{label:'Acompanhamentos nesta página',value:data.responsibilities.items.length},{label:'Registros de acesso restrito',value:restrictedCount}]};
 return{title:'Meu trabalho nas páginas atuais',columns:myWorkExportColumns,rows,info,presentation};
}
/** Ignore consultation timestamps, but fence any change to records, privacy,
 * counts, filters or pagination while the local artifact is being rendered. */
export function myWorkExportFingerprint(data:MyWorkResponse,query:MyWorkExportQuery){return JSON.stringify({scope:data.scope,today:data.today,rows:myWorkExportRows(data),totals:data.totals,tasks:{total:data.tasks.total,hasMore:data.tasks.hasMore,nextOffset:data.tasks.nextOffset},responsibilities:{total:data.responsibilities.total,hasMore:data.responsibilities.hasMore,nextOffset:data.responsibilities.nextOffset},offsets:[query.taskOffset,query.responsibilityOffset]});}

/** Optional Vault copy of exactly the same reduced report. Text is literal,
 * including Obsidian syntax; no raw HTML, embeds, URLs or record IDs are added. */
export function myWorkMarkdownReport(report:ReturnType<typeof myWorkExportReport>){
 const literal=(value:unknown)=>clean(String(value??'')).replace(/[\\`*{}\[\]<>()#+.!_~|^=$:%/@&-]/g,'\\$&');
 const table=(values:unknown[])=>'| '+values.map(literal).join(' | ')+' |';
 return['# Meu trabalho no Portal PROEX','','## Sobre o recorte','',...report.info.map(([label,value])=>`- **${literal(label)}:** ${literal(value)}`),'','## Registros destas páginas','',table(report.columns.map(column=>column.label)),'| '+report.columns.map(()=>'---').join(' | ')+' |',...report.rows.map(row=>table(report.columns.map(column=>row[column.key]))),''].join('\n');
}
