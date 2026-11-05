import {NODE_KINDS,RELATIONS,type StructureWorkspace} from '@/lib/institutional-structure/contracts';

export type StructureQuery={viewerId:string;organizationId:string;projectId:string|null;includeArchived:boolean};
export class StructureApiError extends Error{constructor(message:string,readonly status=0,readonly code='structure_response'){super(message);}}
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const text=(value:unknown,max:number,empty=false):value is string=>typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0);
const integer=(value:unknown,max=Number.MAX_SAFE_INTEGER)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
const status=(value:unknown)=>value==='active'||value==='archived';
function reference(value:unknown){if(value===null)return true;if(typeof value!=='string')return false;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&!/[\r\n\\]/.test(value);}catch{return false;}}
export function isStructureWorkspace(value:unknown):value is StructureWorkspace{
 if(!object(value)||!identifier(value.viewerId)||!object(value.scope)||!identifier(value.scope.organizationId)||!text(value.scope.organizationName,1000)||(value.scope.projectId!==null&&!identifier(value.scope.projectId))||!text(value.scope.projectName,1000)||typeof value.scope.canManage!=='boolean'||typeof value.canApplyTemplate!=='boolean'||value.canApplyTemplate&&!value.scope.canManage||!integer(value.version)||typeof value.asOf!=='string'||!Number.isFinite(Date.parse(value.asOf)))return false;
 if(value.source!==null&&(!object(value.source)||!text(value.source.label,120)||!text(value.source.revision,40,true)||(value.source.issuedOn!==null&&(typeof value.source.issuedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.source.issuedOn)))||!reference(value.source.referenceUrl)||typeof value.source.adapted!=='boolean'))return false;
 if(!Array.isArray(value.nodes)||value.nodes.length>200||value.canApplyTemplate&&value.nodes.length!==0||!Array.isArray(value.teams)||value.teams.length>500||!Array.isArray(value.links)||value.links.length>500)return false;
 const nodes=new Map<string,Record<string,unknown>>(),teams=new Set<string>(),links=new Set<string>();
 for(const node of value.nodes){if(!object(node)||!identifier(node.id)||nodes.has(node.id)||(node.parentId!==null&&!identifier(node.parentId))||!text(node.name,160)||!text(node.acronym,24,true)||!NODE_KINDS.includes(node.kind as typeof NODE_KINDS[number])||!RELATIONS.includes(node.relation as typeof RELATIONS[number])||!integer(node.position,999)||!status(node.status)||(node.parentId===null)!==(node.relation==='root'))return false;nodes.set(node.id,node);}
 for(const node of nodes.values()){const visited=new Set<string>();let current:Record<string,unknown>|undefined=node;while(current){if(visited.has(String(current.id))||visited.size>=8)return false;visited.add(String(current.id));if(current.parentId===null)break;current=nodes.get(String(current.parentId));if(!current)return false;}}
 for(const team of value.teams){if(!object(team)||!identifier(team.id)||teams.has(team.id)||!text(team.name,100)||!status(team.status))return false;teams.add(team.id);}
 for(const link of value.links){if(!object(link)||!identifier(link.nodeId)||!identifier(link.teamId)||!nodes.has(link.nodeId)||!teams.has(link.teamId))return false;const key=JSON.stringify([link.nodeId,link.teamId]);if(links.has(key))return false;links.add(key);}
 return true;
}
export function structureQueryPath(query:StructureQuery){return'/api/institutional-structure?'+new URLSearchParams({organizationId:query.organizationId,...(query.projectId?{projectId:query.projectId}:{}),includeArchived:String(query.includeArchived)});}
async function responseValue(response:Response,signal:AbortSignal){let value:unknown;try{value=await response.json();}catch{throw new StructureApiError('A resposta chegou incompleta. Atualize antes de continuar.',response.status);}if(signal.aborted)throw new DOMException('Consulta cancelada.','AbortError');if(!response.ok)throw new StructureApiError(object(value)&&typeof value.error==='string'?value.error:'Não foi possível consultar a estrutura.',response.status,object(value)&&typeof value.code==='string'?value.code:'structure_response');return value;}
export async function readStructure(query:StructureQuery,signal:AbortSignal):Promise<StructureWorkspace>{
 const value=await responseValue(await fetch(structureQueryPath(query),{credentials:'same-origin',cache:'no-store',redirect:'error',signal}),signal);
 if(!isStructureWorkspace(value)||value.viewerId!==query.viewerId||value.scope.organizationId!==query.organizationId||value.scope.projectId!==query.projectId||query.includeArchived&&!value.scope.canManage||!query.includeArchived&&value.nodes.some(node=>node.status==='archived')||!value.scope.canManage&&value.teams.some(team=>team.status==='archived'))throw new StructureApiError('A resposta não corresponde à sua conta ou ao recorte escolhido.',403,'structure_context');
 return value;
}
export async function saveStructure(input:Record<string,unknown>,query:StructureQuery,signal:AbortSignal){
 const value=await responseValue(await fetch('/api/institutional-structure',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{'Content-Type':'application/json','X-Proex-Action':'1'},body:JSON.stringify(input)}),signal);
 if(!object(value)||value.viewerId!==query.viewerId||value.organizationId!==query.organizationId||!identifier(value.entityId)||typeof value.duplicate!=='boolean'||value.version!==undefined&&!integer(value.version))throw new StructureApiError('A confirmação chegou incompleta. Confira a estrutura antes de tentar novamente.',502);
 return value;
}
