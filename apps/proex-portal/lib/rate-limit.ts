import {HttpError} from './errors';
const MAX_EXPIRED_BUCKETS_PER_REQUEST = 200;
export type RateRule={bucket:string,limit:number,windowMs:number};
async function bucketKey(bucket:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bucket)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function limited():never{throw new HttpError(429,'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.','rate_limited');}
const RATE_LIMITED_MARK='portal_rate_limited';
/** Verdadeiro quando um lote foi desfeito porque um balde passou do limite entre a leitura e a gravação. */
export function isRateLimitedError(error:unknown){return String(error).includes(RATE_LIMITED_MARK);}
export function rateLimitedError():never{limited();}
/**
 * Prepara a contagem de uma tentativa em todos os baldes, para entrar no lote (db.batch)
 * da própria operação. No alvo Node cada escrita regrava o instantâneo inteiro do banco. Por isso:
 * - um balde já cheio recusa aqui, com uma leitura, sem escrever nada (quem insiste não
 *   gera novas gravações);
 * - as instruções devolvidas (limpeza dos expirados, incrementos e a conferência depois do
 *   incremento) vão no mesmo lote da operação: uma ação permitida custa um único commit.
 * A conferência cobre pedidos simultâneos: se algum balde passar do limite, o lote inteiro,
 * operação inclusive, é desfeito, e o erro é reconhecido por isRateLimitedError.
 */
export async function rateLimitStatements(db:D1Database,rules:RateRule[]):Promise<D1PreparedStatement[]>{
 if(!rules.length)return [];
 const now=Date.now(),keys=await Promise.all(rules.map(rule=>bucketKey(rule.bucket)));
 const current=await db.prepare(`SELECT bucket_key,count FROM portal_rate_limits WHERE reset_at>? AND bucket_key IN (${keys.map(()=>'?').join(',')})`).bind(now,...keys).all<{bucket_key:string,count:number}>();
 const counts=new Map((current.results??[]).map(row=>[row.bucket_key,Number(row.count)]));
 if(rules.some((rule,index)=>(counts.get(keys[index])??0)>=rule.limit))limited();
 return [
  db.prepare('DELETE FROM portal_rate_limits WHERE bucket_key IN (SELECT bucket_key FROM portal_rate_limits WHERE reset_at<=? LIMIT ?)').bind(now,MAX_EXPIRED_BUCKETS_PER_REQUEST),
  ...rules.flatMap((rule,index)=>[
   db.prepare('INSERT INTO portal_rate_limits(bucket_key,count,reset_at) VALUES(?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END').bind(keys[index],now+rule.windowMs,now,now,now+rule.windowMs),
   db.prepare(`SELECT CASE WHEN (SELECT count FROM portal_rate_limits WHERE bucket_key=?)<=? THEN 1 ELSE json_extract('[]','${RATE_LIMITED_MARK}') END`).bind(keys[index],rule.limit),
  ]),
 ];
}
/** Conta uma tentativa em todos os baldes de uma vez, numa única transação própria. */
export async function rateLimitAll(db:D1Database,rules:RateRule[]){
 const statements=await rateLimitStatements(db,rules);
 if(!statements.length)return;
 try{await db.batch(statements);}catch(error){if(isRateLimitedError(error))limited();throw error;}
}
export async function rateLimit(db:D1Database,bucket:string,limit:number,windowMs:number){await rateLimitAll(db,[{bucket,limit,windowMs}]);}
/** IP do cliente informado pela plataforma: Cloudflare ou, no alvo Node da Vercel, x-real-ip (definido pela própria Vercel). */
export function clientIp(request:Request):string|null{return request.headers.get('cf-connecting-ip')??((globalThis as {process?:{env?:Record<string,string|undefined>}}).process?.env?.VERCEL==='1'?request.headers.get('x-real-ip'):null);}
export async function accountRate(db:D1Database,request:Request,subject:string){const ip=clientIp(request);await rateLimitAll(db,[{bucket:'account:global',limit:250,windowMs:60000},{bucket:`account:${subject.toLowerCase().slice(0,300)}`,limit:10,windowMs:600000},...(ip?[{bucket:`account:ip:${ip}`,limit:40,windowMs:600000}]:[])]);}
