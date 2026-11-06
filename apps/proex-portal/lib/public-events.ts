import { all, one } from './database';
import { projectAuthoritySql, type PortalActor } from './access';

/** Status is the publication gate. A draft never enters this projection. */
const PUBLIC_EVENT_SCOPE="(c.status='active' OR (c.status IN('paused','closed') AND EXISTS(SELECT 1 FROM audit published WHERE published.entity_id=c.id AND published.project_id=c.project_id AND published.action='campaign.active'))) AND p.status='active' AND o.status='active'";
export type PublicEvent={id:string;name:string;location:string;status:'active'|'paused'|'closed';startsAt:string;endsAt:string};
export async function publicEvents(db:D1Database):Promise<PublicEvent[]> {
 return await all(db,`SELECT c.id,c.name,c.location,c.status,c.starts_at startsAt,c.ends_at endsAt FROM campaigns c JOIN projects p ON p.id=c.project_id JOIN organizations o ON o.id=p.organization_id WHERE ${PUBLIC_EVENT_SCOPE} ORDER BY c.starts_at DESC,c.id LIMIT 501`) as PublicEvent[];
}
export async function publicEvent(db:D1Database,id:string){
 return one(db,`SELECT c.id,c.name,c.location,c.status,c.rules_text,c.retry_limit,c.starts_at,c.ends_at FROM campaigns c JOIN projects p ON p.id=c.project_id JOIN organizations o ON o.id=p.organization_id WHERE c.id=? AND ${PUBLIC_EVENT_SCOPE}`,[id]);
}
/** A private destination is returned only by a live authorized project read. */
export async function privateEventDestination(db:D1Database,actor:PortalActor|null,id:string):Promise<string|null>{
 if(!actor)return null;
 const authority=projectAuthoritySql(actor,['campaigns.manage','participation.operate','reports.read'],'p.id');
 const row=await one(db,`SELECT c.id,c.project_id FROM campaigns c JOIN projects p ON p.id=c.project_id JOIN organizations o ON o.id=p.organization_id WHERE c.id=? AND c.status='draft' AND p.status='active' AND o.status='active' AND (${authority.sql})`,[id,...authority.values]);
 return row?`/?module=events&project=${encodeURIComponent(row.project_id)}&campaignId=${encodeURIComponent(row.id)}`:null;
}
