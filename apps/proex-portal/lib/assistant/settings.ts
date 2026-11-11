import { aiConfigurationAuthority, getActor, organizationAuthoritySql, platformOwnerAuthoritySql, type PortalActor } from '../access';
import { all, one } from '../database';
import { HttpError } from '../errors';
import { availableProviderCredentials, dailyLimits, newAssistantConfig, object, onlyKeys, storedConfigJson, TASK_MODEL_KEYS, TEST_MODE_LIMITS, validateConfig, type AssistantConfig, type DailyLimits } from './contracts';
import { configChanges } from './quota';
import { decryptProviderCredentials, encryptProviderCredentials, type CredentialKeys } from './crypto';
import { catalogModelName, fitsFunction, fitsTask, type RoutedTask } from './model-catalog';
import { loadCatalog } from './model-catalog-store';
import { TASK_MODEL_KEY, resolveTaskRoute, speechDestination, speechRouteModel, taskRouteName } from './task-routing';
import type { SpeechRouteModel } from './role-contracts';

export type SpeechProvider = 'deepgram' | 'groq';
export type SpeechEnvironment = { provider?: string; organizationId?: string; groqKey?: string };

export function speechProviderForOrganization(organizationId: string, environment?: SpeechEnvironment, selection: AssistantConfig['sttProvider'] = 'legacy'): SpeechProvider {
 if(selection==='groq'||selection==='deepgram')return selection;
 return environment?.provider === 'groq' && environment.organizationId === organizationId ? 'groq' : 'deepgram';
}
export function validProviderKey(value: unknown): value is string {
 return typeof value === 'string' && value.length >= 12 && value.length <= 512 && !/\s|[\u0000-\u001f]/u.test(value);
}
export function groqSpeechKey(environment?: SpeechEnvironment): string {
 const key = environment?.groqKey;
 if (!validProviderKey(key)) throw new HttpError(503, 'A transcrição Groq desta organização está sem credencial no servidor.', 'assistant_unavailable');
 return key;
}

const ACTIVE = "COALESCE(u.status,'active')='active' AND COALESCE(u.activation_pending,0)=0 AND u.anonymized_at IS NULL";
export { aiConfigurationAuthority } from '../access';
/** A configuration grant permits administration; it never bypasses use policy.
 * The alias is a server-owned SQL identifier and actorId is always bound. */
