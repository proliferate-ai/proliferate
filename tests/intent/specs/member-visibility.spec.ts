// T2-ORG-2 (specs/developing/testing/scenarios.md, flow-registry row
// "Member visibility boundaries — sees own work, not others' private state").
//
// This is the visibility complement to T2-ORG-1 (organization-roles.spec.ts).
// T2-ORG-1 pins the *mutation* boundary (a member cannot invite/promote/remove,
// gets 403 on create-invitation). This file pins the *read* boundary: what a
// plain member can and cannot SEE of the organization.
//
// Survey facts (verified against origin/main, organizations/api.py):
// - Shared team state is member-readable: GET /organizations/{id}
//   (get_organization_endpoint) and GET /organizations/{id}/members
//   (list_organization_members_endpoint) both depend on current_path_org_member
//   — a member sees the org and its roster (the team they belong to).
// - Admin-only visibility is gated:
//     * GET /organizations/{id}/invitations depends on current_path_org_admin
//       as of #1029 (fix: gate org invitations list to admins) — a member can
//       no longer read pending/accepted/revoked invitations, i.e. other
//       people's invite state. This file is written against that admin-only
//       contract; #1029 is merged on this branch's base, so it asserts 403
//       directly (no expected-fail pin needed).
//     * GET /organizations/{id}/join-link depends on current_path_org_admin —
//       the org's join secret is admin-only.
// - Management surfaces stay closed on the read→write edge too: PATCH
//   /organizations/{id}/members/{membership_id} depends on current_path_org_admin,
//   so a member cannot reach into another member's membership record.
// All denials surface as 403 organization_permission_denied via
// current_path_org_admin (organizations/domain/policy.py), never a 404 that
// would leak existence differently — asserted below.
//
// Cloud personal secrets/workspaces would be the other "others' private state"
// axis, but those surfaces are product-gated for password-only accounts at
// tier 2 (see secrets.spec.ts / cloud-workspace.spec.ts) and belong to their
// own rows; this file stays on the org-scoped visibility boundary, which is
// cleanly reachable for password accounts.

import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  apiRequest,
  ensureInstanceClaimed,
  getOwnOrganization,
  inviteAndRegisterMember,
  listMembers,
  passwordLogin,
  resetPasswordLoginRateLimits,
} from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

// Distinct fixed email from organization-roles.spec.ts's members so the two
// specs don't couple through shared roster state; idempotent across reruns
// against this profile's persisted DB (inviteAndRegisterMember logs in first).
const VIS_MEMBER_EMAIL = "t2vis-member@t2intent.example.com";
const VIS_MEMBER_PASSWORD = "T2VisMember!Passw0rd";

let ownerToken: string;
let organizationId: string;
let memberToken: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  ownerToken = (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
  organizationId = (await getOwnOrganization(ownerToken)).id;
  memberToken = await inviteAndRegisterMember(
    ownerToken,
    organizationId,
    VIS_MEMBER_EMAIL,
    VIS_MEMBER_PASSWORD,
    "member",
  );
});

test.afterAll(async () => {
  // This file's logins are all legitimate; leave the shared per-IP
  // rate-limit bucket clean for whichever spec runs next (single worker).
  await resetPasswordLoginRateLimits();
});

test.describe("T2-ORG-2: member visibility boundaries", () => {
  test("member sees own work: their org appears in their org list and reads back", async () => {
    const list = await apiRequest<{ organizations: { id: string }[] }>("/v1/organizations", {
      token: memberToken,
    });
    expect(list.status).toBe(200);
    expect(list.body.organizations.map((org) => org.id)).toContain(organizationId);

    const org = await apiRequest(`/v1/organizations/${organizationId}`, { token: memberToken });
    expect(org.status).toBe(200);
  });

  test("member sees shared team state: the member roster, including themselves and the owner", async () => {
    // Roster is shared team state, not private state — a member is allowed to
    // see who is on the team.
    const roster = await listMembers(memberToken, organizationId);
    const emails = roster.map((member) => member.email);
    expect(emails).toContain(VIS_MEMBER_EMAIL);
    expect(emails).toContain(ADMIN_EMAIL);
  });

  test("member cannot see others' invite state: the org invitations list is admin-only (#1029)", async () => {
    const asMember = await apiRequest(`/v1/organizations/${organizationId}/invitations`, {
      token: memberToken,
    });
    expect(asMember.status).toBe(403);
    const detail = (asMember.body as { detail?: { code?: string } }).detail;
    expect(detail?.code).toBe("organization_permission_denied");

    // Corroborate the boundary is real (not a fixture fluke): the same
    // endpoint returns 200 for the owner, so the 403 is the member gate, not a
    // broken route.
    const asOwner = await apiRequest(`/v1/organizations/${organizationId}/invitations`, {
      token: ownerToken,
    });
    expect(asOwner.status).toBe(200);
  });

  test("member cannot see the org join secret: join-link is admin-only", async () => {
    const asMember = await apiRequest(`/v1/organizations/${organizationId}/join-link`, {
      token: memberToken,
    });
    expect(asMember.status).toBe(403);
    const detail = (asMember.body as { detail?: { code?: string } }).detail;
    expect(detail?.code).toBe("organization_permission_denied");
  });

  test("member cannot reach into another member's membership record (management stays closed)", async () => {
    // Resolve the owner's membership id via the roster the member is allowed
    // to read, then attempt to mutate it — the read boundary being open does
    // not open the write boundary.
    const roster = await listMembers(memberToken, organizationId);
    const ownerMembership = roster.find((member) => member.email === ADMIN_EMAIL);
    expect(ownerMembership).toBeDefined();

    const attempt = await apiRequest(
      `/v1/organizations/${organizationId}/members/${ownerMembership!.membershipId}`,
      { method: "PATCH", token: memberToken, body: { role: "member" } },
    );
    expect(attempt.status).toBe(403);
    const detail = (attempt.body as { detail?: { code?: string } }).detail;
    expect(detail?.code).toBe("organization_permission_denied");
  });
});
