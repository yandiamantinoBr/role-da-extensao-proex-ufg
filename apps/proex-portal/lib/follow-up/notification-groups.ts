export type NoticeForGroup={task_id:string;title:string;status:string;priority:string;due_at:string|null;read_at:string|null;created_at:string};
export type NotificationGroup={task_id:string;title:string;status:string;priority:string;due_at:string|null;updates:number;unread:number;last_created_at:string|null};
/** Counts describe only the supplied recent window, never an all-time task total. */
export function groupNotifications(notifications:readonly NoticeForGroup[]):NotificationGroup[]{
 const groups=new Map<string,NotificationGroup>();
 for(const notice of notifications){const stamp=typeof notice.created_at==='string'&&Number.isFinite(Date.parse(notice.created_at))?notice.created_at:null,group=groups.get(notice.task_id);if(!group){groups.set(notice.task_id,{task_id:notice.task_id,title:notice.title,status:notice.status,priority:notice.priority,due_at:notice.due_at,updates:1,unread:notice.read_at===null?1:0,last_created_at:stamp});continue;}group.updates++;if(notice.read_at===null)group.unread++;if(stamp&&(!group.last_created_at||Date.parse(stamp)>Date.parse(group.last_created_at))){group.last_created_at=stamp;group.title=notice.title;group.status=notice.status;group.priority=notice.priority;group.due_at=notice.due_at;}}
 return[...groups.values()].sort((a,b)=>(b.last_created_at?Date.parse(b.last_created_at):0)-(a.last_created_at?Date.parse(a.last_created_at):0)||a.task_id.localeCompare(b.task_id));
}