export function assistantUsageSql(actorId: string, alias = 's') {
 if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid settings alias');
 const scope = `json_extract(${alias}.config_json,'$.usageScope')`, user = `json_extract(${alias}.config_json,'$.usageUserId')`;
 return { sql: `(((json_type(${alias}.config_json,'$.usageScope') IS NULL OR ${scope}='organization') AND (json_type(${alias}.config_json,'$.usageUserId') IS NULL OR json_type(${alias}.config_json,'$.usageUserId')='null')) OR (${scope}='private' AND json_type(${alias}.config_json,'$.usageUserId')='text' AND ${user}=?))`, values: [actorId] };
}
function requireUsage(config: AssistantConfig, actorId: string | undefined) {
 if (config.usageScope === 'private' && config.usageUserId !== actorId) throw new HttpError(403, 'A IA desta organização está liberada somente para quem configurou o uso pessoal.', 'assistant_usage_forbidden');
}
export async function configurationActor(db: D1Database, actor: PortalActor | null, organizationId: string, ownerOnly = false) {
 const current = actor && await getActor(db, actor); if (!current) throw new HttpError(403, 'Seu acesso mudou. Entre novamente.', 'assistant_forbidden');
 const auth = ownerOnly ? organizationAuthoritySql(current, organizationId) : aiConfigurationAuthority(current, organizationId);
 if (!await one(db, `SELECT id FROM organizations WHERE id=? AND status='active' AND ${auth.sql}`, [organizationId, ...auth.values])) throw new HttpError(403, 'Seu acesso à configuração desta organização mudou.', 'assistant_configuration_forbidden');
 return { current, auth };
}
export async function loadAssistantSettings(db: D1Database, secret: string, organizationId: string, mode: boolean | SpeechProvider | 'triage' | 'document' | 'configuration' = false, keys?: CredentialKeys, actorId?: string) {
 const row = await one(db, "SELECT s.* FROM ai_organization_settings s JOIN organizations o ON o.id=s.organization_id AND o.status='active' WHERE s.organization_id=?", [organizationId]);
 if (!row) throw new HttpError(503, 'Esta organização ainda não configurou o assistente.', 'assistant_unavailable');
 const config = validateConfig(JSON.parse(row.config_json));
 const runtime = mode !== 'configuration' || actorId !== undefined;
 if (runtime) requireUsage(config, actorId);
 const rawCredentials = object(await decryptProviderCredentials(secret, row.credentials_ciphertext, organizationId, keys));
 const credentials = availableProviderCredentials(rawCredentials);
 if (runtime) {
  // Decryption yields control. Recheck the live policy and revision afterwards,
  // even when a caller still holds a valid organization configuration grant.
  const usage = assistantUsageSql(actorId ?? '');
  if (!await one(db, `SELECT 1 FROM ai_organization_settings s JOIN organizations o ON o.id=s.organization_id WHERE s.organization_id=? AND s.revision=? AND o.status='active' AND ${usage.sql}`, [organizationId, row.revision, ...usage.values])) throw new HttpError(403, 'Seu acesso de uso ou a configuração de IA mudou.', 'assistant_usage_forbidden');
 }
 if(mode==='configuration'){ /* Private loader for explicit speech routing below. No feature is enabled here. */ }
 else if (mode === 'triage') {
  if (!config.jevEnabled || !credentials.typesafe) throw new HttpError(503, 'A triagem com JEV está indisponível nesta organização. Você pode classificar a demanda manualmente.', 'triage_disabled');
 } else if (mode==='document' ? !config.documentEnabled || !credentials[config.textProvider] || config.jevEnabled && !credentials.typesafe : mode ? !config.sttEnabled || (mode !== 'groq' && !credentials.deepgram) || (mode === 'groq' && config.sttProvider==='groq' && !credentials.groq) : !config.enabled || !credentials[config.textProvider] || config.jevEnabled && !credentials.typesafe) {
  throw new HttpError(503, mode==='document'?'A interpretação documental desta organização está desativada ou sem credencial.':mode ? 'A transcrição desta organização está desativada ou sem credencial.' : 'O assistente desta organização está desativado ou sem credencial.', mode==='document'?'document_ai_unavailable':'assistant_unavailable');
 }
 return { config, credentials, rawCredentials, revision: Number(row.revision) };
}
/** Explicit Groq selection never falls back to an environment key. Legacy routes
 * retain the already-authorized pilot organization until deliberately changed. */
export async function loadSpeechSettings(db:D1Database,secret:string,organizationId:string,environment?:SpeechEnvironment,keys?:CredentialKeys,actorId?:string){
 const settings=await loadAssistantSettings(db,secret,organizationId,'configuration',keys,actorId??'');
 const provider=speechProviderForOrganization(organizationId,environment,settings.config.sttProvider);
 const credentialSource=provider==='groq'&&settings.config.sttProvider==='legacy'?'environment':'vault';
 const apiKey=provider==='groq'?(credentialSource==='environment'?groqSpeechKey(environment):settings.credentials.groq):settings.credentials.deepgram;
 if(!settings.config.sttEnabled||!validProviderKey(apiKey))throw new HttpError(503,'A transcrição desta organização está desativada ou sem credencial.','assistant_unavailable');
 return {...settings,provider,credentialSource,apiKey};
}
function id(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new HttpError(400, 'Escolha uma organização válida.', 'assistant_organization'); return value; }
function key(value: unknown): string { if (!validProviderKey(value)) throw new HttpError(400, 'Informe uma chave válida no campo do provedor.', 'assistant_credentials'); return value; }
/**
 * Modo de testes decidido no servidor: ligar guarda os limites atuais e aplica limites altos;
 * desligar devolve os limites guardados. O navegador não consegue forjar os limites guardados.
 */
