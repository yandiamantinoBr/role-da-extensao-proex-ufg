import { type PortalActor } from '../access';
import { one, uid, type Row } from '../database';
import { digest, type CredentialKeys } from '../assistant/crypto';
import { PROVIDERS, safeRequest } from '../assistant/contracts';
import { containsCredential } from '../assistant/sensitive';
import { assistantUsageSql, loadAssistantSettings } from '../assistant/settings';
import { reservationStatements } from '../assistant/admission';
import { classifyTaskTriage, taskTriageBody } from '../assistant/provider';
import { decisionCeiling, decisionTarget, recordRouteFallback, requireTaskEndpoint, resolveTaskRoute, taskApproval, taskRouteGuards, taskRouteName, withTaskRoute, type ResolvedTaskRoute } from '../assistant/task-routing';
import { TASK_PRIORITIES, choices, fail, id, onlyKeys, text, version } from './contracts';
import { atomic, authority, type Scope } from './scope';
import { serverWorkClock } from './time';
import { followupDetail, saveTaskTriage } from './service';
import { TRIAGE_CONTEXT_LIMIT, TRIAGE_INPUT_LIMIT, type TriageProposal, type TriageResponse } from './triage-contract';

const configEnabled = "json_extract(s.config_json,'$.jevEnabled')=1";
const activeTask = "t.status IN ('open','in_progress','blocked')";
const stale = () => fail('A demanda ou a configuração mudou. Abra a versão atual para preparar outra triagem.', 'triage_stale', 409);
const sensitiveSummary = [
 /\b[a-z][a-z\d+.-]{1,15}:\/\/|\bwww\.|\b(?:[a-z\d][a-z\d-]*\.)+(?:br|com|org|net|edu|gov|io|app|test|invalid)\b/iu,
 /(?<![\p{L}\d])(?:\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s-]?\d{2}|\d{2}[\s.]?\d{3}[\s.]?\d{3}[\s/]?\d{4}[\s-]?\d{2})(?![\p{L}\d])/u,
 /(?<![\p{L}\d])(?:\+?55[\s.-]*)?(?:\(\d{2}\)|\d{2})[\s.-]*(?:9[\s.-]*)?\d{4}[\s.-]*\d{4}(?![\p{L}\d])/u,
 /-----BEGIN |\b(?:pne_|pxs_)[A-Za-z0-9_-]{12,}|\[(?:e-mail|documento) omitido\]/iu,
];

/**
 * Reserva máxima de uma análise, em micros de dólar. A tela mostra este número e o servidor reserva este mesmo número.
 * Com modelo escolhido vale o maior preço entre ele e o padrão (o pedido pode terminar em qualquer um); sem rota, o padrão de sempre.
 */
export function triageReserveMicros(decisionRoute:ResolvedTaskRoute=null) {
 return Math.ceil(TRIAGE_INPUT_LIMIT*(decisionCeiling(decisionRoute)?.decisionInputMicrosPerToken ?? PROVIDERS.typesafe.inputMicrosPerToken));
}

export async function taskTriageAvailable(db:D1Database, actor:PortalActor, taskId:unknown):Promise<boolean> {
 const task = await getTask(db,actor,id(taskId)!);
 const usage = assistantUsageSql(actor.userId);
 return Boolean(!['completed','cancelled'].includes(task.status) &&
  await one(db, `SELECT 1 FROM ai_organization_settings s WHERE s.organization_id=? AND ${configEnabled} AND ${usage.sql}`, [task.organization_id,...usage.values]));
}

/**
 * Estado que a tela consulta antes de abrir a triagem. Sem modelo de decisão escolhido devolve só `enabled`, como sempre,
 * e não lê chave nem catálogo. Com modelo escolhido e apto a responder, devolve também a reserva máxima que o servidor fará
 * e o nome do modelo que recebe o resumo, para o aviso e a autorização nomearem o destino real.
 */
