import { requireCapability, requireOrganizationCapability, type PortalActor } from '../access';
import { one } from '../database';
import { HttpError } from '../errors';
import { syncDigest } from '../sync/contracts';
import { decryptCredentials, encryptCredentials } from '../assistant/crypto';
import { readInvitationCode } from '../invitation-link';
import { emailAddress, emailDispatchInternals as e, emailOwnerCheck, type EmailDispatcher } from '../follow-up/email';

/*
 * Invite e-mail through the notice channel the portal already uses (MailApp of the organization), on request of the
 * person who created the invite (17/11). Same configuration, dispatch credential, quotas and interval as the other
 * notices; own queue `invite_email_queue`, ids `iv-…`.
 *
 * - Offered only when the queue is working: e-mail on in Configurações and an Apps Script that declared `kinds`
 *   including 'invite' in the last 48 h. Otherwise the screen says so and keeps WhatsApp, copy and QR.
 * - The invite code is kept encrypted only until MailApp accepts the message, then erased. Accepted, cancelled or
 *   expired invites are never sent; their queued rows are cancelled and the code erased.
 * - The recipient is the invite's own e-mail; nothing from the request chooses it.
 */
type Input = Record<string, unknown>;
export const INVITE_EMAIL_PREFIX = 'iv-';
export const INVITE_EMAIL_SUBJECT = 'PROEX · Convite para o portal';
export const INVITE_EMAIL_READY_MS = 48 * 3_600_000;
export const isInviteEmailId = (value: unknown) => typeof value === 'string' && value.startsWith(INVITE_EMAIL_PREFIX);
const scopeOf = (id: string) => `invite-email:${id}`;
const lookback = (now: number) => new Date(now - e.LOOKBACK_MS).toISOString();
/** Invite still usable: not accepted, not revoked, not expired. */
const live = (now: number) => `i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>'${new Date(now).toISOString()}'`;
const joins = 'FROM invite_email_queue q JOIN invites i ON i.id=q.invite_id';

async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function fail(status: number, message: string, code: string): never { throw new HttpError(status, message, code); }

/** Whether invite e-mails can go out for this organization now. */
export async function inviteEmailReady(db: D1Database, organizationId: string, now = Date.now()) {
  const row = await one(db, `SELECT c.enabled,s.invite_kind_at FROM followup_email_configuration c LEFT JOIN followup_email_dispatch_state s ON s.organization_id=c.organization_id WHERE c.organization_id=?`, [organizationId]);
  return Boolean(row && Number(row.enabled) === 1 && row.invite_kind_at && Date.parse(String(row.invite_kind_at)) > now - INVITE_EMAIL_READY_MS);
}
/** The Apps Script declared support for invites in this claim (kinds includes 'invite'). */
export async function recordInviteEmailSupport(db: D1Database, organizationId: string, now = Date.now()) {
  const at = new Date(now).toISOString();
  await db.prepare("INSERT INTO followup_email_dispatch_state(organization_id,invite_kind_at,updated_at) VALUES(?,?,?) ON CONFLICT(organization_id) DO UPDATE SET invite_kind_at=excluded.invite_kind_at").bind(organizationId, at, at).run();
}

async function ownInvite(db: D1Database, actor: PortalActor | null, inviteId: unknown) {
  if (!actor) fail(401, 'Entre com sua conta para continuar.', 'unauthenticated');
  if (typeof inviteId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(inviteId)) fail(400, 'Convite inválido.', 'invalid_invite');
  const invite = await one(db, `SELECT i.*,COALESCE(i.organization_id,p.organization_id) org FROM invites i LEFT JOIN projects p ON p.id=i.project_id WHERE i.id=?`, [inviteId]);
  if (!invite) fail(404, 'Convite não encontrado.', 'invite_not_found');
  // Only who created the link (and still may invite in that scope) asks for its e-mail.
  if (invite!.created_by !== actor!.userId) fail(403, 'Só quem criou o convite pode enviá-lo por e-mail.', 'invite_email_forbidden');
  if (invite!.project_id) requireCapability(actor, 'access.invite', String(invite!.project_id)); else requireOrganizationCapability(actor, 'access.invite', String(invite!.org));
  return invite!;
}

