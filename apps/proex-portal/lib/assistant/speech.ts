import { getActor, requireLiveCapability, projectAuthoritySql, type PortalActor } from '../access';
import { one } from '../database';
import { HttpError } from '../errors';
import { object, safeRequest } from './contracts';
import { decryptCredentials, digest, encryptCredentials, type CredentialKeys } from './crypto';
import { assistantUsageSql, loadSpeechSettings, type SpeechEnvironment, type SpeechProvider } from './settings';

export const GROQ_SPEECH_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const GROQ_SPEECH_MODEL = 'whisper-large-v3-turbo';
// Official pricing verified 2026-11-05: USD0.04/hour, minimum10billed seconds.
// Reserve with integer micro-USD rounding; this is not an assertion of free use.
export function speechReservedUsdMicros(provider:SpeechProvider,duration:number){return provider==='groq'?Math.ceil(Math.max(duration,10)*40000/3600):Math.ceil(duration/60*30000);}
export const SPEECH_ENDPOINT = 'https://api.deepgram.com/v1/listen?model=nova-3&language=pt-BR&mip_opt_out=true';
export function speechEndpoint(value: unknown = SPEECH_ENDPOINT): string { if (value !== SPEECH_ENDPOINT) throw new HttpError(400, 'Use apenas o endpoint oficial de transcrição autorizado.', 'speech_endpoint'); return SPEECH_ENDPOINT; }
import { validateSpeechAudio } from './audio';
import { quotaRefusal } from './quota';
import { recordRouteFallback, resolveTaskRoute, speechDestination, speechRouteStyle, taskApproval, taskRouteGuards } from './task-routing';
import { speechRouteCeilingMicros } from './role-contracts';
export { validateSpeechAudio } from './audio';
export async function speechActor(db: D1Database, actor: PortalActor | null, projectId: string) {
 const current = actor && await getActor(db,actor); if (!current) throw new HttpError(403,'Entre novamente para transcrever.','speech_forbidden');
 await requireLiveCapability(db,current,'inventory.read',projectId);
 const project = await one(db,"SELECT p.organization_id FROM projects p JOIN organizations o ON o.id=p.organization_id AND o.status='active' WHERE p.id=?",[projectId]);
 if (!project) throw new HttpError(403,'O projeto ou sua organização está indisponível.','speech_forbidden'); return { current, organizationId: String(project.organization_id) };
}
async function providerSpeech(provider: SpeechProvider, bytes: Uint8Array, apiKey: string, signal: AbortSignal, fetcher: typeof fetch, target?: { endpoint: string; model: string }) {
 const wav = new Uint8Array(bytes).buffer;
 let endpoint = speechEndpoint();
 let headers: Record<string, string> = { Authorization: `Token ${apiKey}`, 'Content-Type': 'audio/wav' };
 let requestBody: BodyInit = wav;
 if (provider === 'groq') {
  const form = new FormData();
  form.set('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  form.set('model', target?.model ?? GROQ_SPEECH_MODEL);
  form.set('language', 'pt');
  form.set('response_format', 'json');
  endpoint = target?.endpoint ?? GROQ_SPEECH_ENDPOINT;
  headers = { Authorization: `Bearer ${apiKey}` };
  requestBody = form;
 }
 try {
  const response = await fetcher(endpoint, { method:'POST', redirect:'error', cache:'no-store', signal, headers, body:requestBody });
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new HttpError(503,'O provedor não transcreveu o áudio. A reserva permanece na cota.','speech_provider');
  const reader = response.body?.getReader(); if (!reader) throw new Error('empty'); const chunks: Uint8Array[]=[]; let size=0;
  try { for (;;) { const {value,done}=await reader.read(); if(done) break; size+=value.length; if(size>256*1024) throw new Error('limit'); chunks.push(value); } } finally { await reader.cancel().catch(()=>{}); }
  const body=new Uint8Array(size); let offset=0; for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;} return object(JSON.parse(new TextDecoder().decode(body)));
 } catch(error) { if(error instanceof HttpError) throw error; throw new HttpError(503,'A transcrição falhou ou demorou demais. O áudio continua disponível para revisão; não houve retry pago automático.','speech_provider'); }
}
function validatedTranscript(response: Record<string, unknown>, provider: SpeechProvider, duration: number) {
 let transcript = response.text;
 let returnedVersion: string | null = null;
 if (provider === 'deepgram') {
  const metadata = object(response.metadata), channels = object(response.results).channels;
  if (!Array.isArray(channels) || channels.length !== 1 || !Array.isArray(object(channels[0]).alternatives)) throw new Error('speech_schema');
  transcript = object((object(channels[0]).alternatives as unknown[])[0]).transcript;
  const model = object(Object.values(object(metadata.model_info))[0]);
  if (typeof metadata.duration !== 'number' || Math.abs(metadata.duration - duration) > .25 || !String(model.arch).startsWith('nova-3') || typeof model.version !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(model.version)) throw new Error('speech_schema');
  returnedVersion = model.version;
 }
 if (typeof transcript !== 'string' || !transcript.trim() || transcript.length > 4000 || response.error) throw new Error('speech_schema');
 return { transcript: safeRequest(transcript), returnedVersion };
}

