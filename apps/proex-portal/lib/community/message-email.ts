import type { PortalActor } from '../access';
import { one } from '../database';
import { syncDigest } from '../sync/contracts';
import { activeAccount } from '../follow-up/scope';
import { emailAddress, emailDispatchInternals as e, emailOwnerCheck, type EmailDispatcher } from '../follow-up/email';
import { messagePairSql } from './messages';

/*
 * Optional e-mail notice for a new direct message (recado), through the channel the portal already uses (MailApp).
 * Same configuration, dispatch credential, consent (followup_email_preferences), quotas and interval as the
 * demand notices; its own queue (`community_email_queue`, ids `cm-…`). The e-mail carries no content and no sender:
 * only "Você recebeu um recado" and the link. A person turns it off in the Recados tab (community_preferences.message_email).
 * Offered only to an Apps Script that declares support (`kinds` includes 'message'), so an older script never
 * receives a template it would refuse.
 */
type Input = Record<string, unknown>;
export const MESSAGE_EMAIL_PREFIX = 'cm-';
export const MESSAGE_EMAIL_SUBJECT = 'PROEX · Novo recado';
export const MESSAGE_EMAIL_PERSON_DAILY = 2;
export const isMessageEmailId = (value: unknown) => typeof value === 'string' && value.startsWith(MESSAGE_EMAIL_PREFIX);

function eligible() {
  return `${activeAccount('recipient')} AND prefs.enabled=1 AND lower(recipient.email)=prefs.consent_email AND m.created_at>=prefs.enabled_at
    AND m.read_at IS NULL AND m.recipient_hidden_at IS NULL AND m.created_at>=?
    AND EXISTS(SELECT 1 FROM organizations org WHERE org.id=m.organization_id AND org.status='active')
    AND COALESCE((SELECT cp.message_email FROM community_preferences cp WHERE cp.user_id=recipient.user_id),1)=1
    AND ${messagePairSql('m.sender_id', 'm.recipient_id', 'm.organization_id')}
    AND NOT EXISTS(SELECT 1 FROM community_blocks b WHERE (b.user_id=m.sender_id AND b.blocked_id=m.recipient_id) OR (b.user_id=m.recipient_id AND b.blocked_id=m.sender_id))`;
}
const joins = `FROM community_email_queue q JOIN community_messages m ON m.id=q.message_id JOIN portal_users recipient ON recipient.user_id=q.user_id
  JOIN followup_email_preferences prefs ON prefs.organization_id=q.organization_id AND prefs.user_id=q.user_id`;
const lookback = (now: number) => new Date(now - e.LOOKBACK_MS).toISOString();
/**
 * At most one notice "in flight" per person: none while another one is claimed or being sent, while an uncertain one is
 * younger than 24 h, or while an accepted one (last 24 h) points to a message still unread. Older states stop blocking.
 */
const notBusy = `NOT EXISTS(SELECT 1 FROM community_email_queue busy LEFT JOIN community_messages bm ON bm.id=busy.message_id WHERE busy.user_id=q.user_id AND busy.id!=q.id
  AND (busy.status IN ('claimed','sending') OR (busy.status='uncertain' AND busy.updated_at>?)
    OR (busy.status IN ('accepted','accepted_attested') AND busy.accepted_at>? AND bm.read_at IS NULL AND bm.recipient_hidden_at IS NULL)))`;

