import {authority,assignedRecipient} from '../follow-up/scope';
import {responsibilityRead,responsibilityDirect,responsibilityTeam,taskDirect,taskTeam} from '../responsibilities/scope';
import type {TaskCounts,AssignmentFilter} from './contracts';

export const areaSql=`CASE WHEN t.loan_id IS NOT NULL THEN 'loans' WHEN t.item_id IS NOT NULL THEN 'materials' WHEN t.campaign_id IS NOT NULL THEN 'campaigns' WHEN t.project_id IS NOT NULL THEN 'projects' ELSE 'general' END`;
export const emptyCounts=():TaskCounts=>({total:0,pending:0,attention:0,overdue:0,dueToday:0,inProgress:0,blocked:0,completed:0,cancelled:0});
export function countSelect(today:string) {const pending="t.status NOT IN ('completed','cancelled')",overdue=`(${pending} AND t.due_at<'${today}')`;return `COUNT(DISTINCT t.id) total,
 COUNT(DISTINCT CASE WHEN ${pending} THEN t.id END) pending,
 COUNT(DISTINCT CASE WHEN ${overdue} OR t.status='blocked' THEN t.id END) attention,
 COUNT(DISTINCT CASE WHEN ${overdue} THEN t.id END) overdue,
 COUNT(DISTINCT CASE WHEN ${pending} AND t.due_at='${today}' THEN t.id END) dueToday,
 COUNT(DISTINCT CASE WHEN t.status='in_progress' THEN t.id END) inProgress,
 COUNT(DISTINCT CASE WHEN t.status='blocked' THEN t.id END) blocked,
 COUNT(DISTINCT CASE WHEN t.status='completed' THEN t.id END) completed,
 COUNT(DISTINCT CASE WHEN t.status='cancelled' THEN t.id END) cancelled`;}
function relation(direct:string,team:string,filter:AssignmentFilter){return filter==='direct'?direct:filter==='team'?team:`(${direct} OR ${team})`;}

/** Shared predicates for the full workspace and its counts-only personal summary. */
export function myWorkPredicates(organizationId:string|null,projectId:string|null,assignment:AssignmentFilter){
 const taskConditions=[authority('caller.user_id','t.organization_id','t.project_id'),assignedRecipient('caller.user_id'),"EXISTS(SELECT 1 FROM organizations active_org WHERE active_org.id=t.organization_id AND active_org.status='active')",relation(taskDirect('caller.user_id'),taskTeam('caller.user_id'),assignment)],taskValues:unknown[]=[];
 const responsibilityConditions=[responsibilityRead('caller.user_id'),"s.status='active'","EXISTS(SELECT 1 FROM organizations active_org WHERE active_org.id=s.organization_id AND active_org.status='active')",relation(responsibilityDirect('caller.user_id'),responsibilityTeam('caller.user_id'),assignment)],responsibilityValues:unknown[]=[];
 if(organizationId){taskConditions.push('t.organization_id=?');taskValues.push(organizationId);responsibilityConditions.push('s.organization_id=?');responsibilityValues.push(organizationId);}
 if(projectId){taskConditions.push('t.project_id=?');taskValues.push(projectId);responsibilityConditions.push('s.project_id=?');responsibilityValues.push(projectId);}
 return{taskWhere:taskConditions.join(' AND '),responsibilityWhere:responsibilityConditions.join(' AND '),taskValues,responsibilityValues};
}
