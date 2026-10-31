import { getActor, requireCapability, type PortalActor } from '../access';
import { all, one } from '../database';
import { HttpError } from '../errors';
import { materialsAction } from '../materials';
import { createRecord } from '../records';
import { ASSISTANT_CONTRACT, DEFAULT_ASSISTANT_CONFIG, PROVIDERS, object, onlyKeys, safeRequest, validateConfig, validateProposal, type AssistantCredentials, type AssistantItem, type AssistantPlan } from './contracts';
import { decryptCredentials, digest, encryptCredentials, signPlan, verifyPlan } from './crypto';
import { checkDecision, decisionBody, generateProposal, generationBody } from './provider';

const nowIso = () => new Date().toISOString();
async function currentActor(db: D1Database, actor: PortalActor | null): Promise<PortalActor> { const current = actor && await getActor(db, actor); if (!current) throw new HttpError(403, 'Seu acesso mudou. Entre novamente.', 'assistant_forbidden'); return current; }
async function platformOwner(db: D1Database, actor: PortalActor): Promise<boolean> {
 // 0008 introduces organization owners. They cannot configure platform credentials.
 const columns = await all(db, 'PRAGMA table_info(members)'), scoped = columns.some(column => column.name === 'organization_id');
 return !!await one(db, `SELECT m.id FROM members m WHERE m.user_id=? AND m.role='owner' AND m.project_id IS NULL AND m.revoked_at IS NULL ${scoped ? 'AND m.organization_id IS NULL' : ''} AND NOT EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=m.user_id AND (u.status!='active' OR u.activation_pending!=0 OR u.anonymized_at IS NOT NULL)) LIMIT 1`, [actor.userId]);
}
async function settingsRow(db: D1Database) { return one(db, "SELECT revision,config_json,credentials_ciphertext FROM ai_settings WHERE id='portal'"); }
async function loadSettings(db: D1Database, secret: string) {
 const row = await settingsRow(db); if (!row) throw new HttpError(503, 'O responsável ainda não configurou o assistente de IA.', 'assistant_unavailable');
 const config = validateConfig(JSON.parse(row.config_json)), credentials = object(await decryptCredentials(secret, row.credentials_ciphertext));
 if (!config.enabled || typeof credentials.deepseek !== 'string' || !credentials.deepseek || config.jevEnabled && (typeof credentials.typesafe !== 'string' || !credentials.typesafe)) throw new HttpError(503, 'O assistente está desativado ou sem as credenciais necessárias.', 'assistant_unavailable');
 return { revision: row.revision as number, config, credentials: credentials as AssistantCredentials };
}
export async function assistantStatus(db: D1Database, actor: PortalActor | null, secret: string) {
 const current = await currentActor(db, actor), canConfigure = await platformOwner(db, current), row = await settingsRow(db);
 let available = false; try { await loadSettings(db, secret); available = true; } catch { /* Configuration details and ciphertext never leave the server. */ }
 const day = dayKey(Date.now());
 return { available, canConfigure, voice: { dictation: 'browser-optional', uploadStt: false }, ...(canConfigure ? { config: row ? validateConfig(JSON.parse(row.config_json)) : DEFAULT_ASSISTANT_CONFIG, revision: row?.revision ?? 0, usage: await one(db, 'SELECT reserved_usd_micros,reserved_tokens,reserved_ms,calls FROM ai_daily_usage WHERE day=?', [day]) ?? { reserved_usd_micros: 0, reserved_tokens: 0, reserved_ms: 0, calls: 0 }, credentialsConfigured: !!row } : {}) };
}
function apiKey(value: unknown): string { if (typeof value !== 'string' || value.length < 12 || value.length > 512 || /\s|[\u0000-\u001f]/u.test(value)) throw new HttpError(400, 'Informe uma chave válida no campo reservado ao provedor.', 'assistant_credentials'); return value; }
export async function configureAssistant(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, secret: string) {
 onlyKeys(input, ['action', 'config', 'deepseekKey', 'typesafeKey', 'expectedRevision', 'replaceCredentials']);
 const current = await currentActor(db, actor); if (!await platformOwner(db, current)) throw new HttpError(403, 'Somente o responsável da plataforma pode configurar a IA.', 'assistant_configuration_forbidden');
 const config = validateConfig(input.config), old = await settingsRow(db);
 if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (old?.revision ?? 0)) throw new HttpError(409, 'A configuração mudou. Atualize antes de salvar.', 'assistant_configuration_changed');
 const previous = old && input.replaceCredentials !== true ? object(await decryptCredentials(secret, old.credentials_ciphertext)) : {};
 const credentials: AssistantCredentials = { deepseek: input.deepseekKey ? apiKey(input.deepseekKey) : String(previous.deepseek ?? ''), typesafe: input.typesafeKey ? apiKey(input.typesafeKey) : String(previous.typesafe ?? '') };
 if (config.enabled && !credentials.deepseek || config.jevEnabled && !credentials.typesafe) throw new HttpError(400, 'Cadastre as credenciais dos provedores habilitados.', 'assistant_credentials');
 const ciphertext = await encryptCredentials(secret, credentials), revision = Number(input.expectedRevision) + 1, at = nowIso();
 const columns = await all(db, 'PRAGMA table_info(members)'), org = columns.some(column => column.name === 'organization_id') ? 'AND organization_id IS NULL' : '';
 const ownerSql = `EXISTS(SELECT 1 FROM members WHERE user_id=? AND role='owner' AND project_id IS NULL AND revoked_at IS NULL ${org} AND NOT EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=members.user_id AND (u.status!='active' OR u.activation_pending!=0 OR u.anonymized_at IS NOT NULL)))`;
 const write = old ? db.prepare(`UPDATE ai_settings SET revision=?,config_json=?,credentials_ciphertext=?,updated_by=?,updated_at=? WHERE id='portal' AND revision=? AND ${ownerSql}`).bind(revision, JSON.stringify(config), ciphertext, current.userId, at, input.expectedRevision, current.userId) : db.prepare(`INSERT INTO ai_settings(id,revision,config_json,credentials_ciphertext,updated_by,updated_at) SELECT 'portal',?,?,?,?,? WHERE ${ownerSql}`).bind(revision, JSON.stringify(config), ciphertext, current.userId, at, current.userId);
 const result = await db.batch([write, db.prepare(`INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,NULL,'assistant.configure','portal',?,? WHERE EXISTS(SELECT 1 FROM ai_settings WHERE revision=? AND updated_at=? AND updated_by=?)`).bind(crypto.randomUUID(), current.userId, JSON.stringify({ revision, enabled: config.enabled, jevEnabled: config.jevEnabled, model: config.model, jevModel: config.jevModel }), at, revision, at, current.userId)]);
 if (result[0].meta.changes !== 1) throw new HttpError(409, 'A configuração ou seu acesso mudou. Atualize a página.', 'assistant_configuration_changed');
 return { ok: true, revision };
}
function projectId(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new HttpError(400, 'Escolha um projeto.', 'assistant_project'); return value; }
async function scopedActor(db: D1Database, actor: PortalActor | null, project: string) { const current = await currentActor(db, actor); requireCapability(current, 'inventory.read', project); if (!await one(db, 'SELECT id FROM projects WHERE id=?', [project])) throw new HttpError(404, 'Projeto não encontrado.', 'assistant_project'); return current; }
function operationCapability(intent: string): string { return intent === 'stock.query' ? 'inventory.read' : intent === 'record.create' ? 'campaigns.manage' : 'inventory.manage'; }
function dayKey(now: number): string { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now)); return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-'); }
export async function prepareAssistantPlan(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, secret: string, options: { fetcher?: typeof fetch; now?: number } = {}) {
 onlyKeys(input, ['action', 'projectId', 'request', 'operationKey', 'consent']);
 if (input.consent !== true) throw new HttpError(400, 'Confirme o envio do pedido e do estoque deste projeto aos provedores configurados.', 'assistant_consent');
 if (typeof input.operationKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.operationKey)) throw new HttpError(400, 'Reabra o assistente antes de enviar.', 'assistant_operation');
 const project = projectId(input.projectId), current = await scopedActor(db, actor, project), request = safeRequest(input.request), now = options.now ?? Date.now();
 const { config, credentials, revision } = await loadSettings(db, secret);
 const rows = await all(db, 'SELECT id,name,category,unit,stock,reserved,condition FROM items WHERE project_id=? ORDER BY id LIMIT 101', [project]);
 if (rows.length > 100) throw new HttpError(400, 'Este projeto possui mais de 100 materiais. Use os filtros de Materiais para esta consulta.', 'assistant_context_limit');
 const items = rows.map(row => ({ ...row, name: safeRequest(row.name), unit: safeRequest(row.unit) })) as AssistantItem[], body = generationBody(config, request, items);
 const bodyBytes = new TextEncoder().encode(JSON.stringify(body)).byteLength + 2048;
 if (bodyBytes > 24000) throw new HttpError(400, 'Reduza o pedido ou a quantidade de materiais do contexto.', 'assistant_context_limit');
 const reservedTokens = bodyBytes + config.maxOutputTokens + (config.jevEnabled ? bodyBytes + 18000 : 0), calls = config.jevEnabled ? 2 : 1;
 const reservedCost = Math.ceil(bodyBytes * PROVIDERS.deepseek.inputMicrosPerToken + config.maxOutputTokens * PROVIDERS.deepseek.outputMicrosPerToken + (config.jevEnabled ? (bodyBytes + 18000) * PROVIDERS.typesafe.inputMicrosPerToken : 0));
 const id = await digest(`${current.userId}\n${project}\n${input.operationKey}`), fingerprint = await digest(JSON.stringify({ request, project, revision })), day = dayKey(now);
 async function existingCall() { const call = await one(db, 'SELECT fingerprint,status,plan_id FROM ai_calls WHERE id=?', [id]); if (call && call.fingerprint !== fingerprint) throw new HttpError(409, 'Este envio já foi usado com outro pedido. Prepare uma nova solicitação.', 'assistant_operation_changed'); if (!call) return null; if (call.status === 'complete') { const stored = await one(db, 'SELECT payload_json,payload_digest,status FROM ai_plans WHERE id=?', [call.plan_id]); if (stored?.status === 'ready') { const plan = JSON.parse(stored.payload_json) as AssistantPlan; if (plan.expiresAt > now) return presentPlan(plan, stored.payload_digest, secret); } } throw new HttpError(409, 'Este envio já foi processado ou está em andamento. Prepare um novo pedido se necessário.', 'assistant_call_replay'); }
 const existing = await existingCall(); if (existing) return existing;
 try { await db.batch([
  db.prepare('INSERT INTO ai_daily_usage(day) VALUES(?) ON CONFLICT(day) DO NOTHING').bind(day),
  db.prepare(`INSERT INTO ai_calls(id,fingerprint,actor_id,project_id,status,day,created_at) SELECT ?,?,?,?,'reserved',?,? FROM ai_daily_usage WHERE day=? AND reserved_usd_micros+?<=? AND reserved_tokens+?<=? AND reserved_ms+?<=? AND calls+?<=? AND EXISTS(SELECT 1 FROM ai_settings WHERE id='portal' AND revision=?)`).bind(id, fingerprint, current.userId, project, day, new Date(now).toISOString(), day, reservedCost, config.dailyUsdMicros, reservedTokens, config.dailyTokens, config.timeoutMs, config.dailyMs, calls, config.dailyCalls, revision),
  db.prepare('UPDATE ai_daily_usage SET reserved_usd_micros=reserved_usd_micros+?,reserved_tokens=reserved_tokens+?,reserved_ms=reserved_ms+?,calls=calls+? WHERE day=? AND EXISTS(SELECT 1 FROM ai_calls WHERE id=?)').bind(reservedCost, reservedTokens, config.timeoutMs, calls, day, id),
 ]); } catch (error) { const recovered = await existingCall(); if (recovered) return recovered; throw error; }
 if (!await one(db, 'SELECT id FROM ai_calls WHERE id=?', [id])) throw new HttpError(429, 'O limite diário de custo, tokens, tempo ou chamadas foi atingido. O responsável pode revisar os limites.', 'assistant_quota');
 const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.timeoutMs);
 try {
  const generated = await generateProposal(config, credentials, body, controller.signal, options.fetcher), proposal = validateProposal(generated.proposal, request, items);
  if (generated.inputTokens > bodyBytes) throw new HttpError(502, 'O uso de tokens excedeu a reserva preventiva.', 'assistant_usage');
  const fresh = await scopedActor(db, current, project); requireCapability(fresh, operationCapability(proposal.intent), project);
  let jevModel: string | null = null;
  if (config.jevEnabled) { const decision = await checkDecision(config, credentials, decisionBody(config, request, proposal), controller.signal, options.fetcher); if (!decision.approved || decision.inputTokens > bodyBytes + 18000) throw new HttpError(409, 'O classificador indicou dúvida. Esclareça ação, material e quantidade no pedido.', 'assistant_needs_review'); jevModel = decision.model; }
  if ((await loadSettings(db, secret)).revision !== revision) throw new HttpError(409, 'A configuração de IA mudou. Prepare a proposta novamente.', 'assistant_configuration_changed');
  const before = proposal.itemId ? items.find(item => item.id === proposal.itemId)! : null, delta = proposal.intent === 'stock.receive' ? proposal.quantity : ['stock.distribute', 'stock.consume'].includes(proposal.intent) ? -proposal.quantity : 0;
  if (before && delta && (before.condition !== 'active' || before.stock + delta < before.reserved || before.category === 'equipment' && (delta < 0 || before.stock + delta > 1))) throw new HttpError(409, 'O material não permite essa movimentação. Confira disponibilidade e categoria em Materiais.', 'assistant_stock');
  const plan: AssistantPlan = { contract: ASSISTANT_CONTRACT, id: crypto.randomUUID(), actorId: current.userId, projectId: project, configRevision: revision, proposal, before, after: before ? { stock: before.stock + delta, available: before.stock + delta - before.reserved } : null, provenance: { requestSha256: await digest(request), contextSha256: await digest(JSON.stringify(items)), provider: 'deepseek', model: config.model, modelRevision: PROVIDERS.deepseek.revision, returnedModel: generated.returnedModel, jevModel, reviewedAt: new Date(now).toISOString() }, expiresAt: now + 10 * 60000 }, payload = JSON.stringify(plan), hash = await digest(payload);
  await scopedActor(db, current, project);
  await db.batch([db.prepare('INSERT INTO ai_plans(id,actor_id,project_id,payload_json,payload_digest,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(plan.id, current.userId, project, payload, hash, plan.expiresAt, new Date(now).toISOString()), db.prepare("UPDATE ai_calls SET status='complete',plan_id=? WHERE id=?").bind(plan.id, id), db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,?,?,'assistant.plan',?,?,?)").bind(crypto.randomUUID(), current.userId, project, plan.id, JSON.stringify({ intent: proposal.intent, model: config.model, jevModel, configRevision: revision, requestSha256: plan.provenance.requestSha256, reservedUsdMicros: reservedCost }), nowIso())]);
  return presentPlan(plan, hash, secret);
 } catch (error) { await db.prepare("UPDATE ai_calls SET status='failed' WHERE id=? AND status='reserved'").bind(id).run(); throw error; } finally { clearTimeout(timer); }
}
async function presentPlan(plan: AssistantPlan, hash: string, secret: string) { const { actorId: _actorId, ...publicPlan } = plan; void _actorId; return { plan: publicPlan, planToken: await signPlan(secret, { id: plan.id, digest: hash, actorId: plan.actorId, projectId: plan.projectId, expiresAt: plan.expiresAt }), undoAvailable: false, undoReason: 'Movimentos físicos e registros exigem conferência. Correções são novos registros auditados nas telas correspondentes.' }; }
function guardedStockDatabase(db: D1Database, plan: AssistantPlan, refId: string): D1Database {
 const before = plan.before!;
 // Domain services retain all normal ledger/authorization checks. This extra predicate
 // shares their atomic batch, closing the read -> apply race for the displayed before/after.
 const assertion = () => db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_movements WHERE ref_id=?) OR EXISTS(SELECT 1 FROM items WHERE id=? AND project_id=? AND name=? AND category=? AND unit=? AND stock=? AND reserved=? AND condition=?) THEN 1 ELSE json_extract('[]','assistant_stock_changed') END`).bind(refId, before.id, plan.projectId, before.name, before.category, before.unit, before.stock, before.reserved, before.condition);
 return new Proxy(db, { get(target, key) { if (key === 'batch') return async (statements: D1PreparedStatement[]) => (await target.batch([assertion(), ...statements])).slice(1); const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
}
export async function applyAssistantPlan(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, secret: string, now = Date.now()) {
 onlyKeys(input, ['action', 'planToken', 'confirmed']);
 if (input.confirmed !== true) throw new HttpError(400, 'Confira a proposta e marque a confirmação antes de continuar.', 'assistant_confirmation');
 const current = await currentActor(db, actor), token = await verifyPlan(secret, input.planToken, current.userId, now), stored = await one(db, 'SELECT * FROM ai_plans WHERE id=? AND actor_id=? AND project_id=?', [token.id, current.userId, token.projectId]);
 if (!stored || stored.payload_digest !== token.digest || await digest(stored.payload_json) !== token.digest || stored.expires_at !== token.expiresAt || stored.status === 'cancelled') throw new HttpError(409, 'A proposta mudou ou foi cancelada. Prepare outra prévia.', 'assistant_plan_invalid');
 const plan = JSON.parse(stored.payload_json) as AssistantPlan, fresh = await scopedActor(db, current, plan.projectId); requireCapability(fresh, operationCapability(plan.proposal.intent), plan.projectId);
 if ((await loadSettings(db, secret)).revision !== plan.configRevision) throw new HttpError(409, 'A configuração mudou. Prepare uma nova prévia.', 'assistant_configuration_changed');
 if (stored.status === 'applied') return { ...JSON.parse(stored.result_json), replayed: true };
 const p = plan.proposal, operationKey = `ai_${plan.id.replaceAll('-', '')}`, item = p.itemId ? await one(db, 'SELECT id,project_id,name,category,unit,stock,reserved,condition FROM items WHERE id=? AND project_id=?', [p.itemId, plan.projectId]) : null;
 if (p.itemId && !item) throw new HttpError(409, 'O material não pertence mais ao projeto da proposta.', 'assistant_scope');
 const previousMovement = p.itemId ? await one(db, 'SELECT id FROM stock_movements WHERE ref_id=?', [`manual:${fresh.userId}:${operationKey}`]) : null;
 if (item && p.intent !== 'stock.query' && !previousMovement && JSON.stringify({ id: item.id, name: item.name, category: item.category, unit: item.unit, stock: item.stock, reserved: item.reserved, condition: item.condition }) !== JSON.stringify(plan.before)) throw new HttpError(409, 'O material mudou desde a prévia. Prepare outra proposta com o saldo atual.', 'assistant_stock_changed');
 let result: Record<string, unknown>;
 if (p.intent === 'stock.query') result = { ok: true, queried: true, item };
 else if (p.intent === 'record.create') { const saved = await createRecord(db, fresh, { projectId: plan.projectId, kind: 'observation', title: p.title, body: p.body, occurredAt: plan.provenance.reviewedAt, operationKey }); result = { ok: true, recordId: saved.id }; }
 else { try { const saved = await materialsAction(guardedStockDatabase(db, plan, `manual:${fresh.userId}:${operationKey}`), fresh, 'stock.move', { itemId: p.itemId, kind: p.intent.slice(6), delta: p.intent === 'stock.receive' ? p.quantity : -p.quantity, reason: p.body || p.title || 'Movimentação conferida no assistente', operationKey }); result = { ok: true, movementId: object(saved?.movement).id, item: saved?.item }; } catch (error) { if (String(error).includes('assistant_stock_changed')) throw new HttpError(409, 'O material mudou durante a confirmação. Prepare uma nova proposta.', 'assistant_stock_changed'); throw error; } }
 await db.batch([db.prepare("UPDATE ai_plans SET status='applied',result_json=? WHERE id=? AND status='ready'").bind(JSON.stringify(result), plan.id), db.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,?,'assistant.apply',?,?,? WHERE changes()=1").bind(crypto.randomUUID(), fresh.userId, plan.projectId, plan.id, JSON.stringify({ intent: p.intent, ...(result.movementId ? { movementId: result.movementId } : {}), ...(result.recordId ? { recordId: result.recordId } : {}) }), nowIso())]);
 return result;
}
