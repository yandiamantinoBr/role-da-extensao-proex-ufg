import { platformOwnerAuthoritySql, type PortalActor } from '../access';
import { one } from '../database';
import { HttpError } from '../errors';
import { newAssistantConfig, object, onlyKeys } from './contracts';
import { credentialKeyId, decryptProviderCredentials, encryptProviderCredentials, type CredentialKeys } from './crypto';
import { looksLikeSecret, parseCatalog, safeBaseUrl, validateModel, validateProvider, VAULT_KEYS, type CatalogProvider, type ModelCatalog } from './model-catalog';
import { boundedJson } from './generic-provider';
/** Same rule as settings.validProviderKey (kept local to avoid an import cycle). */
const validProviderKey = (value: unknown): value is string => typeof value === 'string' && value.length >= 12 && value.length <= 512 && !/\s|[\u0000-\u001f]/u.test(value);

const norm = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
function findNumber(value: unknown, pattern: RegExp, depth = 0): number | null {
  if (!value || typeof value !== 'object' || depth > 3) return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (pattern.test(key) && typeof item === 'number' && Number.isFinite(item)) return item;
    const nested = findNumber(item, pattern, depth + 1); if (nested !== null) return nested;
  }
  return null;
}
/** Artificial Analysis Data API (x-api-key). Tolerant to field names; only names and the intelligence index are used. */
async function referenceModels(baseUrl: string, apiKey: string, fetcher: typeof fetch = fetch) {
  let data: Record<string, unknown>;
  try {
    data = await boundedJson(await fetcher(`${safeBaseUrl(baseUrl)}/language/models`, { method: 'GET', redirect: 'error', cache: 'no-store', headers: { 'x-api-key': apiKey, Accept: 'application/json' } }), 4 * 1024 * 1024);
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(503, 'O Artificial Analysis não respondeu.', 'reference_unavailable'); }
  if (JSON.stringify(data).includes(apiKey)) throw new HttpError(502, 'Resposta inesperada do Artificial Analysis.', 'reference_schema');
  const list = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data as unknown[] : [];
  return list.slice(0, 2000).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const keys = [row.slug, row.name, row.id, row.model_id].filter((value): value is string => typeof value === 'string').map(norm).filter(Boolean);
    return keys.length ? [{ keys, score: findNumber(row, /intelligence_index$/) }] : [];
  });
}

export const catalogSettingName = (organizationId: string) => `ai.catalog.v1:${organizationId}`;
const ORG = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const forbidden = () => new HttpError(403, 'Somente a administração geral gerencia o catálogo de modelos.', 'catalog_admin');
const changed = () => new HttpError(409, 'O catálogo mudou. Atualize a tela antes de salvar.', 'catalog_changed');

async function requireOwner(db: D1Database, actor: PortalActor | null) {
  if (!actor) throw new HttpError(401, 'Entre para acessar o catálogo.', 'unauthenticated');
  const authority = platformOwnerAuthoritySql(actor);
  if (!await one(db, `SELECT 1 WHERE ${authority.sql}`, authority.values)) throw forbidden();
  return authority;
}
function organization(value: unknown) { if (typeof value !== 'string' || !ORG.test(value)) throw new HttpError(400, 'Escolha uma organização.', 'catalog_organization'); return value; }

/** Leitura usada também pelo Rolê em tempo de execução (sem exigir dono). */
export async function loadCatalog(db: D1Database, organizationId: string): Promise<{ catalog: ModelCatalog; stamp: string; raw: string | null }> {
  const row = await one(db, 'SELECT value,updated_at FROM settings WHERE name=?', [catalogSettingName(organizationId)]);
  return { catalog: parseCatalog(row ? String(row.value) : null), stamp: row ? String(row.updated_at) : '', raw: row ? String(row.value) : null };
}

function mask(key: string) {
  if (key.length < 24) return '…••••';
  const prefix = /^(sk-ant-|sk-|nvapi-|gsk_|pplx-|aa_)/.exec(key)?.[0] ?? '', tail = key.slice(-4);
  return prefix + '…' + (/^[A-Za-z0-9_-]{4}$/.test(tail) ? tail : '••••');
}

async function decrypted(db: D1Database, organizationId: string, secret: string, keys: CredentialKeys) {
  const row = await one(db, 'SELECT revision,credentials_ciphertext FROM ai_organization_settings WHERE organization_id=?', [organizationId]);
  if (!row) return { row: null, credentials: {} as Record<string, unknown> };
  try { return { row, credentials: object(await decryptProviderCredentials(secret, String(row.credentials_ciphertext), organizationId, keys)) }; }
  catch { return { row, credentials: null }; }
}

