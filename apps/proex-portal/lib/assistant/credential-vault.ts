import { platformOwnerAuthoritySql, type PortalActor } from '../access';
import { all, iso, one } from '../database';
import { HttpError } from '../errors';
import { credentialProviders, DEFAULT_ASSISTANT_CONFIG, newAssistantConfig, object, onlyKeys, validateConfig, type AssistantConfig, type CredentialProvider } from './contracts';
import { credentialKeyId, decryptProviderCredentials, encryptProviderCredentials, type CredentialKeys } from './crypto';
import { speechProviderForOrganization, validProviderKey, type SpeechEnvironment } from './settings';

const providers = { deepseek: 'DeepSeek', typesafe: 'TypeSafe JEV', deepgram: 'Deepgram', groq: 'Groq',openai:'OpenAI' } as const;
const purposes = { deepseek: 'Texto e documentos', typesafe: 'Decisão e conferência', deepgram: 'Transcrição de voz', groq: 'Transcrição de voz em português',openai:'Propostas de operações e documentos textuais' } as const;
const dayInBrazil = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const conflict = () => new HttpError(409, 'As credenciais mudaram. Atualize a lista antes de salvar.', 'assistant_configuration_changed');
const forbidden = () => new HttpError(403, 'Somente a administração geral pode gerenciar credenciais.', 'assistant_key_admin');

async function requireOwner(db: D1Database, actor: PortalActor | null) {
  if (!actor) throw new HttpError(401, 'Entre para acessar as credenciais.', 'unauthenticated');
  const authority = platformOwnerAuthoritySql(actor);
  if (!await one(db, `SELECT 1 WHERE ${authority.sql}`, authority.values)) throw forbidden();
  return { actor, authority };
}

function organizationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw new HttpError(400, 'Escolha uma organização.', 'assistant_organization');
  }
  return value;
}

async function storedSettings(db: D1Database, id: string, authSecret: string, keys: CredentialKeys) {
  const row = await one(db, 'SELECT revision,config_json,credentials_ciphertext FROM ai_organization_settings WHERE organization_id=?', [id]);
  let credentials: Record<string, unknown> | null = {};
  if (row) {
    try { credentials = object(await decryptProviderCredentials(authSecret, row.credentials_ciphertext, id, keys)); }
    catch { credentials = null; }
  }
  return { row, credentials };
}

function credentialMask(provider: CredentialProvider, key: string) {
  const prefix = (provider === 'deepseek'||provider==='openai') && key.startsWith('sk-') ? 'sk-' : '';
  const tail = key.slice(-4);
  return prefix + '…' + (/^[A-Za-z0-9_-]{4}$/.test(tail) ? tail : '••••');
}

function safeMask(provider: CredentialProvider, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const suffix = provider === 'deepseek'||provider==='openai' ? value.replace(/^sk-/, '') : value;
  return /^…(?:[A-Za-z0-9_-]{4}|••••)$/u.test(suffix) ? value : null;
}

function safeLabel(value: unknown, secrets: readonly unknown[]): string | null {
  const label = typeof value === 'string' ? value.trim() : '';
  if (!label || label.length > 72 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(label)) return null;
  const normalized = label.normalize('NFKC');
  if (secrets.some(secret => typeof secret === 'string' && secret.length >= 12 && normalized.includes(secret.normalize('NFKC')))) return null;
  if (/\b(?:sk[-_]|gsk_|dg_)[A-Za-z0-9_-]{10,}|\b(?:bearer\s+|(?:api[_ -]?key|access[_ -]?token)\s*[:=]\s*)[A-Za-z0-9_+./=-]{12,}/i.test(normalized)) return null;
  const tokens = normalized.match(/[A-Za-z0-9_+./=-]{24,}/g) ?? [];
  if (tokens.some(token => token.length >= 32 || /^[a-f0-9]{24,}$/i.test(token) || /[a-z]/i.test(token) && /\d/.test(token))) return null;
  return label;
}

function protectedValues(authSecret: string, keys: CredentialKeys, speech: SpeechEnvironment | undefined,
  credentials: Record<string, unknown> | null, disabled: Record<string, unknown>) {
  return [authSecret, keys.current, keys.previous, speech?.groqKey,
    ...credentialProviders.flatMap(provider => [credentials?.[provider], disabled[provider]])];
}

function disabledCredentials(credentials: Record<string, unknown> | null): Record<string, unknown> {
  const disabled = credentials?.disabledCredentials;
  return disabled && typeof disabled === 'object' && !Array.isArray(disabled) ? { ...disabled } : {};
}

