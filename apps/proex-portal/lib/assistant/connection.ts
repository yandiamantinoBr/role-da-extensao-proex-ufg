import {type PortalActor} from '../access';
import {all,one} from '../database';
import {HttpError} from '../errors';
import {prepareMutation} from '../mutations';
import {object,onlyKeys,validateConfig} from './contracts';
import {decryptCredentials,digest} from './crypto';
import {configurationActor} from './settings';
import {CONNECTION_PROVIDERS,connectionReceipt,type ConnectionProvider,type ConnectionReceipt} from './connection-contracts';
import {probeConnection} from './connection-provider';
type Authorization={sql:string;values:unknown[]};
type ProbeContext={organizationId:string;revision:number;credentialsCiphertext:string;auth:Authorization;current:PortalActor;config:ReturnType<typeof validateConfig>};
function organization(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value))throw new HttpError(400,'Escolha uma organização.','assistant_organization');return value;}
function assertion(db:D1Database,sql:string,values:unknown[],code:string){return db.prepare(`SELECT CASE WHEN (${sql}) THEN 1 ELSE json_extract('[]','${code}') END`).bind(...values);}
function guards(db:D1Database,context:ProbeContext){return[assertion(db,context.auth.sql,context.auth.values,'assistant_probe_revoked'),assertion(db,'EXISTS(SELECT 1 FROM ai_organization_settings WHERE organization_id=? AND revision=?)',[context.organizationId,context.revision],'assistant_probe_configuration')];}
async function batch(db:D1Database,statements:D1PreparedStatement[]){try{return await db.batch(statements);}catch(error){if(String(error).includes('assistant_probe_revoked'))throw new HttpError(403,'Sua autorização técnica foi revogada.','assistant_configuration_forbidden');if(String(error).includes('assistant_probe_configuration'))throw new HttpError(409,'A configuração mudou. Salve ou atualize antes de testar.','assistant_configuration_changed');if(String(error).includes('assistant_probe_quota'))throw new HttpError(429,'Limite de diagnósticos atingido. Aguarde antes de testar novamente.','assistant_connection_quota');throw error;}}
async function context(db:D1Database,actor:PortalActor|null,organizationId:unknown,expected?:unknown):Promise<ProbeContext>{
 const id=organization(organizationId),{current,auth}=await configurationActor(db,actor,id),row=await one(db,'SELECT revision,config_json,credentials_ciphertext FROM ai_organization_settings WHERE organization_id=?',[id]);
 if(!row)throw new HttpError(409,'Salve a configuração e as credenciais antes de testar.','assistant_configuration_changed');
 if(expected!==undefined&&(!Number.isSafeInteger(expected)||expected!==row.revision))throw new HttpError(409,'A configuração mudou. Atualize antes de testar.','assistant_configuration_changed');
 return{organizationId:id,revision:Number(row.revision),credentialsCiphertext:String(row.credentials_ciphertext),config:validateConfig(JSON.parse(row.config_json)),auth,current};
}
function pending(id:string,provider:ConnectionProvider,c:ProbeContext,at:string):ConnectionReceipt{return{id,provider,organizationId:c.organizationId,revision:c.revision,checkedAt:at,outcome:'pending',httpStatus:null,elapsedMs:0,modelListed:null,authenticationChecked:false,inferenceTested:false,replayed:true};}
async function storedReceipt(db:D1Database,c:ProbeContext,id:string,provider:ConnectionProvider){
 const start=await one(db,"SELECT created_at FROM audit WHERE id=? AND organization_id=? AND action='assistant.connection.started'",[id,c.organizationId]);if(!start)throw new HttpError(409,'O diagnóstico anterior não pode ser confirmado.','assistant_connection_uncertain');
 const result=await one(db,"SELECT details FROM audit WHERE entity_id=? AND organization_id=? AND action='assistant.connection.result' ORDER BY created_at DESC,id DESC LIMIT 1",[id,c.organizationId]);
 const receipt=result?connectionReceipt(JSON.parse(result.details)):pending(id,provider,c,String(start.created_at));if(receipt.provider!==provider||receipt.revision!==c.revision||receipt.organizationId!==c.organizationId)throw new HttpError(409,'Este diagnóstico pertence a outra configuração.','assistant_configuration_changed');
 await batch(db,guards(db,c));return{...receipt,replayed:true};
}
function rateStatements(db:D1Database,key:string,limit:number,windowMs:number,now:number){return[
 db.prepare('INSERT INTO portal_rate_limits(bucket_key,count,reset_at) VALUES(?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END').bind(key,now+windowMs,now,now,now+windowMs),
 assertion(db,'EXISTS(SELECT 1 FROM portal_rate_limits WHERE bucket_key=? AND count<=?)',[key,limit],'assistant_probe_quota'),
 ];}
