import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { authorize, canDelegate, parseInstant, scopeContains, validateScope } from "../lib/proex/access/policy.ts";
import { createInvitationService, InvitationError } from "../lib/proex/access/invitations.ts";
import { CAPABILITIES } from "../lib/proex/access/types.ts";

const NOW = "2026-10-20T13:00:00.000Z";
const LATER = "2026-10-21T13:00:00.000Z";
const OWNER = { userId: "owner", verifiedEmails: ["owner@example.test"] };
const MEMBER = { userId: "member", verifiedEmails: ["member@example.test"] };
const ROLE_SCOPE = { organizationId: "proex", projectId: "role" };
const ROOT_GRANT = {
  id: "root-grant", userId: OWNER.userId, scope: { organizationId: "proex" },
  capabilities: [...CAPABILITIES], delegableCapabilities: [...CAPABILITIES],
};

function grant(overrides = {}) {
  return {
    id: "operator-grant", userId: MEMBER.userId, scope: ROLE_SCOPE,
    capabilities: ["participation.operate"], ...overrides,
  };
}
function request(capability, scope = ROLE_SCOPE) { return { capability, scope }; }
function rejectsCode(promise, code) {
  return assert.rejects(promise, (error) => error instanceof InvitationError && error.code === code);
}

/* Test fixture only. There is deliberately no in-memory persistence adapter in production code. */
function harness(initialGrants = [ROOT_GRANT]) {
  let state = { grants: structuredClone(initialGrants), invitations: [], audit: [] };
  let now = NOW;
  let next = 0;
  let tail = Promise.resolve();
  let failAudit = false;
  const repository = {
    async transaction(operation) {
      let release;
      const previous = tail;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      const draft = structuredClone(state);
      const find = (id) => draft.invitations.find((invitation) => invitation.id === id);
      const transaction = {
        async getGrantsForUser(userId) { return structuredClone(draft.grants.filter((g) => g.userId === userId)); },
        async getInvitationByTokenHash(hash) {
          return structuredClone(draft.invitations.find((invitation) => invitation.tokenHash === hash) ?? null);
        },
        async getInvitationById(id) { return structuredClone(find(id) ?? null); },
        async createInvitation(invitation) {
          assert.equal(draft.invitations.some((existing) => existing.id === invitation.id
            || existing.tokenHash === invitation.tokenHash), false, "unique invitation id/hash");
          draft.invitations.push(structuredClone(invitation));
        },
        async acceptInvitation(id, version, userId, at) {
          const invitation = find(id);
          assert.equal(invitation?.version, version, "compare-and-swap invitation version");
          assert.equal(invitation.acceptedAt, undefined);
          assert.equal(invitation.revokedAt, undefined);
          Object.assign(invitation, { acceptedAt: at, acceptedBy: userId, version: version + 1 });
        },
        async revokeInvitation(id, version, at) {
          const invitation = find(id);
          assert.equal(invitation?.version, version);
          Object.assign(invitation, { revokedAt: at, version: version + 1 });
        },
        async createGrant(newGrant) {
          assert.equal(draft.grants.some((existing) => existing.id === newGrant.id
            || (newGrant.sourceInvitationId && existing.sourceInvitationId === newGrant.sourceInvitationId)), false);
          draft.grants.push(structuredClone(newGrant));
        },
        async appendAudit(event) {
          if (failAudit) throw new Error("simulated audit failure");
          draft.audit.push(structuredClone(event));
        },
      };
      try {
        const result = await operation(transaction);
        state = draft;
        return result;
      } finally { release(); }
    },
  };
  const dependencies = {
    repository,
    clock: { now: () => now },
    tokens: {
      generate: () => randomBytes(32).toString("base64url"),
      hash: async (token) => createHash("sha256").update(token).digest("hex"),
    },
    ids: { next: (kind) => `${kind}-${++next}` },
  };
  return {
    service: createInvitationService(dependencies), dependencies,
    snapshot: () => structuredClone(state),
    setTime: (value) => { now = value; },
    setGrants: (value) => { state.grants = structuredClone(value); },
    corruptInvitation: (change) => { Object.assign(state.invitations[0], change); },
    failAudit: (value) => { failAudit = value; },
  };
}