export async function assistantCredentialVault(db: D1Database, actor: PortalActor | null, selectedId: string | null, authSecret: string, keys: CredentialKeys, speech?: SpeechEnvironment) {
  const { authority } = await requireOwner(db, actor);
  const organizations = await all(db, `SELECT id,name FROM organizations WHERE status='active' AND ${authority.sql} ORDER BY name,id`, authority.values);
  const selected = selectedId === null ? organizations[0] : organizations.find(row => row.id === organizationId(selectedId));
  if (selectedId !== null && !selected) throw new HttpError(404, 'Organização indisponível.', 'assistant_organization');
  let storageReady = false;
  try { await credentialKeyId(keys.current, authSecret); storageReady = true; } catch { /* Deployment has not configured the independent secret. */ }
  const id = selected?.id;
  const { row, credentials } = id ? await storedSettings(db, id, authSecret, keys) : { row: null, credentials: {} };
  const metadata = id ? await all(db, `SELECT c.provider,c.label,c.mask,c.state,c.created_at,c.updated_at,
    COALESCE(NULLIF(creator.display_name,''),'Administração geral') AS created_by,
    COALESCE(NULLIF(updater.display_name,''),'Administração geral') AS updated_by
    FROM ai_provider_credential_metadata c LEFT JOIN profiles creator ON creator.user_id=c.created_by
    LEFT JOIN profiles updater ON updater.user_id=c.updated_by
    WHERE c.organization_id=? AND ${authority.sql}`, [id, ...authority.values]) : [];
  const today = dayInBrazil.format(new Date());
  const usage = id ? await one(db, `SELECT COALESCE(SUM(CASE WHEN day=? THEN reserved_usd_micros ELSE 0 END),0) AS today,
    COALESCE(SUM(reserved_usd_micros),0) AS month FROM ai_organization_usage WHERE organization_id=? AND substr(day,1,7)=? AND ${authority.sql}`,
  [today, id, today.slice(0, 7), ...authority.values]) : null;
  const disabled = disabledCredentials(credentials);
  const secrets = protectedValues(authSecret, keys, speech, credentials, disabled);
  const entries = credentialProviders.map(provider => {
    const saved = metadata.find(entry => entry.provider === provider);
    const present = !!credentials && validProviderKey(credentials[provider]);
    const status = credentials === null ? 'unavailable' : present ? 'active' : validProviderKey(disabled[provider]) ? 'disabled' : saved?.state === 'removed' ? 'removed' : 'missing';
    return { provider, label: safeLabel(saved?.label, secrets) ?? providers[provider], purpose: purposes[provider], status,
      mask: safeMask(provider, saved?.mask), createdAt: saved?.created_at ?? null, createdBy: saved?.created_by ?? null,
      updatedAt: saved?.updated_at ?? null, updatedBy: saved?.updated_by ?? null };
  });
  if (!await one(db, `SELECT 1 WHERE ${authority.sql}`, authority.values)) throw forbidden();
  return { organizations, organizationId: id ?? null, revision: Number(row?.revision ?? 0), storageReady,
    legacyAvailable: !keys.current && !keys.previous && (!row || String(row.credentials_ciphertext).startsWith('v1.')),
    recoverable: credentials === null, keys: entries,
    groqPilot: typeof id === 'string' && speechProviderForOrganization(id, speech) === 'groq' ? validProviderKey(speech?.groqKey) ? 'configured' : 'missing' : null,
    reserved: { today: Number(usage?.today ?? 0), month: Number(usage?.month ?? 0), dailyLimit: row ? validateConfig(JSON.parse(row.config_json)).dailyUsdMicros : DEFAULT_ASSISTANT_CONFIG.dailyUsdMicros } };
}

function suspendDependentFeatures(config: AssistantConfig, provider: CredentialProvider, id: string, speech?: SpeechEnvironment) {
  if ((provider === 'deepseek'||provider==='openai')&&config.textProvider===provider) { config.enabled = false; config.documentEnabled = false; }
  if (provider === 'typesafe') config.jevEnabled = false;
  if ((provider === 'deepgram'||provider==='groq') && speechProviderForOrganization(id, speech, config.sttProvider) === provider) config.sttEnabled = false;
}

