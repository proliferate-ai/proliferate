// T2-ORG-1 (specs/developing/testing/scenarios.md): organization roles and
// gating.
//
// Preconditions per the scenario: an org with one owner, one admin, one
// member. Single-org mode only ever mints ONE organization (the instance
// org, claimed once in auth.spec.ts's T2-AUTH-1), so this spec seeds the
// admin and member roles by inviting + self-registering through the
// product's own /register surface — the same "invite doubles as the
// allowlist entry" mechanism invitation.spec.ts already exercises. That is
// the preferred path scenarios.md names for exactly this situation.
//
// Survey facts that shape this test (verified against code, not assumed):
// - required_roles_for_invitation_role (organizations/domain/policy.py):
//   inviting role "owner" requires the caller to already be an owner;
//   inviting "member"/"admin" only requires admin-or-owner. Enforced in
//   organizations/service.py create_invitation via _require_current_org_role,
//   surfaced as 403 organization_permission_denied.
// - Membership role/status updates (PATCH .../members/{id}) run through the
//   same DB-backed role lookup on every request (CurrentOrgUser.role comes
//   from the membership row via current_path_org_admin) — there is no
//   JWT-embedded role to go stale, so a promotion's effect is immediate on
//   the promoted user's very next call, no re-login or token refresh needed.
// - Removing a membership sets status='removed'; get_organization_with_membership
//   (backing GET /organizations/{id}) filters to ACTIVE memberships only, so
//   the removed user's very next org-scoped call 404s with
//   organization_not_found — membership_policy.py additionally guarantees a
//   removed member is never silently reactivated by a later list/login call
//   (place_new_identity raises instance_access_removed, 403, instead).
//
// SPEC DIVERGENCE (flagged for the record, see PR body): scenarios.md names
// "list invitations" as an example of an admin-gated endpoint a member gets
// 403 from. As built, GET /organizations/{id}/invitations depends on
// current_path_org_member (not current_path_org_admin) — see
// organizations/api.py list_organization_invitations_endpoint — so a plain
// member CAN call it successfully today, even though the settings UI that
// surfaces the same data (OrganizationMembersSection) is adminOnly
// navigation. This test pins the AS-BUILT behavior (member 200s on that
// specific endpoint) as a documented product gap, and uses a genuinely
// admin-gated endpoint (create-invitation) for the 403 assertion the
// scenario actually needs.

import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  apiRequest,
  ensureInstanceClaimed,
  getOwnOrganization,
  inviteAndRegisterMember,
  inviteMemberRaw,
  listMembers,
  listOrganizationInvitations,
  passwordLogin,
  updateMembership,
} from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

const ADMIN_ROLE_EMAIL = "t2org-admin@t2intent.example.com";
const ADMIN_ROLE_PASSWORD = "T2OrgAdmin!Passw0rd";
const MEMBER_ROLE_EMAIL = "t2org-member@t2intent.example.com";
const MEMBER_ROLE_PASSWORD = "T2OrgMember!Passw0rd";
// Date.now()-suffixed: these two get their role/status mutated by the test
// (promoted, removed) and the profile DB persists across local reruns
// (stack/boot.ts) — a fixed email would come back already-mutated on a
// rerun and the "before" assertions below would spuriously fail against
// leftover state from a prior run, not this run's behavior.
const RUN_ID = Date.now();
const PROMOTE_EMAIL = `t2org-promote-${RUN_ID}@t2intent.example.com`;
const PROMOTE_PASSWORD = "T2OrgPromote!Passw0rd";
const REMOVE_EMAIL = `t2org-remove-${RUN_ID}@t2intent.example.com`;
const REMOVE_PASSWORD = "T2OrgRemove!Passw0rd";

let ownerToken: string;
let organizationId: string;
let adminRoleToken: string;
let memberRoleToken: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  ownerToken = (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
  organizationId = (await getOwnOrganization(ownerToken)).id;

  // Seed one admin and one member alongside the existing owner — the
  // scenario's "org with one owner, one admin, one member" precondition.
  adminRoleToken = await inviteAndRegisterMember(
    ownerToken,
    organizationId,
    ADMIN_ROLE_EMAIL,
    ADMIN_ROLE_PASSWORD,
    "admin",
  );
  memberRoleToken = await inviteAndRegisterMember(
    ownerToken,
    organizationId,
    MEMBER_ROLE_EMAIL,
    MEMBER_ROLE_PASSWORD,
    "member",
  );
});