export async function claimMessageEmail(db: D1Database, principal: EmailDispatcher, input: Input, runtimeOrigin: unknown, now = Date.now()) {
  e.keys(input, ['action', 'organizationId', 'installerEmail', 'remainingQuota']);
  await e.requireDispatcher(db, principal, input.organizationId);
  const c = await e.config(db, e.id(input.organizationId), runtimeOrigin, input.installerEmail);
  if (e.quotaInput(input.remainingQuota) < 1) return { claim: null, state: 'google_quota' };
  if (c.next_send_at > now) return { claim: null, state: 'interval' };
  const at = new Date(now).toISOString();
  await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c),
    db.prepare("UPDATE community_email_queue SET status='queued',claim_hash=NULL,claim_nonce=NULL,claim_expires_at=NULL,updated_at=? WHERE organization_id=? AND status='claimed' AND claim_expires_at<=?").bind(at, c.organization_id, now),
    db.prepare(`INSERT OR IGNORE INTO community_email_queue(id,message_id,organization_id,user_id,created_at,updated_at)
      SELECT '${MESSAGE_EMAIL_PREFIX}'||lower(hex(randomblob(16))),m.id,m.organization_id,m.recipient_id,?,? FROM community_messages m JOIN portal_users recipient ON recipient.user_id=m.recipient_id
      JOIN followup_email_preferences prefs ON prefs.organization_id=m.organization_id AND prefs.user_id=m.recipient_id
      WHERE m.organization_id=? AND ${eligible()} AND NOT EXISTS(SELECT 1 FROM community_email_queue old WHERE old.message_id=m.id)
      ORDER BY m.created_at,m.id LIMIT 50`).bind(at, at, c.organization_id, lookback(now))]);
  const candidate = await one(db, `SELECT q.id ${joins} WHERE q.organization_id=? AND q.status='queued' AND ${eligible()} AND ${notBusy} ORDER BY q.created_at,q.id LIMIT 1`, [c.organization_id, lookback(now), lookback(now), lookback(now)]);
  if (!candidate) return { claim: null, state: 'idle' };
  const token = e.randomToken(), hash = await syncDigest(token), nonce = crypto.randomUUID();
  await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c),
    e.assertion(db, `EXISTS(SELECT 1 ${joins} WHERE q.id=? AND q.status='queued' AND ${eligible()} AND ${notBusy})`, [candidate.id, lookback(now), lookback(now), lookback(now)], 'email_recipient_changed'),
    db.prepare("UPDATE community_email_queue SET status='claimed',claim_hash=?,claim_nonce=?,claim_expires_at=?,dispatcher_id=?,credential_hash=?,configuration_version=?,updated_at=? WHERE id=? AND status='queued'")
      .bind(hash, nonce, now + e.CLAIM_MS, principal.actor.userId, principal.credentialHash, c.version, at, candidate.id)]);
  return { claim: { id: candidate.id, claimToken: token, expiresAt: new Date(now + e.CLAIM_MS).toISOString() } };
}

async function queueRow(db: D1Database, principal: EmailDispatcher, input: Input, c: { organization_id: string; version: number }) {
  const token = input.claimToken;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) e.fail('email_claim_changed', 'Claim inválido.');
  const row = await one(db, 'SELECT * FROM community_email_queue WHERE id=? AND organization_id=?', [e.id(input.id), c.organization_id]);
  if (!row || row.claim_hash !== await syncDigest(token as string) || row.dispatcher_id !== principal.actor.userId || row.credential_hash !== principal.credentialHash || row.configuration_version !== c.version) e.fail('email_claim_changed', 'O claim pertence a outra operação, chave ou configuração.');
  return row!;
}