/** Visão para a administração geral: catálogo + se cada provedor tem chave (só presença e dica). */
export async function catalogView(db: D1Database, actor: PortalActor | null, organizationIdInput: unknown, secret: string, keys: CredentialKeys) {
  await requireOwner(db, actor);
  const organizationId = organization(organizationIdInput);
  const { catalog, stamp } = await loadCatalog(db, organizationId);
  const { credentials } = await decrypted(db, organizationId, secret, keys);
  const providers = catalog.providers.map(provider => ({ ...provider, hasKey: !!credentials && validProviderKey(credentials[provider.keyRef]) }));
  return { organizationId, stamp, catalog: { ...catalog, providers } };
}

async function saveCatalog(db: D1Database, actor: PortalActor, organizationId: string, catalog: ModelCatalog, expected: string, audit: { action: string; details: Record<string, unknown> }, raw: string | null = null) {
  const at = new Date().toISOString(), name = catalogSettingName(organizationId);
  const next = { ...catalog, updatedAt: at, updatedBy: actor.displayName || 'Administração geral' };
  const authority = platformOwnerAuthoritySql(actor);
  const guard = db.prepare(`SELECT CASE WHEN ${authority.sql} AND EXISTS(SELECT 1 FROM organizations WHERE id=? AND status='active') THEN 1 ELSE json_extract('[]','catalog_authority_changed') END`).bind(...authority.values, organizationId);
  const write = expected
    ? db.prepare('UPDATE settings SET value=?,updated_at=? WHERE name=? AND updated_at=? AND value=?').bind(JSON.stringify(next), at, name, expected, raw ?? '')
    : db.prepare('INSERT INTO settings(name,value,updated_at) VALUES(?,?,?)').bind(name, JSON.stringify(next), at);
  const verify = db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','catalog_revision_changed') END");
  const log = db.prepare('INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(), actor.userId, organizationId, audit.action, organizationId, JSON.stringify(audit.details), at);
  try { await db.batch([guard, write, verify, log]); }
  catch (error) {
    const message = String(error);
    if (message.includes('catalog_authority_changed')) throw forbidden();
    if (message.includes('catalog_revision_changed') || message.includes('UNIQUE constraint failed')) throw changed();
    throw error;
  }
  return at;
}

/** Cadastrar, editar e apagar modelos e provedores; colar ou remover a chave de um provedor novo. */
export async function manageCatalog(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, secret: string, keys: CredentialKeys, options: { fetcher?: typeof fetch } = {}) {
  await requireOwner(db, actor);
  const current = actor!;
  const organizationId = organization(input.organizationId);
  if (!await one(db, "SELECT 1 FROM organizations WHERE id=? AND status='active'", [organizationId])) throw new HttpError(404, 'Organização indisponível.', 'catalog_organization');
  const { catalog, stamp, raw } = await loadCatalog(db, organizationId);
  if (typeof input.expected !== 'string' || input.expected !== stamp) throw changed();
  const inUse = async () => { const row = await one(db, 'SELECT config_json FROM ai_organization_settings WHERE organization_id=?', [organizationId]); const parsed = row ? JSON.parse(String(row.config_json)) as Record<string, unknown> : {}; return new Set([parsed.roleModel, parsed.roleVisionModel].filter((value): value is string => typeof value === 'string' && !!value)); };
  const action = input.action;
  if (action === 'model.save') {
    onlyKeys(input, ['action', 'organizationId', 'expected', 'model', 'replaceId']);
    const model = validateModel(object(input.model), catalog.providers);
    const replaceId = typeof input.replaceId === 'string' ? input.replaceId : null;
    if (catalog.models.some(entry => entry.id === model.id && entry.id !== replaceId)) throw new HttpError(409, 'Já existe um modelo com esse identificador.', 'catalog_duplicate');
    const models = replaceId ? catalog.models.map(entry => entry.id === replaceId ? model : entry) : [...catalog.models, model];
    if (replaceId && !catalog.models.some(entry => entry.id === replaceId)) throw changed();
    const before = replaceId ? catalog.models.find(entry => entry.id === replaceId) : null;
    if (before && (await inUse()).has(before.id) && (model.id !== before.id || model.providerId !== before.providerId || model.model !== before.model || model.enabled !== before.enabled || model.testOnly !== before.testOnly || before.capabilities.some(capability => !model.capabilities.includes(capability)))) throw new HttpError(409, 'Este modelo está em uso pelo Rolê. Só preço, fonte e observação podem mudar; para o resto, escolha outro modelo em Funções e acesso.', 'catalog_in_use');
    await saveCatalog(db, current, organizationId, { ...catalog, models }, stamp, { action: 'assistant.catalog.model.save', details: { model: model.id, provider: model.providerId, capabilities: model.capabilities } }, raw);
  } else if (action === 'model.delete') {
    onlyKeys(input, ['action', 'organizationId', 'expected', 'modelId']);
    if ((await inUse()).has(String(input.modelId))) throw new HttpError(409, 'Este modelo está em uso pelo Rolê. Escolha outro em Funções e acesso antes de apagar.', 'catalog_in_use');
    if (!catalog.models.some(entry => entry.id === input.modelId)) throw changed();
    await saveCatalog(db, current, organizationId, { ...catalog, models: catalog.models.filter(entry => entry.id !== input.modelId) }, stamp, { action: 'assistant.catalog.model.delete', details: { model: String(input.modelId) } }, raw);
  } else if (action === 'provider.save') {
    onlyKeys(input, ['action', 'organizationId', 'expected', 'provider']);
    const provider = validateProvider(object(input.provider));
    if (catalog.providers.some(entry => entry.id === provider.id)) throw new HttpError(409, 'Já existe um provedor com esse identificador.', 'catalog_duplicate');
    const vault = await decrypted(db, organizationId, secret, keys);
    if (vault.credentials && provider.keyRef in vault.credentials) throw new HttpError(409, 'Já existe uma chave guardada com esse identificador. Use outro identificador.', 'catalog_duplicate');
    await saveCatalog(db, current, organizationId, { ...catalog, providers: [...catalog.providers, provider] }, stamp, { action: 'assistant.catalog.provider.save', details: { provider: provider.id, kind: provider.kind, host: new URL(provider.baseUrl).hostname } }, raw);
  } else if (action === 'provider.delete') {
    onlyKeys(input, ['action', 'organizationId', 'expected', 'providerId']);
    const provider = catalog.providers.find(entry => entry.id === input.providerId);
    if (!provider) throw changed();
    if (provider.builtin && (VAULT_KEYS as readonly string[]).includes(provider.keyRef)) throw new HttpError(409, 'Este provedor faz parte das integrações revisadas e não pode ser apagado. Desligue a chave, se quiser.', 'catalog_builtin');
    if (catalog.models.some(model => model.providerId === provider.id)) throw new HttpError(409, 'Apague antes os modelos deste provedor.', 'catalog_in_use');
    const vault = await decrypted(db, organizationId, secret, keys);
    if (provider.key?.state === 'active' || !vault.credentials || provider.keyRef in vault.credentials) throw new HttpError(409, 'Remova antes a chave deste provedor.', 'catalog_in_use');
    await saveCatalog(db, current, organizationId, { ...catalog, providers: catalog.providers.filter(entry => entry.id !== provider.id) }, stamp, { action: 'assistant.catalog.provider.delete', details: { provider: provider.id } }, raw);
  } else if (action === 'key.save' || action === 'key.remove') {
    onlyKeys(input, ['action', 'organizationId', 'expected', 'providerId', ...(action === 'key.save' ? ['label', 'secret'] : [])]);
    const provider = catalog.providers.find(entry => entry.id === input.providerId);
    if (!provider || !provider.keyRef.startsWith('p:')) throw new HttpError(400, 'As chaves dos provedores revisados ficam na aba Chaves.', 'catalog_key_builtin');
    await credentialKeyId(keys.current, secret);
    const label = action === 'key.save' ? String(input.label ?? '').trim().slice(0, 72) || provider.label : '';
    if (action === 'key.save' && (!validProviderKey(input.secret) || looksLikeSecret(label) || label.includes(String(input.secret).slice(-8)) || /[A-Za-z0-9_-]{24,}/.test(label))) throw new HttpError(400, 'Cole uma chave válida e um nome curto sem a chave.', 'catalog_key');
    const { row, credentials } = await decrypted(db, organizationId, secret, keys);
    if (credentials === null) throw new HttpError(409, 'O cofre desta organização precisa ser recriado na aba Chaves antes.', 'assistant_key_recovery');
    const next: Record<string, unknown> = { ...credentials };
    if (action === 'key.save') next[provider.keyRef] = input.secret; else delete next[provider.keyRef];
    const ciphertext = await encryptProviderCredentials(secret, next, organizationId, keys, row ? String(row.credentials_ciphertext) : undefined);
    const at = new Date().toISOString(), revision = Number(row?.revision ?? 0) + 1;
    const keyMeta = action === 'key.save' ? { label, mask: mask(String(input.secret)), state: 'active' as const, updatedAt: at, updatedBy: current.displayName || 'Administração geral' } : { label: provider.key?.label ?? provider.label, mask: provider.key?.mask ?? '', state: 'removed' as const, updatedAt: at, updatedBy: current.displayName || 'Administração geral' };
    const providers: CatalogProvider[] = catalog.providers.map(entry => entry.id === provider.id ? { ...entry, key: keyMeta } : entry);
    const authority = platformOwnerAuthoritySql(current);
    const write = row
      ? db.prepare('UPDATE ai_organization_settings SET revision=?,credentials_ciphertext=?,updated_by=?,updated_at=? WHERE organization_id=? AND revision=? AND credentials_ciphertext=?').bind(revision, ciphertext, current.userId, at, organizationId, row.revision, row.credentials_ciphertext)
      : db.prepare('INSERT INTO ai_organization_settings(organization_id,revision,config_json,credentials_ciphertext,updated_by,updated_at) VALUES(?,?,?,?,?,?)').bind(organizationId, revision, JSON.stringify(newAssistantConfig(current.userId)), ciphertext, current.userId, at);
    const nextCatalog = { ...catalog, providers, updatedAt: at, updatedBy: current.displayName || 'Administração geral' };
    try {
      await db.batch([
        db.prepare(`SELECT CASE WHEN ${authority.sql} THEN 1 ELSE json_extract('[]','catalog_authority_changed') END`).bind(...authority.values),
        write, db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','catalog_revision_changed') END"),
        stamp ? db.prepare('UPDATE settings SET value=?,updated_at=? WHERE name=? AND updated_at=? AND value=?').bind(JSON.stringify(nextCatalog), at, catalogSettingName(organizationId), stamp, raw ?? '')
          : db.prepare('INSERT INTO settings(name,value,updated_at) VALUES(?,?,?)').bind(catalogSettingName(organizationId), JSON.stringify(nextCatalog), at),
        db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','catalog_revision_changed') END"),
        db.prepare('INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(), current.userId, organizationId, action === 'key.save' ? 'assistant.credentials.save' : 'assistant.credentials.remove', organizationId, JSON.stringify({ provider: provider.keyRef, state: keyMeta.state, revision, mask: keyMeta.mask }), at),
      ]);
    } catch (error) {
      const message = String(error);
      if (message.includes('catalog_authority_changed')) throw forbidden();
      if (message.includes('catalog_revision_changed') || message.includes('UNIQUE constraint failed')) throw changed();
      throw error;
    }
  } else if (action === 'scores.refresh') {
    onlyKeys(input, ['action', 'organizationId', 'expected']);
    const reference = catalog.providers.find(entry => entry.kind === 'reference');
    const { credentials } = await decrypted(db, organizationId, secret, keys);
    const apiKey = reference && credentials ? credentials[reference.keyRef] : null;
    if (!reference || !validProviderKey(apiKey)) throw new HttpError(400, 'Cole antes a chave do Artificial Analysis no cartão dele.', 'catalog_key');
    const rows = await referenceModels(reference.baseUrl, apiKey, options.fetcher);
    let matched = 0; const today = new Date().toISOString().slice(0, 10);
    const models = catalog.models.map(model => {
      const found = rows.find(row => row.keys.some(key => key === norm(model.model) || key === norm(model.model.split('/').pop() ?? '') || key === norm(model.label.replace(/\(.*\)/, ''))));
      if (!found || found.score === null) return model;
      matched++;
      return { ...model, score: { value: found.score, source: 'Artificial Analysis', readAt: today } };
    });
    await saveCatalog(db, current, organizationId, { ...catalog, models }, stamp, { action: 'assistant.catalog.scores', details: { matched, total: rows.length } }, raw);
    return { ...(await catalogView(db, current, organizationId, secret, keys)), refreshed: { matched, total: rows.length } };
  } else throw new HttpError(400, 'Escolha uma ação do catálogo.', 'catalog_action');
  return catalogView(db, current, organizationId, secret, keys);
}