export async function testAssistantConnection(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>,secret:string,options:{fetcher?:typeof fetch;signal?:AbortSignal}={}):Promise<ConnectionReceipt>{
 onlyKeys(input,['organizationId','provider','expectedRevision','operationKey','consent']);if(!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<1)throw new HttpError(409,'Atualize a configuração salva antes de testar.','assistant_configuration_changed');if(input.consent!==true)throw new HttpError(400,'Confirme o uso da credencial salva para consultar somente metadados do provedor.','assistant_consent');
 if(!CONNECTION_PROVIDERS.includes(input.provider as ConnectionProvider))throw new HttpError(400,'Escolha um provedor autorizado.','assistant_provider');const provider=input.provider as ConnectionProvider,c=await context(db,actor,input.organizationId,input.expectedRevision);
 if(options.signal?.aborted)throw new HttpError(499,'O diagnóstico foi cancelado.','assistant_connection_cancelled');
 const mutation=await prepareMutation(db,c.current.userId,'assistant.connection.test',input);
 if(mutation.existingId)return storedReceipt(db,c,mutation.existingId,provider);
 const credentials=object(await decryptCredentials(secret,c.credentialsCiphertext,c.organizationId));let credential=credentials[provider];if(typeof credential!=='string'||credential.length<12)throw new HttpError(409,'Cadastre e salve a credencial deste provedor antes de testar.','assistant_credentials');
 const id=crypto.randomUUID(),start=Date.now(),at=new Date(start).toISOString(),tenMinuteKey=await digest(`assistant.connection/10m/${c.organizationId}/${provider}`),dailyKey=await digest(`assistant.connection/24h/${c.organizationId}/${provider}`);
 // mutation_keys retains its existing meaning: this operation creates the
 // durable audit record identified by entity_id, in the very same transaction.
 // It is never removed here. A lost/replayed request cannot start another GET.
 try{await batch(db,[...guards(db,c),...rateStatements(db,tenMinuteKey,3,10*60000,start),...rateStatements(db,dailyKey,12,86400000,start),mutation.claimStatement(id),db.prepare("INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,'assistant.connection.started',?,?,?)").bind(id,c.current.userId,c.organizationId,id,JSON.stringify({provider,revision:c.revision}),at)]);}
 catch(error){const existing=await mutation.recover(error);return storedReceipt(db,c,existing,provider);}
 const controller=new AbortController();let timedOut=false;const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)controller.abort();
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},Math.min(c.config.timeoutMs,8000));let result:Awaited<ReturnType<typeof probeConnection>>;
 try{
  if(controller.signal.aborted)throw new Error('probe_cancelled');
  result=await probeConnection(provider,credential,provider==='deepseek'?c.config.model:provider==='typesafe'?c.config.jevModel:'nova-3',controller.signal,options.fetcher,async()=>{await batch(db,guards(db,c));});
 }catch(error){if(error instanceof HttpError)throw error;result={outcome:timedOut?'timeout':controller.signal.aborted?'cancelled':'unavailable',httpStatus:null,modelListed:null,authenticationChecked:false};}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);credential='';for(const key of Object.keys(credentials))credentials[key]='';}
 const receipt:ConnectionReceipt={id,provider,organizationId:c.organizationId,revision:c.revision,checkedAt:new Date().toISOString(),elapsedMs:Math.max(0,Date.now()-start),...result,inferenceTested:false,replayed:false};
 await batch(db,[...guards(db,c),db.prepare("INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,'assistant.connection.result',?,?,?)").bind(crypto.randomUUID(),c.current.userId,c.organizationId,id,JSON.stringify(receipt),receipt.checkedAt)]);
 return receipt;
}
export async function assistantConnectionStatus(db:D1Database,actor:PortalActor|null,organizationId:unknown){
 const c=await context(db,actor,organizationId),starts=await all(db,"SELECT id,details,created_at FROM audit WHERE organization_id=? AND action='assistant.connection.started' ORDER BY created_at DESC,id DESC LIMIT 60",[c.organizationId]),checks:ConnectionReceipt[]=[];
 for(const start of starts){let details:Record<string,unknown>;try{details=object(JSON.parse(start.details));}catch{continue;}const provider=details.provider as ConnectionProvider;if(!CONNECTION_PROVIDERS.includes(provider)||details.revision!==c.revision||checks.some(check=>check.provider===provider))continue;checks.push(await storedReceipt(db,c,String(start.id),provider));if(checks.length===3)break;}
 await batch(db,guards(db,c));return{organizationId:c.organizationId,revision:c.revision,checks};
}
