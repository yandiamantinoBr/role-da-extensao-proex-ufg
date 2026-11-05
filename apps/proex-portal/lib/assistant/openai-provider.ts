import {HttpError} from '../errors';
import {PROVIDERS,type AssistantConfig} from './contracts';
const object=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const string=(maxLength:number)=>({type:'string',maxLength});
const SCHEMAS={
 operation:object({intent:{type:'string',enum:['stock.query','stock.receive','stock.distribute','stock.consume','record.create']},itemId:{type:['string','null'],maxLength:200},quantity:{type:'integer',minimum:0,maximum:1000000},title:string(160),body:string(2000),evidence:{type:'array',minItems:1,maxItems:3,items:object({source:{type:'string',enum:['request']},quote:string(500)})}}),
 document:object({fields:{type:'array',maxItems:100,items:object({key:string(100),value:string(600),quote:string(600)})}}),
} as const;
export type TextPurpose=keyof typeof SCHEMAS;
export type ChatTextBody={messages:{role:string;content:string}[]};
export function openAiGenerationBody(config:AssistantConfig,body:ChatTextBody,purpose:TextPurpose='operation'){
 if(config.openaiModel!==PROVIDERS.openai.model||!Object.hasOwn(SCHEMAS,purpose)||body.messages.length!==2||body.messages[0].role!=='system'||body.messages[1].role!=='user'||body.messages.some(message=>typeof message.content!=='string'))throw new HttpError(400,'Escolha um modelo e contrato de texto revisados.','assistant_model');
 return{model:config.openaiModel,store:false,stream:false,background:false,service_tier:'default',reasoning:{effort:'none'},max_output_tokens:config.maxOutputTokens,tools:[],tool_choice:'none',parallel_tool_calls:false,input:body.messages.map(message=>({role:message.role==='system'?'developer':'user',content:message.content})),text:{format:{type:'json_schema',name:'proex_'+purpose,strict:true,schema:SCHEMAS[purpose]}}};
}
const invalid=()=>new HttpError(502,'A resposta OpenAI não confirmou o modelo, o uso ou o contrato esperado.','assistant_provider_schema');
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>;}
async function bounded(response:Response){
 if(!response.ok||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel().catch(()=>{});throw new HttpError(503,'A OpenAI não respondeu ao pedido. A reserva foi mantida; não houve repetição automática.','assistant_provider_unavailable');}
 const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>128*1024)){await response.body?.cancel().catch(()=>{});throw invalid();}
 const reader=response.body?.getReader();if(!reader)throw invalid();const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>128*1024)throw invalid();chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch{throw invalid();}finally{bytes.fill(0);}
}
export async function generateOpenAiJson(config:AssistantConfig,apiKey:string,body:ReturnType<typeof openAiGenerationBody>,signal:AbortSignal,fetcher:typeof fetch=fetch){
 if(!apiKey||config.textProvider!=='openai'||body.model!==PROVIDERS.openai.model)throw new HttpError(503,'A credencial OpenAI selecionada está indisponível.','assistant_unavailable');
 try{
  const data=await bounded(await fetcher(PROVIDERS.openai.endpoint,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal}));
  if(signal.aborted)throw new Error('aborted');
  if(JSON.stringify(data).includes(apiKey)||data.object!=='response'||data.model!==body.model||data.status!=='completed'||data.error!==null||data.incomplete_details!==null||!Array.isArray(data.output)||data.output.length!==1)throw invalid();
  const message=record(data.output[0]);if(message.type!=='message'||message.role!=='assistant'||message.status!=='completed'||!Array.isArray(message.content)||message.content.length!==1)throw invalid();
  const content=record(message.content[0]);if(content.type!=='output_text'||typeof content.text!=='string'||!content.text.trim()||content.text.length>16000)throw invalid();
  const usage=record(data.usage);for(const key of ['input_tokens','output_tokens','total_tokens'])if(!Number.isSafeInteger(usage[key])||Number(usage[key])<0)throw invalid();
  if(Number(usage.output_tokens)>config.maxOutputTokens||Number(usage.total_tokens)!==Number(usage.input_tokens)+Number(usage.output_tokens))throw invalid();
  let proposal:unknown;try{proposal=JSON.parse(content.text);}catch{throw invalid();}
  return{proposal,returnedModel:String(data.model),inputTokens:Number(usage.input_tokens),outputTokens:Number(usage.output_tokens)};
 }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,'A chamada OpenAI falhou ou demorou demais. Não houve nova tentativa automática.','assistant_provider_unavailable');}
}
