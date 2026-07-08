// T2-INV-1 (specs/developing/testing/scenarios.md): invitation happy path +
// the four negatives (expired, revoked, wrong-email, duplicate-pending).
//
// Survey facts that shape this test (scenarios.md, verified against code):
// - There is NO secret invite token. The invitation UUID is the reference and
//   acceptance is authorized by the authenticated user's email matching
//   invitation.email (normalized). Wrong email → rejected by the store
//   (organization_invitations.py), never by obscurity.
// - Email delivery via Resend is skipped locally (no RESEND_API_KEY) and
//   recorded as delivery_status='skipped'. Assert that; never expect an email.
// - Accept is driven through the desktop-web settings UI
//   (CurrentUserInvitationsSection on the Members pane), which calls
//   POST /organizations/invitations/current/{id}/accept.
// - Duplicate pending invite for the same (org, email): the partial unique
//   index uq_organization_invitation_pending_email guarantees at most one
//   pending row; the product's create path is upsert-on-conflict (rotate), so
//   the enforced behavior is "still exactly one pending row", not an error.

import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  acceptCurrentInvitation,
  apiRequest,
  backdateInvitationExpiry,
  ensureInstanceClaimed,
  inviteMember,
  listInvitationsCurrent,
  listMembers,
  listOrganizationInvitations,
  getOwnOrganization,
  passwordLogin,
  registerInvitedAccount,
  revokeInvitation,
  webBaseUrl,
  type InvitationSummary,
} from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

const INVITEE_EMAIL = "invitee@t2intent.example.com";
const INVITEE_PASSWORD = "Invitee!Passw0rd";
const OTHER_EMAIL = "other@t2intent.example.com";
const OTHER_PASSWORD = "Other!Passw0rd";

let adminToken: string;
let organizationId: string;