export async function transcribeSpeech(db:D1Database, actor:PortalActor|null, input:{projectId:string;operationKey:string;consent:boolean;expectedProvider?:string;approval?:string;mime:string;bytes:Uint8Array},secret:string,options:{fetcher?:typeof fetch;signal?:AbortSignal;now?:number;environment?:SpeechEnvironment;keys?:CredentialKeys}={}) {
 if(!input.consent)throw new HttpError(400,'Autorize o envio deste áudio ao provedor configurado.','speech_consent');
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input.projectId)||!/^[A-Za-z0-9_-]{8,100}$/.test(input.operationKey))throw new HttpError(400,'Escolha o projeto e prepare um envio válido.','speech_input');
 const {current,organizationId}=await speechActor(db,actor,input.projectId);
 const settings=await loadSpeechSettings(db,secret,organizationId,options.environment,options.keys,current.userId),provider=settings.provider;
 // Modelo do catálogo para voz (vazio = padrão de hoje). O consentimento nomeia um destino só: com rota,
 // o cliente precisa confirmar `catalog:<id>`; rota pulada antes do envio segue no padrão já consentido.
 const speechRoute=settings.config.speechModel?await resolveTaskRoute(db,organizationId,settings.config,settings.rawCredentials,'speech',provider):null;
 const routed=speechRoute&&!('skip' in speechRoute)?speechRoute:null,destination=speechDestination(speechRoute,provider);
 // Com modelo de voz em jogo (escolhido agora, ou mostrado à pessoa antes), o aviso diz o que fazer; sem ele, o texto de sempre.
 if ((input.expectedProvider ?? 'deepgram') !== destination) throw new HttpError(409,settings.config.speechModel||String(input.expectedProvider??'').startsWith('catalog:')?'O serviço que transcreve o áudio mudou. Nada foi enviado. Confira o aviso, autorize e envie de novo.':'O provedor de transcrição mudou. Atualize o portal e confirme novamente.','speech_provider_changed');
 const approval=routed?await taskApproval(organizationId,settings.revision,'speech',[routed]):undefined;
 const destinationChanged=()=>new HttpError(409,'O serviço ou o custo da transcrição mudou. Nada foi enviado. Confira o aviso e autorize de novo.','speech_provider_changed');
 if(input.approval!==approval)throw destinationChanged();
 const routeGuards=taskRouteGuards(db,organizationId,[speechRoute]);
 const audio=validateSpeechAudio(input.bytes,input.mime),now=options.now??Date.now(),apiKey=routed?routed.apiKey:settings.apiKey;
 // Formato de envio do destino: provedor de voz revisado (Deepgram) ou formulário de áudio compatível com OpenAI.
 const style:SpeechProvider=routed?speechRouteStyle(routed):provider;
 const target=routed&&style==='groq'?{endpoint:`${routed.baseUrl}/audio/transcriptions`,model:routed.model.model}:undefined;
 const model=routed?routed.model.model:provider==='groq'?GROQ_SPEECH_MODEL:'nova-3';
 await db.prepare("UPDATE ai_transcriptions SET result_ciphertext=NULL WHERE organization_id=? AND status='complete' AND created_at<? AND result_ciphertext IS NOT NULL").bind(organizationId,new Date(now-3600000).toISOString()).run();
 const audioSha256=await digest(input.bytes),id=await digest(`${current.userId}\n${input.projectId}\n${input.operationKey}`);
 // Keep existing Deepgram fingerprints valid and prevent replay across providers.
 const fingerprint=await digest(routed?`${audioSha256}:${settings.revision}:${destination}:${approval}`:`${audioSha256}:${settings.revision}${provider === 'groq' ? ':groq' : ''}`);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 // Com rota, a reserva usa o preço por hora do modelo escolhido (mínimo de 10 s) e nunca fica abaixo da reserva revisada do mesmo formato.
 // A conta é a mesma função que a tela usa para mostrar o teto antes do envio (role-contracts).
 const cost=routed?speechRouteCeilingMicros(style,audio.duration,routed.model.price.perHour):speechReservedUsdMicros(provider,audio.duration);
 const auth=projectAuthoritySql(current,['inventory.read'],'?');
 const usage=assistantUsageSql(current.userId);
 const assertion=db.prepare(`SELECT CASE WHEN ${auth.sql} AND EXISTS(SELECT 1 FROM ai_organization_settings s JOIN organizations o ON o.id=s.organization_id WHERE s.organization_id=? AND s.revision=? AND json_extract(s.config_json,'$.sttEnabled')=1 AND o.status='active' AND ${usage.sql}) THEN 1 ELSE json_extract('[]','speech_authority_changed') END`).bind(...auth.values,input.projectId,organizationId,settings.revision,...usage.values);
 async function authorized(dispatch=false){try{if(dispatch&&routeGuards.length)await db.batch([...routeGuards,assertion]);else await assertion.first();}catch(error){if(String(error).includes('speech_authority_changed'))throw new HttpError(403,'Seu acesso ou a configuração mudou.','speech_forbidden');throw error;}if(options.signal?.aborted)throw new HttpError(499,'Envio cancelado.','speech_aborted');}
 async function replay(){const row=await one(db,'SELECT * FROM ai_transcriptions WHERE id=?',[id]);if(!row)return null;if(row.fingerprint!==fingerprint||row.actor_id!==current.userId||row.project_id!==input.projectId||row.organization_id!==organizationId)throw new HttpError(409,'Este envio já foi usado com outro áudio ou configuração.','speech_operation_changed');await speechActor(db,current,input.projectId);if(row.status==='complete'&&now-Date.parse(row.created_at)<3600000){const result={...object(await decryptCredentials(secret,row.result_ciphertext,`speech:${organizationId}:${id}`)),replayed:true};await authorized();return result;}throw new HttpError(409,'Este envio já foi processado ou falhou. Para uma nova tentativa paga, escolha explicitamente novo envio.','speech_replay');}
 const admissionNonce=crypto.randomUUID();
 const old=await replay();if(old)return old;if(options.signal?.aborted)throw new HttpError(499,'Envio cancelado antes da transcrição.','speech_aborted');

 try{await db.batch([assertion,...routeGuards,db.prepare('INSERT INTO ai_organization_usage(organization_id,day) VALUES(?,?) ON CONFLICT(organization_id,day) DO NOTHING').bind(organizationId,day),db.prepare(`INSERT INTO ai_transcriptions(id,fingerprint,admission_nonce,actor_id,project_id,organization_id,config_revision,status,created_at) SELECT ?,?,?,?,?,?,?,'reserved',? FROM ai_organization_usage WHERE organization_id=? AND day=? AND calls+1<=? AND reserved_usd_micros+?<=? AND reserved_ms+?<=?`).bind(id,fingerprint,admissionNonce,current.userId,input.projectId,organizationId,settings.revision,new Date(now).toISOString(),organizationId,day,settings.config.dailyCalls,cost,settings.config.dailyUsdMicros,settings.config.timeoutMs,settings.config.dailyMs),db.prepare('UPDATE ai_organization_usage SET calls=calls+1,reserved_usd_micros=reserved_usd_micros+?,reserved_ms=reserved_ms+? WHERE organization_id=? AND day=? AND EXISTS(SELECT 1 FROM ai_transcriptions WHERE id=? AND admission_nonce=?)').bind(cost,settings.config.timeoutMs,organizationId,day,id,admissionNonce)]);}catch(error){if(String(error).includes('task_route_changed'))throw destinationChanged();if(String(error).includes('speech_authority_changed'))throw new HttpError(403,'Seu acesso ou a configuração mudou.','speech_forbidden');const recovered=await replay();if(recovered)return recovered;throw error;}
 const admitted=await one(db,'SELECT admission_nonce FROM ai_transcriptions WHERE id=?',[id]);
 if(admitted&&admitted.admission_nonce!==admissionNonce){const recovered=await replay();if(recovered)return recovered;throw new HttpError(409,'Este envio já está em processamento.','speech_replay');}
 if(!admitted)throw await quotaRefusal(db,current,organizationId,day,settings.config,{cost,tokens:0,ms:settings.config.timeoutMs,calls:1});
 const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,settings.config.timeoutMs);options.signal?.addEventListener('abort',abort,{once:true});
 try{
  await speechActor(db,current,input.projectId);const fresh=await loadSpeechSettings(db,secret,organizationId,options.environment,options.keys,current.userId);if(fresh.revision!==settings.revision)throw new HttpError(409,settings.config.speechModel?'A configuração de voz mudou durante o envio. Nada foi enviado. Envie de novo.':'A configuração mudou antes da transcrição.','speech_configuration_changed');
  if(speechRoute&&'skip' in speechRoute)await recordRouteFallback(db,organizationId,current.userId,'speech',settings.config.speechModel,speechRoute.skip);
  await authorized(true);if(controller.signal.aborted)throw new HttpError(503,'A transcrição excedeu o tempo reservado.','speech_provider');
  const response=await providerSpeech(style,input.bytes,apiKey,controller.signal,options.fetcher??fetch,target);
  if(JSON.stringify(response).includes(apiKey))throw new HttpError(502,'O provedor retornou dados que não podem ser apresentados.','speech_schema');
  const { transcript, returnedVersion } = validatedTranscript(response, style, audio.duration);
  const result={transcript,provenance:{provider:destination,model,credentialSource:routed?'vault':settings.credentialSource,returnedVersion,organizationId,projectId:input.projectId,audioSha256,duration:audio.duration,at:new Date(now).toISOString()}};
  await speechActor(db,current,input.projectId);if((await loadSpeechSettings(db,secret,organizationId,options.environment,options.keys,current.userId)).revision!==settings.revision)throw new HttpError(409,'A configuração mudou. A transcrição não será apresentada.','speech_configuration_changed');
  const ciphertext=await encryptCredentials(secret,result,`speech:${organizationId}:${id}`);await db.batch([assertion,db.prepare("UPDATE ai_transcriptions SET status='complete',result_ciphertext=? WHERE id=? AND status='reserved'").bind(ciphertext,id),db.prepare("INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,?,?,'assistant.transcribe',?,?,? WHERE changes()=1").bind(crypto.randomUUID(),current.userId,input.projectId,organizationId,id,JSON.stringify({duration:audio.duration,provider:destination,model,audioSha256,reservedUsdMicros:cost}),new Date(now).toISOString())]);await authorized();return result;
 }catch(error){await db.prepare("UPDATE ai_transcriptions SET status='failed' WHERE id=? AND status='reserved'").bind(id).run();if(error instanceof HttpError)throw error;if(String(error).includes('task_route_changed'))throw destinationChanged();if(String(error).includes('speech_authority_changed'))throw new HttpError(403,'Seu acesso ou a configuração mudou.','speech_forbidden');throw new HttpError(502,'A resposta de transcrição não pôde ser validada.','speech_schema');}finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