export async function taskTriageState(db:D1Database, actor:PortalActor, taskId:unknown, secret:string, keys?:CredentialKeys):Promise<{enabled:boolean;reserveUsdMicros?:number;destinationName?:string;approval?:string}> {
 if (!await taskTriageAvailable(db,actor,taskId)) return {enabled:false};
 try {
  const task = await getTask(db,actor,id(taskId)!);
  if (!await one(db, "SELECT 1 FROM ai_organization_settings WHERE organization_id=? AND COALESCE(json_extract(config_json,'$.decisionModel'),'')<>''", [task.organization_id])) return {enabled:true};
  const {config, rawCredentials, revision} = await loadAssistantSettings(db,secret,task.organization_id,'triage',keys,actor.userId);
  const decisionRoute = config.decisionModel ? await resolveTaskRoute(db,task.organization_id,config,rawCredentials,'decision') : null;
  const destinationName = taskRouteName(decisionRoute);
  return destinationName ? {enabled:true,reserveUsdMicros:triageReserveMicros(decisionRoute),destinationName,approval:await taskApproval(task.organization_id,revision,'triage',[decisionRoute])} : {enabled:true};
 } catch { return {enabled:true}; } // sem o teto, a tela mostra o número do padrão; o envio continua validando tudo de novo
}

