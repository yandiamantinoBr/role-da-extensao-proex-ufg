import { authorize, canDelegate, isActor, isIdentifier, parseInstant, validateDelegation } from "./policy.ts";
import type { InvitationDependencies } from "./ports.ts";
import type { Actor, DelegationRequest, Grant, Invitation } from "./types.ts";

export type InvitationErrorCode =
  | "invalid_input" | "invalid_time" | "forbidden" | "invalid_token"
  | "not_found" | "expired" | "revoked" | "already_accepted"
  | "email_mismatch" | "issuer_no_longer_authorized";

export class InvitationError extends Error {
  readonly code: InvitationErrorCode;
  constructor(code: InvitationErrorCode) {
    super(code);
    this.name = "InvitationError";
    this.code = code;
  }
}

/** Invitation matching only; this normalization must NEVER merge accounts or choose a userId. */
export function normalizeInvitationEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function validToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43,512}$/.test(token);
}

function proposalOf(invitation: Invitation): DelegationRequest {
  return {
    scope: invitation.scope, capabilities: invitation.capabilities,
    delegableCapabilities: invitation.delegableCapabilities, expiresAt: invitation.grantExpiresAt,
  };
}

function validateStoredInvitation(invitation: Invitation): void {
  if (!isIdentifier(invitation.id) || !isIdentifier(invitation.issuedBy)
    || !normalizeInvitationEmail(invitation.recipientEmail) || !validateDelegation(proposalOf(invitation))
    || !/^[a-f0-9]{64}$/.test(invitation.tokenHash)
    || !Number.isSafeInteger(invitation.version) || invitation.version < 1) {
    throw new InvitationError("invalid_input");
  }
  for (const value of [invitation.issuedAt, invitation.expiresAt, invitation.acceptedAt, invitation.revokedAt]) {
    if (value !== undefined && parseInstant(value) === null) throw new InvitationError("invalid_time");
  }
  if (parseInstant(invitation.issuedAt) === null || parseInstant(invitation.expiresAt) === null
    || parseInstant(invitation.expiresAt)! <= parseInstant(invitation.issuedAt)!) {
    throw new InvitationError("invalid_time");
  }
  if ((invitation.acceptedAt === undefined) !== (invitation.acceptedBy === undefined)
    || (invitation.acceptedBy !== undefined && !isIdentifier(invitation.acceptedBy))) {
    throw new InvitationError("invalid_input");
  }
}

