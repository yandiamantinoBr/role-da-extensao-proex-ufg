import type {PortalActor} from '../access';
import type {Row} from '../database';
import {HttpError} from '../errors';
import {activeAccount,actorRequired,authority} from '../follow-up/scope';
import {id,onlyKeys} from '../follow-up/contracts';
import {serverWorkClock} from '../follow-up/time';
import {countSelect,myWorkPredicates} from './queries';
import type {MyWorkSummary} from './summary-contract';

type Context={organizationId:string|null;projectId:string|null};
type Snapshot={tasks:Row;responsibilities:number;permission:{allowed:number;provenance:string}};
const changed=()=>new HttpError(403,'Seu acesso ou vínculo mudou. Atualize a página para consultar suas atribuições.','my_work_summary_forbidden');

/** Internal evidence only. These IDs never enter the returned summary or global portal DTO. */
function permissionStatement(db:D1Database,actor:PortalActor,scope:Context){
 const projectAuthority=authority('context.user_id','p.organization_id','p.id');
 const organizationAuthority=`(${authority('context.user_id','o.id','NULL')} OR EXISTS(SELECT 1 FROM projects p WHERE p.organization_id=o.id AND ${projectAuthority}))`;
 const organizationFilter=`(context.organization_id IS NULL OR o.id=context.organization_id) AND (context.project_id IS NULL OR EXISTS(SELECT 1 FROM projects selected WHERE selected.id=context.project_id AND selected.organization_id=o.id))`;
 const projectFilter=`(context.organization_id IS NULL OR p.organization_id=context.organization_id) AND (context.project_id IS NULL OR p.id=context.project_id)`;
 return db.prepare(`WITH context(user_id,organization_id,project_id) AS(VALUES(?,?,?))
 SELECT CASE WHEN EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=context.user_id AND ${activeAccount('u')})
 AND (context.project_id IS NOT NULL AND EXISTS(SELECT 1 FROM projects p JOIN organizations o ON o.id=p.organization_id WHERE o.status='active' AND ${projectFilter} AND ${projectAuthority})
 OR context.project_id IS NULL AND EXISTS(SELECT 1 FROM organizations o WHERE o.status='active' AND ${organizationFilter} AND ${organizationAuthority})) THEN 1 ELSE 0 END allowed,
 json_object(
 'grants',json((SELECT COALESCE(json_group_array(json(entry)),'[]') FROM(SELECT json_object('id',m.id,'role',m.role,'project',m.project_id,'organization',m.organization_id) entry FROM members m WHERE m.user_id=context.user_id AND m.revoked_at IS NULL ORDER BY m.id COLLATE BINARY))),
 'organizations',json((SELECT COALESCE(json_group_array(json(entry)),'[]') FROM(SELECT json_object('id',o.id,'status',o.status) entry FROM organizations o WHERE ${organizationFilter} AND ${organizationAuthority} ORDER BY o.id COLLATE BINARY))),
 'projects',json((SELECT COALESCE(json_group_array(json(entry)),'[]') FROM(SELECT json_object('id',p.id,'organization',p.organization_id,'status',p.status) entry FROM projects p WHERE ${projectFilter} AND ${projectAuthority} ORDER BY p.id COLLATE BINARY))),
 'affiliations',json((SELECT COALESCE(json_group_array(json(entry)),'[]') FROM(SELECT json_object('id',tm.id,'team',t.id,'organization',t.organization_id,'status',t.status) entry FROM followup_team_members tm JOIN followup_teams t ON t.id=tm.team_id WHERE tm.user_id=context.user_id AND tm.removed_at IS NULL AND(context.organization_id IS NULL OR t.organization_id=context.organization_id) AND(context.project_id IS NULL OR EXISTS(SELECT 1 FROM projects selected WHERE selected.id=context.project_id AND selected.organization_id=t.organization_id)) ORDER BY tm.id COLLATE BINARY)))
 ) provenance FROM context`).bind(actor.userId,scope.organizationId,scope.projectId);
}
async function snapshot(db:D1Database,actor:PortalActor,scope:Context,today:string):Promise<Snapshot>{
 const {taskWhere,responsibilityWhere,taskValues,responsibilityValues}=myWorkPredicates(scope.organizationId,scope.projectId,'all');
 const result=await db.batch([
  db.prepare(`SELECT ${countSelect(today)} FROM followup_tasks t JOIN(SELECT ? user_id) caller WHERE ${taskWhere}`).bind(actor.userId,...taskValues),
  db.prepare(`SELECT COUNT(DISTINCT s.id) total FROM work_responsibility_scopes s JOIN(SELECT ? user_id) caller WHERE ${responsibilityWhere}`).bind(actor.userId,...responsibilityValues),
  permissionStatement(db,actor,scope),
 ]);
 const permission=result[2].results?.[0] as Snapshot['permission']|undefined;
 if(!permission?.allowed)throw changed();
 return{tasks:result[0].results?.[0] as Row,responsibilities:Number((result[1].results?.[0] as Row|undefined)?.total??0),permission};
}
function actorGrants(actor:PortalActor){return actor.members.filter(member=>!member.revoked_at).map(member=>({id:member.id,role:member.role,project:member.project_id,organization:member.organization_id??null})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);}

/** Two small strong snapshots; the final await includes live authority and exact counts.
 * Never load titles, bodies, names, contacts, assignees or task pages here. */
export async function myWorkSummary(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>={}):Promise<MyWorkSummary>{
 actorRequired(actor);onlyKeys(input,['organizationId','projectId']);
 const scope={organizationId:id(input.organizationId,true),projectId:id(input.projectId,true)},clock=serverWorkClock();
 const initial=await snapshot(db,actor,scope,clock.today);
 if(JSON.stringify(JSON.parse(initial.permission.provenance).grants)!==JSON.stringify(actorGrants(actor)))throw changed();
 const prepared:MyWorkSummary={version:1,viewerId:actor.userId,...clock,timeZone:'America/Sao_Paulo',scope,
  tasks:{total:Number(initial.tasks.total),pending:Number(initial.tasks.pending),attention:Number(initial.tasks.attention),dueToday:Number(initial.tasks.dueToday),inProgress:Number(initial.tasks.inProgress),completed:Number(initial.tasks.completed)},responsibilities:{active:initial.responsibilities}};
 // Last asynchronous operation. Permission loss cannot become an all-clear zero;
 // neither data changes nor a late revocation can return the earlier aggregate.
 const final=await snapshot(db,actor,scope,clock.today);
 if(initial.permission.provenance!==final.permission.provenance)throw changed();
 if(JSON.stringify(initial.tasks)!==JSON.stringify(final.tasks)||initial.responsibilities!==final.responsibilities)throw new HttpError(409,'Suas atribuições mudaram durante a consulta. Atualize para conferir os totais.','my_work_summary_changed');
 return prepared;
}