/** Screen: is e-mail available for this invite, and where is its message? */
export async function inviteEmailStatus(db: D1Database, actor: PortalActor | null, input: Input) {
  const invite = await ownInvite(db, actor, input.inviteId);
  const queued = await one(db, 'SELECT status FROM invite_email_queue WHERE invite_id=?', [invite.id]);
  return { available: await inviteEmailReady(db, String(invite.org)), status: queued ? String(queued.status) : null };
}

/** Queue the e-mail for an invite the person just created. The link proves the code; only its hash is in `invites`. */
export async function queueInviteEmail(db: D1Database, actor: PortalActor | null, input: Input, secret: string | undefined, now = Date.now()) {
  const invite = await ownInvite(db, actor, input.inviteId);
  if (typeof secret !== 'string' || secret.length < 32) fail(503, 'O envio por e-mail precisa ser configurado pelo responsável.', 'invite_email_unavailable');
  let code = '';
  try { const link = new URL(String(input.url)); code = link.pathname === '/convite' ? readInvitationCode(link.search, link.hash) : ''; } catch { code = ''; }
  if (!code || await sha256Hex(code) !== invite.token_hash) fail(400, 'O link não corresponde a este convite. Gere o convite de novo.', 'invite_email_link');
  if (invite.accepted_at) fail(409, 'Este convite já foi aceito.', 'invite_used');
  if (invite.revoked_at) fail(409, 'Este convite foi cancelado.', 'invite_revoked');
  if (Date.parse(String(invite.expires_at)) <= now) fail(409, 'Este convite expirou. Gere um novo.', 'invite_expired');
  if (!await inviteEmailReady(db, String(invite.org), now)) fail(409, 'O envio por e-mail ainda não está ligado nesta organização. Use o WhatsApp, a mensagem ou o QR.', 'invite_email_unavailable');
  const existing = await one(db, 'SELECT status FROM invite_email_queue WHERE invite_id=?', [invite.id]);
  if (existing) return { queued: true, status: String(existing.status), duplicate: true };
  const id = INVITE_EMAIL_PREFIX + crypto.randomUUID().replace(/-/g, ''), at = new Date(now).toISOString();
  const cipher = await encryptCredentials(secret, { code }, scopeOf(id));
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO invite_email_queue(id,invite_id,organization_id,code_cipher,requested_by,created_at,updated_at)
      SELECT ?,i.id,?,?,?,?,? FROM invites i WHERE i.id=? AND i.created_by=? AND ${live(now)}`).bind(id, invite.org, cipher, actor!.userId, at, at, invite.id, actor!.userId),
    db.prepare("INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,?,'invite.email.queued',?,'{}',? WHERE changes()=1").bind(crypto.randomUUID(), actor!.userId, invite.org, invite.id, at),
  ]);
  const row = await one(db, 'SELECT status FROM invite_email_queue WHERE invite_id=?', [invite.id]);
  if (!row) fail(409, 'O convite mudou. Atualize a página.', 'invite_changed');
  return { queued: true, status: String(row!.status) };
}

export async function claimInviteEmail(db: D1Database, principal: EmailDispatcher, input: Input, runtimeOrigin: unknown, now = Date.now()) {
  e.keys(input, ['action', 'organizationId', 'installerEmail', 'remainingQuota']);
  await e.requireDispatcher(db, principal, input.organizationId);
  const c = await e.config(db, e.id(input.organizationId), runtimeOrigin, input.installerEmail);
  if (e.quotaInput(input.remainingQuota) < 1) return { claim: null, state: 'google_quota' };
  if (c.next_send_at > now) return { claim: null, state: 'interval' };
  const at = new Date(now).toISOString();
  await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c),
    db.prepare("UPDATE invite_email_queue SET status='queued',claim_hash=NULL,claim_nonce=NULL,claim_expires_at=NULL,updated_at=? WHERE organization_id=? AND status='claimed' AND claim_expires_at<=?").bind(at, c.organization_id, now),
    // An invite accepted, cancelled or expired before its turn is never sent, and its code is erased.
    db.prepare(`UPDATE invite_email_queue SET status='cancelled',code_cipher=NULL,updated_at=? WHERE organization_id=? AND status='queued' AND NOT EXISTS(SELECT 1 FROM invites i WHERE i.id=invite_email_queue.invite_id AND ${live(now)})`).bind(at, c.organization_id)]);
  const candidate = await one(db, `SELECT q.id ${joins} WHERE q.organization_id=? AND q.status='queued' AND q.code_cipher IS NOT NULL AND q.created_at>=? AND ${live(now)} ORDER BY q.created_at,q.id LIMIT 1`, [c.organization_id, lookback(now)]);
  if (!candidate) return { claim: null, state: 'idle' };
  const token = e.randomToken(), hash = await syncDigest(token), nonce = crypto.randomUUID();
  await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c),
    e.assertion(db, `EXISTS(SELECT 1 ${joins} WHERE q.id=? AND q.status='queued' AND ${live(now)})`, [candidate.id], 'email_recipient_changed'),
    db.prepare("UPDATE invite_email_queue SET status='claimed',claim_hash=?,claim_nonce=?,claim_expires_at=?,dispatcher_id=?,credential_hash=?,configuration_version=?,updated_at=? WHERE id=? AND status='queued'")
      .bind(hash, nonce, now + e.CLAIM_MS, principal.actor.userId, principal.credentialHash, c.version, at, candidate.id)]);
  return { claim: { id: candidate.id, claimToken: token, expiresAt: new Date(now + e.CLAIM_MS).toISOString() } };
}

async function queueRow(db: D1Database, principal: EmailDispatcher, input: Input, c: { organization_id: string; version: number }) {
  const token = input.claimToken;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) e.fail('email_claim_changed', 'Claim inválido.');
  const row = await one(db, 'SELECT * FROM invite_email_queue WHERE id=? AND organization_id=?', [e.id(input.id), c.organization_id]);
  if (!row || row.claim_hash !== await syncDigest(token as string) || row.dispatcher_id !== principal.actor.userId || row.credential_hash !== principal.credentialHash || row.configuration_version !== c.version) e.fail('email_claim_changed', 'O claim pertence a outra operação, chave ou configuração.');
  return row!;
}

/** Fixed template; the last line is the personal link, rebuilt from the configured portal origin. */
export function inviteEmailBody(portalOrigin: string, code: string) {
  return `Você recebeu um convite para o Portal PROEX UFG.\n\nO link é pessoal e vale por tempo limitado. Não o repasse a outras pessoas.\nPara ativar seu acesso, abra:\n${portalOrigin}/convite#token=${code}`;
}

