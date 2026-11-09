import {HttpError} from './errors';
const MAX_EXPIRED_BUCKETS_PER_REQUEST = 200;
export type RateRule={bucket:string,limit:number,windowMs:number};
async function bucketKey(bucket:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bucket)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function limited():never{throw new HttpError(429,'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.','rate_limited');}
/**
 * Conta uma tentativa em todos os baldes de uma vez.
 * No alvo Node cada escrita regrava o instantâneo inteiro do banco. Por isso:
 * - um balde já cheio recusa com uma leitura, sem escrever nada (quem insiste não
 *   gera novas gravações);
 * - todos os baldes, e a limpeza dos expirados, entram numa única transação.
 * A conferência depois do incremento cobre pedidos simultâneos.
 */
export async function rateLimitAll(db:D1Database,rules:RateRule[]){
 if(!rules.length)return;
 const now=Date.now(),keys=await Promise.all(rules.map(rule=>bucketKey(rule.bucket)));
 const current=await db.prepare(`SELECT bucket_key,count FROM portal_rate_limits WHERE reset_at>? AND bucket_key IN (${keys.map(()=>'?').join(',')})`).bind(now,...keys).all<{bucket_key:string,count:number}>();
 const counts=new Map((current.results??[]).map(row=>[row.bucket_key,Number(row.count)]));
 if(rules.some((rule,index)=>(counts.get(keys[index])??0)>=rule.limit))limited();
 const results=await db.batch([
  db.prepare('DELETE FROM portal_rate_limits WHERE bucket_key IN (SELECT bucket_key FROM portal_rate_limits WHERE reset_at<=? LIMIT ?)').bind(now,MAX_EXPIRED_BUCKETS_PER_REQUEST),
  ...rules.map((rule,index)=>db.prepare('INSERT INTO portal_rate_limits(bucket_key,count,reset_at) VALUES(?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING count,reset_at').bind(keys[index],now+rule.windowMs,now,now,now+rule.windowMs)),
 ]);
 rules.forEach((rule,index)=>{const row=results[index+1]?.results?.[0] as {count:number}|undefined;if(!row||row.count>rule.limit)limited();});
}
export async function rateLimit(db:D1Database,bucket:string,limit:number,windowMs:number){await rateLimitAll(db,[{bucket,limit,windowMs}]);}
/** IP do cliente informado pela plataforma: Cloudflare ou, no alvo Node da Vercel, x-real-ip (definido pela própria Vercel). */
export function clientIp(request:Request):string|null{return request.headers.get('cf-connecting-ip')??((globalThis as {process?:{env?:Record<string,string|undefined>}}).process?.env?.VERCEL==='1'?request.headers.get('x-real-ip'):null);}
export async function accountRate(db:D1Database,request:Request,subject:string){const ip=clientIp(request);await rateLimitAll(db,[{bucket:'account:global',limit:250,windowMs:60000},{bucket:`account:${subject.toLowerCase().slice(0,300)}`,limit:10,windowMs:600000},...(ip?[{bucket:`account:ip:${ip}`,limit:40,windowMs:600000}]:[])]);}
