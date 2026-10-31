'use client';
export type EmailSettings={enabled:boolean;version:number;senderEmail:string;portalOrigin:string;dailyLimit:number;personDailyLimit:number;eventLimit:number;intervalSeconds:number};
export type EmailStatus={organizationId:string;canManage:boolean;organizationEnabled:boolean;self:{email:string;enabled:boolean};configuration:EmailSettings|null;notice:string;dispatchTokens?:{id:string;label:string;expires_at:string;expired:boolean;revoked_at:string|null}[];queue?:{status:string;count:number}[];state?:{last_attempt_at:string|null;last_accepted_at:string|null;remaining_quota:number|null;last_outcome:string}|null;uncertain?:{id:string;status:string;sending_at:string;updated_at:string}[]};
export type EmailActionResult={kind:'updated'}|{kind:'token';id:string;token:string;expiresAt:string};
export class EmailSettingsError extends Error{constructor(message:string,readonly status=0){super(message);this.name='EmailSettingsError';}}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const string=(value:unknown):value is string=>typeof value==='string';
const nullableText=(value:unknown)=>value===null||string(value);
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const entries=(value:unknown,valid:(row:unknown)=>boolean)=>Array.isArray(value)&&value.every(valid);
function abort(signal?:AbortSignal){if(signal?.aborted){if(signal.reason)throw signal.reason;const error=new Error('Consulta cancelada.');error.name='AbortError';throw error;}}
async function json(response:Response,signal?:AbortSignal){let value:unknown;try{value=await response.json();}catch(error){abort(signal);if(object(error)&&error.name==='AbortError')throw error;if(response.ok)throw new EmailSettingsError('A resposta chegou incompleta. Atualize o estado antes de tentar novamente.');value=null;}abort(signal);if(!response.ok){const message=object(value)?value.error:null;throw new EmailSettingsError(string(message)?message:object(message)&&string(message.message)?message.message:'Não foi possível confirmar os avisos. Atualize o estado.',response.status);}return value;}
function configuration(value:unknown):value is EmailSettings{return object(value)&&typeof value.enabled==='boolean'&&integer(value.version)&&string(value.senderEmail)&&string(value.portalOrigin)&&integer(value.dailyLimit)&&integer(value.personDailyLimit)&&integer(value.eventLimit)&&integer(value.intervalSeconds);}
function statusShape(value:unknown,organizationId:string):value is EmailStatus{
 if(!object(value)||value.organizationId!==organizationId||typeof value.canManage!=='boolean'||typeof value.organizationEnabled!=='boolean'||!object(value.self)||!string(value.self.email)||typeof value.self.enabled!=='boolean'||!string(value.notice))return false;
 if(!value.canManage)return value.configuration===null;
 return (value.configuration===null||configuration(value.configuration))&&entries(value.dispatchTokens,row=>object(row)&&string(row.id)&&string(row.label)&&string(row.expires_at)&&Number.isFinite(Date.parse(row.expires_at))&&(typeof row.expired==='boolean'||row.expired===0||row.expired===1)&&nullableText(row.revoked_at))
 &&entries(value.queue,row=>object(row)&&string(row.status)&&integer(row.count))
 &&(value.state===null||object(value.state)&&nullableText(value.state.last_attempt_at)&&nullableText(value.state.last_accepted_at)&&(value.state.remaining_quota===null||integer(value.state.remaining_quota))&&string(value.state.last_outcome))
 &&entries(value.uncertain,row=>object(row)&&string(row.id)&&string(row.status)&&nullableText(row.sending_at)&&string(row.updated_at));
}
export async function loadEmailStatus(organizationId:string,signal?:AbortSignal):Promise<EmailStatus>{const response=await fetch('/api/follow-up/email?organizationId='+encodeURIComponent(organizationId),{cache:'no-store',credentials:'same-origin',signal}),value=await json(response,signal);if(!statusShape(value,organizationId))throw new EmailSettingsError('O estado recebido não corresponde à organização. Atualize antes de continuar.');if(!value.canManage)return{organizationId:value.organizationId,canManage:false,organizationEnabled:value.organizationEnabled,self:value.self,configuration:null,notice:value.notice};return{...value,dispatchTokens:value.dispatchTokens?.map(row=>({...row,expired:!!row.expired}))};}
export async function updateEmailSettings(organizationId:string,input:Record<string,unknown>,signal?:AbortSignal):Promise<EmailActionResult>{
 const action=input.action;if(!string(action)||!['configure','preference','token.create','token.revoke','reconcile'].includes(action))throw new EmailSettingsError('Escolha uma ação de configuração válida.');
 const response=await fetch('/api/follow-up/email',{method:'POST',cache:'no-store',credentials:'same-origin',signal,headers:{'Content-Type':'application/json','X-Proex-Action':'1'},body:JSON.stringify({...input,organizationId})}),value=await json(response,signal);
 if(action==='token.create'){
  if(!object(value)||value.organizationId!==organizationId||!string(value.id)||!string(value.label)||!string(value.token)||!/^pne_[A-Za-z0-9_-]{43}$/.test(value.token)||!string(value.expiresAt)||!Number.isFinite(Date.parse(value.expiresAt)))throw new EmailSettingsError('A credencial não pôde ser confirmada. Atualize a lista antes de criar outra.');
  return{kind:'token',id:value.id,token:value.token,expiresAt:value.expiresAt};
 }
 if(!object(value)||value.ok!==true||action==='configure'&&(!integer(value.version)||value.version<1)||action==='reconcile'&&(value.retry!==false||value.meaning!=='manual_attestation_no_delivery_proof'))throw new EmailSettingsError('A resposta não confirmou a alteração. Atualize o estado antes de repetir.');
 return{kind:'updated'};
}