export async function manageAssistantCredential(db: D1Database, caller: PortalActor | null, input: Record<string, unknown>, authSecret: string, keys: CredentialKeys, speech?: SpeechEnvironment) {
  const { actor, authority } = await requireOwner(db, caller);
  const action = input.action;
  if (action !== 'save' && action !== 'disable' && action !== 'enable' && action !== 'remove') throw new HttpError(400, 'Escolha uma ação de credencial.', 'assistant_key_action');
  const saving = action === 'save';
  onlyKeys(input, ['action', 'organizationId', 'provider', 'expectedRevision', ...(saving ? ['label', 'secret', 'replaceUnavailable'] : [])]);
  const id = organizationId(input.organizationId), provider = input.provider as CredentialProvider;
  if (!credentialProviders.includes(provider)) throw new HttpError(400, 'Escolha um provedor disponível no cofre.', 'assistant_provider');
  await credentialKeyId(keys.current, authSecret);
  if (!await one(db, `SELECT 1 FROM organizations WHERE id=? AND status='active' AND ${authority.sql}`, [id, ...authority.values])) throw new HttpError(404, 'Organização indisponível.', 'assistant_organization');
  const { row, credentials } = await storedSettings(db, id, authSecret, keys);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (row?.revision ?? 0)) throw conflict();
  const recover = credentials === null && saving && input.replaceUnavailable === true;
  if (credentials === null && !recover) throw new HttpError(409, 'Confirme a substituição das credenciais indisponíveis para recuperar o cofre.', 'assistant_key_recovery');
  if (input.replaceUnavailable !== undefined && (input.replaceUnavailable !== true || !recover)) throw conflict();
  const current = credentials ?? {};
  const disabled = disabledCredentials(current);
  const previousKey = current[provider] ?? disabled[provider];
  const previous = await one(db, 'SELECT label,mask FROM ai_provider_credential_metadata WHERE organization_id=? AND provider=?', [id, provider]);
  const secrets = protectedValues(authSecret, keys, speech, current, disabled);
  let label = safeLabel(previous?.label, secrets) ?? providers[provider];
  let mask = safeMask(provider, previous?.mask) ?? '';
  if (saving) {
    if (!validProviderKey(input.secret)) throw new HttpError(400, 'Informe uma credencial válida do provedor.', 'assistant_credentials');
    const name = safeLabel(input.label, [input.secret, ...secrets]);
    if (!name) throw new HttpError(400, 'Informe um nome curto sem credenciais ou segredos.', 'assistant_key_label');
    label = name;
    current[provider] = input.secret;
    mask = credentialMask(provider, input.secret);
  } else if (!validProviderKey(previousKey)) {
    throw new HttpError(409, 'Cadastre uma credencial deste provedor antes de alterar seu estado.', 'assistant_credentials');
  }
  // Retain a disabled key outside the provider fields used by runtime callers,
  // including older builds that read the v2 envelope.
  if (action === 'disable') disabled[provider] = previousKey;
  else delete disabled[provider];
  if (action === 'disable' || action === 'remove') delete current[provider];
  if (action === 'enable') current[provider] = previousKey;
  current.disabledCredentials = disabled;
  const config = row ? validateConfig(JSON.parse(row.config_json)) : newAssistantConfig(actor.userId);
  if (recover) credentialProviders.forEach(name => suspendDependentFeatures(config, name, id, speech));
  if (action !== 'enable') suspendDependentFeatures(config, provider, id, speech);
  const ciphertext = await encryptProviderCredentials(authSecret, current, id, keys, row?.credentials_ciphertext);
  const at = iso(), revision = Number(input.expectedRevision) + 1;
  const state = action === 'remove' ? 'removed' : action === 'disable' ? 'disabled' : 'active';
  const guard = db.prepare(`SELECT CASE WHEN ${authority.sql} AND EXISTS(SELECT 1 FROM organizations WHERE id=? AND status='active') THEN 1 ELSE json_extract('[]','vault_authority_changed') END`).bind(...authority.values, id);
  const write = row ? db.prepare('UPDATE ai_organization_settings SET revision=?,config_json=?,credentials_ciphertext=?,updated_by=?,updated_at=? WHERE organization_id=? AND revision=? AND credentials_ciphertext=?')
    .bind(revision, JSON.stringify(config), ciphertext, actor.userId, at, id, input.expectedRevision, row.credentials_ciphertext)
    : db.prepare('INSERT INTO ai_organization_settings(organization_id,revision,config_json,credentials_ciphertext,updated_by,updated_at) VALUES(?,?,?,?,?,?)')
      .bind(id, revision, JSON.stringify(config), ciphertext, actor.userId, at);
  const verify = db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','vault_revision_changed') END");
  const metadata = db.prepare(`INSERT INTO ai_provider_credential_metadata(organization_id,provider,label,mask,state,created_at,created_by,updated_at,updated_by)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,provider) DO UPDATE SET label=excluded.label,mask=excluded.mask,state=excluded.state,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
    .bind(id, provider, label, mask, state, at, actor.userId, at, actor.userId);
  const audit = db.prepare('INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), actor.userId, id, `assistant.credentials.${recover ? 'recover' : action}`, id, JSON.stringify({ provider, state, revision }), at);
  try {
    await db.batch([guard, write, verify, metadata,
      ...(recover ? [db.prepare("UPDATE ai_provider_credential_metadata SET state='removed',updated_at=?,updated_by=? WHERE organization_id=? AND provider<>?").bind(at, actor.userId, id, provider)] : []),
      audit]);
  } catch (error) {
    const message = String(error);
    if (message.includes('vault_authority_changed')) throw forbidden();
    if (message.includes('vault_revision_changed') || message.includes('UNIQUE constraint failed: ai_organization_settings.organization_id')) throw conflict();
    throw error;
  }
  return assistantCredentialVault(db, actor, id, authSecret, keys, speech);
}