function issue(h, overrides = {}) {
  return h.service.issue(OWNER, {
    recipientEmail: MEMBER.verifiedEmails[0], scope: ROLE_SCOPE,
    capabilities: ["participation.operate"], invitationExpiresAt: LATER, ...overrides,
  });
}

test("scope validation rejects malformed, inherited, unknown and projectless event scopes", () => {
  assert.equal(validateScope(ROLE_SCOPE), true);
  assert.equal(validateScope({ organizationId: "proex", locationId: "central" }), true);
  for (const scope of [null, [], {}, { organizationId: " " }, { organizationId: "proex", projectId: "" },
    { organizationId: "proex", module: "unknown" }, { organizationId: "proex", eventId: "event" },
    { ...ROLE_SCOPE, unvalidatedScope: "other" }, Object.create(ROLE_SCOPE)]) {
    assert.equal(validateScope(scope), false);
  }
});

test("scope containment never broadens a project, event, location or organization", () => {
  assert.equal(scopeContains({ organizationId: "proex" }, ROLE_SCOPE), true);
  assert.equal(scopeContains(ROLE_SCOPE, { organizationId: "proex" }), false);
  assert.equal(scopeContains(ROLE_SCOPE, { ...ROLE_SCOPE, projectId: "other" }), false);
  assert.equal(scopeContains(ROLE_SCOPE, { ...ROLE_SCOPE, organizationId: "other" }), false);
  const eventScope = { ...ROLE_SCOPE, eventId: "event-1", locationId: "booth" };
  assert.equal(scopeContains(eventScope, { ...eventScope }), true);
  assert.equal(scopeContains(eventScope, { ...eventScope, eventId: "event-2" }), false);
  assert.equal(scopeContains(eventScope, { ...eventScope, locationId: "other" }), false);
});

test("authorization denies by default and accepts only an explicit capability in scope", () => {
  assert.equal(authorize(null, [grant()], request("participation.operate"), NOW).allowed, false);
  assert.equal(authorize(MEMBER, [], request("participation.operate"), NOW).allowed, false);
  assert.deepEqual(authorize(MEMBER, [grant()], request("participation.operate"), NOW), {
    allowed: true, grantIds: ["operator-grant"],
  });
  assert.equal(authorize(MEMBER, [grant()], request("inventory.deliver"), NOW).allowed, false);
  assert.equal(authorize(MEMBER, [grant()], request("participation.operate", {
    ...ROLE_SCOPE, projectId: "other",
  }), NOW).allowed, false);
  assert.equal(authorize(MEMBER, [grant()], request("participation.operate", {
    ...ROLE_SCOPE, organizationId: "other",
  }), NOW).allowed, false);
});

test("a user cannot borrow another identity's grant", () => {
  assert.equal(authorize(MEMBER, [ROOT_GRANT], request("inventory.manage"), NOW).allowed, false);
});

test("module and event constraints are effective even when the request omits its derived module", () => {
  const inventory = grant({ scope: { ...ROLE_SCOPE, module: "inventory" }, capabilities: ["inventory.read"] });
  assert.equal(authorize(MEMBER, [inventory], request("inventory.read"), NOW).allowed, true);
  assert.equal(authorize(MEMBER, [inventory], request("inventory.read", {
    ...ROLE_SCOPE, module: "reports",
  }), NOW).allowed, false);
  const event = grant({ scope: { ...ROLE_SCOPE, eventId: "event-1" } });
  assert.equal(authorize(MEMBER, [event], request("participation.operate"), NOW).allowed, false);
  assert.equal(authorize(MEMBER, [event], request("participation.operate", event.scope), NOW).allowed, true);
});

