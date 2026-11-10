import {one,all,type Row} from '../database';
import {rateLimitAll} from '../rate-limit';
import {RESPONSES,fail,id,onlyKeys,sha256,text,token,translate} from './shared';

/*
 * Public side of a convocation, for people without a portal account (e.g. scholarship students).
 * - The invite link (#c=token) only reveals the convocation's public data (title, date, place, shifts, invited
 *   projects, purpose notice). It never lists other people.
 * - Answering requires the consent box and creates a guest row bound to a personal edit secret chosen by the
 *   browser (256 bits, stored only as a hash). That secret is the guest's whole "account": it opens and edits only
 *   that one answer, never a portal session. Losing it means answering again through the invite.
 * - Invite validity, its use limit and the convocation status are enforced by database triggers in the same write.
 */
type Input = Record<string, unknown>;
const enrollmentPattern = /^[A-Za-z0-9][A-Za-z0-9.\-/]{3,19}$/;
const statement = (db: D1Database, sql: string, values: unknown[] = []) => db.prepare(sql).bind(...values);

async function publicView(db: D1Database, convocationId: string) {
  const c = await one(db, `SELECT c.id,c.title,c.edition,c.location,c.event_date,c.response_deadline,c.description,c.purpose_notice,c.retention_days,c.status,c.purged_at,o.name organization_name
    FROM convocations c JOIN organizations o ON o.id=c.organization_id AND o.status='active' WHERE c.id=?`, [convocationId]);
  if (!c) fail('Convocação não encontrada.', 'convocation_not_found', 404);
  const shifts = await all(db, 'SELECT id,label,starts_at startsAt,ends_at endsAt FROM convocation_shifts WHERE convocation_id=? ORDER BY position', [convocationId]);
  const projects = await all(db, "SELECT p.id,p.name FROM convocation_projects cp JOIN projects p ON p.id=cp.project_id WHERE cp.convocation_id=? AND p.status='active' ORDER BY p.name,p.id", [convocationId]);
  return { id: c!.id, title: c!.title, edition: c!.edition, location: c!.location, eventDate: c!.event_date, responseDeadline: c!.response_deadline, description: c!.description,
    purposeNotice: c!.purpose_notice, retentionDays: Number(c!.retention_days), organizationName: c!.organization_name, accepting: c!.status === 'open' && !c!.purged_at, shifts, projects };
}
async function inviteByToken(db: D1Database, secret: string) {
  const invite = await one(db, 'SELECT * FROM convocation_invites WHERE token_hash=?', [await sha256(secret)]);
  if (!invite) fail('Este link de convite não existe. Confira se copiou o link inteiro.', 'convocation_invite_closed', 404);
  return invite!;
}
const inviteOpen = (invite: Row, now: number) => !invite.revoked_at && Date.parse(String(invite.expires_at)) > now && Number(invite.use_count) < Number(invite.max_uses);
/**
 * The personal link reaches one answer in one convocation and expires with the data: on the last day of the
 * retention period (event date + retention days, Brasília) or as soon as the team purges the guests.
 */