export async function beginInviteEmail(db: D1Database, principal: EmailDispatcher, input: Input, runtimeOrigin: unknown, secret: string | undefined, now = Date.now()) {
  e.keys(input, ['action', 'organizationId', 'installerEmail', 'remainingQuota', 'id', 'claimToken']);
  await e.requireDispatcher(db, principal, input.organizationId);
  const c = await e.config(db, e.id(input.organizationId), runtimeOrigin, input.installerEmail);
  if (e.quotaInput(input.remainingQuota) < 1) e.fail('email_google_quota', 'A conta não tem cota MailApp disponível.');
  if (typeof secret !== 'string' || secret.length < 32) e.fail('email_unavailable', 'O envio de convites não está configurado.', 503);
  const row = await queueRow(db, principal, input, c);
  if (row.status !== 'claimed' || Number(row.claim_expires_at) <= now) e.fail('email_claim_changed', 'O aviso já foi iniciado ou o claim expirou.');
  const at = new Date(now).toISOString(), day = e.dayKey(now);
  // Shared organization quota plus a smaller invite bucket, and one e-mail per invite, ever.
  const buckets = [{ day, bucket: 'organization', limit: c.daily_limit }, { day, bucket: 'invites:organization', limit: Math.max(1, Math.floor(c.daily_limit / 3)) }, { day: 'all', bucket: 'invite:' + row.invite_id, limit: 1 }];
  const sendNonce = crypto.randomUUID(), acceptanceToken = e.randomToken(), acceptanceHash = await syncDigest(acceptanceToken);
  await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c),
    e.assertion(db, "EXISTS(SELECT 1 FROM invite_email_queue WHERE id=? AND status='claimed' AND claim_hash=? AND claim_nonce=? AND claim_expires_at>? AND dispatcher_id=? AND credential_hash=? AND configuration_version=?)", [row.id, row.claim_hash, row.claim_nonce, now, row.dispatcher_id, row.credential_hash, row.configuration_version], 'email_claim_changed'),
    e.assertion(db, `EXISTS(SELECT 1 ${joins} WHERE q.id=? AND ${live(now)})`, [row.id], 'email_recipient_changed'),
    e.assertion(db, 'EXISTS(SELECT 1 FROM followup_email_configuration WHERE organization_id=? AND next_send_at<=?)', [c.organization_id, now], 'email_interval'),
    ...buckets.map(b => db.prepare('INSERT INTO followup_email_usage(organization_id,day,bucket) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(c.organization_id, b.day, b.bucket)),
    ...buckets.map(b => e.assertion(db, 'EXISTS(SELECT 1 FROM followup_email_usage WHERE organization_id=? AND day=? AND bucket=? AND reserved<?)', [c.organization_id, b.day, b.bucket, b.limit], 'email_quota')),
    db.prepare("UPDATE invite_email_queue SET status='sending',send_nonce=?,acceptance_hash=?,sending_at=?,updated_at=? WHERE id=? AND status='claimed'").bind(sendNonce, acceptanceHash, at, at, row.id),
    ...buckets.map(b => db.prepare("UPDATE followup_email_usage SET reserved=reserved+1 WHERE organization_id=? AND day=? AND bucket=? AND EXISTS(SELECT 1 FROM invite_email_queue WHERE id=? AND send_nonce=? AND status='sending')").bind(c.organization_id, b.day, b.bucket, row.id, sendNonce)),
    db.prepare('UPDATE followup_email_configuration SET next_send_at=? WHERE organization_id=?').bind(now + c.interval_seconds * 1000, c.organization_id),
    e.audit(db, principal.actor.userId, c.organization_id, 'invite.email.sending', String(row.id), at)]);
  const d = e.dispatcherSql(principal);
  const target = await one(db, `SELECT lower(i.email) email,q.code_cipher ${joins} WHERE q.id=? AND q.status='sending' AND q.send_nonce=? AND ${live(Date.now())} AND ${d.sql}
    AND EXISTS(SELECT 1 FROM followup_email_configuration WHERE organization_id=? AND enabled=1 AND version=?)`, [row.id, sendNonce, ...d.values, c.organization_id, c.version]);
  const payload = target?.code_cipher ? await decryptCredentials(secret!, String(target.code_cipher), scopeOf(String(row.id))) as { code?: unknown } | null : null;
  const code = typeof payload?.code === 'string' && /^[A-Za-z0-9_-]{43}$/.test(payload.code) ? payload.code : '';
  if (!target || !code) {
    await db.prepare("UPDATE invite_email_queue SET status='uncertain',code_cipher=NULL,updated_at=? WHERE id=? AND send_nonce=? AND status='sending'").bind(new Date().toISOString(), row.id, sendNonce).run();
    e.fail('email_recipient_changed', 'O convite mudou após a reserva. Nenhum conteúdo será liberado.');
  }
  return { senderEmail: c.sender_email, to: emailAddress(target!.email), subject: INVITE_EMAIL_SUBJECT, body: inviteEmailBody(c.portal_origin, code), acceptanceToken, sendNonce };
}

