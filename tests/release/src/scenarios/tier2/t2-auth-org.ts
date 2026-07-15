/**
 * T2-AUTH-ORG — representative auth/org/authorization cells (PR 4, BRIEF §6).
 *
 * A BOUNDED set proving the Tier-2-on-runner mechanism generalizes beyond
 * billing: one auth, one org-roles, one invitation case adapted onto the
 * runner (the reusable `tests/intent` seed/auth helpers, driven against the
 * shared booted stack). The FULL non-billing Tier-2 inventory is PR 8 — do not
 * port it here. These cases carry `tier2_billing` evidence with an empty
 * `asserted_policy`/zero `ledger`/empty id arrays (BRIEF §6 note) so the
 * green-requires-evidence gate holds uniformly across both Tier-2 scenarios.
 */

import assert from "node:assert/strict";

import { makeTier2MatrixScenario } from "./harness.js";
import type { Tier2CaseResult, Tier2CellContext, Tier2CellHandler } from "./types.js";
import { adminContext, userIdFor } from "./fixtures.js";
import * as seed from "../../../../intent/stack/seed.ts";

export const T2_AUTH_ORG_ID = "T2-AUTH-ORG";

const PASSWORD = "Tier2Cells!Passw0rd";

// ── T2-AUTH-REP: claim + password login/logout (session lifecycle) ────────
const t2AuthRep: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token } = await adminContext();

  // A valid session can read its own identity.
  const me = await seed.apiRequest<{ id: string; email: string }>("/users/me", { token });
  assert.equal(me.status, 200, "an authenticated session resolves its own identity");
  assert.ok(me.body.id, "the session carries a stable user id");

  // Wrong password is rejected — the negative half of the login lifecycle.
  let rejected = false;
  try {
    await seed.passwordLogin(me.body.email, `wrong-${Date.now()}`);
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, "an incorrect password is rejected, not silently accepted");
  await seed.resetPasswordLoginRateLimits();

  // An expired/garbage bearer token is rejected — "logout" in this
  // stateless-JWT-session client is "the token stops being accepted"; there is
  // no server-side revocation endpoint in this suite's surface, so the
  // negative-auth case above plus this malformed-token rejection is the
  // tier-2-reachable half of the session lifecycle.
  const garbled = await seed.apiRequest("/users/me", { token: `${token}garbled` });
  assert.ok(garbled.status === 401 || garbled.status === 403, "a tampered bearer token is rejected");

  return { status: "green" };
};

// ── T2-ORG-ROLES-REP: role change is enforced (member cannot admin-act;
// promoted admin can) ──────────────────────────────────────────────────────
const t2OrgRolesRep: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();
  const email = `t2orgroles-${Date.now()}@example.com`;
  const memberToken = await seed.registerFreshMember(token, organizationId, email, PASSWORD, "member");

  // A plain member cannot invite (an admin-only action).
  const memberInvite = await seed.inviteMemberRaw(memberToken, organizationId, `t2orgroles-blocked-${Date.now()}@example.com`, "member");
  assert.equal(memberInvite.status, 403, "a member role cannot perform an admin-gated action");

  // Promote to admin; the same action now succeeds.
  const members = await seed.listMembers(token, organizationId);
  const membership = members.find((m) => m.email === email)!;
  const promotion = await seed.updateMembership(token, organizationId, membership.membershipId, { role: "admin" });
  assert.ok([200, 201].includes(promotion.status), "role promotion succeeds");
  assert.equal(promotion.body.role, "admin");

  const promotedInvite = await seed.inviteMemberRaw(memberToken, organizationId, `t2orgroles-allowed-${Date.now()}@example.com`, "member");
  assert.ok([200, 201].includes(promotedInvite.status), "a promoted admin can now perform the admin-gated action");

  // Demote back to member (cleanup for later cases in this run).
  await seed.updateMembership(token, organizationId, membership.membershipId, { role: "member" });

  return { status: "green" };
};

// ── T2-INVITE-REP: invite + accept reflects in membership; revoke-before-
// accept blocks acceptance ─────────────────────────────────────────────────
const t2InviteRep: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();

  const email = `t2invite-${Date.now()}@example.com`;
  const invitation = await seed.inviteMember(token, organizationId, email, "member");
  assert.equal(invitation.status, "pending");

  await seed.registerInvitedAccount({ email, password: PASSWORD, invitationToken: invitation.id });
  const loggedIn = await seed.passwordLogin(email, PASSWORD);
  const members = await seed.listMembers(token, organizationId);
  const accepted = members.find((m) => m.email === email);
  assert.ok(accepted, "the invited account appears as a member after self-registration");
  assert.equal(accepted!.status, "active");
  assert.ok(loggedIn.access_token, "the invited member can log in with their own password");

  // Revoke-before-accept: a second invitation, revoked, cannot be accepted.
  const email2 = `t2invite-revoked-${Date.now()}@example.com`;
  const invitation2 = await seed.inviteMember(token, organizationId, email2, "member");
  const revoked = await seed.revokeInvitation(token, organizationId, invitation2.id);
  assert.ok([200, 204].includes(revoked.status), "revocation succeeds");
  const raw = await seed.registerInvitedAccountRaw({ email: email2, password: PASSWORD, invitationToken: invitation2.id });
  assert.notEqual(raw.status, 200, "a revoked invitation cannot be accepted");

  return { status: "green" };
};

function withEmptyEvidence(handler: Tier2CellHandler): Tier2CellHandler {
  return async (ctx: Tier2CellContext): Promise<Tier2CaseResult> => {
    const result = await handler(ctx);
    if (result.status === "green") {
      // No billing ledger/Stripe/policy surface applies to these auth/org
      // cases; the evidence carries the case id with empty/zero fields so the
      // green-requires-evidence gate holds uniformly (BRIEF §6 note).
      ctx.policy.record({});
    }
    return result;
  };
}

const cases: Record<string, Tier2CellHandler> = {
  "T2-AUTH-REP": withEmptyEvidence(t2AuthRep),
  "T2-ORG-ROLES-REP": withEmptyEvidence(t2OrgRolesRep),
  "T2-INVITE-REP": withEmptyEvidence(t2InviteRep),
};

export const t2AuthOrg = makeTier2MatrixScenario({
  id: T2_AUTH_ORG_ID,
  title: "Tier-2 representative auth/org/authorization cells (mechanism generality proof; full inventory is PR 8)",
  registryFlowRef: "specs/developing/testing/core-release-validation.md#t2-auth-org",
  requiredEnv: [],
  requireStripe: false,
  cases,
});