test("invalid timestamps fail closed, including impossible dates and expiry boundary", () => {
  assert.equal(parseInstant("2026-02-30T13:00:00Z"), null);
  assert.equal(parseInstant("2026-10-20"), null);
  assert.equal(parseInstant("2026-10-20T13:00:00Z"), Date.parse(NOW));
  assert.equal(authorize(MEMBER, [grant()], request("participation.operate"), "invalid").reason, "invalid_time");
  for (const extra of [{ expiresAt: NOW }, { expiresAt: "invalid" }, { validFrom: LATER },
    { validFrom: "invalid" }, { revokedAt: NOW }, { revokedAt: "invalid" },
    { validFrom: LATER, expiresAt: NOW }]) {
    assert.equal(authorize(MEMBER, [grant(extra)], request("participation.operate"), NOW).allowed, false);
  }
});

test("revocation is re-evaluated with the same already-authenticated actor", () => {
  const grants = [grant()];
  assert.equal(authorize(MEMBER, grants, request("participation.operate"), NOW).allowed, true);
  grants[0].revokedAt = NOW;
  assert.equal(authorize(MEMBER, grants, request("participation.operate"), NOW).allowed, false);
});

test("aggregate report access does not imply identifiable export or other module access", () => {
  const reader = grant({ capabilities: ["reports.read"] });
  assert.equal(authorize(MEMBER, [reader], request("reports.read"), NOW).allowed, true);
  assert.equal(authorize(MEMBER, [reader], request("reports.export_identifiable"), NOW).allowed, false);
  assert.equal(authorize(MEMBER, [reader], request("inventory.manage"), NOW).allowed, false);
});

test("unknown capabilities and malformed grants never authorize", () => {
  assert.equal(authorize(MEMBER, [grant()], request("do.everything"), NOW).allowed, false);
  for (const malformed of [grant({ scope: { ...ROLE_SCOPE, eventId: "bad", projectId: undefined } }),
    grant({ capabilities: ["participation.operate", "unknown"] }),
    grant({ delegableCapabilities: ["organization.manage"] }),
    grant({ capabilities: ["organization.manage"] })]) {
    assert.equal(authorize(MEMBER, [malformed], request("participation.operate"), NOW).allowed, false);
  }
});

test("delegation requires both invite authority and an explicit capability ceiling", () => {
  const proposal = { scope: ROLE_SCOPE, capabilities: ["participation.operate"] };
  assert.equal(canDelegate(OWNER, [ROOT_GRANT], proposal, NOW).allowed, true);
  assert.equal(canDelegate(MEMBER, [grant()], proposal, NOW).allowed, false);
  const inviterWithoutCeiling = grant({ capabilities: ["access.invite", "participation.operate"] });
  assert.equal(canDelegate(MEMBER, [inviterWithoutCeiling], proposal, NOW).allowed, false);
  const ceilingWithoutInvite = grant({ delegableCapabilities: ["participation.operate"] });
  assert.equal(canDelegate(MEMBER, [ceilingWithoutInvite], proposal, NOW).allowed, false);
});

test("delegation cannot escape project, organization, module, event or validity", () => {
  const manager = grant({
    scope: { ...ROLE_SCOPE, module: "inventory", eventId: "event-1" },
    capabilities: ["access.invite", "inventory.read"], delegableCapabilities: ["inventory.read"],
    expiresAt: LATER,
  });
  const proposal = { scope: manager.scope, capabilities: ["inventory.read"], expiresAt: LATER };
  assert.equal(canDelegate(MEMBER, [manager], proposal, NOW).allowed, true);
  for (const overrides of [{ expiresAt: undefined }, { expiresAt: "2026-10-22T13:00:00Z" },
    { expiresAt: "invalid" }, { expiresAt: NOW }, { capabilities: ["inventory.manage"] },
    { scope: ROLE_SCOPE }, { scope: { ...manager.scope, organizationId: "other" } },
    { scope: { ...manager.scope, projectId: "other" } },
    { scope: { ...manager.scope, eventId: "other" } },
    { scope: { ...manager.scope, module: "reports" } }]) {
    assert.equal(canDelegate(MEMBER, [manager], { ...proposal, ...overrides }, NOW).allowed, false);
  }
});

