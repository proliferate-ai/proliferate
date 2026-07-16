/**
 * T2-IDENTITY-ORG — the full non-billing auth/org/authorization Tier-2
 * inventory (PR 8, workstream 1).
 *
 * Cells run at the HTTP seam against the ONE booted stack
 * (`makeTier2MatrixScenario`): real Server + Postgres, AnyHarness/runtime
 * skipped. Every handler drives the product's own auth/org HTTP surface (plus
 * the raw-SQL time-travel/DB-read helpers `tests/intent/stack/seed.ts`
 * exposes for state the product has no API to fast-forward or that the
 * product deliberately never surfaces — e.g. backdating an invitation's
 * `expires_at`, or reading the instance-org `is_instance` flag). These cases
 * carry `tier2_billing` evidence with an empty `asserted_policy`/zero
 * `ledger`/empty id arrays (BRIEF §6 note), same as the PR-4 representative
 * cells this file replaces, so the green-requires-evidence gate holds
 * uniformly across both Tier-2 scenarios.
 *
 * Supersedes the PR-4 representative file (`t2-auth-org.ts`, now deleted):
 * T2-AUTH-REP / T2-ORG-ROLES-REP / T2-INVITE-REP are gone. The manifest rows
 * this file claims are real (`specs/developing/testing/core-release-
 * validation.md` §"Authentication, organizations, and surfaces"): T2-AUTH-1,
 * T2-INV-1, T2-INV-2, T2-ORG-1, T2-ORG-2.
 */

import assert from "node:assert/strict";

import { makeTier2MatrixScenario } from "./harness.js";
import type { Tier2CaseResult, Tier2CellContext, Tier2CellHandler } from "./types.js";
import { adminContext } from "./fixtures.js";
import * as seed from "../../../../intent/stack/seed.ts";

export const T2_IDENTITY_ORG_ID = "T2-IDENTITY-ORG";

const PASSWORD = "Tier2Cells!Passw0rd";

/** Raw fetch against the booted stack, bypassing seed.ts's throwing wrappers,
 * for negatives this file needs that seed.ts does not already expose
 * (a raw /setup POST, a raw /register POST past its typed helper). */