export function withTestMode(previous: AssistantConfig, next: AssistantConfig): AssistantConfig {
 if (next.testMode && !previous.testMode) { const high = Object.fromEntries(Object.entries(TEST_MODE_LIMITS).map(([key, value]) => [key, Math.max(value, next[key as keyof DailyLimits])])) as DailyLimits; return { ...next, ...high, testModeRestore: dailyLimits(previous) }; }
 if (!next.testMode && previous.testMode) return { ...next, ...(previous.testModeRestore ?? dailyLimits(next)), testModeRestore: null };
 return { ...next, testModeRestore: next.testMode ? previous.testModeRestore : null };
}
export async function configureAssistant(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, secret: string, speechEnvironment?: SpeechEnvironment, keys?: CredentialKeys) {
 onlyKeys(input, ['action','organizationId','config','deepseekKey','typesafeKey','deepgramKey','expectedRevision','replaceCredentials']);
 const organizationId = id(input.organizationId), { current, auth } = await configurationActor(db, actor, organizationId);
 const writesKeys = input.replaceCredentials === true || input.deepseekKey || input.typesafeKey || input.deepgramKey;
 if ((keys?.current || keys?.previous) && writesKeys) throw new HttpError(403, 'Use Chaves e modelos em Configurações para cadastrar ou trocar credenciais.', 'assistant_key_admin');
 const old = await one(db, 'SELECT revision,config_json,credentials_ciphertext FROM ai_organization_settings WHERE organization_id=?', [organizationId]);
 if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (old?.revision ?? 0)) throw new HttpError(409, 'A configuração mudou. Atualize antes de salvar.', 'assistant_configuration_changed');
 const proposed = object(input.config), previousConfig = old ? validateConfig(JSON.parse(old.config_json)) : newAssistantConfig(current.userId);
 const usageScope = Object.hasOwn(proposed,'usageScope') ? proposed.usageScope : previousConfig.usageScope;
 // Modelo por tarefa que não veio no pedido fica como estava: uma tela que ainda não conhece essas chaves não desfaz a escolha.
 const keptTaskModels = Object.fromEntries(TASK_MODEL_KEYS.filter(taskKey => !Object.hasOwn(proposed, taskKey)).map(taskKey => [taskKey, previousConfig[taskKey]]));
 const config = withTestMode(previousConfig, validateConfig({ ...proposed, ...keptTaskModels, usageScope, usageUserId: usageScope === 'private' ? current.userId : null }));
 const previous = old && input.replaceCredentials !== true ? object(await decryptProviderCredentials(secret, old.credentials_ciphertext, organizationId, keys)) : {};
 const credentials = availableProviderCredentials(previous);
 const catalogKeys = Object.fromEntries(Object.entries(previous).filter(([name]) => /^p:[a-z0-9-]+$/.test(name)));
 if (input.deepseekKey) credentials.deepseek = key(input.deepseekKey);
 if (input.typesafeKey) credentials.typesafe = key(input.typesafeKey);
 if (input.deepgramKey) credentials.deepgram = key(input.deepgramKey);
 const speechProvider = speechProviderForOrganization(organizationId, speechEnvironment, config.sttProvider);
 if (config.sttEnabled && speechProvider === 'groq') {
  if(config.sttProvider==='legacy')groqSpeechKey(speechEnvironment);
  else if(!validProviderKey(credentials.groq))throw new HttpError(400,'Cadastre a chave Groq desta organização no cofre antes de habilitar a transcrição.','assistant_credentials');
 }

 // Catalog-backed Rolê: the chosen models must exist, fit the function and have a key.
 const catalog = config.roleModel || config.roleVisionModel ? (await loadCatalog(db, organizationId)).catalog : null;
 const catalogKey = (modelId: string, need: 'chat' | 'vision') => {
  const model = catalog?.models.find(entry => entry.id === modelId && entry.enabled), provider = catalog?.providers.find(entry => entry.id === model?.providerId);
  if (!model || fitsFunction(model, provider, need)) throw new HttpError(400, need === 'vision' ? 'Escolha para fotos um modelo do catálogo marcado com Foto.' : 'Escolha para a conversa um modelo do catálogo marcado com Texto.', 'assistant_model');
  return validProviderKey(previous[provider!.keyRef]);
 };
 if (config.roleModel !== previousConfig.roleModel || config.roleVisionModel !== previousConfig.roleVisionModel) {
  const owner = platformOwnerAuthoritySql(current);
  if (!await one(db, `SELECT 1 WHERE ${owner.sql}`, owner.values)) throw new HttpError(403, 'Só a administração geral escolhe modelos do catálogo para o Rolê.', 'catalog_admin');
 }
 // Modelo por tarefa (documentos, conferência/triagem, voz): só a administração geral troca. O escolhido precisa
 // existir, estar ligado, servir para a tarefa e ter chave salva. A chave do padrão segue obrigatória (abaixo): é a queda.
 const changedTasks = (Object.keys(TASK_MODEL_KEY) as RoutedTask[]).filter(task => config[TASK_MODEL_KEY[task]] !== previousConfig[TASK_MODEL_KEY[task]]);
 const changedModelNames: Record<string, string> = {};
 // Com troca de modelo por tarefa, a conferência de administração geral também entra na asserção atômica do salvamento (abaixo).
 const taskOwner = changedTasks.length ? platformOwnerAuthoritySql(current) : null;
 if (taskOwner) {
  const owner = taskOwner;
  if (!await one(db, `SELECT 1 WHERE ${owner.sql}`, owner.values)) throw new HttpError(403, 'Só a administração geral escolhe os modelos de documentos, conferência e voz.', 'catalog_admin');
  const chosenTasks = changedTasks.filter(task => config[TASK_MODEL_KEY[task]]);
  // O catálogo também dá os nomes que o histórico mostra (o modelo que saiu e o que entrou).
  const taskCatalog = catalog ?? (await loadCatalog(db, organizationId)).catalog;
  for (const task of changedTasks) for (const modelId of [previousConfig[TASK_MODEL_KEY[task]], config[TASK_MODEL_KEY[task]]]) { const name = modelId ? catalogModelName(taskCatalog, modelId) : null; if (name) changedModelNames[modelId] = name.slice(0, 120); }
  for (const task of chosenTasks) {
   const model = taskCatalog.models.find(entry => entry.id === config[TASK_MODEL_KEY[task]] && entry.enabled), provider = taskCatalog.providers.find(entry => entry.id === model?.providerId);
   if (!model) throw new HttpError(400, 'Escolha um modelo que exista e esteja ligado na aba Modelos.', 'assistant_model');
   const unfit = fitsTask(model, provider, task);
   if (unfit || !provider) throw new HttpError(400, unfit ?? 'Provedor removido.', 'assistant_model');
   if (!validProviderKey((credentials as Record<string, unknown>)[provider.keyRef] || previous[provider.keyRef])) throw new HttpError(400, 'Falta a chave do serviço deste modelo. Cole a chave na aba Chaves e escolha o modelo de novo.', 'assistant_credentials');
  }
 }
 const roleTextKey = config.roleModel ? catalogKey(config.roleModel, 'chat') : !!credentials[config.roleProvider];
 const roleVisionKey = config.roleVisionModel ? catalogKey(config.roleVisionModel, 'vision') : !!credentials.deepseek;
 if (config.roleEnabled && !roleTextKey || config.roleVisionEnabled && (!config.roleEnabled || !roleVisionKey) || (config.enabled || config.documentEnabled) && !credentials[config.textProvider] || config.jevEnabled && !credentials.typesafe || config.sttEnabled && speechProvider === 'deepgram' && !credentials.deepgram) throw new HttpError(400, 'Cadastre as credenciais dos provedores habilitados.', 'assistant_credentials');
 const credentialsChanged = !old || writesKeys;
 const ciphertext = old && !credentialsChanged ? old.credentials_ciphertext : await encryptProviderCredentials(secret, { ...catalogKeys, ...credentials }, organizationId, keys, old?.credentials_ciphertext);
 const revision = Number(input.expectedRevision) + 1, at = new Date().toISOString();
 const assertion = db.prepare(`SELECT CASE WHEN ${auth.sql}${taskOwner ? ` AND ${taskOwner.sql}` : ''} THEN 1 ELSE json_extract('[]','ai_configuration_revoked') END`).bind(...auth.values, ...(taskOwner?.values ?? []));
 const statement = old ? db.prepare('UPDATE ai_organization_settings SET revision=?,config_json=?,credentials_ciphertext=?,updated_by=?,updated_at=? WHERE organization_id=? AND revision=? AND credentials_ciphertext=?').bind(revision, storedConfigJson(config), ciphertext, current.userId, at, organizationId, input.expectedRevision, old.credentials_ciphertext) : db.prepare('INSERT INTO ai_organization_settings(organization_id,revision,config_json,credentials_ciphertext,updated_by,updated_at) VALUES(?,?,?,?,?,?)').bind(organizationId, revision, storedConfigJson(config), ciphertext, current.userId, at);
 try { const result = await db.batch([assertion, statement, db.prepare("INSERT INTO audit(id,actor_id,project_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,NULL,?,'assistant.configure',?,?,? WHERE changes()=1").bind(crypto.randomUUID(), current.userId, organizationId, organizationId, JSON.stringify({ revision, enabled: config.enabled, sttEnabled: config.sttEnabled, jevEnabled: config.jevEnabled, roleEnabled: config.roleEnabled, roleProvider: config.roleProvider, roleVisionEnabled: config.roleVisionEnabled, testMode: config.testMode, changes: configChanges(previousConfig, config), ...(Object.keys(changedModelNames).length ? { modelNames: changedModelNames } : {}) }), at)]); if (result[1].meta.changes !== 1) throw new HttpError(409, 'A configuração mudou. Atualize a página.', 'assistant_configuration_changed'); }
 catch (error) { if (String(error).includes('ai_configuration_revoked')) throw new HttpError(403, 'A autorização de configuração foi revogada.', 'assistant_configuration_forbidden'); throw error; }
 return { ok: true, revision };
}
export async function assistantStatus(db: D1Database, actor: PortalActor | null, secret: string, selectedId?: string, speechEnvironment?: SpeechEnvironment, keys?: CredentialKeys) {
 const current = actor && await getActor(db, actor); if (!current) throw new HttpError(403, 'Entre para usar o assistente.', 'assistant_forbidden');
 const visible = [];
 for (const organization of current.organizations ?? []) {
  let canConfigure = false, canDelegate = false, available = false, sttAvailable = false, documentAvailable=false;
  const savedPolicy = await one(db, 'SELECT config_json FROM ai_organization_settings WHERE organization_id=?', [organization.id]);
  const policy = savedPolicy ? validateConfig(JSON.parse(savedPolicy.config_json)) : newAssistantConfig(current.userId);
  const usagePolicy = assistantUsageSql(current.userId);
  const canUseAi = savedPolicy ? Boolean(await one(db, `SELECT 1 FROM ai_organization_settings s JOIN organizations o ON o.id=s.organization_id WHERE s.organization_id=? AND o.status='active' AND ${usagePolicy.sql}`, [organization.id,...usagePolicy.values])) : false;
  try { await configurationActor(db, current, organization.id); canConfigure = true; } catch { /* deny */ }
  try { await configurationActor(db, current, organization.id, true); canDelegate = true; } catch { /* deny */ }
  // Só existem com modelo do catálogo escolhido e apto a responder: é o destino que o aviso e a autorização precisam nomear.
  let documentRouteName: string | undefined, decisionRouteName: string | undefined;
  const routeName = async (loaded: { config: AssistantConfig; rawCredentials: Record<string, unknown> }, task: 'document' | 'decision') => { try { return taskRouteName(await resolveTaskRoute(db, organization.id, loaded.config, loaded.rawCredentials, task)) ?? undefined; } catch { return undefined; } };
  try { const loaded = await loadAssistantSettings(db, secret, organization.id, false, keys, current.userId); available = true; if (loaded.config.jevEnabled && loaded.config.decisionModel) decisionRouteName = await routeName(loaded, 'decision'); } catch { /* unavailable */ }
  try {
   const loaded = await loadAssistantSettings(db, secret, organization.id, 'document', keys, current.userId); documentAvailable = true;
   if (loaded.config.documentEnabled && loaded.config.documentModel) documentRouteName = await routeName(loaded, 'document');
   if (loaded.config.documentEnabled && loaded.config.jevEnabled && loaded.config.decisionModel) decisionRouteName ??= await routeName(loaded, 'decision');
  } catch { /* unavailable */ }
  let sttProvider = speechProviderForOrganization(organization.id, speechEnvironment),sttCredentialSource='vault';
  // Só existe com modelo do catálogo escolhido para voz e em condição de receber o áudio: é o destino que o consentimento precisa nomear.
  let sttRoute: string | undefined, sttRouteModel: SpeechRouteModel | undefined;
  try {
   const speech=await loadSpeechSettings(db,secret,organization.id,speechEnvironment,keys,current.userId);
   sttProvider=speech.provider;sttCredentialSource=speech.credentialSource;
   sttAvailable = true;
   if (speech.config.speechModel) { const resolved = await resolveTaskRoute(db, organization.id, speech.config, speech.rawCredentials, 'speech', speech.provider), routeModel = speechRouteModel(resolved); if (routeModel) { sttRoute = speechDestination(resolved, speech.provider); sttRouteModel = routeModel; } }
  } catch { try{const stored=await loadAssistantSettings(db,secret,organization.id,'configuration',keys);sttProvider=speechProviderForOrganization(organization.id,speechEnvironment,stored.config.sttProvider);sttCredentialSource=sttProvider==='groq'&&stored.config.sttProvider==='legacy'?'environment':'vault';}catch{/* unavailable */} }
  visible.push({ id: organization.id, name: organization.name, canConfigure, canDelegate, canUseAi, usageScope:policy.usageScope, usageIsMine:policy.usageScope==='private'&&policy.usageUserId===current.userId, available, sttAvailable, sttProvider, legacySttProvider:speechProviderForOrganization(organization.id,speechEnvironment), sttCredentialSource, documentAvailable, ...(sttRoute && sttRouteModel ? { sttRoute, sttRouteModel } : {}), ...(documentRouteName ? { documentRouteName } : {}), ...(decisionRouteName ? { decisionRouteName } : {}) });
 }
 const selected = visible.find(organization => organization.id === selectedId) ?? (visible.length === 1 ? visible[0] : undefined);
 const result = { available: selected?.available ?? false, documentAvailable:selected?.documentAvailable??false, canConfigure: selected?.canConfigure ?? false, canDelegate: selected?.canDelegate ?? false, organizationId: selected?.id ?? '', organizations: visible, voice: { dictation: 'browser-optional', uploadStt: selected?.sttAvailable ?? false } };
 if (!selected?.canConfigure) return result;
 const row = await one(db, "SELECT revision,config_json,substr(credentials_ciphertext,1,3) AS credential_format FROM ai_organization_settings WHERE organization_id=?", [selected.id]);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const details = { config: row ? validateConfig(JSON.parse(row.config_json)) : newAssistantConfig(current.userId), revision: row?.revision ?? 0, credentialsConfigured: !!row, credentialVaultManaged: Boolean(keys?.current || keys?.previous || (row && row.credential_format !== 'v1.')), usage:await one(db,'SELECT reserved_usd_micros,reserved_tokens,reserved_ms,calls FROM ai_organization_usage WHERE organization_id=? AND day=?',[selected.id,day])??{reserved_usd_micros:0,reserved_tokens:0,reserved_ms:0,calls:0} };
 if (!selected.canDelegate) return { ...result, ...details };
 const candidates = await all(db, "SELECT DISTINCT m.user_id AS userId,COALESCE(NULLIF(p.display_name,''),m.user_id) AS name FROM members m JOIN portal_users u ON u.user_id=m.user_id LEFT JOIN profiles p ON p.user_id=m.user_id WHERE m.organization_id=? AND m.revoked_at IS NULL AND u.status='active' AND u.activation_pending=0 AND u.anonymized_at IS NULL ORDER BY name", [selected.id]);
 const grants = await all(db, 'SELECT id,user_id AS userId,created_at AS createdAt FROM ai_configuration_grants WHERE organization_id=? AND revoked_at IS NULL', [selected.id]);
 return { ...result, ...details, candidates, grants };
}
export async function manageAssistantGrant(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>) {
 onlyKeys(input, ['action','organizationId','userId','grantId']); const organizationId = id(input.organizationId), { current, auth } = await configurationActor(db, actor, organizationId, true), at = new Date().toISOString();
 const assertion = db.prepare(`SELECT CASE WHEN ${auth.sql} THEN 1 ELSE json_extract('[]','ai_configuration_revoked') END`).bind(...auth.values);
 if (input.action === 'grant.revoke') {
  const grantId = id(input.grantId); await db.batch([assertion, db.prepare('UPDATE ai_configuration_grants SET revoked_at=? WHERE id=? AND organization_id=? AND revoked_at IS NULL').bind(at, grantId, organizationId), db.prepare("INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,?,'assistant.grant.revoke',?,'{}',? WHERE changes()=1").bind(crypto.randomUUID(), current.userId, organizationId, grantId, at)]); return { ok: true };
 }
 const userId = id(input.userId), grantId = crypto.randomUUID();
 const result = await db.batch([assertion, db.prepare(`INSERT OR IGNORE INTO ai_configuration_grants(id,organization_id,user_id,grantor_member_id,granted_by,created_at)
  SELECT ?,?,?,issuer.id,?,? FROM members issuer LEFT JOIN portal_users u ON u.user_id=issuer.user_id
  WHERE issuer.user_id=? AND issuer.role='owner' AND issuer.project_id IS NULL AND (issuer.organization_id IS NULL OR issuer.organization_id=?) AND issuer.revoked_at IS NULL AND ${ACTIVE}
  AND EXISTS(SELECT 1 FROM members target JOIN portal_users account ON account.user_id=target.user_id WHERE target.user_id=? AND target.organization_id=? AND target.revoked_at IS NULL AND account.status='active' AND account.activation_pending=0 AND account.anonymized_at IS NULL) ORDER BY issuer.organization_id IS NULL,issuer.id LIMIT 1`).bind(grantId, organizationId, userId, current.userId, at, current.userId, organizationId, userId, organizationId), db.prepare("INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,?,'assistant.grant.create',?,'{}',? WHERE changes()=1").bind(crypto.randomUUID(), current.userId, organizationId, grantId, at)]);
 if (!result[1].meta.changes && !await one(db, 'SELECT id FROM ai_configuration_grants WHERE organization_id=? AND user_id=? AND revoked_at IS NULL', [organizationId,userId])) throw new HttpError(403, 'Escolha uma pessoa ativa desta organização.', 'assistant_grant_target'); return { ok: true };
}