export async function acknowledgeInviteEmail(db: D1Database, principal: EmailDispatcher, input: Input, runtimeOrigin: unknown) {
  e.keys(input, ['action', 'organizationId', 'installerEmail', 'id', 'claimToken', 'acceptanceToken']);
  await e.requireDispatcher(db, principal, input.organizationId);
  const c = await e.config(db, e.id(input.organizationId), runtimeOrigin, input.installerEmail), row = await queueRow(db, principal, input, c);
  if (typeof input.acceptanceToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.acceptanceToken) || row.acceptance_hash !== await syncDigest(input.acceptanceToken) || !['sending', 'uncertain', 'accepted'].includes(String(row.status))) e.fail('email_claim_changed', 'Recibo de aceitação inválido.');
  if (row.status === 'accepted') { await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c)]); return { status: 'accepted', meaning: 'mailapp_returned_without_error', replayed: true }; }
  const at = new Date().toISOString();
  const result = await e.batch(db, [e.dispatcherAssertion(db, principal), e.configAssertion(db, c),
    // Accepted by MailApp: the code is no longer needed here.
    db.prepare("UPDATE invite_email_queue SET status='accepted',code_cipher=NULL,accepted_at=COALESCE(accepted_at,?),updated_at=? WHERE id=? AND acceptance_hash=? AND status IN('sending','uncertain')").bind(at, at, row.id, row.acceptance_hash),
    db.prepare("INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at) SELECT ?,?,?,'invite.email.accepted',?,'{}',? WHERE changes()=1").bind(crypto.randomUUID(), principal.actor.userId, c.organization_id, row.id, at)]);
  return { status: 'accepted', meaning: 'mailapp_returned_without_error', replayed: Number(result![2].meta.changes) !== 1 };
}

