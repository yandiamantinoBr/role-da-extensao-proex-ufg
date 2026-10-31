import { type AssistantConfig, PROVIDERS } from './contracts';
export type AiReservation = {tokens:number;cost:number;calls:number;milliseconds:number};
export function aiReservation(config:AssistantConfig,bodyBytes:number):AiReservation{return{tokens:bodyBytes+config.maxOutputTokens+(config.jevEnabled?bodyBytes+18000:0),calls:config.jevEnabled?2:1,milliseconds:config.timeoutMs,cost:Math.ceil(bodyBytes*PROVIDERS.deepseek.inputMicrosPerToken+config.maxOutputTokens*PROVIDERS.deepseek.outputMicrosPerToken+(config.jevEnabled?(bodyBytes+18000)*PROVIDERS.typesafe.inputMicrosPerToken:0))};}
type Request={table:'ai_calls'|'ai_document_calls';authorization:D1PreparedStatement;id:string;fingerprint:string;nonce:string;actorId:string;projectId:string|null;organizationId:string;day:string;createdAt:string;revision:number;config:AssistantConfig;reservation:AiReservation;document?:{kind:'project'|'asset';sourceDigest:string;expiresAt:number}};
/** Fixed table adapters share the same org budget and nonce-owned reservation.
 * The caller runs this array in one atomic batch and checks nonce before dispatch.
 */
export function reservationStatements(db:D1Database,input:Request):D1PreparedStatement[]{
 const {table,authorization,id,fingerprint,nonce,actorId,projectId,organizationId,day,createdAt,revision,config,reservation:r}=input;
 if(table==='ai_calls'&&!projectId||table==='ai_document_calls'&&!input.document)throw new Error('Invalid assistant reservation adapter');
 const quota=`FROM ai_organization_usage WHERE organization_id=? AND day=? AND reserved_usd_micros+?<=? AND reserved_tokens+?<=? AND reserved_ms+?<=? AND calls+?<=? AND EXISTS(SELECT 1 FROM ai_organization_settings WHERE organization_id=? AND revision=?)`;
 const limits=[organizationId,day,r.cost,config.dailyUsdMicros,r.tokens,config.dailyTokens,r.milliseconds,config.dailyMs,r.calls,config.dailyCalls,organizationId,revision];
 const claim=table==='ai_calls'?db.prepare(`INSERT INTO ai_calls(id,fingerprint,admission_nonce,actor_id,project_id,status,day,created_at) SELECT ?,?,?,?,?,'reserved',?,? ${quota}`).bind(id,fingerprint,nonce,actorId,projectId,day,createdAt,...limits)
 :db.prepare(`INSERT INTO ai_document_calls(id,fingerprint,admission_nonce,actor_id,project_id,organization_id,kind,source_digest,config_revision,status,day,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,?,'reserved',?,?,? ${quota}`).bind(id,fingerprint,nonce,actorId,projectId,organizationId,input.document!.kind,input.document!.sourceDigest,revision,day,createdAt,input.document!.expiresAt,...limits);
 return[authorization,db.prepare('INSERT INTO ai_organization_usage(organization_id,day) VALUES(?,?) ON CONFLICT(organization_id,day) DO NOTHING').bind(organizationId,day),claim,db.prepare(`UPDATE ai_organization_usage SET reserved_usd_micros=reserved_usd_micros+?,reserved_tokens=reserved_tokens+?,reserved_ms=reserved_ms+?,calls=calls+? WHERE organization_id=? AND day=? AND EXISTS(SELECT 1 FROM ${table} WHERE id=? AND admission_nonce=?)`).bind(r.cost,r.tokens,r.milliseconds,r.calls,organizationId,day,id,nonce)];
}
