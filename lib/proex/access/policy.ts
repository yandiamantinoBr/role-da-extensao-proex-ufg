import { CAPABILITIES, MODULES } from "./types.ts";
import type {
  AccessRequest, Actor, AuthorizationDecision, Capability, DelegationRequest, Grant, Scope,
} from "./types.ts";

const scopeKeys = new Set(["organizationId", "projectId", "module", "eventId", "locationId"]);
const capabilitySet = new Set<string>(CAPABILITIES);
const moduleSet = new Set<string>(MODULES);
const capabilityModules: Partial<Record<Capability, Scope["module"]>> = {
  "campaigns.manage": "campaigns",
  "participation.operate": "participation",
  "inventory.read": "inventory", "inventory.manage": "inventory", "inventory.deliver": "inventory",
  "loans.read": "loans", "loans.manage": "loans", "loans.checkout": "loans",
  "reports.read": "reports", "reports.export_identifiable": "reports",
};

export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

export function validateScope(value: unknown): value is Scope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const scope = value as Record<string, unknown>;
  if (Object.keys(scope).some((key) => !scopeKeys.has(key))) return false;
  if (!Object.hasOwn(scope, "organizationId") || !isIdentifier(scope.organizationId)) return false;
  for (const key of ["projectId", "eventId", "locationId"]) {
    if (scope[key] !== undefined && !isIdentifier(scope[key])) return false;
  }
  if (scope.module !== undefined && !moduleSet.has(scope.module as string)) return false;
  // An event must always be resolved together with its owning project by the server adapter.
  if (scope.eventId !== undefined && scope.projectId === undefined) return false;
  return true;
}

export function parseInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const canonical = `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
  return new Date(milliseconds).toISOString() === canonical ? milliseconds : null;
}

export function isActor(value: unknown): value is Actor {
  if (!value || typeof value !== "object") return false;
  const actor = value as Actor;
  return isIdentifier(actor.userId) && Array.isArray(actor.verifiedEmails)
    && actor.verifiedEmails.every((email) => typeof email === "string");
}

export function validateCapabilities(value: unknown, allowEmpty = false): value is readonly Capability[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0)
    && value.every((capability) => typeof capability === "string" && capabilitySet.has(capability))
    && new Set(value).size === value.length;
}

function capabilityFitsScope(scope: Scope, capability: Capability): boolean {
  if (capability === "organization.manage") {
    return scope.projectId === undefined && scope.module === undefined
      && scope.eventId === undefined && scope.locationId === undefined;
  }
  const requiredModule = capabilityModules[capability];
  return requiredModule === undefined || scope.module === undefined || scope.module === requiredModule;
}

/** A narrower grant cannot cover an unscoped request. Scope ownership is resolved outside this kernel. */
export function scopeContains(parent: Scope, child: Scope): boolean {
  if (!validateScope(parent) || !validateScope(child)) return false;
  if (parent.organizationId !== child.organizationId) return false;
  return (["projectId", "module", "eventId", "locationId"] as const)
    .every((key) => parent[key] === undefined || parent[key] === child[key]);
}

function validGrant(grant: Grant): boolean {
  if (!grant || !isIdentifier(grant.id) || !isIdentifier(grant.userId) || !validateScope(grant.scope)) return false;
  if (!validateCapabilities(grant.capabilities)
    || !grant.capabilities.every((capability) => capabilityFitsScope(grant.scope, capability))) return false;
  const delegable = grant.delegableCapabilities ?? [];
  if (!validateCapabilities(delegable, true)
    || !delegable.every((capability) => grant.capabilities.includes(capability))) return false;
  for (const value of [grant.validFrom, grant.expiresAt, grant.revokedAt]) {
    if (value !== undefined && parseInstant(value) === null) return false;
  }
  if (grant.validFrom && grant.expiresAt
    && parseInstant(grant.validFrom)! >= parseInstant(grant.expiresAt)!) return false;
  return true;
}

function activeGrant(grant: Grant, userId: string, now: number): boolean {
  return validGrant(grant) && grant.userId === userId && grant.revokedAt === undefined
    && (grant.validFrom === undefined || parseInstant(grant.validFrom)! <= now)
    && (grant.expiresAt === undefined || parseInstant(grant.expiresAt)! > now);
}

export function authorize(
  actor: Actor | null, grants: readonly Grant[], request: AccessRequest, now: string,
): AuthorizationDecision {
  if (!isActor(actor)) return { allowed: false, reason: "unauthenticated" };
  const time = parseInstant(now);
  if (time === null) return { allowed: false, reason: "invalid_time" };
  if (!Array.isArray(grants) || !request || !validateScope(request.scope)
    || !capabilitySet.has(request.capability) || !capabilityFitsScope(request.scope, request.capability)) {
    return { allowed: false, reason: "invalid_request" };
  }
  const requiredModule = capabilityModules[request.capability];
  const target = requiredModule ? { ...request.scope, module: requiredModule } : request.scope;
  const active = grants.filter((grant) => activeGrant(grant, actor.userId, time));
  if (active.length === 0) return { allowed: false, reason: "no_active_grant" };
  const scoped = active.filter((grant) => scopeContains(grant.scope, target));
  if (scoped.length === 0) return { allowed: false, reason: "scope_mismatch" };
  const matching = scoped.filter((grant) => grant.capabilities.includes(request.capability));
  return matching.length > 0
    ? { allowed: true, grantIds: matching.map((grant) => grant.id) }
    : { allowed: false, reason: "capability_missing" };
}

export function validateDelegation(request: DelegationRequest): boolean {
  if (!request || !validateScope(request.scope) || !validateCapabilities(request.capabilities)) return false;
  const delegable = request.delegableCapabilities ?? [];
  return validateCapabilities(delegable, true)
    && request.capabilities.every((capability) => capabilityFitsScope(request.scope, capability))
    && delegable.every((capability) => request.capabilities.includes(capability))
    && (request.expiresAt === undefined || parseInstant(request.expiresAt) !== null);
}

/** One explicit delegable grant must cover the complete proposal; privileges are never stitched together. */
export function canDelegate(
  actor: Actor | null, grants: readonly Grant[], proposal: DelegationRequest, now: string,
): AuthorizationDecision {
  if (!isActor(actor)) return { allowed: false, reason: "unauthenticated" };
  const time = parseInstant(now);
  if (time === null) return { allowed: false, reason: "invalid_time" };
  if (!Array.isArray(grants) || !validateDelegation(proposal)
    || (proposal.expiresAt !== undefined && parseInstant(proposal.expiresAt)! <= time)) {
    return { allowed: false, reason: "invalid_request" };
  }
  const matching = grants.filter((grant) => {
    if (!activeGrant(grant, actor.userId, time) || !grant.capabilities.includes("access.invite")
      || !scopeContains(grant.scope, proposal.scope)) return false;
    const ceiling = grant.delegableCapabilities ?? [];
    if (!proposal.capabilities.every((capability) => ceiling.includes(capability))) return false;
    // A finite delegation cannot mint an unlimited or longer-lived membership.
    return grant.expiresAt === undefined || (proposal.expiresAt !== undefined
      && parseInstant(proposal.expiresAt)! <= parseInstant(grant.expiresAt)!);
  });
  return matching.length > 0
    ? { allowed: true, grantIds: matching.map((grant) => grant.id) }
    : { allowed: false, reason: "delegation_not_allowed" };
}