test("delegation cannot combine unrelated grants or mint further delegation above its ceiling", () => {
  const inviter = grant({ capabilities: ["access.invite"], delegableCapabilities: [] });
  const operator = grant({ id: "second", delegableCapabilities: ["participation.operate"] });
  assert.equal(canDelegate(MEMBER, [inviter, operator], {
    scope: ROLE_SCOPE, capabilities: ["participation.operate"],
  }, NOW).allowed, false);
  assert.equal(canDelegate(OWNER, [ROOT_GRANT], {
    scope: ROLE_SCOPE, capabilities: ["participation.operate"], delegableCapabilities: ["access.invite"],
  }, NOW).allowed, false);
});

test("invitation acceptance binds a verified address to the authenticated user id, not to a name", async () => {
  const h = harness();
  const issued = await issue(h, { recipientEmail: " MEMBER@EXAMPLE.TEST " });
  const accepted = await h.service.accept(MEMBER, issued.token);
  assert.equal(accepted.userId, MEMBER.userId);
  assert.deepEqual(accepted.capabilities, ["participation.operate"]);
  assert.equal(accepted.sourceInvitationId, issued.invitation.id);
  assert.equal(h.snapshot().invitations[0].acceptedBy, MEMBER.userId);
  assert.equal(authorize(MEMBER, h.snapshot().grants, request("participation.operate"), NOW).allowed, true);
  assert.equal(authorize(MEMBER, h.snapshot().grants, request("inventory.manage"), NOW).allowed, false);
});

test("unverified or wrong e-mail cannot accept, and a failed attempt does not consume invitation", async () => {
  const h = harness();
  const issued = await issue(h);
  await rejectsCode(h.service.accept({ userId: "wrong", verifiedEmails: [] }, issued.token), "email_mismatch");
  await rejectsCode(h.service.accept({ userId: "wrong", verifiedEmails: ["wrong@example.test"] }, issued.token), "email_mismatch");
  await h.service.accept(MEMBER, issued.token);
  assert.equal(h.snapshot().grants.filter((g) => g.sourceInvitationId).length, 1);
});

test("accepting an invite never merges accounts that happen to have the same address", async () => {
  const h = harness([ROOT_GRANT, grant({ userId: "existing-other-account" })]);
  const issued = await issue(h);
  const accepted = await h.service.accept(MEMBER, issued.token);
  assert.equal(accepted.userId, "member");
  assert.equal(h.snapshot().grants.some((g) => g.userId === "existing-other-account"), true);
});