test.describe("T2-ORG-1: roles and gating", () => {
  test("member gets 403 on an admin-gated endpoint (create invitation)", async () => {
    const attempt = await inviteMemberRaw(
      memberRoleToken,
      organizationId,
      "should-never-exist@t2intent.example.com",
      "member",
    );
    expect(attempt.status).toBe(403);
    const detail = (attempt.body as unknown as { detail?: { code?: string } }).detail;
    expect(detail?.code).toBe("organization_permission_denied");
  });

  test("documents GAP: list-invitations is member-readable, not admin-gated, despite adminOnly settings UI", async () => {
    // The UI section that surfaces this data (OrganizationMembersSection,
    // settings navigation id "organization-members") is adminOnly — but the
    // API it calls underneath has no such gate. A plain member can read
    // every pending/accepted/revoked invitation for the org, including
    // invitee email addresses, via a direct call. Pinned here so a future
    // tightening (or a ruling that this is intentional) shows up as a loud
    // diff instead of silent drift.
    const asMember = await listOrganizationInvitations(memberRoleToken, organizationId);
    expect(Array.isArray(asMember)).toBe(true); // 200, not 403.
  });

  test("admin can invite member and admin, but not owner", async () => {
    const inviteMemberResult = await inviteMemberRaw(
      adminRoleToken,
      organizationId,
      "t2org-admin-invites-member@t2intent.example.com",
      "member",
    );
    expect([200, 201]).toContain(inviteMemberResult.status);

    const inviteAdminResult = await inviteMemberRaw(
      adminRoleToken,
      organizationId,
      "t2org-admin-invites-admin@t2intent.example.com",
      "admin",
    );
    expect([200, 201]).toContain(inviteAdminResult.status);

    const inviteOwnerResult = await inviteMemberRaw(
      adminRoleToken,
      organizationId,
      "t2org-admin-invites-owner@t2intent.example.com",
      "owner",
    );
    expect(inviteOwnerResult.status).toBe(403);
    const detail = (inviteOwnerResult.body as unknown as { detail?: { code?: string } }).detail;
    expect(detail?.code).toBe("organization_permission_denied");
  });

  test("owner can invite owner", async () => {
    const inviteOwnerResult = await inviteMemberRaw(
      ownerToken,
      organizationId,
      "t2org-owner-invites-owner@t2intent.example.com",
      "owner",
    );
    expect([200, 201]).toContain(inviteOwnerResult.status);
    expect(inviteOwnerResult.body.role).toBe("owner");
    expect(inviteOwnerResult.body.status).toBe("pending");
  });

  test("promote member -> admin via membership update; the promoted user gains admin surfaces on their next call, no re-login needed", async () => {
    const promotedToken = await inviteAndRegisterMember(
      ownerToken,
      organizationId,
      PROMOTE_EMAIL,
      PROMOTE_PASSWORD,
      "member",
    );

    // Before promotion: the same admin-gated call this spec already proved
    // members get 403 from.
    const before = await inviteMemberRaw(
      promotedToken,
      organizationId,
      "t2org-promote-before@t2intent.example.com",
      "member",
    );
    expect(before.status).toBe(403);

    const members = await listMembers(ownerToken, organizationId);
    const membership = members.find((member) => member.email === PROMOTE_EMAIL);
    expect(membership).toBeDefined();

    const update = await updateMembership(ownerToken, organizationId, membership!.membershipId, {
      role: "admin",
    });
    expect(update.status).toBe(200);
    expect(update.body.role).toBe("admin");

    // The SAME access token from before the promotion — role is resolved
    // from the membership row on every request, not embedded in the JWT, so
    // this proves the effect is immediate without a fresh login.
    const after = await inviteMemberRaw(
      promotedToken,
      organizationId,
      "t2org-promote-after@t2intent.example.com",
      "member",
    );
    expect([200, 201]).toContain(after.status);
  });

  test("remove a member -> membership status 'removed' -> their next org-scoped call fails", async () => {
    const removedUserToken = await inviteAndRegisterMember(
      ownerToken,
      organizationId,
      REMOVE_EMAIL,
      REMOVE_PASSWORD,
      "member",
    );

    // Sanity: the org-scoped call works while still active.
    const beforeRemoval = await apiRequest(`/v1/organizations/${organizationId}`, {
      token: removedUserToken,
    });
    expect(beforeRemoval.status).toBe(200);

    const members = await listMembers(ownerToken, organizationId);
    const membership = members.find((member) => member.email === REMOVE_EMAIL);
    expect(membership).toBeDefined();

    const removal = await updateMembership(ownerToken, organizationId, membership!.membershipId, {
      status: "removed",
    });
    expect(removal.status).toBe(200);
    expect(removal.body.status).toBe("removed");

    const afterRemoval = await apiRequest(`/v1/organizations/${organizationId}`, {
      token: removedUserToken,
    });
    expect(afterRemoval.status).toBe(404);
    const detail = (afterRemoval.body as { detail?: { code?: string } }).detail;
    expect(detail?.code).toBe("organization_not_found");

    // list_organization_members (backing the admin Members pane) filters to
    // ACTIVE memberships only (db/store/organizations.py) — a removed member
    // simply disappears from the roster rather than showing status=removed
    // there. The PATCH response above is the direct, authoritative read of
    // the membership row's status; this is the corroborating check that the
    // member is gone from the active list.
    const membersAfter = await listMembers(ownerToken, organizationId);
    expect(membersAfter.find((member) => member.email === REMOVE_EMAIL)).toBeUndefined();

    // Extra correctness check beyond the scenario's literal wording: the
    // removal must not be silently undone by a later list/login call either
    // (membership_policy.py's place_new_identity fails closed with
    // instance_access_removed rather than re-adding a removed member).
    const relist = await apiRequest("/v1/organizations", { token: removedUserToken });
    expect(relist.status).toBe(403);
    const relistDetail = (relist.body as { detail?: { code?: string } }).detail;
    expect(relistDetail?.code).toBe("instance_access_removed");
  });
});