test.beforeAll(async () => {
  await ensureInstanceClaimed();
  adminToken = (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
  organizationId = (await getOwnOrganization(adminToken)).id;
});

/** Seed a password account for `email` if it does not exist yet, using the
 * product's invite-as-allowlist registration (single-org mode's only
 * self-serve account path). Requires a live pending invitation; creates and
 * consumes one. Idempotent per email. */
async function ensureInviteeAccount(email: string, password: string): Promise<void> {
  try {
    await passwordLogin(email, password);
    return; // Account already exists from a previous run.
  } catch {
    // Fall through and register it.
  }
  const invitation = await inviteMember(adminToken, organizationId, email, "member");
  await registerInvitedAccount({ email, password, invitationToken: invitation.id });
}

test.describe("T2-INV-1: invitation happy path", () => {
  test("admin invites → pending row with skipped delivery → invitee accepts via settings UI → active membership", async ({ page }) => {
    // The registration path (used for seeding the account) auto-consumes the
    // invitation, so mint the account first, remove the membership it
    // created, then send the invitation under test.
    await ensureInviteeAccount(INVITEE_EMAIL, INVITEE_PASSWORD);
    const preMembers = await listMembers(adminToken, organizationId);
    const existing = preMembers.find((member) => member.email === INVITEE_EMAIL);
    if (existing && existing.status === "active") {
      const removed = await apiRequest(
        `/v1/organizations/${organizationId}/members/${existing.membership_id}`,
        { method: "DELETE", token: adminToken },
      );
      expect(removed.status).toBe(200);
    }

    const invitation = await inviteMember(adminToken, organizationId, INVITEE_EMAIL, "member");
    expect(invitation.status).toBe("pending");
    // Locally Resend is unconfigured → the durable delivery marks 'skipped'.
    expect(["sent", "skipped"]).toContain(invitation.delivery_status);
    expect(invitation.delivery_status).toBe("skipped");

    // Invitee signs in on the desktop web app and accepts through the UI.
    await page.goto(webBaseUrl());
    await page.getByLabel("Email").fill(INVITEE_EMAIL);
    await page.getByLabel("Password").fill(INVITEE_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });

    // Members pane (GET /organizations/invitations/current backs this section).
    await page.goto(`${webBaseUrl()}/settings?section=organization-members`);
    await expect(page.getByText("Pending invitations")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Accept invitation" }).first().click();
    // Confirmation dialog → Join.
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.getByText(/^Joined /).first()).toBeVisible({ timeout: 30_000 });

    // Server-side assertions: membership active with invited role; invitation
    // accepted with accepted_by_user_id; org appears in the invitee's list.
    const inviteeToken = (await passwordLogin(INVITEE_EMAIL, INVITEE_PASSWORD)).access_token;
    const members = await listMembers(adminToken, organizationId);
    const membership = members.find((member) => member.email === INVITEE_EMAIL);
    expect(membership).toBeDefined();
    expect(membership!.status).toBe("active");
    expect(membership!.role).toBe("member");

    const adminView = await listOrganizationInvitations(adminToken, organizationId);
    const acceptedRow = adminView.find((row) => row.id === invitation.id);
    expect(acceptedRow).toBeDefined();
    expect(acceptedRow!.status).toBe("accepted");
    expect(acceptedRow!.accepted_by_user_id).toBe(membership!.user_id);

    const inviteeOrg = await getOwnOrganization(inviteeToken);
    expect(inviteeOrg.id).toBe(organizationId);
  });

  test("negative: expired invitation cannot be accepted and is lazily marked expired", async () => {
    await ensureInviteeAccount(OTHER_EMAIL, OTHER_PASSWORD);
    // Make sure OTHER is not an active member (registration made them one).
    const members = await listMembers(adminToken, organizationId);
    const otherMembership = members.find((member) => member.email === OTHER_EMAIL);
    if (otherMembership && otherMembership.status === "active") {
      await apiRequest(`/v1/organizations/${organizationId}/members/${otherMembership.membership_id}`, {
        method: "DELETE",
        token: adminToken,
      });
    }

    const invitation = await inviteMember(adminToken, organizationId, OTHER_EMAIL, "member");
    await backdateInvitationExpiry(invitation.id, new Date(Date.now() - 60_000));

    const otherToken = (await passwordLogin(OTHER_EMAIL, OTHER_PASSWORD)).access_token;

    // The list endpoint lazily marks expired: the invitation must not be listed.
    const listed = await listInvitationsCurrent(otherToken);
    expect(listed.find((row) => row.id === invitation.id)).toBeUndefined();

    // Direct accept → enumerated error, not a 500.
    const accept = await acceptCurrentInvitation(otherToken, invitation.id);
    expect(accept.status).toBe(404);
    const detail = (accept.body as { detail?: { code?: string } }).detail;
    expect(["invitation_expired", "invalid_invitation"]).toContain(detail?.code);

    // Lazy transition persisted: the admin's list shows status=expired.
    const adminView = await listOrganizationInvitations(adminToken, organizationId);
    const row = adminView.find((item) => item.id === invitation.id);
    expect(row).toBeDefined();
    expect(row!.status).toBe("expired");
  });

  test("negative: revoked invitation cannot be accepted", async () => {
    const invitation = await inviteMember(adminToken, organizationId, OTHER_EMAIL, "member");
    const revoked = await revokeInvitation(adminToken, organizationId, invitation.id);
    expect(revoked.status).toBe(200);
    expect((revoked.body as InvitationSummary).status).toBe("revoked");

    const otherToken = (await passwordLogin(OTHER_EMAIL, OTHER_PASSWORD)).access_token;
    const listed = await listInvitationsCurrent(otherToken);
    expect(listed.find((row) => row.id === invitation.id)).toBeUndefined();

    const accept = await acceptCurrentInvitation(otherToken, invitation.id);
    expect(accept.status).toBe(404);
    const detail = (accept.body as { detail?: { code?: string } }).detail;
    expect(detail?.code).toBe("invalid_invitation");
  });

  test("negative: wrong email — invitation not listed and direct accept with the known UUID rejected", async () => {
    // Invitation addressed to INVITEE; OTHER (authenticated) tries to take it.
    const invitation = await inviteMember(adminToken, organizationId, INVITEE_EMAIL, "member");

    const otherToken = (await passwordLogin(OTHER_EMAIL, OTHER_PASSWORD)).access_token;
    const listed = await listInvitationsCurrent(otherToken);
    expect(listed.find((row) => row.id === invitation.id)).toBeUndefined();

    // Direct accept call with the known UUID → rejected (email mismatch). The
    // per-id accept path scopes the lookup by the caller's email, so the
    // mismatch surfaces as invalid_invitation (404) — the caller cannot even
    // confirm the UUID exists.
    const accept = await acceptCurrentInvitation(otherToken, invitation.id);
    expect([403, 404]).toContain(accept.status);
    const detail = (accept.body as { detail?: { code?: string } }).detail;
    expect(["invitation_email_mismatch", "invalid_invitation"]).toContain(detail?.code);

    // The invitation is untouched for its rightful owner.
    const adminView = await listOrganizationInvitations(adminToken, organizationId);
    const row = adminView.find((item) => item.id === invitation.id);
    expect(row!.status).toBe("pending");

    // Cleanup so later runs start clean.
    await revokeInvitation(adminToken, organizationId, invitation.id);
  });

  test("negative: duplicate pending invite for the same (org, email) — the partial unique index guarantees one pending row", async () => {
    // SPEC DIVERGENCE (flagged for the scenario contract): scenarios.md words
    // this negative as "rejected by partial unique index → enumerated error",
    // but the as-built create path (db/store/organization_invitations.py
    // create_or_rotate_organization_invitation) deliberately does NOT reject:
    // it expires the existing pending invitation and mints a fresh one
    // (rotate), with ON CONFLICT DO UPDATE as the concurrency backstop on the
    // partial unique index uq_organization_invitation_pending_email. The
    // invariant the index enforces — at most ONE live pending invitation per
    // (org, email) — is what this test pins.
    const first = await inviteMember(adminToken, organizationId, OTHER_EMAIL, "member");
    const second = await inviteMember(adminToken, organizationId, OTHER_EMAIL, "admin");
    expect(second.id).not.toBe(first.id); // Rotated: fresh row, old one expired.
    expect(second.role).toBe("admin");

    const adminView = await listOrganizationInvitations(adminToken, organizationId);
    const pendingForEmail = adminView.filter(
      (row) => row.email === OTHER_EMAIL && row.status === "pending",
    );
    expect(pendingForEmail).toHaveLength(1);
    expect(pendingForEmail[0].id).toBe(second.id);
    const firstRow = adminView.find((row) => row.id === first.id);
    expect(firstRow!.status).toBe("expired");

    // Cleanup.
    await revokeInvitation(adminToken, organizationId, second.id);
  });
});
