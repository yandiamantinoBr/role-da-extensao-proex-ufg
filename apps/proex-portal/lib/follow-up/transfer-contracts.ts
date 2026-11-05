import { id, text, version, onlyKeys, fail } from './contracts';
/**
 * Contract of the preserving follow-up task transfer (migration 0031).
 *
 * GET  /api/follow-up/transfer?taskId=ID  -> TransferPreview (read only, no writes, no rate-limit row)
 * POST /api/follow-up/transfer            -> TransferReceipt
 *      body {taskId,targetProjectId,expectedVersion,reason,operationKey,confirmed:true}
 *
 * Only SIMPLE tasks move: project-scoped, no campaign/item/loan, no checklist of any kind
 * and not the follow-up of a checklist row. The task keeps its id and every field;
 * project_id, version (+1) and updated_at change atomically with an immutable receipt.
 * Errors: 400 invalid, 401 anonymous, 403 forbidden (also lost access/replay after
 * revocation), 404 not visible, 409 conflict/noop/linked/operation_changed, 429 rate limit.
 */
export const TRANSFER_BLOCKERS = ['organization_scope','checklist','linked_resource','inactive_source','no_candidates'] as const;
export type TransferBlocker = typeof TRANSFER_BLOCKERS[number];
export type TransferCandidate = { projectId:string; name:string; assigneesWithoutAccess:number };
export type TransferPreview = {
 viewerId:string; taskId:string; version:number;
 source:{ projectId:string; name:string };
 eligible:boolean; reason:TransferBlocker|null;
 assignments:{ people:number; teams:number };
 candidates:TransferCandidate[];
};
export type TransferReceipt = { viewerId:string; taskId:string; projectId:string; version:number; duplicate:boolean };
export type TransferInput = { taskId:string; targetProjectId:string; expectedVersion:number; reason:string; operationKey:string; confirmed:true };
export const TRANSFER_REASON_MAX = 500;
export const TRANSFER_KEYS = ['taskId','targetProjectId','expectedVersion','reason','operationKey','confirmed'];
export function transferInput(input:Record<string,unknown>):TransferInput {
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Envie os dados da transferência.');
 onlyKeys(input,TRANSFER_KEYS);
 const key=input.operationKey;
 if(typeof key!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(key))fail('Atualize a página e envie a operação novamente.','invalid_operation_key');
 if(input.confirmed!==true)fail('Confirme explicitamente que o histórico ficará visível no projeto de destino.','followup_transfer_confirmation');
 return { taskId:id(input.taskId)!, targetProjectId:id(input.targetProjectId)!, expectedVersion:version(input.expectedVersion), reason:text(input.reason,TRANSFER_REASON_MAX), operationKey:key as string, confirmed:true };
}
export function transferTaskId(value:unknown):string {return id(value)!;}
export const blockerLabels:Record<TransferBlocker,string> = {
 organization_scope:'Demandas da organização (sem projeto) não podem ser movidas.',
 checklist:'Demandas com conferência ou derivadas de conferência não podem ser movidas.',
 linked_resource:'Demandas vinculadas a ação, material ou empréstimo não podem ser movidas.',
 inactive_source:'O projeto ou a organização de origem não está ativo.',
 no_candidates:'Não há outro projeto ativo desta organização que você gerencie.',
};
