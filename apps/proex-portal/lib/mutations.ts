import {one,iso} from './database';
import {HttpError} from './errors';
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object'){const fields=value as Record<string,unknown>;return Object.fromEntries(Object.keys(fields).filter(k=>k!=='operationKey'&&fields[k]!==undefined).sort().map(k=>[k,canonical(fields[k])]));}
 return value;
}
async function digest(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function prepareMutation(db:D1Database,actorId:string,action:string,input:Record<string,unknown>){
 const key=input.operationKey;if(typeof key!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(key))throw new HttpError(400,'Atualize a página e envie a operação novamente.','invalid_operation_key');
 const scope=await digest(`${actorId}\n${action}\n${key}`),fingerprint=await digest(JSON.stringify(canonical(input)));
 async function find(){const row=await one(db,'SELECT fingerprint,entity_id FROM mutation_keys WHERE scope=?',[scope]);if(row&&row.fingerprint!==fingerprint)throw new HttpError(409,'Esta operação já foi usada com outros dados. Atualize o formulário.','operation_changed');return row?.entity_id as string|undefined;}
 const existingId=await find();
 return {scope,fingerprint,existingId,claimStatement:(id:string)=>db.prepare('INSERT INTO mutation_keys(scope,fingerprint,entity_id,created_at) VALUES(?,?,?,?)').bind(scope,fingerprint,id,iso()),recover:async(error:unknown)=>{const id=await find();if(id)return id;throw error;}};
}
