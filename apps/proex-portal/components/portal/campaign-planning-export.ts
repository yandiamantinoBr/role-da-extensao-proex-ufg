import type {PlanningWorkspace,SessionStatus} from '@/lib/campaign-planning/contracts';
import type {ExportColumn,ExportRow} from './report-export';
import type {ReportPdfPresentation} from './report-pdf';

const clean=(value:string)=>value.replace(/[\p{Cc}\p{Bidi_Control}]/gu,' ').replace(/\s+/gu,' ').trim();
const states:Record<SessionStatus,string>={tentative:'Provisória',confirmed:'Confirmada',cancelled:'Cancelada',done:'Realizada'};
const columns:ExportColumn[]=[{key:'data',label:'Data'},{key:'ordem',label:'Ordem'},{key:'sessao',label:'Sessão'},{key:'inicio',label:'Início'},{key:'fim',label:'Fim'},{key:'situacao',label:'Situação'},{key:'observacao',label:'Observação'}];
/** Explicit literal projection: hosts, identity fields and arbitrary DTO properties never reach a document. */
export function planningExportReport(data:PlanningWorkspace){
 const rows:ExportRow[]=data.sessions.map(session=>({data:session.sessionDate.split('-').reverse().join('/'),ordem:session.ordinal,sessao:clean(session.label)||`Sessão ${session.ordinal}`,inicio:session.startsAt??'A confirmar',fim:session.endsAt??'A confirmar',situacao:states[session.status],observacao:clean(session.note)||'—'}));
 const info:[string,string][]=[['Projeto responsável',clean(data.campaign.primaryProjectName)],['Dinâmica',clean(data.campaign.name)],['Posição consultada',`${new Date(data.asOf).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} (Brasília) · versão ${data.version}`],['Leitura','Sessões provisórias precisam de confirmação. Horários locais de Brasília. O planejamento não comprova entregas e não altera estoque.']];
 const presentation:ReportPdfPresentation={layout:'table',projectName:clean(data.campaign.primaryProjectName),...(data.primaryProjectId==='role-da-extensao'&&data.campaign.primaryProjectName.normalize('NFC').trim().toLocaleLowerCase('pt-BR')==='rolê da extensão'?{projectBrand:'role-da-extensao' as const}:{}),columnWeights:[1.7,2.8,1.5,3.5],columnGroups:[{label:'Data e ordem',keys:['data','ordem']},{label:'Sessão e horário',keys:['sessao','inicio','fim']},{label:'Situação',keys:['situacao']},{label:'Observação',keys:['observacao']}],metrics:[{label:'Sessões',value:data.sessions.length},{label:'Provisórias',value:data.sessions.filter(session=>session.status==='tentative').length},{label:'Confirmadas',value:data.sessions.filter(session=>session.status==='confirmed').length},{label:'Realizadas',value:data.sessions.filter(session=>session.status==='done').length}]};
 return{title:'Programação da dinâmica',columns,rows,info,presentation};
}
/** Covers all authorized content/permissions, including fields deliberately omitted from exports. */
export function planningFingerprint(data:PlanningWorkspace){const {asOf:ignored,...snapshot}=data;void ignored;return JSON.stringify(snapshot);}