export async function beginMessageEmail(db: D1Database, principal: EmailDispatcher, input: Input, runtimeOrigin: unknown, now = Date.now()) {
  e.keys(input, ['action', 'organizationId', 'installerEmail', 'remainingQuota', 'id', 'claimToken']);
  await e.requireDispatcher(db, principal, input.organizationId);
  const c = await e.config(db, e.id(input.organizationId), runtimeOrigin, input.installerEmail);
  if (e.quotaInput(input.remainingQuota) < 1) e.fail('email_google_quota', 'A conta não tem cota MailApp disponível.');
  const row = await queueRow(db, principal, input, c);
  if (row.status !== 'claimed' || Number(row.claim_expires_at) <= now) e.fail('email_claim_changed', 'O aviso já foi iniciado ou o claim expirou.');
  const at = new Date(now).toISOString(), day = e.dayKey(now);
  // Shared organization/person quotas plus smaller message-only buckets, so recados never use up the demand notices.
  const buckets = [{ day, bucket: 'organization', limit: c.daily_limit }, { day, bucket: 'person:' + row.user_id, limit: c.person_daily_limit }, { day, bucket: 'messages:organization', limit: Math.max(1, Math.floor(c.daily_limit / 3)) }, { day, bucket: 'messages:person:' + row.user_id, limit: MESSAGE_EMAIL_PERSON_DAILY }, { day: 'all', bucket: 'message:' + row.message_id, limit: 1 }];
  const sendNonce = crypto.randomUUID(), acceptanceToken = e.randomToken(), acceptanceHash = await syncDigest(acceptanceToken);
  await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c),
    e.assertion(db, "EXISTS(SELECT 1 FROM community_email_queue WHERE id=? AND status='claimed' AND claim_hash=? AND claim_nonce=? AND claim_expires_at>? AND dispatcher_id=? AND credential_hash=? AND configuration_version=?)", [row.id, row.claim_hash, row.claim_nonce, now, row.dispatcher_id, row.credential_hash, row.configuration_version], 'email_claim_changed'),
    e.assertion(db, `EXISTS(SELECT 1 ${joins} WHERE q.id=? AND ${eligible()})`, [row.id, lookback(now)], 'email_recipient_changed'),
    e.assertion(db, 'EXISTS(SELECT 1 FROM followup_email_configuration WHERE organization_id=? AND next_send_at<=?)', [c.organization_id, now], 'email_interval'),
    ...buckets.map(b => db.prepare('INSERT INTO followup_email_usage(organization_id,day,bucket) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(c.organization_id, b.day, b.bucket)),
    ...buckets.map(b => e.assertion(db, 'EXISTS(SELECT 1 FROM followup_email_usage WHERE organization_id=? AND day=? AND bucket=? AND reserved<?)', [c.organization_id, b.day, b.bucket, b.limit], 'email_quota')),
    db.prepare("UPDATE community_email_queue SET status='sending',send_nonce=?,acceptance_hash=?,sending_at=?,updated_at=? WHERE id=? AND status='claimed'").bind(sendNonce, acceptanceHash, at, at, row.id),
    ...buckets.map(b => db.prepare("UPDATE followup_email_usage SET reserved=reserved+1 WHERE organization_id=? AND day=? AND bucket=? AND EXISTS(SELECT 1 FROM community_email_queue WHERE id=? AND send_nonce=? AND status='sending')").bind(c.organization_id, b.day, b.bucket, row.id, sendNonce)),
    db.prepare('UPDATE followup_email_configuration SET next_send_at=? WHERE organization_id=?').bind(now + c.interval_seconds * 1000, c.organization_id),
    e.audit(db, principal.actor.userId, c.organization_id, 'community.email.sending', String(row.id), at)]);
  const d = e.dispatcherSql(principal);
  const recipient = await one(db, `SELECT lower(recipient.email) email ${joins} WHERE q.id=? AND q.status='sending' AND q.send_nonce=? AND ${eligible()} AND ${d.sql}
    AND EXISTS(SELECT 1 FROM followup_email_configuration WHERE organization_id=? AND enabled=1 AND version=?)`, [row.id, sendNonce, lookback(Date.now()), ...d.values, c.organization_id, c.version]);
  if (!recipient) {
    await db.prepare("UPDATE community_email_queue SET status='uncertain',updated_at=? WHERE id=? AND send_nonce=? AND status='sending'").bind(new Date().toISOString(), row.id, sendNonce).run();
    e.fail('email_recipient_changed', 'O acesso mudou após a reserva. Nenhum conteúdo será liberado.');
  }
  return { senderEmail: c.sender_email, to: emailAddress(recipient!.email), subject: MESSAGE_EMAIL_SUBJECT, body: `Você recebeu um recado no Portal PROEX.\n\nAcesse o portal para ler:\n${c.portal_origin}/?module=community&tab=messages`, acceptanceToken, sendNonce };
}

export async function acknowledgeMessageEmail(db: D1Database, principal: EmailDispatcher, input: Input, runtimeOrigin: unknown) {
  e.keys(input, ['action', 'organizationId', 'installerEmail', 'id', 'claimToken', 'acceptanceToken']);
  await e.requireDispatcher(db, principal, input.organizationId);
  const c = await e.config(db, e.id(input.organizationId), runtimeOrigin, input.installerEmail), row = await queueRow(db, principal, input, c);
  if (typeof input.acceptanceToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.acceptanceToken) || row.acceptance_hash !== await syncDigest(input.acceptanceToken) || !['sending', 'uncertain', 'accepted'].includes(String(row.status))) e.fail('email_claim_changed', 'Recibo de aceitação inválido.');
  if (row.status === 'accepted') { await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c)]); return { status: 'accepted', meaning: 'mailapp_returned_without_error', replayed: true }; }
  const at = new Date().toISOString();
  const result = await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c),
    db.prepare("UPDATE community_email_queue SET status='accepted',accepted_at=COALESCE(accepted_at,?),updated_at=? WHERE id=? AND acceptance_hash=? AND status IN('sending','uncertain')").bind(at, at, row.id, row.acceptance_hash),
    db.prepare("INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,?,'community.email.accepted',?,'{}',? WHERE changes()=1").bind(crypto.randomUUID(), principal.actor.userId, c.organization_id, row.id, at)]);
  return { status: 'accepted', meaning: 'mailapp_returned_without_error', replayed: Number(result![2].meta.changes) !== 1 };
}

