export type MyWorkSummary={
 version:1;viewerId:string;asOf:string;today:string;timeZone:'America/Sao_Paulo';
 scope:{organizationId:string|null;projectId:string|null};
 tasks:{total:number;pending:number;attention:number;dueToday:number;inProgress:number;completed:number};
 responsibilities:{active:number};
};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const identifier=(value:unknown)=>value===null||typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
export function isMyWorkSummary(value:unknown):value is MyWorkSummary{
 if(!object(value)||!exact(value,['version','viewerId','asOf','today','timeZone','scope','tasks','responsibilities'])||value.version!==1||typeof value.viewerId!=='string'||!identifier(value.viewerId)||typeof value.asOf!=='string'||!Number.isFinite(Date.parse(value.asOf))||typeof value.today!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.today)||!Number.isFinite(Date.parse(value.today+'T00:00:00Z'))||new Date(value.today+'T00:00:00Z').toISOString().slice(0,10)!==value.today||value.timeZone!=='America/Sao_Paulo')return false;
 if(!object(value.scope)||!exact(value.scope,['organizationId','projectId'])||!identifier(value.scope.organizationId)||!identifier(value.scope.projectId))return false;
 if(!object(value.tasks)||!exact(value.tasks,['total','pending','attention','dueToday','inProgress','completed'])||!Object.values(value.tasks).every(count)||!object(value.responsibilities)||!exact(value.responsibilities,['active'])||!count(value.responsibilities.active))return false;
 const task=value.tasks as MyWorkSummary['tasks'];
 return task.pending<=task.total&&task.completed<=task.total&&task.attention<=task.pending&&task.dueToday<=task.pending&&task.inProgress<=task.pending;
}
