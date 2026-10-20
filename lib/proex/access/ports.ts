import type { AccessAuditEvent, Grant, Instant, Invitation } from "./types.ts";

/**
 * A production adapter MUST provide serializable/locked transactions and rollback all writes on error.
 * Invitation reads used by acceptance/revocation must lock that row or enforce compare-and-swap.
 * Compare-and-swap MUST throw on a version/state conflict, never silently return success.
 * Unique constraints: invitation id/tokenHash and grant sourceInvitationId.
 * This contract is not a database implementation or a claim that persistence is configured.
 */
export interface AccessTransaction {
  getGrantsForUser(userId: string): Promise<readonly Grant[]>;
  getInvitationByTokenHash(tokenHash: string): Promise<Invitation | null>;
  getInvitationById(id: string): Promise<Invitation | null>;
  createInvitation(invitation: Invitation): Promise<void>;
  acceptInvitation(id: string, expectedVersion: number, userId: string, at: Instant): Promise<void>;
  revokeInvitation(id: string, expectedVersion: number, at: Instant): Promise<void>;
  createGrant(grant: Grant): Promise<void>;
  appendAudit(event: AccessAuditEvent): Promise<void>;
}

export interface AccessRepository {
  transaction<T>(operation: (transaction: AccessTransaction) => Promise<T>): Promise<T>;
}

export type InvitationDependencies = {
  repository: AccessRepository;
  clock: { now(): Instant };
  /** Adapter must generate at least 256 bits of cryptographically secure randomness. */
  tokens: { generate(): string | Promise<string>; hash(token: string): Promise<string> };
  ids: { next(kind: "invitation" | "grant" | "audit"): string };
};