async function getTask(db:D1Database, actor:PortalActor, taskId:string) {
 const task = await one(db, `SELECT t.id,t.organization_id,t.project_id,t.version,t.status,t.due_at
  FROM followup_tasks t WHERE t.id=? AND ${authority('?','t.organization_id','t.project_id',true)}`, [taskId,actor.userId]);
 if (!task) fail('Demanda não encontrada neste contexto ou seu acesso mudou.', 'triage_forbidden', 404);
 return task!;
}
const scopeOf = (task:Row):Scope => ({organizationId:task.organization_id,projectId:task.project_id});
function guard(db:D1Database, actor:PortalActor, task:Row, revision:number) {
 const usage = assistantUsageSql(actor.userId);
 return db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM followup_tasks t
  JOIN ai_organization_settings s ON s.organization_id=t.organization_id WHERE t.id=? AND t.version=? AND t.organization_id=?
  AND s.revision=? AND ${configEnabled} AND ${activeTask} AND ${usage.sql}
  AND ${authority('?','t.organization_id','t.project_id',true)})
  THEN 1 ELSE json_extract('[]','triage_authority_or_version_changed') END`)
  .bind(task.id,task.version,task.organization_id,revision,...usage.values,actor.userId);
}
function guardError(error:unknown):never {
 if (String(error).includes('triage_authority_or_version_changed')) return stale();
 throw error;
}

export async function prepareTaskTriage(db:D1Database, actor:PortalActor, input:Record<string,unknown>, secret:string,
  options:{now?:number;fetcher?:typeof fetch;keys?:CredentialKeys}={}):Promise<TriageResponse> {
 onlyKeys(input,['id','expectedVersion','operationKey','context','consent','destinationName','approval']);
 if (input.consent!==true) fail('Confirme o envio do resumo operacional ao provedor.', 'triage_consent');
 if (typeof input.operationKey!=='string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.operationKey)) fail('Abra a triagem novamente.', 'triage_operation');
 const rawContext = text(input.context,TRIAGE_CONTEXT_LIMIT);
 if (containsCredential(rawContext)) {
  fail('Retire senhas, tokens e chaves do resumo operacional antes de enviar.', 'triage_sensitive');
 }
 const context = safeRequest(rawContext);
 if (sensitiveSummary.some(pattern => pattern.test(context))) {
  fail('Retire links, contatos e documentos do resumo operacional antes de enviar.', 'triage_sensitive');
 }
 const task = await getTask(db,actor,id(input.id)!);
 if (task.version!==version(input.expectedVersion) || ['completed','cancelled'].includes(task.status)) return stale();
 const {config, credentials, rawCredentials, revision} = await loadAssistantSettings(db,secret,task.organization_id,'triage',options.keys,actor.userId);
 const now = options.now ?? Date.now(), {asOf:createdAt,today:day} = serverWorkClock(now);
 const proposalId = await digest(JSON.stringify(['triage',actor.userId,task.id,input.operationKey]));
 const authorization = guard(db,actor,task,revision);
 const body = taskTriageBody(config,context,task.due_at,day);
 if (new TextEncoder().encode(JSON.stringify(body)).byteLength>TRIAGE_INPUT_LIMIT) fail('Resuma o contexto antes de enviar.', 'triage_context_limit');
 // Triagem roteada: só existe com decisionModel escolhido. Vazio = null = exatamente o caminho de sempre.
 const decisionRoute = config.decisionModel ? await resolveTaskRoute(db,task.organization_id,config,rawCredentials,'decision') : null;
 const destinationName = taskRouteName(decisionRoute), shownDestination = typeof input.destinationName==='string' ? input.destinationName : '';
 const approval=destinationName?await taskApproval(task.organization_id,revision,'triage',[decisionRoute]):undefined;
 const destinationChanged=()=>fail('O modelo ou o custo desta triagem mudou. Confira o aviso e autorize de novo.','triage_destination',409);
 if ((destinationName??'')!==shownDestination || approval!==input.approval) return destinationChanged();
 requireTaskEndpoint(decisionRoute, 'decision', options.fetcher);
 const fingerprint = await digest(JSON.stringify(approval?[task.id,task.version,revision,context,approval]:[task.id,task.version,revision,context]));
 const routeGuards=taskRouteGuards(db,task.organization_id,[decisionRoute]);
 async function dispatchFence(){if(routeGuards.length)await db.batch([...routeGuards,authorization]);else await authorization.first();}
 const routedBody = decisionRoute && !('skip' in decisionRoute) ? taskTriageBody(config,context,task.due_at,day,decisionRoute.model.model) : null;
 if (routedBody && new TextEncoder().encode(JSON.stringify(routedBody)).byteLength>TRIAGE_INPUT_LIMIT) fail('Resuma o contexto antes de enviar.', 'triage_context_limit');
 // Com rota, reserva o maior preço entre o escolhido e o padrão (o pedido pode terminar em qualquer um).
 const reservedUsdMicros = triageReserveMicros(decisionRoute);
 async function replay():Promise<TriageResponse|null> {
  const call=await one(db,'SELECT status,proposal_json,fingerprint,expires_at FROM ai_task_triage_calls WHERE id=?',[proposalId]);
  if (!call) return null;
  if (call.fingerprint!==fingerprint || call.expires_at<=now) return stale();
  try { await authorization.first(); } catch (error) { guardError(error); }
  if (call.status==='ready') return {status:'ready',proposalId,proposal:JSON.parse(call.proposal_json) as TriageProposal};
  if (call.status==='abstained') return {status:'abstained'};
  return fail('Esta análise já foi processada ou está em andamento. Inicie outra apenas se necessário.', 'triage_replay',409);
 }
 const previous=await replay(); if(previous)return previous;
 const nonce=uid();
 try {
  await db.batch(reservationStatements(db,{
   table:'ai_task_triage_calls', authorization,routeGuards,id:proposalId,fingerprint,nonce,actorId:actor.userId,
   projectId:task.project_id,organizationId:task.organization_id,day,createdAt,revision,config,
   reservation:{tokens:TRIAGE_INPUT_LIMIT,cost:reservedUsdMicros,calls:1,milliseconds:config.timeoutMs},
   triage:{taskId:task.id,taskVersion:task.version,expiresAt:now+10*60000},
  }));
 } catch(error) { if(String(error).includes('task_route_changed'))return destinationChanged();const duplicate=await replay(); if(duplicate)return duplicate; guardError(error); }
 const claim=await one(db,'SELECT admission_nonce FROM ai_task_triage_calls WHERE id=?',[proposalId]);
 if(claim?.admission_nonce!==nonce) return (await replay()) ?? fail('O limite diário da organização foi atingido. Use a classificação manual.', 'triage_budget',429);

 const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),config.timeoutMs);
 let measured:number|null=null;
 try {
  await dispatchFence();
  if(controller.signal.aborted) fail('A triagem excedeu o tempo reservado.','triage_timeout',503);
  // Com rota: uma chamada ao escolhido; o padrão só entra se o escolhido estava indisponível antes do envio.
  const routed=decisionRoute?await withTaskRoute(decisionRoute,{
   chosen:route=>classifyTaskTriage(config,credentials,routedBody!,controller.signal,options.fetcher,decisionTarget(route)),
   fallback:()=>classifyTaskTriage(config,credentials,body,controller.signal,options.fetcher),
   onFallback:async reason=>{
    await recordRouteFallback(db,task.organization_id,actor.userId,'decision',config.decisionModel,reason);
    await authorization.first();
    if(controller.signal.aborted) fail('A triagem excedeu o tempo reservado.','triage_timeout',503);
   },
  }):null;
  const result=routed?routed.result:await classifyTaskTriage(config,credentials,body,controller.signal,options.fetcher);
  const answeredModel=routed?.route?routed.route.model.model:config.jevModel;
  measured=result.inputTokens;
  if(measured>TRIAGE_INPUT_LIMIT) fail('O provedor informou uso acima da reserva. A proposta foi descartada.', 'triage_usage',502);
  const status=result.proposal?'ready':'abstained';
  await db.batch([authorization,
   db.prepare('UPDATE ai_task_triage_calls SET status=?, input_tokens=?, proposal_json=? WHERE id=? AND admission_nonce=?')
    .bind(status,measured,result.proposal?JSON.stringify(result.proposal):null,proposalId,nonce),
    // Só quando o modelo do catálogo respondeu: a linha passa a nomear quem de fato classificou.
    ...(routed?.route?[db.prepare('UPDATE ai_task_triage_calls SET model=? WHERE id=? AND admission_nonce=?').bind(answeredModel,proposalId,nonce)]:[]),
   db.prepare(`INSERT INTO audit(id,actor_id,organization_id,project_id,action,entity_id,details,created_at)
    VALUES(?,?,?,?,'task.triage.prepare',?,?,?)`)
    .bind(uid(),actor.userId,task.organization_id,task.project_id,task.id,JSON.stringify({model:answeredModel,status,inputTokens:measured,reservedUsdMicros,proposalId}),createdAt),
  ]);
  await authorization.first();
  return result.proposal?{status:'ready',proposalId,proposal:result.proposal}:{status:'abstained'};
 } catch(error) {
  await db.prepare("UPDATE ai_task_triage_calls SET status='failed',input_tokens=?,proposal_json=NULL WHERE id=? AND admission_nonce=? AND status='reserved'")
   .bind(measured,proposalId,nonce).run();
  if(String(error).includes('task_route_changed'))return destinationChanged();
  return guardError(error);
 } finally {clearTimeout(timer);}
}

export async function applyTaskTriage(db:D1Database, actor:PortalActor, input:Record<string,unknown>, now=Date.now()) {
 onlyKeys(input,['action','id','expectedVersion','proposalId','confirmed']);
 if (input.confirmed!==true) fail('Revise e confirme a classificação sugerida.', 'triage_confirmation');
 if (typeof input.proposalId!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(input.proposalId)) return stale();
 const task=await getTask(db,actor,id(input.id)!);
 const call=await one(db,'SELECT * FROM ai_task_triage_calls WHERE id=? AND actor_id=? AND organization_id=? AND task_id=?',
  [input.proposalId,actor.userId,task.organization_id,task.id]);
 if (!call || call.expires_at<=now || call.task_version!==version(input.expectedVersion)) return stale();
 const authorization=guard(db,actor,task,call.config_revision);
 if (call.status==='applied' && task.version===call.task_version+1) {
  try { await authorization.first(); } catch(error) { guardError(error); }
  return followupDetail(db,actor,task.id);
 }
 if (call.status!=='ready' || task.version!==call.task_version || !call.proposal_json) return stale();
 const proposal=JSON.parse(call.proposal_json) as TriageProposal;
 const priority=choices(proposal.urgency,TASK_PRIORITIES), importance=choices(proposal.importance,TASK_PRIORITIES);
 const at=new Date(now).toISOString(), scope=scopeOf(task);
 try {
  await atomic(db,actor,scope,[authorization,
   db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ai_task_triage_calls WHERE id=? AND status='ready' AND expires_at>?)
    THEN 1 ELSE json_extract('[]','triage_authority_or_version_changed') END`).bind(call.id,now),
   ...saveTaskTriage(db,actor,scope,task.id,{priority,importance,version:task.version,proposalId:call.id,model:call.model},at),
   db.prepare("UPDATE ai_task_triage_calls SET status='applied' WHERE id=?").bind(call.id),
  ]);
 } catch(error) { return guardError(error); }
 return followupDetail(db,actor,task.id);
}
