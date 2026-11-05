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
 const ordered:{node:StructureWorkspace['nodes'][number];path:string}[]=[];
 const visit=(parentId:string|null,prefix='')=>{data.nodes.filter(entry=>entry.parentId===parentId).sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name,'pt-BR')).forEach((node,index)=>{const path=prefix?`${prefix}.${index+1}`:String(index+1);ordered.push({node,path});visit(node.id,path);});};visit(null);
 const rows:ExportRow[]=ordered.map(({node,path})=>({unidade:`${path} ${clean(node.acronym?`${node.name} (${node.acronym})`:node.name)}`,tipo:kindLabels[node.kind],relacao:relationLabels[node.relation],superior:node.parentId?clean(nodes.get(node.parentId)!.name):'—',equipes:data.links.filter(link=>link.nodeId===node.id).map(link=>clean(teams.get(link.teamId)!.name)).join('; ')||'—',situacao:node.status==='active'?'Ativa':'Arquivada'}));
 const date=(value:string|null)=>value?value.split('-').reverse().join('/'):'Não informada';
 const consulted=new Date(data.asOf).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília)';
 const source=data.source?`${clean(data.source.label)} · ${clean(data.source.revision)||'Sem revisão'} · ${date(data.source.issuedOn)} · ${data.source.adapted?'Cadastro adaptado localmente':'Referência oficial aplicada sem alterações'}`:'Não informada';
 const info:[string,string][]=[['Organização',clean(data.scope.organizationName)],['Recorte',`${clean(data.scope.projectName)} · ${includeArchived?'Inclui unidades arquivadas autorizadas':'Unidades ativas'}`],['Fonte',source],['Versão do cadastro',`${data.version} · Consulta em ${consulted}`],['Leitura','A numeração indica a hierarquia; — indica ausência no recorte. Apenas equipes visíveis; sem integrantes, contatos, identificadores, links ou observações. A referência não certifica a estrutura atual e não concede permissões.']];
 const presentation:ReportPdfPresentation={columnWeights:[3.9,2.7,1.9,1.3],columnGroups:[{label:'Unidade formal',keys:['unidade','tipo']},{label:'Vínculo institucional',keys:['superior','relacao']},{label:'Equipes visíveis',keys:['equipes']},{label:'Situação',keys:['situacao']}],metrics:[{label:'Unidades no recorte',value:data.nodes.length},{label:'Relações de governança',value:data.nodes.filter(node=>node.relation==='governance').length},{label:'Equipes vinculadas visíveis',value:new Set(data.links.map(link=>link.teamId)).size}]};
 return{title:'Estrutura institucional e equipes',columns:structureExportColumns,rows,info,presentation};
}
/** Source/version, authorized links and even removed nodes fence a rendered artifact. */
export function structureFingerprint(data:StructureWorkspace){const {asOf:ignored,...snapshot}=data;void ignored;return JSON.stringify(snapshot);}
