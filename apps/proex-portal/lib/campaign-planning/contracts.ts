/**
 * Campaign planning API contract. Client-safe: no server imports, no I/O.
 *
 * Timezone contract: `sessionDate` is a civil date (YYYY-MM-DD) and `startsAt`/`endsAt` are
 * local wall-clock times (HH:MM, 24h) on that date, in the event's local time
 * (America/Sao_Paulo). They are never converted to UTC and carry no offset; a session never
 * crosses midnight. `asOf`/`linkedAt` are UTC ISO-8601 instants produced by the server.
 * Sessions are planning data only: three daily sessions are a tentative arrangement, not an
 * official schedule. Quantities, stock and participants are deliberately absent.
 */
export const SESSION_STATUSES=['tentative','confirmed','cancelled','done'] as const;
export type SessionStatus=typeof SESSION_STATUSES[number];
export const PLANNING_LIMITS={label:100,note:500,ordinalMin:1,ordinalMax:10,sessions:200,hosts:20} as const;
export const PLANNING_ACTIONS=['host.link','session.save','session.status'] as const;
export type PlanningAction=typeof PLANNING_ACTIONS[number];

export type PlanningSession={id:string;sessionDate:string;ordinal:number;label:string;startsAt:string|null;endsAt:string|null;status:SessionStatus;note:string;version:number};
/** Only host projects the viewer can currently read. Hidden hosts are never counted or named. */
export type PlanningHost={projectId:string;projectName:string;projectStatus:'active'|'archived';linkedAt:string;canManage:boolean};
export type PlanningWorkspace={
 viewerId:string;campaignId:string;primaryProjectId:string;
 campaign:{name:string;status:'draft'|'active'|'paused'|'closed';primaryProjectName:string};
 /** campaigns.manage on the primary project (owner/manager, live SQL). */
 canManage:boolean;
 /** Opaque header CAS revision for the whole authorized action, not a host count. It can change without a visible host diff; it prevents overwriting concurrent host/session changes. 0 means no planning has been written. Send as expectedVersion. */
 version:number;
 sessions:PlanningSession[];hosts:PlanningHost[];asOf:string;
};
type Base={campaignId:string;projectId:string;expectedVersion:number;operationKey:string};
export type HostLinkInput=Base&{action:'host.link';hostProjectId:string;linked:boolean};
export type SessionSaveInput=Base&{action:'session.save';id?:string;expectedSessionVersion?:number;sessionDate:string;ordinal:number;label?:string;startsAt?:string|null;endsAt?:string|null;status?:SessionStatus;note?:string};
export type SessionStatusInput=Base&{action:'session.status';id:string;expectedSessionVersion:number;status:SessionStatus};
export type PlanningActionInput=HostLinkInput|SessionSaveInput|SessionStatusInput;
export type PlanningActionResult={viewerId:string;campaignId:string;entityId:string;version:number;duplicate:boolean;sessionVersion?:number};

export function isCivilDate(value:unknown):value is string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'2000-01-01'||value>'2100-12-31')return false;
 const [y,m,d]=value.split('-').map(Number),parsed=new Date(Date.UTC(y,m-1,d));
 return parsed.getUTCFullYear()===y&&parsed.getUTCMonth()===m-1&&parsed.getUTCDate()===d;
}
export function isLocalTime(value:unknown):value is string{return typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);}
/** Returns a user-facing message, or null when the time/status combination is valid. */
export function sessionTimeProblem(status:SessionStatus,startsAt:string|null,endsAt:string|null):string|null{
 if(startsAt!==null&&!isLocalTime(startsAt)||endsAt!==null&&!isLocalTime(endsAt))return 'Use horários no formato HH:MM.';
 if((startsAt===null)!==(endsAt===null))return 'Informe início e fim juntos, ou deixe ambos em branco enquanto a sessão for provisória.';
 if(startsAt!==null&&endsAt!==null&&startsAt>=endsAt)return 'O fim deve ser posterior ao início, no mesmo dia.';
 if((status==='confirmed'||status==='done')&&startsAt===null)return 'Confirme início e fim antes de marcar a sessão como confirmada ou realizada.';
 return null;
}
