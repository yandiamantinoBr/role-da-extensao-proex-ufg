import {HttpError} from '../errors';
import {type ConnectionOutcome,type ConnectionProvider} from './connection-contracts';
const URLS={deepseek:{metadata:'https://api.deepseek.com/user/balance',models:'https://api.deepseek.com/models'},typesafe:{metadata:'https://api.typesafe.ai/v1/models'},deepgram:{metadata:'https://api.deepgram.com/v1/auth/token'}} as const;
export const CONNECTION_RESPONSE_BYTES=32*1024;
export type ProbeResult={outcome:ConnectionOutcome;httpStatus:number|null;modelListed:boolean|null;authenticationChecked:boolean};
class ProbeFailure extends Error{constructor(readonly outcome:ConnectionOutcome,readonly httpStatus:number|null=null){super('provider_probe_failed');}}
export function connectionEndpoint(provider:ConnectionProvider,step:'metadata'|'models'='metadata'){
 const endpoints=URLS[provider];if(!endpoints||!(step in endpoints))throw new ProbeFailure('invalid_response');const value=(endpoints as Record<string,string>)[step],url=new URL(value);if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||url.search)throw new ProbeFailure('invalid_response');return value;
}
async function get(provider:ConnectionProvider,key:string,step:'metadata'|'models',signal:AbortSignal,fetcher:typeof fetch,beforeEachRequest?:()=>Promise<void>){
 await beforeEachRequest?.();if(signal.aborted)throw new Error('probe_aborted');
 const response=await fetcher(connectionEndpoint(provider,step),{method:'GET',redirect:'error',cache:'no-store',signal,headers:{Authorization:`${provider==='deepgram'?'Token':'Bearer'} ${key}`,Accept:'application/json'}});
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw new ProbeFailure(response.status===401||response.status===403?'rejected':response.status===429?'rate_limited':'unavailable',response.status);}
 if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel().catch(()=>{});throw new ProbeFailure('invalid_response',response.status);}
 const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>CONNECTION_RESPONSE_BYTES)){await response.body?.cancel().catch(()=>{});throw new ProbeFailure('invalid_response',response.status);}
 const reader=response.body?.getReader();if(!reader)throw new ProbeFailure('invalid_response',response.status);const chunks:Uint8Array[]=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>CONNECTION_RESPONSE_BYTES)throw new ProbeFailure('invalid_response',response.status);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}let value:unknown;
 try{const text=new TextDecoder().decode(bytes);if(text.includes(key))throw Error();value=JSON.parse(text);}catch{throw new ProbeFailure('invalid_response',response.status);}finally{bytes.fill(0);}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length===0||'error'in value||'err_code'in value)throw new ProbeFailure('invalid_response',response.status);return{body:value as Record<string,unknown>,status:response.status};
}
export async function probeConnection(provider:ConnectionProvider,key:string,model:string,signal:AbortSignal,fetcher:typeof fetch=fetch,beforeEachRequest?:()=>Promise<void>):Promise<ProbeResult>{
 try{
  const metadata=await get(provider,key,'metadata',signal,fetcher,beforeEachRequest);let modelListed:boolean|null=null;
  if(provider==='deepseek'){if(typeof metadata.body.is_available!=='boolean')throw new ProbeFailure('invalid_response',metadata.status);const models=await get(provider,key,'models',signal,fetcher,beforeEachRequest);if(models.body.object!=='list'||!Array.isArray(models.body.data)||models.body.data.length>200||models.body.data.some(row=>!row||typeof row!=='object'||typeof row.id!=='string'))throw new ProbeFailure('invalid_response',models.status);modelListed=models.body.data.some(row=>row.id===model);}
  if(provider==='typesafe'){if(!Array.isArray(metadata.body.models)||metadata.body.models.length>200||metadata.body.models.some(row=>!row||typeof row!=='object'||typeof row.name!=='string'))throw new ProbeFailure('invalid_response',metadata.status);modelListed=metadata.body.models.some(row=>row.name===model);}
  // Deepgram documents GET /auth/token as key verification. Its metadata is not
  // retained or returned; it does not prove permission/model for a paid STT call.
  return{outcome:'authenticated',httpStatus:metadata.status,modelListed,authenticationChecked:true};
 }catch(error){if(signal.aborted||error instanceof HttpError)throw error;if(error instanceof ProbeFailure)return{outcome:error.outcome,httpStatus:error.httpStatus,modelListed:null,authenticationChecked:false};return{outcome:'unavailable',httpStatus:null,modelListed:null,authenticationChecked:false};}
}