export function createInvitationService(dependencies: InvitationDependencies) {
  const { repository, clock, tokens, ids } = dependencies;
  function currentTime(): string {
    const now = clock.now();
    if (parseInstant(now) === null) throw new InvitationError("invalid_time");
    return now;
  }
  function nextId(kind: "invitation" | "grant" | "audit"): string {
    const id = ids.next(kind);
    if (!isIdentifier(id)) throw new InvitationError("invalid_input");
    return id;
  }
  async function digest(token: string): Promise<string> {
    const hash = await tokens.hash(token);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new InvitationError("invalid_token");
    return hash;
  }

  return {
    async issue(actor: Actor | null, input: DelegationRequest & {
      recipientEmail: string; invitationExpiresAt: string;
    }): Promise<{ invitation: Invitation; token: string }> {
      const now = currentTime();
      const email = normalizeInvitationEmail(input?.recipientEmail);
      if (!isActor(actor) || !email || !validateDelegation(input)
        || parseInstant(input.invitationExpiresAt) === null
        || parseInstant(input.invitationExpiresAt)! <= parseInstant(now)!) {
        throw new InvitationError("invalid_input");
      }
      const token = await tokens.generate();
      if (!validToken(token)) throw new InvitationError("invalid_token");
      const tokenHash = await digest(token);
      return repository.transaction(async (transaction) => {
        const now = currentTime();
        if (parseInstant(input.invitationExpiresAt)! <= parseInstant(now)!) throw new InvitationError("expired");
        const grants = await transaction.getGrantsForUser(actor.userId);
        if (!canDelegate(actor, grants, input, now).allowed) throw new InvitationError("forbidden");
        const invitation: Invitation = {
          id: nextId("invitation"), recipientEmail: email, scope: { ...input.scope },
          capabilities: [...input.capabilities], delegableCapabilities: [...(input.delegableCapabilities ?? [])],
          tokenHash, issuedBy: actor.userId, issuedAt: now, expiresAt: input.invitationExpiresAt,
          ...(input.expiresAt !== undefined ? { grantExpiresAt: input.expiresAt } : {}), version: 1,
        };
        await transaction.createInvitation(invitation);
        await transaction.appendAudit({
          id: nextId("audit"), type: "invitation.issued", actorUserId: actor.userId,
          organizationId: invitation.scope.organizationId, projectId: invitation.scope.projectId,
          invitationId: invitation.id, at: now,
        });
        // The caller may deliver this token once; no token is persisted or added to audit events.
        return { invitation, token };
      });
    },

    async accept(actor: Actor | null, token: string): Promise<Grant> {
      if (!isActor(actor)) throw new InvitationError("forbidden");
      if (!validToken(token)) throw new InvitationError("invalid_token");
      const tokenHash = await digest(token);
      return repository.transaction(async (transaction) => {
        const invitation = await transaction.getInvitationByTokenHash(tokenHash);
        if (!invitation) throw new InvitationError("not_found");
        const now = currentTime();
        validateStoredInvitation(invitation);
        if (invitation.revokedAt !== undefined) throw new InvitationError("revoked");
        if (invitation.acceptedAt !== undefined) throw new InvitationError("already_accepted");
        if (parseInstant(invitation.issuedAt)! > parseInstant(now)!) throw new InvitationError("invalid_time");
        if (parseInstant(invitation.expiresAt)! <= parseInstant(now)!) throw new InvitationError("expired");
        if (!actor.verifiedEmails.some((email) => normalizeInvitationEmail(email)
          === normalizeInvitationEmail(invitation.recipientEmail))) throw new InvitationError("email_mismatch");
        const issuerGrants = await transaction.getGrantsForUser(invitation.issuedBy);
        if (!canDelegate({ userId: invitation.issuedBy, verifiedEmails: [] }, issuerGrants,
          proposalOf(invitation), now).allowed) throw new InvitationError("issuer_no_longer_authorized");
        const grant: Grant = {
          id: nextId("grant"), userId: actor.userId, scope: { ...invitation.scope },
          capabilities: [...invitation.capabilities], delegableCapabilities: [...invitation.delegableCapabilities],
          validFrom: now, ...(invitation.grantExpiresAt ? { expiresAt: invitation.grantExpiresAt } : {}),
          sourceInvitationId: invitation.id,
        };
        await transaction.acceptInvitation(invitation.id, invitation.version, actor.userId, now);
        await transaction.createGrant(grant);
        await transaction.appendAudit({
          id: nextId("audit"), type: "invitation.accepted", actorUserId: actor.userId,
          organizationId: invitation.scope.organizationId, projectId: invitation.scope.projectId,
          invitationId: invitation.id, grantId: grant.id, at: now,
        });
        return grant;
      });
    },

    async revoke(actor: Actor | null, invitationId: string): Promise<void> {
      if (!isActor(actor) || !isIdentifier(invitationId)) throw new InvitationError("invalid_input");
      return repository.transaction(async (transaction) => {
        const invitation = await transaction.getInvitationById(invitationId);
        if (!invitation) throw new InvitationError("not_found");
        const now = currentTime();
        validateStoredInvitation(invitation);
        const grants = await transaction.getGrantsForUser(actor.userId);
        if (!authorize(actor, grants, { scope: invitation.scope, capability: "access.manage" }, now).allowed) {
          throw new InvitationError("forbidden");
        }
        if (invitation.acceptedAt !== undefined) throw new InvitationError("already_accepted");
        if (invitation.revokedAt !== undefined) return;
        await transaction.revokeInvitation(invitation.id, invitation.version, now);
        await transaction.appendAudit({
          id: nextId("audit"), type: "invitation.revoked", actorUserId: actor.userId,
          organizationId: invitation.scope.organizationId, projectId: invitation.scope.projectId,
          invitationId: invitation.id, at: now,
        });
      });
    },
  };
}
