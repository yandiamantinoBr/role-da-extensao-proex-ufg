import {HttpError} from './errors';
export async function rateLimit(db:D1Database,bucket:string,limit:number,windowMs:number){
 const key=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bucket)))].map(b=>b.toString(16).padStart(2,'0')).join(''),now=Date.now();
 const row=await db.prepare('INSERT INTO portal_rate_limits(bucket_key,count,reset_at) VALUES(?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING count,reset_at').bind(key,now+windowMs,now,now,now+windowMs).first<{count:number,reset_at:number}>();
 if(!row||row.count>limit)throw new HttpError(429,'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.','rate_limited');
}
/** IP do cliente informado pela plataforma: Cloudflare ou, no alvo Node da Vercel, x-real-ip (definido pela própria Vercel). */
export function clientIp(request:Request):string|null{return request.headers.get('cf-connecting-ip')??((globalThis as {process?:{env?:Record<string,string|undefined>}}).process?.env?.VERCEL==='1'?request.headers.get('x-real-ip'):null);}
export async function accountRate(db:D1Database,request:Request,subject:string){await rateLimit(db,'account:global',250,60000);await rateLimit(db,`account:${subject.toLowerCase().slice(0,300)}`,10,600000);const ip=clientIp(request);if(ip)await rateLimit(db,`account:ip:${ip}`,40,600000);}
