/** Provider-neutral domain contracts. An Actor must come from a trusted server adapter. */
export const MODULES = [
  "administration", "campaigns", "participation", "inventory", "loans", "reports",
] as const;
export type Module = (typeof MODULES)[number];

export const CAPABILITIES = [
  "organization.manage", "access.invite", "access.manage", "campaigns.manage",
  "participation.operate", "inventory.read", "inventory.manage", "inventory.deliver",
  "loans.read", "loans.manage", "loans.checkout", "reports.read",
  "reports.export_identifiable",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** UTC ISO 8601, with seconds and optional milliseconds; always ends with Z. */
export type Instant = string;

export type Actor = {
  userId: string;
  /** Only addresses already verified by the authentication provider, never form fields. */
  verifiedEmails: readonly string[];
};

export type Scope = {
  organizationId: string;
  projectId?: string;
  module?: Module;
  eventId?: string;
  locationId?: string;
};

export type Grant = {
  id: string;
  userId: string;
  scope: Scope;
  capabilities: readonly Capability[];
  /** Explicit delegation ceiling. Possessing a capability alone does not allow granting it. */
  delegableCapabilities?: readonly Capability[];
  validFrom?: Instant;
  expiresAt?: Instant;
  revokedAt?: Instant;
  sourceInvitationId?: string;
};

export type AccessRequest = { scope: Scope; capability: Capability };
export type DelegationRequest = {
  scope: Scope;
  capabilities: readonly Capability[];
  delegableCapabilities?: readonly Capability[];
  expiresAt?: Instant;
};

export type DenialReason =
  | "unauthenticated" | "invalid_request" | "invalid_time"
  | "no_active_grant" | "scope_mismatch" | "capability_missing"
  | "delegation_not_allowed";
export type AuthorizationDecision =
  | { allowed: true; grantIds: readonly string[] }
  | { allowed: false; reason: DenialReason };

export type Invitation = {
  id: string;
  recipientEmail: string;
  scope: Scope;
  capabilities: readonly Capability[];
  delegableCapabilities: readonly Capability[];
  tokenHash: string;
  issuedBy: string;
  issuedAt: Instant;
  expiresAt: Instant;
  /** Invitation expiry controls acceptance; this separately limits the resulting membership. */
  grantExpiresAt?: Instant;
  version: number;
  acceptedAt?: Instant;
  acceptedBy?: string;
  revokedAt?: Instant;
};

export type AccessAuditEvent = {
  id: string;
  type: "invitation.issued" | "invitation.accepted" | "invitation.revoked";
  actorUserId: string;
  organizationId: string;
  projectId?: string;
  invitationId: string;
  grantId?: string;
  at: Instant;
};