test("replay and concurrent acceptance create exactly one membership", async () => {
  const h = harness();
  const issued = await issue(h);
  const results = await Promise.allSettled([
    h.service.accept(MEMBER, issued.token),
    h.service.accept({ userId: "other-identity", verifiedEmails: MEMBER.verifiedEmails }, issued.token),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "already_accepted");
  await rejectsCode(h.service.accept(MEMBER, issued.token), "already_accepted");
  assert.equal(h.snapshot().grants.filter((g) => g.sourceInvitationId).length, 1);
  assert.equal(h.snapshot().audit.filter((event) => event.type === "invitation.accepted").length, 1);
});

test("expiry and malformed time deny invitation acceptance without writing a membership", async () => {
  for (const time of [LATER, "invalid"]) {
    const h = harness();
    const issued = await issue(h);
    h.setTime(time);
    await rejectsCode(h.service.accept(MEMBER, issued.token), time === LATER ? "expired" : "invalid_time");
    assert.equal(h.snapshot().grants.length, 1);
    assert.equal(h.snapshot().invitations[0].acceptedAt, undefined);
  }
});

test("revoking an invitation is scoped, audited and blocks acceptance", async () => {
  const h = harness();
  const issued = await issue(h);
  await rejectsCode(h.service.revoke(MEMBER, issued.invitation.id), "forbidden");
  await h.service.revoke(OWNER, issued.invitation.id);
  await h.service.revoke(OWNER, issued.invitation.id);
  await rejectsCode(h.service.accept(MEMBER, issued.token), "revoked");
  assert.equal(h.snapshot().audit.filter((event) => event.type === "invitation.revoked").length, 1);
});

test("revoking an accepted invitation does not silently revoke or alter its membership", async () => {
  const h = harness();
  const issued = await issue(h);
  await h.service.accept(MEMBER, issued.token);
  await rejectsCode(h.service.revoke(OWNER, issued.invitation.id), "already_accepted");
  assert.equal(h.snapshot().grants.filter((g) => g.sourceInvitationId).length, 1);
});

test("issuer authority is rechecked at acceptance after revocation or scope change", async () => {
  for (const replacement of [{ ...ROOT_GRANT, revokedAt: NOW }, {
    ...ROOT_GRANT, scope: { organizationId: "other" },
  }]) {
    const h = harness();
    const issued = await issue(h);
    h.setGrants([replacement]);
    await rejectsCode(h.service.accept(MEMBER, issued.token), "issuer_no_longer_authorized");
    assert.equal(h.snapshot().invitations[0].acceptedAt, undefined);
  }
});

test("invitation issuance cannot escalate scope, capability or membership lifetime", async () => {
  const h = harness([{ ...ROOT_GRANT, expiresAt: LATER }]);
  await rejectsCode(issue(h), "forbidden");
  await rejectsCode(issue(h, { expiresAt: "2026-10-22T13:00:00Z" }), "forbidden");
  const issued = await issue(h, { expiresAt: LATER });
  const accepted = await h.service.accept(MEMBER, issued.token);
  assert.equal(accepted.expiresAt, LATER);
  const h2 = harness();
  await rejectsCode(issue(h2, { scope: { organizationId: "other" } }), "forbidden");
  await rejectsCode(issue(h2, { capabilities: ["unknown"] }), "invalid_input");
});

test("unknown, malformed and weak tokens are rejected without a membership", async () => {
  const h = harness();
  await rejectsCode(h.service.accept(MEMBER, "short"), "invalid_token");
  await rejectsCode(h.service.accept(MEMBER, randomBytes(32).toString("base64url")), "not_found");
  const weak = createInvitationService({ ...h.dependencies, tokens: {
    ...h.dependencies.tokens, generate: () => "hardcoded",
  } });
  await rejectsCode(weak.issue(OWNER, {
    recipientEmail: "member@example.test", scope: ROLE_SCOPE,
    capabilities: ["participation.operate"], invitationExpiresAt: LATER,
  }), "invalid_token");
  assert.equal(h.snapshot().invitations.length, 0);
});

test("corrupt stored scope or timestamp fails closed", async () => {
  for (const change of [{ scope: { organizationId: "proex", eventId: "event" } },
    { expiresAt: "invalid" }, { issuedAt: "2026-02-30T00:00:00Z" }]) {
    const h = harness();
    const issued = await issue(h);
    h.corruptInvitation(change);
    await assert.rejects(h.service.accept(MEMBER, issued.token), InvitationError);
    assert.equal(h.snapshot().grants.length, 1);
  }
});

test("acceptance and its audit roll back together when persistence fails", async () => {
  const h = harness();
  const issued = await issue(h);
  h.failAudit(true);
  await assert.rejects(h.service.accept(MEMBER, issued.token), /simulated audit failure/);
  assert.equal(h.snapshot().invitations[0].acceptedAt, undefined);
  assert.equal(h.snapshot().grants.length, 1);
  h.failAudit(false);
  await h.service.accept(MEMBER, issued.token);
  assert.equal(h.snapshot().grants.length, 2);
});

test("raw tokens and recipient addresses do not leak into audit events", async () => {
  const h = harness();
  const issued = await issue(h);
  await h.service.accept(MEMBER, issued.token);
  const snapshot = h.snapshot();
  assert.equal(JSON.stringify(snapshot).includes(issued.token), false);
  assert.equal(JSON.stringify(snapshot.audit).includes("member@example.test"), false);
  assert.equal(snapshot.invitations[0].tokenHash.length, 64);
});