export const LINK_EXPIRY_SQL = "date(c.event_date,'+'||c.retention_days||' days')";
async function guestByToken(db: D1Database, secret: string) {
  const guest = await one(db, `SELECT g.*,${LINK_EXPIRY_SQL} link_expires_on,CASE WHEN date('now','-3 hours')>${LINK_EXPIRY_SQL} THEN 1 ELSE 0 END link_expired
    FROM convocation_guests g JOIN convocations c ON c.id=g.convocation_id WHERE g.edit_hash=? AND c.purged_at IS NULL`, [await sha256(secret)]);
  if (!guest) fail('Não encontramos uma resposta para este link pessoal. Se ela foi apagada, responda de novo pelo convite.', 'convocation_guest_not_found', 404);
  if (guest!.link_expired) fail(`Este link pessoal venceu em ${String(guest!.link_expires_on).split('-').reverse().join('/')}, junto com o prazo de guarda dos dados. Fale com a coordenação da ação.`, 'convocation_link_expired', 410);
  return guest!;
}
async function guestView(db: D1Database, guest: Row) {
  const shifts = await all(db, 'SELECT shift_id FROM convocation_guest_shifts WHERE guest_id=?', [guest.id]);
  const expires = guest.link_expires_on ?? (await one(db, `SELECT ${LINK_EXPIRY_SQL} d FROM convocations c WHERE c.id=?`, [guest.convocation_id]))?.d ?? null;
  return { name: guest.name, enrollment: guest.enrollment, projectId: guest.project_id, response: guest.response, shiftIds: shifts.map(row => String(row.shift_id)), version: Number(guest.version), updatedAt: guest.updated_at, linkExpiresOn: expires };
}
function answer(input: Input) {
  const name = text(input.name, 'o seu nome', 3, 120), enrollment = text(input.enrollment, 'a matrícula', 4, 20).replace(/\s/g, '');
  if (!enrollmentPattern.test(enrollment)) fail('Use só letras, números, ponto, hífen ou barra na matrícula.');
  if (!(RESPONSES as readonly unknown[]).includes(input.response)) fail('Responda sim, não ou talvez.');
  const shiftIds = Array.isArray(input.shiftIds) ? [...new Set(input.shiftIds.map(value => id(value, 'o turno')))] : fail('Escolha os turnos.');
  if (shiftIds.length > 12) fail('Escolha no máximo 12 turnos.');
  if (input.response !== 'no' && !shiftIds.length) fail('Escolha pelo menos um turno, ou responda que não vai.');
  return { name, enrollment, projectId: id(input.projectId, 'o seu projeto'), response: input.response as string, shiftIds: input.response === 'no' ? [] : shiftIds };
}
async function limit(db: D1Database, ip: string | null, scope: string, writes: boolean) {
  const who = ip ?? 'unknown';
  await rateLimitAll(db, writes
    ? [{ bucket: `convocation:write:ip:${who}`, limit: 30, windowMs: 600_000 }, { bucket: `convocation:write:${scope}`, limit: 600, windowMs: 3_600_000 }, { bucket: 'convocation:write:global', limit: 3000, windowMs: 3_600_000 }]
    : [{ bucket: `convocation:read:ip:${who}`, limit: 120, windowMs: 600_000 }]);
}