export async function recoverInviteEmail(db: D1Database, principal: EmailDispatcher, input: Input) {
  e.keys(input, ['action', 'organizationId', 'installerEmail', 'id', 'claimToken']);
  await e.requireDispatcher(db, principal, input.organizationId);
  if (typeof input.claimToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.claimToken)) e.fail('email_claim_changed', 'Claim inválido.');
  const row = await one(db, 'SELECT * FROM invite_email_queue WHERE id=? AND organization_id=?', [e.id(input.id), e.id(input.organizationId)]);
  if (!row || row.claim_hash !== await syncDigest(input.claimToken as string) || row.dispatcher_id !== principal.actor.userId) return { status: 'superseded' };
  await e.batch(db, [e.dispatcherAssertion(db, principal), db.prepare("UPDATE invite_email_queue SET status=CASE WHEN status='claimed' THEN 'queued' WHEN status='sending' THEN 'uncertain' ELSE status END,claim_hash=CASE WHEN status='claimed' THEN NULL ELSE claim_hash END,claim_nonce=CASE WHEN status='claimed' THEN NULL ELSE claim_nonce END,code_cipher=CASE WHEN status='sending' THEN NULL ELSE code_cipher END,updated_at=? WHERE id=? AND claim_hash=?").bind(new Date().toISOString(), row.id, row.claim_hash)]);
  const after = await one(db, 'SELECT status FROM invite_email_queue WHERE id=?', [row.id]);
  return { status: after?.status ?? 'uncertain' };
}

export async function reconcileInviteEmail(db: D1Database, actor: PortalActor | null, input: Input) {
  e.keys(input, ['action', 'organizationId', 'id', 'outcome', 'confirmed']);
  if (!actor) e.fail('unauthenticated', 'Entre para conferir o envio.', 401);
  const orgId = e.id(input.organizationId), queueId = e.id(input.id);
  if (!['accepted_attested', 'close_unconfirmed'].includes(String(input.outcome)) || input.confirmed !== true) e.fail('email_reconcile_confirmation', 'Confirme a conferência manual. Nenhum reenvio é criado.', 400);
  const at = new Date().toISOString();
  await e.batch(db, [e.assertion(db, emailOwnerCheck(), [actor!.userId, orgId]),
    e.assertion(db, "EXISTS(SELECT 1 FROM invite_email_queue WHERE id=? AND organization_id=? AND status IN('sending','uncertain'))", [queueId, orgId], 'email_claim_changed'),
    db.prepare('UPDATE invite_email_queue SET status=?,code_cipher=NULL,reconciled_at=?,updated_at=? WHERE id=?').bind(input.outcome === 'accepted_attested' ? 'accepted_attested' : 'closed_unconfirmed', at, at, queueId),
    e.audit(db, actor!.userId, orgId, input.outcome === 'accepted_attested' ? 'invite.email.accepted_attested' : 'invite.email.closed_unconfirmed', queueId, at)]);
  return { ok: true, retry: false, meaning: 'manual_attestation_no_delivery_proof' };
}