export async function recoverMessageEmail(db: D1Database, principal: EmailDispatcher, input: Input) {
  e.keys(input, ['action', 'organizationId', 'installerEmail', 'id', 'claimToken']);
  await e.requireDispatcher(db, principal, input.organizationId);
  if (typeof input.claimToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.claimToken)) e.fail('email_claim_changed', 'Claim inválido.');
  const row = await one(db, 'SELECT * FROM community_email_queue WHERE id=? AND organization_id=?', [e.id(input.id), e.id(input.organizationId)]);
  if (!row || row.claim_hash !== await syncDigest(input.claimToken as string) || row.dispatcher_id !== principal.actor.userId) return { status: 'superseded' };
  await e.batch(db, [e.dispatcherAssertion(db, principal), db.prepare("UPDATE community_email_queue SET status=CASE WHEN status='claimed' THEN 'queued' WHEN status='sending' THEN 'uncertain' ELSE status END,claim_hash=CASE WHEN status='claimed' THEN NULL ELSE claim_hash END,claim_nonce=CASE WHEN status='claimed' THEN NULL ELSE claim_nonce END,updated_at=? WHERE id=? AND claim_hash=?").bind(new Date().toISOString(), row.id, row.claim_hash)]);
  const after = await one(db, 'SELECT status FROM community_email_queue WHERE id=?', [row.id]);
  return { status: after?.status ?? 'uncertain' };
}

export async function reconcileMessageEmail(db: D1Database, actor: PortalActor | null, input: Input) {
  e.keys(input, ['action', 'organizationId', 'id', 'outcome', 'confirmed']);
  if (!actor) e.fail('unauthenticated', 'Entre para conferir o envio.', 401);
  const orgId = e.id(input.organizationId), queueId = e.id(input.id);
  if (!['accepted_attested', 'close_unconfirmed'].includes(String(input.outcome)) || input.confirmed !== true) e.fail('email_reconcile_confirmation', 'Confirme a conferência manual. Nenhum reenvio é criado.', 400);
  const at = new Date().toISOString();
  await e.batch(db, [e.assertion(db, emailOwnerCheck(), [actor!.userId, orgId]),
    e.assertion(db, "EXISTS(SELECT 1 FROM community_email_queue WHERE id=? AND organization_id=? AND status IN('sending','uncertain'))", [queueId, orgId], 'email_claim_changed'),
    db.prepare('UPDATE community_email_queue SET status=?,reconciled_at=?,updated_at=? WHERE id=?').bind(input.outcome === 'accepted_attested' ? 'accepted_attested' : 'closed_unconfirmed', at, at, queueId),
    e.audit(db, actor!.userId, orgId, input.outcome === 'accepted_attested' ? 'community.email.accepted_attested' : 'community.email.closed_unconfirmed', queueId, at)]);
  return { ok: true, retry: false, meaning: 'manual_attestation_no_delivery_proof' };
}

/** The person's own switch for message e-mails (on by default; the general e-mail consent is still required). */
export async function messageEmailPreference(db: D1Database, userId: string, enabled: boolean) {
  await db.prepare('INSERT INTO community_preferences(user_id,badges,seen_level,message_email,version,updated_at) VALUES(?,1,1,?,1,?) ON CONFLICT(user_id) DO UPDATE SET message_email=excluded.message_email,updated_at=excluded.updated_at').bind(userId, enabled ? 1 : 0, new Date().toISOString()).run();
  return { messageEmail: enabled };
}
export async function messageEmailState(db: D1Database, userId: string) {
  const row = await one(db, 'SELECT message_email FROM community_preferences WHERE user_id=?', [userId]);
  const consent = await one(db, 'SELECT COUNT(*) n FROM followup_email_preferences WHERE user_id=? AND enabled=1', [userId]);
  return { messageEmail: row ? !!row.message_email : true, emailConsent: Number(consent?.n ?? 0) > 0 };
}
