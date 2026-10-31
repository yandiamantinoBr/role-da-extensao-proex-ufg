import { HttpError } from '../errors';
export const TASK_STATES = ['open','in_progress','blocked','completed','cancelled'] as const;
export const TASK_PRIORITIES = ['high','medium','low'] as const;
export const stateLabels = { open:'Aberta',in_progress:'Em andamento',blocked:'Bloqueada',completed:'Concluída',cancelled:'Cancelada' };
export const priorityLabels = { high:'Alta',medium:'Média',low:'Baixa' };
export type TaskStatus = typeof TASK_STATES[number];
export type TaskPriority = typeof TASK_PRIORITIES[number];
export type Task = { id:string;organization_id:string;project_id:string|null;title:string;body:string;priority:TaskPriority;status:TaskStatus;due_at:string|null;version:number;created_at:string;updated_at:string;canEdit:boolean;canWork:boolean;canDelegateWork:boolean;project_name:string;organization_name:string;campaign_id:string|null;item_id:string|null;loan_id:string|null;assignees:{user_id:string|null;team_id:string|null;name:string}[];checklist_id?:string|null };
export type ChecklistRow = {id:string;item_id:string;material:string;size:string;expected:number;counted:number|null;damaged:number;note:string};
export type Checklist = {id:string;task_id:string;title:string;status:'open'|'completed';version:number;rows:ChecklistRow[];followups:{row_id:string;task_id:string}[]};
export type Team = {id:string;name:string;status:'active'|'archived';version:number;members:{userId:string;name:string}[]};
export type Catalog = {organizations:{id:string;name:string;canManage:boolean}[];projects:{id:string;name:string;organization_id:string;canEdit:boolean}[];people:{userId:string;name:string}[];teamPeople:{userId:string;name:string}[];teams:Team[];items:{id:string;name:string;unit:string;stock:number}[];campaigns:{id:string;name:string;status:string;version:number}[];loans:{id:string;action_name:string}[];canEdit:boolean;canManageTeams:boolean};
export function fail(message:string,code='followup_invalid',status=400):never {throw new HttpError(status,message,code);}
export function id(value:unknown,optional=false):string|null {if(optional&&(value===null||value===undefined||value===''))return null;if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value))return fail('Selecione um identificador válido.');return value;}
export function text(value:unknown,max:number,optional=false):string {if(optional&&(value===undefined||value===null))return '';if(typeof value!=='string')return fail('Preencha os campos de texto.');const s=value.normalize('NFC').trim();if((!optional&&!s)||s.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s))return fail(`Use ${optional?'até':'entre 1 e'} ${max} caracteres.`);return s;}
export function integer(value:unknown,max=1000000):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)return fail('Informe uma contagem inteira válida.');return value;}
export function version(value:unknown):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)return fail('Reabra o registro antes de salvar.','followup_version');return value;}
export function date(value:unknown):string|null {if(value===undefined||value===null||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)return fail('Informe o prazo como uma data válida.');return value;}
export function choices<T extends string>(value:unknown,allowed:readonly T[]):T {if(typeof value!=='string'||!allowed.includes(value as T))return fail('Escolha uma opção válida.');return value as T;}
export function ids(value:unknown,max=20):string[] {if(value===undefined)return [];if(!Array.isArray(value)||value.length>max)return fail(`Selecione até ${max} responsáveis.`);return [...new Set(value.map(v=>id(v)!))].sort();}
export function onlyKeys(input:Record<string,unknown>,keys:string[]) {if(Object.keys(input).some(k=>!keys.includes(k)))fail('Há campos não permitidos nesta operação.');}
export function manualShareUrl(title:string,taskId:string,baseUrl:string):string {const base=new URL(baseUrl);if(!['https:','http:'].includes(base.protocol)||base.username||base.password)throw new Error('Endereço inválido.');base.searchParams.set('demandId',taskId);return `https://wa.me/?text=${encodeURIComponent(`${title.slice(0,160)}\n${base.href}`)}`;}