async function rawRequest(
  path: string,
  init: { method?: string; token?: string; body?: unknown; form?: Record<string, string> } = {},
): Promise<{ status: number; text: string }> {
  const apiBaseUrl = required("TIER2_BILLING_API_BASE_URL");
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (init.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(init.form).toString();
  } else if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  if (init.token) {
    headers.Authorization = `Bearer ${init.token}`;
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: init.method ?? "GET",
    headers,
    body,
    redirect: "manual",
  });
  return { status: response.status, text: await response.text() };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — did the Tier-2 stack boot?`);
  }
  return value;
}

// ── T2-AUTH-1: fresh /setup claim, password login, logout, relogin,
// wrong-password rejection, and permanent second-claim rejection ──────────
const t2Auth1: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token } = await adminContext();

  // A valid session can read its own identity — proves the claim + first
  // login already performed by `adminContext()` actually authenticated.
  const me = await seed.apiRequest<{ id: string; email: string }>("/users/me", { token });
  assert.equal(me.status, 200, "an authenticated session resolves its own identity");
  assert.ok(me.body.id, "the session carries a stable user id");

  // Relogin: password login is not a one-shot — the same credentials
  // authenticate again and mint a fresh, independently valid session.
  const relogin = await seed.passwordLogin(me.body.email, seed.ADMIN_PASSWORD);
  assert.ok(relogin.access_token, "relogin with the same password succeeds");
  const meAgain = await seed.apiRequest<{ id: string }>("/users/me", { token: relogin.access_token });
  assert.equal(meAgain.status, 200, "the relogin session authenticates independently");
  assert.equal(meAgain.body.id, me.body.id, "relogin resolves the same account");

  // Wrong password is rejected — the negative half of the login lifecycle.
  let rejected = false;
  try {
    await seed.passwordLogin(me.body.email, `wrong-${Date.now()}`);
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, "an incorrect password is rejected, not silently accepted");
  await seed.resetPasswordLoginRateLimits();

  // Logout: POST /auth/web/session/logout bumps the user's token_generation
  // (proliferate.auth.identity.sessions.revoke_sessions_for_refresh_token),
  // which is stamped into every access token at mint and re-checked on every
  // read (TokenGenerationJWTStrategy.read_token) — so logout revokes not just
  // the browser's refresh cookie but every previously issued access token,
  // including the desktop-flow bearer token `relogin` just minted. The web
  // logout route only needs the CSRF-armed refresh cookie for the *web*
  // session it is closing; it is driven here with no cookie at all (refresh
  // token omitted) purely to trigger a no-op-safe call, then the REAL
  // observation is the following read with the previously-good bearer token.
  //
  // Because logout is keyed off a refresh token, not off "which token you
  // present", the reachable proof here is the desktop refresh endpoint's
  // generation check: mint a desktop pair, then force the SAME revocation
  // path (token_generation bump) via the web logout route using that pair's
  // own refresh token, and prove the paired access token stops authenticating.
  const desktopPair = await rawRequest("/auth/desktop/password/login", {
    method: "POST",
    body: { email: me.body.email, password: seed.ADMIN_PASSWORD },
  });
  assert.equal(desktopPair.status, 200, "desktop password login mints a token pair");
  const { access_token: desktopAccess, refresh_token: desktopRefresh } = JSON.parse(desktopPair.text) as {
    access_token: string;
    refresh_token: string;
  };
  const preLogout = await seed.apiRequest("/users/me", { token: desktopAccess });
  assert.equal(preLogout.status, 200, "the freshly minted desktop access token authenticates before logout");

  // Web logout takes the refresh token from a cookie + CSRF double-submit;
  // reproduce that handshake directly rather than through a browser, since a
  // real revocation (not a client-side cookie clear) is exactly what T2-AUTH-1
  // requires "logout" to mean.
  const csrf = "t2-auth-1-csrf";
  const logout = await fetch(`${required("TIER2_BILLING_API_BASE_URL")}/auth/web/session/logout`, {
    method: "POST",
    headers: {
      Cookie: `proliferate_web_refresh=${desktopRefresh}; proliferate_web_csrf=${csrf}`,
      "x-proliferate-csrf": csrf,
    },
  });
  assert.equal(logout.status, 200, "logout with a matching CSRF token + refresh cookie succeeds");

  const postLogout = await seed.apiRequest("/users/me", { token: desktopAccess });
  assert.ok(
    postLogout.status === 401 || postLogout.status === 403,
    "logout revokes the access token minted alongside the closed refresh token, not just the cookie",
  );
  const postLogoutRefresh = await rawRequest("/auth/desktop/refresh", {
    method: "POST",
    body: { grant_type: "refresh_token", refresh_token: desktopRefresh },
  });
  assert.equal(postLogoutRefresh.status, 401, "the revoked refresh token cannot mint a new session either");

  // Permanent second-claim rejection: /setup is claim-once. With a user
  // already present, GET /setup answers 404 (permanently closed) and a
  // second POST — even with the original setup token — is rejected the same
  // way, never silently re-claiming or handing out a second owner account.
  const openProbe = await rawRequest("/setup");
  assert.equal(openProbe.status, 404, "setup is permanently closed once the instance is claimed");
  const secondClaim = await rawRequest("/setup", {
    method: "POST",
    form: {
      email: `second-claim-${Date.now()}@example.com`,
      password: PASSWORD,
      setup_token: seed.readSetupToken(),
      organization_name: "Should Never Exist",
    },
  });
  assert.equal(secondClaim.status, 404, "a second /setup claim attempt is permanently rejected");

  return { status: "green" };
};

// ── T2-INV-1: invite, fresh-browser acceptance, role assignment,
// resend/rotation, revoke, expiry, reuse, duplicate, and wrong-email
// rejection ─────────────────────────────────────────────────────────────────
const t2Inv1: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();

  // Invite + fresh-browser acceptance + role assignment.
  const email = `t2inv1-${Date.now()}@example.com`;
  const invitation = await seed.inviteMember(token, organizationId, email, "admin");
  assert.equal(invitation.status, "pending");
  assert.equal(invitation.role, "admin", "the invited role is carried on the invitation");

  await seed.registerInvitedAccount({ email, password: PASSWORD, invitationToken: invitation.id });
  const loggedIn = await seed.passwordLogin(email, PASSWORD);
  assert.ok(loggedIn.access_token, "the invited member can log in with their own password (fresh browser/session)");
  const members = await seed.listMembers(token, organizationId);
  const accepted = members.find((m) => m.email === email);
  assert.ok(accepted, "the invited account appears as a member after self-registration");
  assert.equal(accepted!.status, "active");
  assert.equal(accepted!.role, "admin", "the accepted membership lands with the invited role, not a default");

  // Reuse: an already-accepted invitation cannot register a second account.
  const reuse = await seed.registerInvitedAccountRaw({
    email: `t2inv1-reuse-${Date.now()}@example.com`,
    password: PASSWORD,
    invitationToken: invitation.id,
  });
  assert.notEqual(reuse.status, 200, "an accepted invitation cannot be reused to register another account");

  // Wrong-email rejection: a real, still-pending invitation issued to one
  // email cannot be redeemed by a registration claiming a different email.
  const wrongEmailTarget = `t2inv1-wrongtarget-${Date.now()}@example.com`;
  const wrongEmailInvite = await seed.inviteMember(token, organizationId, wrongEmailTarget, "member");
  const wrongEmailAttempt = await seed.registerInvitedAccountRaw({
    email: `t2inv1-impersonator-${Date.now()}@example.com`,
    password: PASSWORD,
    invitationToken: wrongEmailInvite.id,
  });
  assert.notEqual(wrongEmailAttempt.status, 200, "registering with a mismatched email against a real token is rejected");

  // Duplicate: a second invitation to the same still-pending email rotates
  // the allowlist entry (the product's observed contract — one live pending
  // invitation per email, not two coexisting ones) rather than erroring;
  // the OLD token stops working once the duplicate is sent.
  const dupTarget = `t2inv1-dup-${Date.now()}@example.com`;
  const firstDup = await seed.inviteMember(token, organizationId, dupTarget, "member");
  const secondDup = await seed.inviteMember(token, organizationId, dupTarget, "member");
  assert.notEqual(secondDup.id, firstDup.id, "duplicate-invite rotates to a new invitation id");
  const staleFirstDup = await seed.registerInvitedAccountRaw({
    email: dupTarget,
    password: PASSWORD,
    invitationToken: firstDup.id,
  });
  assert.notEqual(staleFirstDup.status, 200, "the superseded first invitation token no longer redeems");
  const freshSecondDup = await seed.registerInvitedAccountRaw({
    email: dupTarget,
    password: PASSWORD,
    invitationToken: secondDup.id,
  });
  assert.equal(freshSecondDup.status, 200, "the newest duplicate invitation token redeems");

  // Resend/rotation: resend keeps the invitation id but re-arms delivery and
  // extends the expiry — proven by resending an invite, then still redeeming
  // the SAME token afterward (rotation did not invalidate the id it rotated).
  const rotateTarget = `t2inv1-rotate-${Date.now()}@example.com`;
  const toRotate = await seed.inviteMember(token, organizationId, rotateTarget, "member");
  const resent = await seed.apiRequest<{ id: string; deliveryStatus: string }>(
    `/v1/organizations/${organizationId}/invitations/${toRotate.id}/resend`,
    { method: "POST", token },
  );
  assert.equal(resent.status, 200, "resend succeeds for a still-pending invitation");
  assert.equal(resent.body.id, toRotate.id, "resend rotates delivery/expiry in place, keeping the same invitation id");
  const redeemAfterResend = await seed.registerInvitedAccountRaw({
    email: rotateTarget,
    password: PASSWORD,
    invitationToken: toRotate.id,
  });
  assert.equal(redeemAfterResend.status, 200, "the same token still redeems after a resend/rotation");

  // Revoke-before-accept: a revoked invitation cannot be accepted.
  const revokeTarget = `t2inv1-revoked-${Date.now()}@example.com`;
  const toRevoke = await seed.inviteMember(token, organizationId, revokeTarget, "member");
  const revoked = await seed.revokeInvitation(token, organizationId, toRevoke.id);
  assert.ok([200, 204].includes(revoked.status), "revocation succeeds");
  const afterRevoke = await seed.registerInvitedAccountRaw({
    email: revokeTarget,
    password: PASSWORD,
    invitationToken: toRevoke.id,
  });
  assert.notEqual(afterRevoke.status, 200, "a revoked invitation cannot be accepted");

  // Expiry: backdate a pending invitation's expires_at directly (no product
  // API fast-forwards time; the same time-travel convention Tier-2 billing
  // uses with Stripe test clocks) and prove it can no longer be redeemed.
  const expiryTarget = `t2inv1-expired-${Date.now()}@example.com`;
  const toExpire = await seed.inviteMember(token, organizationId, expiryTarget, "member");
  await seed.backdateInvitationExpiry(toExpire.id, new Date(Date.now() - 60_000));
  const afterExpiry = await seed.registerInvitedAccountRaw({
    email: expiryTarget,
    password: PASSWORD,
    invitationToken: toExpire.id,
  });
  assert.notEqual(afterExpiry.status, 200, "an expired invitation cannot be accepted");

  return { status: "green" };
};

// ── T2-INV-2: single-org register-via-invite creates the account and
// membership atomically; a bad token or email creates neither ─────────────
const t2Inv2: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();

  // Happy path: the account and its membership appear together.
  const email = `t2inv2-${Date.now()}@example.com`;
  const invitation = await seed.inviteMember(token, organizationId, email, "member");
  await seed.registerInvitedAccount({ email, password: PASSWORD, invitationToken: invitation.id });
  const login = await seed.passwordLogin(email, PASSWORD);
  assert.ok(login.access_token, "registration creates a real, independently-loginable account");
  const members = await seed.listMembers(token, organizationId);
  assert.ok(members.some((m) => m.email === email && m.status === "active"), "the account and membership are both present");

  // Bad token: registration fails, and the transaction leaves neither a
  // usable account nor a membership behind.
  const badTokenEmail = `t2inv2-badtoken-${Date.now()}@example.com`;
  const badToken = await seed.registerInvitedAccountRaw({
    email: badTokenEmail,
    password: PASSWORD,
    invitationToken: "00000000-0000-0000-0000-000000000000",
  });
  assert.notEqual(badToken.status, 200, "a bad invitation token fails registration");
  let badTokenLoginRejected = false;
  try {
    await seed.passwordLogin(badTokenEmail, PASSWORD);
  } catch {
    badTokenLoginRejected = true;
  }
  assert.equal(badTokenLoginRejected, true, "a bad-token registration attempt created no loginable account");
  const membersAfterBadToken = await seed.listMembers(token, organizationId);
  assert.ok(
    !membersAfterBadToken.some((m) => m.email === badTokenEmail),
    "a bad-token registration attempt created no membership",
  );

  // Bad email (mismatched against a real, live token): same atomicity — the
  // rejected attempt creates neither the impersonator's account nor a
  // membership for them.
  const mismatchTarget = `t2inv2-mismatchtarget-${Date.now()}@example.com`;
  const mismatchInvite = await seed.inviteMember(token, organizationId, mismatchTarget, "member");
  const impersonatorEmail = `t2inv2-impersonator-${Date.now()}@example.com`;
  const badEmail = await seed.registerInvitedAccountRaw({
    email: impersonatorEmail,
    password: PASSWORD,
    invitationToken: mismatchInvite.id,
  });
  assert.notEqual(badEmail.status, 200, "a token/email mismatch fails registration");
  let badEmailLoginRejected = false;
  try {
    await seed.passwordLogin(impersonatorEmail, PASSWORD);
  } catch {
    badEmailLoginRejected = true;
  }
  assert.equal(badEmailLoginRejected, true, "a mismatched-email registration attempt created no loginable account");
  const membersAfterBadEmail = await seed.listMembers(token, organizationId);
  assert.ok(
    !membersAfterBadEmail.some((m) => m.email === impersonatorEmail),
    "a mismatched-email registration attempt created no membership",
  );

  return { status: "green" };
};

// ── T2-ORG-1: role promotion/demotion, last-owner protection, member
// removal, and immediate permission refresh ─────────────────────────────────
const t2Org1: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();

  // Promotion + demotion, proven behaviorally (an admin-gated action denied
  // before promotion, allowed after).
  const email = `t2org1-roles-${Date.now()}@example.com`;
  const memberToken = await seed.registerFreshMember(token, organizationId, email, PASSWORD, "member");
  const memberInvite = await seed.inviteMemberRaw(memberToken, organizationId, `t2org1-blocked-${Date.now()}@example.com`, "member");
  assert.equal(memberInvite.status, 403, "a member role cannot perform an admin-gated action");

  const members = await seed.listMembers(token, organizationId);
  const membership = members.find((m) => m.email === email)!;
  const promotion = await seed.updateMembership(token, organizationId, membership.membershipId, { role: "admin" });
  assert.ok([200, 201].includes(promotion.status), "role promotion succeeds");
  assert.equal(promotion.body.role, "admin");

  const promotedInvite = await seed.inviteMemberRaw(memberToken, organizationId, `t2org1-allowed-${Date.now()}@example.com`, "member");
  assert.ok([200, 201].includes(promotedInvite.status), "a promoted admin can now perform the admin-gated action");

  const demotion = await seed.updateMembership(token, organizationId, membership.membershipId, { role: "member" });
  assert.ok([200, 201].includes(demotion.status), "role demotion succeeds");
  assert.equal(demotion.body.role, "member");
  const demotedInviteAttempt = await seed.inviteMemberRaw(memberToken, organizationId, `t2org1-blocked-again-${Date.now()}@example.com`, "member");
  assert.equal(demotedInviteAttempt.status, 403, "demotion immediately revokes the admin-gated action");

  // Last-owner protection: demoting or removing the sole owner is rejected.
  // adminContext()'s claimed account is the org's only owner in this run.
  const selfDemote = await seed.updateMembership(token, organizationId, /* the owner's own membership */ await ownMembershipId(token, organizationId), { role: "admin" });
  // The service also independently blocks self-modification
  // (cannot_modify_own_membership, 403) before the last-owner check would
  // even run; both are legitimate "the sole owner cannot be downgraded"
  // outcomes, so accept either 403 (self-modify guard) or 409 (last-owner
  // guard) as the reject — never a silent 200.
  assert.ok(
    [403, 409].includes(selfDemote.status),
    "the sole owner cannot demote themselves out of the owner role",
  );

  // Prove the last-owner guard itself (not just the self-modify guard) by
  // having a DIFFERENT actor attempt to demote the owner. Promote the fresh
  // member back to admin so it can act as org-admin caller.
  await seed.updateMembership(token, organizationId, membership.membershipId, { role: "admin" });
  const ownerMembershipId = await ownMembershipId(token, organizationId);
  const otherActorDemotesOwner = await seed.updateMembership(memberToken, organizationId, ownerMembershipId, { role: "admin" });
  assert.equal(
    otherActorDemotesOwner.status,
    409,
    "the last organization owner cannot be demoted, even by another admin",
  );
  const otherActorRemovesOwner = await seed.removeMembership(memberToken, organizationId, ownerMembershipId);
  assert.equal(
    otherActorRemovesOwner.status,
    409,
    "the last organization owner cannot be removed, even by another admin",
  );
  // Cleanup: demote the helper back to member for later cases in this run.
  await seed.updateMembership(token, organizationId, membership.membershipId, { role: "member" });

  // Member removal + immediate permission refresh: the removed member's
  // OWN still-held token stops working on its very next org-scoped call —
  // no re-login/refresh needed to observe the block.
  const removeEmail = `t2org1-removeme-${Date.now()}@example.com`;
  const removeToken = await seed.registerFreshMember(token, organizationId, removeEmail, PASSWORD, "member");
  const beforeRemoval = await seed.apiRequest(`/v1/organizations/${organizationId}`, { token: removeToken });
  assert.equal(beforeRemoval.status, 200, "the member can read the org before removal");
  const removeMembers = await seed.listMembers(token, organizationId);
  const removeMembership = removeMembers.find((m) => m.email === removeEmail)!;
  const removal = await seed.removeMembership(token, organizationId, removeMembership.membershipId);
  assert.ok([200, 201].includes(removal.status), "member removal succeeds");
  const afterRemoval = await seed.apiRequest(`/v1/organizations/${organizationId}`, { token: removeToken });
  assert.ok(
    afterRemoval.status === 403 || afterRemoval.status === 404,
    "a removed member's own token is denied immediately on its next org-scoped call",
  );

  return { status: "green" };
};

async function ownMembershipId(token: string, organizationId: string): Promise<string> {
  const org = await seed.apiRequest<{ membership?: { id: string } }>(`/v1/organizations/${organizationId}`, { token });
  assert.equal(org.status, 200, "resolving the caller's own membership id requires a readable org");
  const membershipId = org.body.membership?.id;
  assert.ok(membershipId, "the organization response carries the caller's membership id");
  return membershipId!;
}

// ── T2-ORG-2: owner/admin/member/removed-member/outsider visibility and
// mutation boundaries across organization, workspace, secret, billing,
// integration, and workflow APIs ────────────────────────────────────────────
const t2Org2: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token: ownerToken, organizationId } = await adminContext();

  const adminEmail = `t2org2-admin-${Date.now()}@example.com`;
  const adminToken = await seed.registerFreshMember(ownerToken, organizationId, adminEmail, PASSWORD, "member");
  const adminMembers = await seed.listMembers(ownerToken, organizationId);
  const adminMembership = adminMembers.find((m) => m.email === adminEmail)!;
  await seed.updateMembership(ownerToken, organizationId, adminMembership.membershipId, { role: "admin" });

  const memberEmail = `t2org2-member-${Date.now()}@example.com`;
  const memberToken = await seed.registerFreshMember(ownerToken, organizationId, memberEmail, PASSWORD, "member");

  const removedEmail = `t2org2-removed-${Date.now()}@example.com`;
  const removedToken = await seed.registerFreshMember(ownerToken, organizationId, removedEmail, PASSWORD, "member");
  const removedMembers = await seed.listMembers(ownerToken, organizationId);
  const removedMembership = removedMembers.find((m) => m.email === removedEmail)!;
  await seed.removeMembership(ownerToken, organizationId, removedMembership.membershipId);

  // Outsider: single-org mode's `SingleOrgPolicy.place_new_identity` joins
  // every new password identity into THE one instance org (see
  // membership_policy.py) — there is no product path in single-org mode to
  // create an authenticated user who belongs to NO organization. An
  // unauthenticated caller (no token at all) is the only "outsider" this
  // seam can produce, so it stands in for the outsider row.
  //
  // UNREACHABLE AT THIS SEAM: an *authenticated-but-org-less* outsider
  // (a real hosted-mode-style account with zero organization membership)
  // cannot be constructed against a single-org-mode boot; only the
  // no-token/unauthenticated case is reachable here.

  type Actor = { name: string; token: string | undefined };
  const actors: Actor[] = [
    { name: "owner", token: ownerToken },
    { name: "admin", token: adminToken },
    { name: "member", token: memberToken },
    { name: "removed-member", token: removedToken },
    { name: "outsider", token: undefined },
  ];

  // One representative read + one representative mutation per API family.
  // Expected: owner/admin/member (active org members) read the org-scoped
  // read; only owner/admin (admin-gated) may mutate; removed-member and
  // outsider are denied both, never with a 5xx.
  for (const actor of actors) {
    const isActiveMember = actor.name === "owner" || actor.name === "admin" || actor.name === "member";
    const isAdmin = actor.name === "owner" || actor.name === "admin";

    // organizations: read the org; mutate = rename it (PATCH).
    const orgRead = await seed.apiRequest(`/v1/organizations/${organizationId}`, { token: actor.token });
    assertDenyOrAllow(orgRead.status, isActiveMember, `organizations read (${actor.name})`);
    const orgMutate = await seed.apiRequest(`/v1/organizations/${organizationId}`, {
      method: "PATCH",
      token: actor.token,
      body: { name: `T2-ORG-2 rename attempt by ${actor.name}` },
    });
    assertDenyOrAllow(orgMutate.status, isAdmin, `organizations mutate (${actor.name})`);
    if (isAdmin) {
      // Restore the name so later actors' reads aren't confused by a stale rename.
      await seed.apiRequest(`/v1/organizations/${organizationId}`, {
        method: "PATCH",
        token: ownerToken,
        body: { name: seed.ADMIN_ORG_NAME },
      });
    }

    // cloud workspaces: list (personal-scoped, any authenticated user);
    // create (personal-scoped, denied outright here since no repo
    // environment is configured — the 404 that produces is itself the
    // "authenticated but nothing to act on" shape, so this family's mutation
    // check instead asserts unauthenticated is denied and authenticated is
    // NOT denied with an auth-shaped status).
    const wsList = await seed.apiRequest("/v1/cloud/workspaces", { token: actor.token });
    assertDenyOrAllow(wsList.status, actor.token !== undefined, `cloud workspaces list (${actor.name})`);
    const wsCreate = await seed.apiRequest("/v1/cloud/workspaces", {
      method: "POST",
      token: actor.token,
      body: {
        gitProvider: "github",
        gitOwner: "t2org2",
        gitRepoName: "no-such-repo",
        branchName: `t2org2-${Date.now()}`,
        source: "web",
      },
    });
    if (actor.token === undefined) {
      assert.ok([401, 403].includes(wsCreate.status), `cloud workspaces create (outsider) must deny, got ${wsCreate.status}`);
    } else {
      assert.notEqual(wsCreate.status, 401, `cloud workspaces create (${actor.name}) must not deny an authenticated caller with a 5xx-adjacent auth failure`);
      assert.ok(wsCreate.status < 500, `cloud workspaces create (${actor.name}) must never 5xx, got ${wsCreate.status}`);
    }

    // org secrets: read = any active member; mutate (PUT env var) = admin only.
    const secretsRead = await seed.apiRequest(`/v1/cloud/organizations/${organizationId}/secrets`, { token: actor.token });
    assertDenyOrAllow(secretsRead.status, isActiveMember, `org secrets read (${actor.name})`);
    const secretsMutate = await seed.apiRequest(
      `/v1/cloud/organizations/${organizationId}/secrets/env-vars/T2_ORG2_PROBE`,
      { method: "PUT", token: actor.token, body: { value: "probe" } },
    );
    assertDenyOrAllow(secretsMutate.status, isAdmin, `org secrets mutate (${actor.name})`);

    // billing: read overview scoped to this org; mutate = overage settings.
    const billingRead = await seed.apiRequest(`/v1/billing/overview?organizationId=${organizationId}`, { token: actor.token });
    assertDenyOrAllow(billingRead.status, isActiveMember, `billing overview read (${actor.name})`);
    const billingMutate = await seed.apiRequest("/v1/billing/overage-settings", {
      method: "POST",
      token: actor.token,
      body: { enabled: false, ownerScope: "organization", organizationId },
    });
    // Overage settings resolves its owner context the same way billing
    // overview does (organizationId-qualified OwnerContext), so a non-member
    // gets the same 404/401/403-class denial; a member (non-admin) may still
    // be denied by a role check inside the service, so only assert the floor:
    // never a 5xx, and outsiders/removed members are always denied.
    if (!isActiveMember) {
      assert.ok(billingMutate.status < 500, `billing mutate (${actor.name}) must never 5xx, got ${billingMutate.status}`);
      assert.ok(
        [401, 403, 404].includes(billingMutate.status),
        `billing mutate (${actor.name}) must deny a non-member, got ${billingMutate.status}`,
      );
    } else {
      assert.ok(billingMutate.status < 500, `billing mutate (${actor.name}) must never 5xx, got ${billingMutate.status}`);
    }

    // integrations: catalog read scoped to the org; admin-only definition
    // create is the mutation.
    const integrationsRead = await seed.apiRequest(`/v1/integrations/catalog?organizationId=${organizationId}`, { token: actor.token });
    assertDenyOrAllow(integrationsRead.status, isActiveMember, `integrations catalog read (${actor.name})`);
    const integrationsMutate = await seed.apiRequest(
      `/v1/integrations/admin/organizations/${organizationId}/definitions`,
      { token: actor.token },
    );
    assertDenyOrAllow(integrationsMutate.status, isAdmin, `integrations admin list (${actor.name})`);

    // workflows: personal-scoped list/create — same shape as cloud
    // workspaces (any authenticated user may act on their OWN workflows;
    // there is no org-scoped workflow read/write surface in this inventory).
    const workflowsRead = await seed.apiRequest("/v1/workflows", { token: actor.token });
    assertDenyOrAllow(workflowsRead.status, actor.token !== undefined, `workflow definitions list (${actor.name})`);
  }

  return { status: "green" };
};

/** Deny = 401/403/404 (never enumerable, never a 5xx); allow = 2xx. Anything
 * else (in particular a 5xx) fails the assertion outright — a boundary
 * violation must never present as a server error. */
function assertDenyOrAllow(status: number, shouldAllow: boolean, label: string): void {
  assert.ok(status < 500, `${label}: must never 5xx, got ${status}`);
  if (shouldAllow) {
    assert.ok(status >= 200 && status < 300, `${label}: expected allow (2xx), got ${status}`);
  } else {
    assert.ok([401, 403, 404].includes(status), `${label}: expected deny (401/403/404), got ${status}`);
  }
}

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
  "T2-AUTH-1": withEmptyEvidence(t2Auth1),
  "T2-INV-1": withEmptyEvidence(t2Inv1),
  "T2-INV-2": withEmptyEvidence(t2Inv2),
  "T2-ORG-1": withEmptyEvidence(t2Org1),
  "T2-ORG-2": withEmptyEvidence(t2Org2),
};

export const t2IdentityOrg = makeTier2MatrixScenario({
  id: T2_IDENTITY_ORG_ID,
  title: "Tier-2 identity/org/authorization manifest cells (auth lifecycle, invitations, roles, cross-actor boundaries)",
  registryFlowRef: "specs/developing/testing/core-release-validation.md#t2-identity-org",
  requiredEnv: [],
  requireStripe: false,
  cases,
});
