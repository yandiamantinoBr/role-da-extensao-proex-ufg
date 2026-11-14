'use client';
export const FOLLOWUP_CHANGED='proex:followup-changed';
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const entries=(value:Record<string,unknown>,name:string,valid:(entry:unknown)=>boolean=object)=>Array.isArray(value[name])&&value[name].every(valid);
const nullableText=(value:unknown)=>value===null||typeof value==='string';
const serverClock=(value:Record<string,unknown>)=>(value.today===undefined||typeof value.today==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.today)&&Number.isFinite(Date.parse(value.today))&&new Date(value.today).toISOString().slice(0,10)===value.today)&&(value.asOf===undefined||typeof value.asOf==='string'&&Number.isFinite(Date.parse(value.asOf)));
const person=(value:unknown)=>object(value)&&typeof value.userId==='string'&&typeof value.name==='string';
const named=(value:unknown)=>object(value)&&typeof value.id==='string'&&typeof value.name==='string';
const groupShape=(value:unknown)=>object(value)&&typeof value.task_id==='string'&&typeof value.title==='string'&&typeof value.status==='string'&&typeof value.priority==='string'&&nullableText(value.due_at)&&typeof value.updates==='number'&&Number.isSafeInteger(value.updates)&&value.updates>0&&value.updates<=100&&typeof value.unread==='number'&&Number.isSafeInteger(value.unread)&&value.unread>=0&&value.unread<=value.updates&&(value.last_created_at===null||typeof value.last_created_at==='string'&&Number.isFinite(Date.parse(value.last_created_at)));
const pendingShape=(value:unknown)=>object(value)&&typeof value.id==='string'&&typeof value.title==='string'&&nullableText(value.due_at)
 &&(value.status===undefined||typeof value.status==='string'&&['open','in_progress','blocked'].includes(value.status))
 &&(value.priority===undefined||typeof value.priority==='string'&&['high','medium','low'].includes(value.priority))
 &&(value.version===undefined||typeof value.version==='number'&&Number.isSafeInteger(value.version)&&value.version>0);
