import { platformOwnerAuthoritySql, type PortalActor } from '../access';
import { one } from '../database';
import { HttpError } from '../errors';
import { onlyKeys, safeRequest } from './contracts';
import type { CredentialKeys } from './crypto';
import { ChargedError, genericChat } from './generic-provider';
import { COMPARE_MAX_OUTPUT, COMPARE_SYSTEM, compareEstimate, fitsFunction, type CatalogModel, type CatalogProvider } from './model-catalog';
import { loadCatalog } from './model-catalog-store';
import { loadAssistantSettings } from './settings';
import { quotaRefusal } from './quota';

const ORG = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function dayKey(now: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

/** Mesma pergunta a 2–3 modelos do catálogo, lado a lado. Só a administração geral; gasto reservado antes. */
export async function compareModels(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, secret: string, keys: CredentialKeys, options: { fetcher?: typeof fetch; now?: number; signal?: AbortSignal } = {}) {
  onlyKeys(input, ['action', 'organizationId', 'modelIds', 'prompt', 'consent', 'acceptedCostMicros']);
  if (!actor) throw new HttpError(401, 'Entre para comparar modelos.', 'unauthenticated');
  const authority = platformOwnerAuthoritySql(actor);
  if (!await one(db, `SELECT 1 WHERE ${authority.sql}`, authority.values)) throw new HttpError(403, 'Somente a administração geral compara modelos.', 'catalog_admin');
  if (input.consent !== true) throw new HttpError(400, 'Confirme o envio da pergunta aos provedores escolhidos.', 'assistant_consent');
  if (typeof input.organizationId !== 'string' || !ORG.test(input.organizationId)) throw new HttpError(400, 'Escolha uma organização.', 'catalog_organization');
  const organizationId = input.organizationId;
  if (typeof input.prompt !== 'string' || input.prompt.length > 2000) throw new HttpError(400, 'Escreva até 2.000 caracteres.', 'assistant_request');
  const prompt = safeRequest(input.prompt);
  const ids = Array.isArray(input.modelIds) ? [...new Set(input.modelIds.map(String))] : [];
  if (ids.length < 2 || ids.length > 3) throw new HttpError(400, 'Escolha de 2 a 3 modelos para comparar.', 'compare_models');
  const { catalog } = await loadCatalog(db, organizationId);
  const { config, rawCredentials } = await loadAssistantSettings(db, secret, organizationId, 'configuration', keys, actor.userId);
  const chosen = ids.map(id => {
    const model = catalog.models.find(entry => entry.id === id && entry.enabled), provider = catalog.providers.find(entry => entry.id === model?.providerId);
    if (!model || !provider || fitsFunction({ ...model, testOnly: false }, provider, 'chat')) throw new HttpError(400, 'Escolha modelos de texto do catálogo.', 'compare_models');
    const apiKey = rawCredentials[provider.keyRef];
    if (typeof apiKey !== 'string' || apiKey.length < 12) throw new HttpError(400, `Falta a chave de ${provider.label}.`, 'compare_key');
    return { model, provider, apiKey } as { model: CatalogModel; provider: CatalogProvider; apiKey: string };
  });
  const estimate = compareEstimate(chosen.map(entry => entry.model), prompt);
  if (!Number.isSafeInteger(input.acceptedCostMicros) || Number(input.acceptedCostMicros) < estimate.total) throw new HttpError(409, 'O custo previsto mudou. Confira e envie de novo.', 'role_cost_changed');
  const day = dayKey(options.now ?? Date.now()), ms = config.timeoutMs * chosen.length;
  try {
    await db.batch([
      db.prepare(`SELECT CASE WHEN ${authority.sql} THEN 1 ELSE json_extract('[]','compare_authority') END`).bind(...authority.values),
      db.prepare('INSERT INTO ai_organization_usage(organization_id,day) VALUES(?,?) ON CONFLICT(organization_id,day) DO NOTHING').bind(organizationId, day),
      db.prepare('UPDATE ai_organization_usage SET reserved_usd_micros=reserved_usd_micros+?,reserved_tokens=reserved_tokens+?,reserved_ms=reserved_ms+?,calls=calls+? WHERE organization_id=? AND day=? AND reserved_usd_micros+?<=? AND reserved_tokens+?<=? AND reserved_ms+?<=? AND calls+?<=?')
        .bind(estimate.total, estimate.tokens, ms, chosen.length, organizationId, day, estimate.total, config.dailyUsdMicros, estimate.tokens, config.dailyTokens, ms, config.dailyMs, chosen.length, config.dailyCalls),
      db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','compare_quota') END"),
    ]);
  } catch (error) {
    if (String(error).includes('compare_authority')) throw new HttpError(403, 'Seu acesso mudou.', 'catalog_admin');
    if (String(error).includes('compare_quota')) throw await quotaRefusal(db, actor, organizationId, day, config, { cost: estimate.total, tokens: estimate.tokens, ms, calls: chosen.length });
    throw error;
  }
  const results = await Promise.all(chosen.map(async ({ model, provider, apiKey }, index) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.timeoutMs), started = Date.now();
    const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await genericChat({ provider, model, apiKey, system: COMPARE_SYSTEM, turns: [{ role: 'user', content: prompt }], maxTokens: COMPARE_MAX_OUTPUT, json: false, signal: controller.signal, fetcher: options.fetcher });
      return { modelId: model.id, label: model.label, provider: provider.label, text: result.text.slice(0, 4000), ms: Date.now() - started, inputTokens: result.inputTokens, outputTokens: result.outputTokens, usdMicros: result.costMicros, reservedUsdMicros: estimate.each[index], error: null as string | null };
    } catch (error) {
      return { modelId: model.id, label: model.label, provider: provider.label, text: '', ms: Date.now() - started, inputTokens: 0, outputTokens: 0, usdMicros: error instanceof ChargedError ? error.chargedMicros : 0, reservedUsdMicros: estimate.each[index], error: error instanceof HttpError ? error.message : 'Falhou ou demorou demais.' };
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }));
  const real = results.reduce((sum, row) => sum + row.usdMicros, 0), extra = Math.max(0, real - estimate.total);
  await db.batch([
    db.prepare('UPDATE ai_organization_usage SET reserved_usd_micros=reserved_usd_micros+? WHERE organization_id=? AND day=?').bind(extra, organizationId, day),
    db.prepare("INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,'assistant.compare',?,?,?)").bind(crypto.randomUUID(), actor.userId, organizationId, organizationId,
      JSON.stringify({ models: results.map(row => ({ provider: chosen.find(entry => entry.model.id === row.modelId)!.provider.id, model: chosen.find(entry => entry.model.id === row.modelId)!.model.model, usdMicros: row.usdMicros, ms: row.ms, ok: !row.error })), reservedUsdMicros: estimate.total, usdMicros: real }), new Date().toISOString()),
  ]);
  return { results, reservedUsdMicros: estimate.total, usdMicros: real };
}
