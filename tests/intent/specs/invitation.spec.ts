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
// - Accept surface: in single-org mode the invite email links to the
//   server-rendered /register page (invitation_delivery.py) — that is the
//   product's own accept path and the happy-path drives it. The hosted-style
//   settings-UI accept (CurrentUserInvitationsSection →
//   POST /organizations/invitations/current/{id}/accept) lived on the
//   admin-gated organization-members pane, unreachable for a plain invitee
//   (product gap, issue #1013). PR #1017 (fix/invitee-accept-ui) moves that
//   section onto the Account pane, which every signed-in user can reach.
//   The test below targets that fixed path but self-skips until #1017
//   merges — see ACCOUNT_PANE_INVITATIONS_LANDED.
// - Duplicate pending invite for the same (org, email): the partial unique
//   index uq_organization_invitation_pending_email guarantees at most one
//   pending row; the product's create path is upsert-on-conflict (rotate), so
//   the enforced behavior is "still exactly one pending row", not an error.

import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  acceptCurrentInvitation,
  apiBaseUrl,
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
  // Fresh email per run: the happy path exercises the full first-contact
  // journey (invite → register → member), which is single-use by design.
  const FRESH_INVITEE_EMAIL = `invitee-${Date.now()}@t2intent.example.com`;
  const FRESH_INVITEE_PASSWORD = "FreshInvitee!Passw0rd";

  test("admin invites → pending row with skipped delivery → invitee joins via the invite link → active membership", async ({ page }) => {
    // NOTE — as-built single-org reality vs the scenario's hosted wording:
    // in single-org mode the invite email links to the server-rendered
    // /register page with the invitation id as the token
    // (invitation_delivery.py chooses invitation_registration_url when
    // settings.single_org_mode). THAT page is the invitee's accept surface;
    // registration itself activates the membership and completes the
    // invitation in one transaction (self_registration.py). The hosted
    // CurrentUserInvitationsSection path is asserted (as a documented gap)
    // in the next test.
    const invitation = await inviteMember(adminToken, organizationId, FRESH_INVITEE_EMAIL, "member");
    expect(invitation.status).toBe("pending");
    // Locally Resend is unconfigured → the durable delivery marks 'skipped'
    // (delivery_status ∈ {sent, skipped} per the contract; skipped here).
    expect(["sent", "skipped"]).toContain(invitation.deliveryStatus);
    expect(invitation.deliveryStatus).toBe("skipped");

    // Open the invite link the email would carry and complete registration.
    await page.goto(
      `${apiBaseUrl()}/register?token=${invitation.id}&email=${encodeURIComponent(FRESH_INVITEE_EMAIL)}`,
    );
    await expect(page.getByRole("heading", { name: "Join this Proliferate instance" })).toBeVisible();
    // Token and email arrive prefilled from the link.
    await expect(page.getByLabel("Invitation token")).toHaveValue(invitation.id);
    await expect(page.getByLabel("Email")).toHaveValue(FRESH_INVITEE_EMAIL);
    await page.getByLabel("Password").fill(FRESH_INVITEE_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "You are all set" })).toBeVisible();

    // Server-side assertions: membership active with invited role; invitation
    // accepted with accepted_by_user_id; org appears in the invitee's list.
    const inviteeToken = (await passwordLogin(FRESH_INVITEE_EMAIL, FRESH_INVITEE_PASSWORD)).access_token;
    const members = await listMembers(adminToken, organizationId);
    const membership = members.find((member) => member.email === FRESH_INVITEE_EMAIL);
    expect(membership).toBeDefined();
    expect(membership!.status).toBe("active");
    expect(membership!.role).toBe("member");

    const adminView = await listOrganizationInvitations(adminToken, organizationId);
    const acceptedRow = adminView.find((row) => row.id === invitation.id);
    expect(acceptedRow).toBeDefined();
    expect(acceptedRow!.status).toBe("accepted");
    expect(acceptedRow!.acceptedByUserId).toBe(membership!.userId);

    const inviteeOrg = await getOwnOrganization(inviteeToken);
    expect(inviteeOrg.id).toBe(organizationId);

    // UI leg: the new member signs into the desktop web app and lands in the
    // app shell (their membership is live end to end).
    await page.goto(webBaseUrl());
    await page.getByLabel("Email").fill(FRESH_INVITEE_EMAIL);
    await page.getByLabel("Password").fill(FRESH_INVITEE_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });
  });

  // Flip to true once PR #1017 (fix/invitee-accept-ui) merges: it moves
  // CurrentUserInvitationsSection from the admin-gated organization-members
  // pane onto AccountPane, which every signed-in user (admin or not) can
  // reach. Until then this test is a documented skip, not a failure — the
  // fix isn't in this branch's tree yet, so asserting the new UI would be
  // red in this PR's own CI.
  const ACCOUNT_PANE_INVITATIONS_LANDED = false;

  test("fixed: pending-invitation accept UI is reachable for a non-admin invitee via the Account pane (#1013, #1017)", async ({ page }) => {
    test.skip(
      !ACCOUNT_PANE_INVITATIONS_LANDED,
      "unblocks when #1017 (fix/invitee-accept-ui) merges — Account pane doesn't render "
        + "CurrentUserInvitationsSection yet. Flip ACCOUNT_PANE_INVITATIONS_LANDED to true "
        + "once it does.",
    );

    // Give the invitee a pending invitation to accept through the UI.
    // (Inviting an existing member is allowed; accept then simply marks the
    // invitation accepted against the live membership.)
    const invitee = (await passwordLogin(FRESH_INVITEE_EMAIL, FRESH_INVITEE_PASSWORD));
    const invitation = await inviteMember(adminToken, organizationId, FRESH_INVITEE_EMAIL, "member");
    const listed = await listInvitationsCurrent(invitee.access_token);
    expect(listed.find((row) => row.id === invitation.id)).toBeDefined();

    // Sign in as the (non-admin) invitee and open Account — unlike Members,
    // Account is not admin-gated, so a plain invitee lands here directly.
    await page.goto(webBaseUrl());
    await page.getByLabel("Email").fill(FRESH_INVITEE_EMAIL);
    await page.getByLabel("Password").fill(FRESH_INVITEE_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });
    await page.goto(`${webBaseUrl()}/settings?section=account`);
    await expect(page).toHaveURL(/section=account/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();

    // The pending invitation is visible right on Account (CurrentUserInvitationsSection).
    await expect(page.getByRole("heading", { name: "Pending invitations" })).toBeVisible();
    const invitationRow = page.getByText(`member access for ${FRESH_INVITEE_EMAIL}`);
    await expect(invitationRow).toBeVisible();

    // Accept through the UI: opens a confirmation dialog, then joins.
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await page.getByRole("button", { name: "Join" }).click();

    // The section clears once the invitation is no longer pending.
    await expect(page.getByRole("heading", { name: "Pending invitations" })).toHaveCount(0, {
      timeout: 15_000,
    });

    // Server-side: invitation accepted against this membership.
    // Poll: the accept endpoint's transaction commits in the session
    // dependency teardown, which can land a beat after the response is
    // written — a fresh read too fast can still see 'pending'.
    await expect
      .poll(async () => {
        const adminView = await listOrganizationInvitations(adminToken, organizationId);
        return adminView.find((row) => row.id === invitation.id)?.status;
      }, { timeout: 10_000 })
      .toBe("accepted");
  });

  test("negative: expired invitation cannot be accepted and is lazily marked expired", async () => {
    await ensureInviteeAccount(OTHER_EMAIL, OTHER_PASSWORD);
    // Make sure OTHER is not an active member (registration made them one).
    const members = await listMembers(adminToken, organizationId);
    const otherMembership = members.find((member) => member.email === OTHER_EMAIL);
    if (otherMembership && otherMembership.status === "active") {
      await apiRequest(`/v1/organizations/${organizationId}/members/${otherMembership.membershipId}`, {
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