export async function convocationGuestAction(db: D1Database, input: Input, ip: string | null) {
  const action = input.action;
  if (action === 'inspect') {
    onlyKeys(input, ['action', 'inviteToken', 'editToken']);
    await limit(db, ip, 'read', false);
    if (input.editToken !== undefined) {
      const guest = await guestByToken(db, token(input.editToken, 'o seu link pessoal'));
      return { convocation: await publicView(db, String(guest.convocation_id)), guest: await guestView(db, guest) };
    }
    const invite = await inviteByToken(db, token(input.inviteToken, 'o link do convite')), view = await publicView(db, String(invite.convocation_id));
    return { convocation: { ...view, accepting: view.accepting && inviteOpen(invite, Date.now()) }, guest: null, invite: { expiresAt: invite.expires_at, open: inviteOpen(invite, Date.now()) } };
  }
  if (action === 'respond') {
    onlyKeys(input, ['action', 'inviteToken', 'editToken', 'name', 'enrollment', 'projectId', 'shiftIds', 'response', 'consent']);
    const inviteSecret = token(input.inviteToken, 'o link do convite'), editSecret = token(input.editToken, 'o link pessoal');
    if (input.consent !== true) fail('Marque que leu o aviso sobre o uso dos seus dados.', 'convocation_consent');
    const invite = await inviteByToken(db, inviteSecret);
    await limit(db, ip, String(invite.id), true);
    const editHash = await sha256(editSecret), existing = await one(db, 'SELECT * FROM convocation_guests WHERE edit_hash=?', [editHash]);
    // A repeated request (lost reply) with the same personal secret returns the answer already saved.
    if (existing) { if (existing.invite_id !== invite.id) fail('Este link pessoal pertence a outra resposta.', 'convocation_token', 409); return { guest: await guestView(db, existing), duplicate: true }; }
    const a = answer(input), guestId = crypto.randomUUID(), at = new Date().toISOString();
    try {
      await db.batch([
        statement(db, 'INSERT INTO convocation_guests(id,convocation_id,invite_id,edit_hash,name,enrollment,project_id,response,consent_at,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)',
          [guestId, invite.convocation_id, invite.id, editHash, a.name, a.enrollment, a.projectId, a.response, at, at, at]),
        ...a.shiftIds.map(shift => statement(db, 'INSERT INTO convocation_guest_shifts(guest_id,shift_id) VALUES(?,?)', [guestId, shift])),
        statement(db, "INSERT INTO convocation_events(id,convocation_id,kind,guest_id,project_id,actor_id,details,created_at) VALUES(?,?,'response_created',?,?,NULL,?,?)", [crypto.randomUUID(), invite.convocation_id, guestId, a.projectId, JSON.stringify({ response: a.response, shifts: a.shiftIds.length }), at]),
      ]);
    } catch (error) {
      const raced = await one(db, 'SELECT * FROM convocation_guests WHERE edit_hash=?', [editHash]);
      if (raced) return { guest: await guestView(db, raced), duplicate: true };
      translate(error);
    }
    return { guest: await guestView(db, (await one(db, 'SELECT * FROM convocation_guests WHERE id=?', [guestId]))!) };
  }
  if (action === 'update') {
    onlyKeys(input, ['action', 'editToken', 'name', 'enrollment', 'projectId', 'shiftIds', 'response', 'expectedVersion']);
    const guest = await guestByToken(db, token(input.editToken, 'o seu link pessoal'));
    await limit(db, ip, String(guest.invite_id), true);
    if (input.expectedVersion !== guest.version) fail('Sua resposta mudou em outra aba. Atualize a página.', 'convocation_guest_changed', 409);
    const a = answer(input), at = new Date().toISOString();
    await db.batch([
      statement(db, 'UPDATE convocation_guests SET name=?,enrollment=?,project_id=?,response=?,updated_at=?,version=version+1 WHERE id=? AND version=?', [a.name, a.enrollment, a.projectId, a.response, at, guest.id, guest.version]),
      statement(db, "SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','convocation_guest_changed') END"),
      statement(db, 'DELETE FROM convocation_guest_shifts WHERE guest_id=?', [guest.id]),
      ...a.shiftIds.map(shift => statement(db, 'INSERT INTO convocation_guest_shifts(guest_id,shift_id) VALUES(?,?)', [guest.id, shift])),
      statement(db, "INSERT INTO convocation_events(id,convocation_id,kind,guest_id,project_id,actor_id,details,created_at) VALUES(?,?,'response_updated',?,?,NULL,?,?)", [crypto.randomUUID(), guest.convocation_id, guest.id, a.projectId, JSON.stringify({ response: a.response, shifts: a.shiftIds.length }), at]),
    ]).catch(translate);
    return { guest: await guestView(db, (await one(db, 'SELECT * FROM convocation_guests WHERE id=?', [guest.id]))!) };
  }
  if (action === 'forget') {
    onlyKeys(input, ['action', 'editToken', 'confirmed']);
    if (input.confirmed !== true) fail('Confirme que quer apagar a sua resposta.');
    const guest = await guestByToken(db, token(input.editToken, 'o seu link pessoal'));
    await limit(db, ip, String(guest.invite_id), true);
    const at = new Date().toISOString();
    await db.batch([
      statement(db, 'DELETE FROM convocation_guest_shifts WHERE guest_id=?', [guest.id]),
      statement(db, 'DELETE FROM convocation_guests WHERE id=?', [guest.id]),
      statement(db, "INSERT INTO convocation_events(id,convocation_id,kind,guest_id,project_id,actor_id,details,created_at) VALUES(?,?,'response_deleted',?,?,NULL,'{}',?)", [crypto.randomUUID(), guest.convocation_id, guest.id, guest.project_id, at]),
    ]);
    return { deleted: true };
  }
  fail('Ação não reconhecida.', 'invalid_action');
}