function taskShape(value:unknown){return object(value)&&typeof value.id==='string'&&typeof value.title==='string'&&typeof value.body==='string'&&typeof value.project_name==='string'&&typeof value.organization_name==='string'&&typeof value.version==='number'&&typeof value.status==='string'&&['open','in_progress','blocked','completed','cancelled'].includes(value.status)&&typeof value.priority==='string'&&['high','medium','low'].includes(value.priority)&&(value.importance==null||typeof value.importance==='string'&&['high','medium','low'].includes(value.importance))&&nullableText(value.due_at)&&entries(value,'assignees');}
function validResponse(value:unknown,query:URLSearchParams|string,body?:Record<string,unknown>){
 if(!object(value))return false;
 const action=typeof body?.action==='string'?body.action:'',view=body?(['notification.read','notification.dismiss','pending.visibility'].includes(action)?'inbox':action.startsWith('team.')?'team':'detail'):new URLSearchParams(String(query)).get('view')??'tasks';
 if(view==='team')return typeof value.teamId==='string';
 if(action==='pending.visibility'&&value.pendingVisibility!=='confirmed'&&value.pendingVisibility!=='outdated')return false;
 if(view==='inbox')return entries(value,'notifications',entry=>object(entry)&&typeof entry.id==='string'&&typeof entry.task_id==='string'&&typeof entry.title==='string'&&nullableText(entry.due_at)&&nullableText(entry.read_at))&&entries(value,'pending',pendingShape)&&(value.clearThrough===undefined||nullableText(value.clearThrough))&&(value.hiddenPending===undefined||entries(value,'hiddenPending',pendingShape))&&(value.hiddenPendingHasMore===undefined||typeof value.hiddenPendingHasMore==='boolean')&&(value.hiddenPendingAfter===undefined||nullableText(value.hiddenPendingAfter))&&(value.hiddenPendingCursor===undefined||nullableText(value.hiddenPendingCursor))&&typeof value.unread==='number'&&Number.isSafeInteger(value.unread)&&value.unread>=0&&typeof value.hasMore==='boolean'&&(value.groups===undefined||entries(value,'groups',groupShape))&&(value.windowLimit===undefined||value.windowLimit===100)&&(value.viewerId===undefined||typeof value.viewerId==='string')&&(value.today===undefined||typeof value.today==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.today));
 if(view==='catalog')return entries(value,'organizations',named)&&entries(value,'projects',named)&&entries(value,'people',person)&&entries(value,'teamPeople',person)&&entries(value,'teams',entry=>named(entry)&&object(entry)&&entries(entry,'members',person))&&entries(value,'items',named)&&entries(value,'campaigns',named)&&entries(value,'loans',entry=>object(entry)&&typeof entry.id==='string'&&typeof entry.action_name==='string')&&typeof value.canEdit==='boolean'&&typeof value.canManageTeams==='boolean';
 if(view==='tasks')return Array.isArray(value.tasks)&&value.tasks.every(taskShape)&&typeof value.hasMore==='boolean'&&serverClock(value);
 if(view==='detail')return taskShape(value.task)&&entries(value,'history',entry=>object(entry)&&object(entry.snapshot))&&entries(value,'workCandidates',person)&&entries(value,'workGrants')&&(value.checklist===null||object(value.checklist)&&(value.checklist.kind===undefined||['materials','activity'].includes(String(value.checklist.kind)))&&entries(value.checklist,'rows',entry=>object(entry)&&typeof entry.id==='string'&&typeof entry.note==='string'&&(value.checklist&&object(value.checklist)&&value.checklist.kind==='activity'?typeof entry.label==='string'&&typeof entry.position==='number'&&typeof entry.version==='number'&&Number.isSafeInteger(entry.version)&&entry.version>0&&(entry.answer===null||['yes','no','not_applicable'].includes(String(entry.answer))):typeof entry.material==='string'&&typeof entry.size==='string'&&typeof entry.expected==='number'&&(entry.counted===null||typeof entry.counted==='number')&&typeof entry.damaged==='number'))&&entries(value.checklist,'followups'));
 return false;
}
export async function followupApi<T>(query:URLSearchParams|string,body?:Record<string,unknown>,signal?:AbortSignal):Promise<T>{
 const endpoint=body?.action==='task.triage.apply'?'/api/follow-up/triage':'/api/follow-up';
 const params = new URLSearchParams(String(query));
 const isSearch = !body && params.get('view') === 'tasks' && params.has('search');
 const payload = isSearch ? { ...Object.fromEntries(params), action: 'tasks.search' } : body;
 const response=await fetch(`${endpoint}${!isSearch && String(query)?`?${query}`:''}`,{method:payload?'POST':'GET',credentials:'same-origin',cache:'no-store',signal,...(payload?{headers:{'Content-Type':'application/json','X-Proex-Action':'1'},body:JSON.stringify(payload)}:{})});
 let data:unknown;
 try{data=await response.json();}catch(error){if(signal?.aborted)throw signal.reason??error;if(object(error)&&error.name==='AbortError')throw error;if(response.ok)throw new Error('A resposta chegou incompleta. Seus campos foram preservados; atualize e tente novamente.');data={};}
 if(signal?.aborted){const error=new Error('Consulta cancelada.');error.name='AbortError';throw error;}
 if(!response.ok){const message=object(data)?data.error:null;throw new Error(typeof message==='string'?message:object(message)&&typeof message.message==='string'?message.message:'Não foi possível concluir. Preserve suas informações e tente novamente.');}
 if(!validResponse(data,query,body))throw new Error('A resposta não corresponde à consulta. Seus campos foram preservados; atualize e tente novamente.');
 return data as T;
}
export function followupChanged(){window.dispatchEvent(new Event(FOLLOWUP_CHANGED));}
export const todayInBrazil=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const dueLabel=(date:string|null)=>date?date.split('-').reverse().join('/'):'Sem prazo';
