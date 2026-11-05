import {kindLabels,relationLabels,type StructureWorkspace} from '@/lib/institutional-structure/contracts';
import type {ExportColumn,ExportRow} from './report-export';
import type {ReportPdfPresentation} from './report-pdf';
import {isStructureWorkspace} from './institutional-structure-api';

const clean=(value:string)=>value.replace(/[\p{Cc}\p{Bidi_Control}]/gu,' ').replace(/\s+/gu,' ').trim();
export const structureExportColumns:ExportColumn[]=[{key:'unidade',label:'Unidade formal'},{key:'tipo',label:'Tipo'},{key:'relacao',label:'Relação'},{key:'superior',label:'Unidade superior'},{key:'equipes',label:'Equipes visíveis'},{key:'situacao',label:'Situação'}];
/** New literal rows only. IDs, source URLs and arbitrary DTO properties never reach a serializer. */
export function structureExportReport(data:StructureWorkspace,includeArchived=false){
 if(!isStructureWorkspace(data))throw new Error('A estrutura está incompleta. Atualize antes de exportar.');
 const nodes=new Map(data.nodes.map(node=>[node.id,node])),teams=new Map(data.teams.map(team=>[team.id,team]));
 const rows:ExportRow[]=data.nodes.map(node=>({unidade:clean(node.acronym?`${node.name} (${node.acronym})`:node.name),tipo:kindLabels[node.kind],relacao:relationLabels[node.relation],superior:node.parentId?clean(nodes.get(node.parentId)!.name):'Sem unidade superior',equipes:data.links.filter(link=>link.nodeId===node.id).map(link=>clean(teams.get(link.teamId)!.name)).join('; ')||'Nenhuma neste recorte',situacao:node.status==='active'?'Ativa':'Arquivada'}));
 const date=(value:string|null)=>value?value.split('-').reverse().join('/'):'Não informada';
 const info:[string,string][]=[['Organização',clean(data.scope.organizationName)],['Recorte',clean(data.scope.projectName)],['Consulta',includeArchived?'Inclui unidades arquivadas autorizadas':'Unidades ativas'],['Versão do cadastro',String(data.version)],['Fonte',data.source?clean(data.source.label):'Não informada'],['Natureza da fonte',data.source?(data.source.adapted?'Cadastro adaptado localmente':'Referência oficial aplicada sem alterações'):'Sem referência registrada'],['Revisão e data',data.source?`${clean(data.source.revision)||'Sem revisão'} · ${date(data.source.issuedOn)}`:'Não informadas'],['Conferência','A fonte é uma referência; esta representação não certifica a estrutura atual e não concede permissões.'],['Equipes','Somente vínculos visíveis no contexto. Não inclui integrantes, contatos, identificadores, links ou observações.'],['Consulta dos dados',new Date(data.asOf).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília)']];
 const presentation:ReportPdfPresentation={columnWeights:[2,1.58,1.76,1.82,1.76,1.3],metrics:[{label:'Unidades no recorte',value:data.nodes.length},{label:'Relações de governança',value:data.nodes.filter(node=>node.relation==='governance').length},{label:'Equipes vinculadas visíveis',value:new Set(data.links.map(link=>link.teamId)).size}]};
 return{title:'Estrutura institucional e equipes',columns:structureExportColumns,rows,info,presentation};
}
/** Source/version, authorized links and even removed nodes fence a rendered artifact. */
export function structureFingerprint(data:StructureWorkspace){const {asOf:ignored,...snapshot}=data;void ignored;return JSON.stringify(snapshot);}
