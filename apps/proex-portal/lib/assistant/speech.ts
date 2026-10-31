import { getActor, requireLiveCapability, projectAuthoritySql, type PortalActor } from '../access';
import { one } from '../database';
import { HttpError } from '../errors';
import { object, safeRequest } from './contracts';
import { decryptCredentials, digest, encryptCredentials } from './crypto';
import { loadAssistantSettings } from './settings';

export const SPEECH_ENDPOINT = 'https://api.deepgram.com/v1/listen?model=nova-3&language=pt-BR&mip_opt_out=true';
export function speechEndpoint(value: unknown = SPEECH_ENDPOINT): string { if (value !== SPEECH_ENDPOINT) throw new HttpError(400, 'Use apenas o endpoint oficial de transcrição autorizado.', 'speech_endpoint'); return SPEECH_ENDPOINT; }
import { validateSpeechAudio } from './audio';
export { validateSpeechAudio } from './audio';
export async function speechActor(db: D1Database, actor: PortalActor | null, projectId: string) {
 const current = actor && await getActor(db,actor); if (!current) throw new HttpError(403,'Entre novamente para transcrever.','speech_forbidden');
 await requireLiveCapability(db,current,'inventory.read',projectId);
 const project = await one(db,"SELECT p.organization_id FROM projects p JOIN organizations o ON o.id=p.organization_id AND o.status='active' WHERE p.id=?",[projectId]);
 if (!project) throw new HttpError(403,'O projeto ou sua organização está indisponível.','speech_forbidden'); return { current, organizationId: String(project.organization_id) };
}
async function providerSpeech(bytes: Uint8Array, apiKey: string, signal: AbortSignal, fetcher: typeof fetch) {
 try {
  const response = await fetcher(speechEndpoint(), { method:'POST', redirect:'error', cache:'no-store', signal, headers:{Authorization:`Token ${apiKey}`,'Content-Type':'audio/wav'}, body: new Uint8Array(bytes).buffer });
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new HttpError(503,'O provedor não transcreveu o áudio. A reserva permanece na cota.','speech_provider');
  const reader = response.body?.getReader(); if (!reader) throw new Error('empty'); const chunks: Uint8Array[]=[]; let size=0;
  try { for (;;) { const {value,done}=await reader.read(); if(done) break; size+=value.length; if(size>256*1024) throw new Error('limit'); chunks.push(value); } } finally { await reader.cancel().catch(()=>{}); }
  const body=new Uint8Array(size); let offset=0; for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;} return object(JSON.parse(new TextDecoder().decode(body)));
 } catch(error) { if(error instanceof HttpError) throw error; throw new HttpError(503,'A transcrição falhou ou demorou demais. O áudio continua disponível para revisão; não houve retry pago automático.','speech_provider'); }
}
export async function transcribeSpeech(db:D1Database, actor:PortalActor|null, input:{projectId:string;operationKey:string;consent:boolean;mime:string;bytes:Uint8Array},secret:string,options:{fetcher?:typeof fetch;signal?:AbortSignal;now?:number}={}) {
 if(!input.consent)throw new HttpError(400,'Autorize o envio deste áudio ao provedor configurado.','speech_consent');
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input.projectId)||!/^[A-Za-z0-9_-]{8,100}$/.test(input.operationKey))throw new HttpError(400,'Escolha o projeto e prepare um envio válido.','speech_input');
 const {current,organizationId}=await speechActor(db,actor,input.projectId), audio=validateSpeechAudio(input.bytes,input.mime), settings=await loadAssistantSettings(db,secret,organizationId,true),now=options.now??Date.now();
 await db.prepare("UPDATE ai_transcriptions SET result_ciphertext=NULL WHERE organization_id=? AND status='complete' AND created_at<? AND result_ciphertext IS NOT NULL").bind(organizationId,new Date(now-3600000).toISOString()).run();
 const audioSha256=await digest(input.bytes),id=await digest(`${current.userId}\n${input.projectId}\n${input.operationKey}`),fingerprint=await digest(`${audioSha256}:${settings.revision}`);
 async function replay(){const row=await one(db,'SELECT * FROM ai_transcriptions WHERE id=?',[id]);if(!row)return null;if(row.fingerprint!==fingerprint||row.actor_id!==current.userId||row.project_id!==input.projectId||row.organization_id!==organizationId)throw new HttpError(409,'Este envio já foi usado com outro áudio ou configuração.','speech_operation_changed');await speechActor(db,current,input.projectId);if(row.status==='complete'&&now-Date.parse(row.created_at)<3600000)return {...object(await decryptCredentials(secret,row.result_ciphertext,`speech:${organizationId}:${id}`)),replayed:true};throw new HttpError(409,'Este envio já foi processado ou falhou. Para uma nova tentativa paga, escolha explicitamente novo envio.','speech_replay');}
 const admissionNonce=crypto.randomUUID();
 const old=await replay();if(old)return old;if(options.signal?.aborted)throw new HttpError(499,'Envio cancelado antes da transcrição.','speech_aborted');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now)),cost=Math.ceil(audio.duration/60*30000),auth=projectAuthoritySql(current,['inventory.read'],'?');
 const assertion=db.prepare(`SELECT CASE WHEN ${auth.sql} AND EXISTS(SELECT 1 FROM ai_organization_settings s JOIN organizations o ON o.id=s.organization_id WHERE s.organization_id=? AND s.revision=? AND json_extract(s.config_json,'$.sttEnabled')=1 AND o.status='active') THEN 1 ELSE json_extract('[]','speech_authority_changed') END`).bind(...auth.values,input.projectId,organizationId,settings.revision);
 try{await db.batch([assertion,db.prepare('INSERT INTO ai_organization_usage(organization_id,day) VALUES(?,?) ON CONFLICT(organization_id,day) DO NOTHING').bind(organizationId,day),db.prepare(`INSERT INTO ai_transcriptions(id,fingerprint,admission_nonce,actor_id,project_id,organization_id,config_revision,status,created_at) SELECT ?,?,?,?,?,?,?,'reserved',? FROM ai_organization_usage WHERE organization_id=? AND day=? AND calls+1<=? AND reserved_usd_micros+?<=? AND reserved_ms+?<=?`).bind(id,fingerprint,admissionNonce,current.userId,input.projectId,organizationId,settings.revision,new Date(now).toISOString(),organizationId,day,settings.config.dailyCalls,cost,settings.config.dailyUsdMicros,settings.config.timeoutMs,settings.config.dailyMs),db.prepare('UPDATE ai_organization_usage SET calls=calls+1,reserved_usd_micros=reserved_usd_micros+?,reserved_ms=reserved_ms+? WHERE organization_id=? AND day=? AND EXISTS(SELECT 1 FROM ai_transcriptions WHERE id=? AND admission_nonce=?)').bind(cost,settings.config.timeoutMs,organizationId,day,id,admissionNonce)]);}catch(error){if(String(error).includes('speech_authority_changed'))throw new HttpError(403,'Seu acesso ou a configuração mudou.','speech_forbidden');const recovered=await replay();if(recovered)return recovered;throw error;}
 const admitted=await one(db,'SELECT admission_nonce FROM ai_transcriptions WHERE id=?',[id]);
 if(admitted&&admitted.admission_nonce!==admissionNonce){const recovered=await replay();if(recovered)return recovered;throw new HttpError(409,'Este envio já está em processamento.','speech_replay');}
 if(!admitted)throw new HttpError(429,'O limite diário da organização foi atingido.','assistant_quota');
 const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,settings.config.timeoutMs);options.signal?.addEventListener('abort',abort,{once:true});
 try{
  await speechActor(db,current,input.projectId);if((await loadAssistantSettings(db,secret,organizationId,true)).revision!==settings.revision)throw new HttpError(409,'A configuração mudou antes da transcrição.','speech_configuration_changed');if(options.signal?.aborted)controller.abort();
  const response=await providerSpeech(input.bytes,settings.credentials.deepgram!,controller.signal,options.fetcher??fetch);if(JSON.stringify(response).includes(settings.credentials.deepgram!))throw new HttpError(502,'O provedor retornou dados que não podem ser apresentados.','speech_schema');const metadata=object(response.metadata),channels=object(response.results).channels;
  if(!Array.isArray(channels)||channels.length!==1||!Array.isArray(object(channels[0]).alternatives))throw new Error('speech_schema');
  const alternative=object((object(channels[0]).alternatives as unknown[])[0]),modelInfo=object(metadata.model_info),model=object(Object.values(modelInfo)[0]);
  if(typeof alternative.transcript!=='string'||!alternative.transcript.trim()||alternative.transcript.length>4000||typeof metadata.duration!=='number'||Math.abs(metadata.duration-audio.duration)>.25||!String(model.arch).startsWith('nova-3')||typeof model.version!=='string'||!/^[A-Za-z0-9._:-]{1,100}$/.test(model.version))throw new HttpError(502,'O provedor não retornou uma transcrição verificável.','speech_schema');
  const result={transcript:safeRequest(alternative.transcript),provenance:{provider:'deepgram',model:'nova-3',returnedVersion:model.version,organizationId,projectId:input.projectId,audioSha256,duration:audio.duration,at:new Date(now).toISOString()}};
  await speechActor(db,current,input.projectId);if((await loadAssistantSettings(db,secret,organizationId,true)).revision!==settings.revision)throw new HttpError(409,'A configuração mudou. A transcrição não será apresentada.','speech_configuration_changed');
  const ciphertext=await encryptCredentials(secret,result,`speech:${organizationId}:${id}`);await db.batch([assertion,db.prepare("UPDATE ai_transcriptions SET status='complete',result_ciphertext=? WHERE id=? AND status='reserved'").bind(ciphertext,id),db.prepare("INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,?,?,'assistant.transcribe',?,?,? WHERE changes()=1").bind(crypto.randomUUID(),current.userId,input.projectId,organizationId,id,JSON.stringify({duration:audio.duration,model:'nova-3',audioSha256,reservedUsdMicros:cost}),new Date(now).toISOString())]);return result;
 }catch(error){await db.prepare("UPDATE ai_transcriptions SET status='failed' WHERE id=? AND status='reserved'").bind(id).run();if(error instanceof HttpError)throw error;throw new HttpError(502,'A resposta de transcrição não pôde ser validada.','speech_schema');}finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
