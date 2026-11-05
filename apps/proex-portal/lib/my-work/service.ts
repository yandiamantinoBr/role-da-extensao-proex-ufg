import { type PortalActor } from '../access';
import { type Row } from '../database';
import { actorRequired } from '../follow-up/scope';
import { id, choices, integer, fail } from '../follow-up/contracts';
import { taskProjectionSql, projectedTask } from '../follow-up/service';
import { serverWorkClock } from '../follow-up/time';
import { responsibilityProjection, projectResponsibility, workTarget } from '../responsibilities/service';
import { taskDirect, taskTeam, targetAccess, assignmentVia } from '../responsibilities/scope';
import { MY_WORK_STATUSES, type TaskCounts, type OperationalArea, type MyWorkResponse, type MyWorkTask } from './contracts';
import {areaSql,emptyCounts,countSelect,myWorkPredicates} from './queries';

function statusSql(status:string,today:string){const pending="t.status NOT IN ('completed','cancelled')";return status==='all'?'1=1':status==='pending'?pending:status==='overdue'?`${pending} AND t.due_at<'${today}'`:status==='due_today'?`${pending} AND t.due_at='${today}'`:status==='attention'?`((${pending} AND t.due_at<'${today}') OR t.status='blocked')`:`t.status='${status}'`;}
function taskProjection(actor:PortalActor) {
 const accesses=(['materials','loans','campaigns'] as const).map(area=>({area,...targetAccess(actor,area,'t.project_id')}));
 const allowed=`CASE ${areaSql} ${accesses.map(a=>`WHEN '${a.area}' THEN (${a.sql})`).join(' ')} ELSE t.project_id IS NOT NULL END`,values=accesses.flatMap(a=>a.values);
 const name="COALESCE((SELECT action_name FROM loans WHERE id=t.loan_id AND project_id=t.project_id),(SELECT name FROM items WHERE id=t.item_id AND project_id=t.project_id),(SELECT name FROM campaigns WHERE id=t.campaign_id AND project_id=t.project_id),p.name)";
 const extra=`${areaSql} operational_area,${taskDirect('caller.user_id')} assigned_direct,${taskTeam('caller.user_id')} assigned_team,${allowed} target_can_open,CASE WHEN ${allowed} THEN ${name} ELSE NULL END target_name,`;
 return{sql:taskProjectionSql.replace('SELECT t.*,','SELECT t.*,'+extra),values:[...values,...values,actor.userId]};
}
export async function myWork(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>={}):Promise<MyWorkResponse> {
 actorRequired(actor);const organizationId=id(input.organizationId,true),projectId=id(input.projectId,true),assignment=choices(input.assignment??'all',['all','direct','team']),status=choices(input.status??'pending',MY_WORK_STATUSES);
 const limit=input.limit===undefined?20:integer(input.limit,50),taskOffset=input.taskOffset===undefined?0:integer(input.taskOffset,50000),responsibilityOffset=input.responsibilityOffset===undefined?0:integer(input.responsibilityOffset,50000);if(!limit)fail('Escolha de 1 a 50 registros.');
 const {asOf,today}=serverWorkClock();
 const {taskWhere,responsibilityWhere,taskValues,responsibilityValues}=myWorkPredicates(organizationId,projectId,assignment);
 const tp=taskProjection(actor),rp=responsibilityProjection(actor);
 // Four guarded reads share one strong snapshot; no fanout writes, receipts,
 // notification read markers or per-item requests occur on a personal GET.
 const results=await db.batch([
  db.prepare(`SELECT ${areaSql} area,${countSelect(today)} FROM followup_tasks t JOIN(SELECT ? user_id) caller WHERE ${taskWhere} GROUP BY ${areaSql}`).bind(actor.userId,...taskValues),
  db.prepare(tp.sql+` WHERE ${taskWhere} AND (${statusSql(status,today)}) ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,COALESCE(t.due_at,'9999'),t.updated_at DESC,t.id LIMIT ? OFFSET ?`).bind(...tp.values,...taskValues,limit,taskOffset),
  db.prepare(`SELECT s.area,COUNT(DISTINCT s.id) total FROM work_responsibility_scopes s JOIN(SELECT ? user_id) caller WHERE ${responsibilityWhere} GROUP BY s.area`).bind(actor.userId,...responsibilityValues),
  db.prepare(rp.sql+` WHERE ${responsibilityWhere} ORDER BY s.area,p.name,s.target_key,s.id LIMIT ? OFFSET ?`).bind(...rp.values,...responsibilityValues,limit,responsibilityOffset),
 ]);
 const areas=new Map<OperationalArea,{area:OperationalArea;taskCounts:TaskCounts;responsibilityCount:number}>();for(const area of ['projects','materials','loans','campaigns','general'] as const)areas.set(area,{area,taskCounts:emptyCounts(),responsibilityCount:0});
 const totals=emptyCounts();for(const raw of results[0].results??[]){const row=raw as Row,counts=emptyCounts();for(const key of Object.keys(counts) as (keyof TaskCounts)[]){counts[key]=Number(row[key]??0);totals[key]+=counts[key];}const entry=areas.get(row.area);if(entry)entry.taskCounts=counts;}
 let responsibilityTotal=0;for(const raw of results[2].results??[]){const row=raw as Row,total=Number(row.total);responsibilityTotal+=total;const entry=areas.get(row.area);if(entry)entry.responsibilityCount=total;}
 const selectedTotal=status==='all'?totals.total:status==='due_today'?totals.dueToday:status==='in_progress'?totals.inProgress:status==='open'?totals.pending-totals.inProgress-totals.blocked:totals[status as keyof TaskCounts];
 const tasks=(results[1].results??[]).map(raw=>{const row=raw as Row,task=projectedTask(row),area=row.operational_area as OperationalArea;delete task.operational_area;delete task.assigned_direct;delete task.assigned_team;delete task.target_can_open;delete task.target_name;const query=new URLSearchParams({module:'demands',demandId:row.id});if(row.project_id)query.set('project',row.project_id);return{...task,assignmentVia:assignmentVia(row.assigned_direct,row.assigned_team)!,canWork:Boolean(row.can_edit||row.can_work),area,href:'/?'+query,target:workTarget({...row,area,can_open:row.target_can_open})} as MyWorkTask;});
 const nextTask=taskOffset+limit<selectedTotal?taskOffset+limit:null,nextResponsibility=responsibilityOffset+limit<responsibilityTotal?responsibilityOffset+limit:null;
 return{version:1,viewerId:actor.userId,asOf,today,timeZone:'America/Sao_Paulo',scope:{organizationId,projectId,assignment,status},totalsScope:'organization-project-assignment',totals:{tasks:totals,responsibilities:{total:responsibilityTotal}},areas:[...areas.values()],tasks:{items:tasks,total:selectedTotal,hasMore:nextTask!==null,nextOffset:nextTask},responsibilities:{items:(results[3].results??[]).map(r=>projectResponsibility(r as Row)),total:responsibilityTotal,hasMore:nextResponsibility!==null,nextOffset:nextResponsibility}};
}
