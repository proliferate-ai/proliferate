// Self-hosting tier-2 scenarios (specs/developing/testing/self-hosting.md).
//
// T2-SH-2: /setup claim UI — extends T2-AUTH-1 with the self-hosted specifics.
//   The claimed user is OWNER of THE single instance organization, and a second
//   context hitting /setup after the claim gets the permanently-closed 404
//   surface (API and rendered page).
// T2-SH-3: invite → /register with the invitation token → invitee sign-in.
//   Plus the wrong-email negative: a real token presented with a mismatched
//   email is rejected by the uniform 403 and creates no account.
// T2-SH-4: adaptive sign-in — the surface is driven purely by
//   GET /auth/desktop/methods + /auth/desktop/github/availability. No GitHub
//   OAuth env (this deployment) ⇒ password form only; GitHub configured ⇒ the
//   "Continue with GitHub" button.
//
// Ground truth this file leans on (verified against the code):
// - single_org_mode is on for this stack (SINGLE_ORG_MODE=true in stack/boot.ts),
//   so exactly one instance org exists and the claimer owns it.
// - Invitations carry NO secret token; the invitation id IS the registration
//   token and acceptance is authorized by email match (self_registration.py's
//   `_not_invited` gives the same uniform 403 for a wrong/unknown/mismatched
//   token so emails can't be enumerated).
// - The desktop connect-to-a-server affordance is Tauri-gated
//   (LoginScreen.tsx:117 isTauriRuntimeAvailable) and never renders in the
//   desktop-web build this suite boots — the set_app_config write / relaunch /
//   credential-store slice is tier-3 by ruling (self-hosting.md §4), so T2-SH-1
//   is registered as a not-yet-implemented row rather than faked here.

import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  apiBaseUrl,
  apiRequest,
  ensureInstanceClaimed,
  getOrganizationIsInstance,
  getOwnOrganization,
  inviteMember,
  listMembers,
  passwordLogin,
  registerInvitedAccountRaw,
  resetPasswordLoginRateLimits,
  revokeInvitation,
  webBaseUrl,
  type OrganizationSummary,
} from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

interface AuthMethodsResponse {
  password_login: boolean;
  github: boolean;
}

interface OAuthAvailabilityResponse {
  enabled: boolean;
  client_id: string | null;
}

async function adminOrg(): Promise<{ token: string; org: OrganizationSummary }> {
  await ensureInstanceClaimed();
  const token = (await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD)).access_token;
  const org = await getOwnOrganization(token);
  return { token, org };
}

test.describe("T2-SH-2: /setup claim yields a single-org OWNER; re-claim is permanently closed", () => {
  test("the claimed user owns the single instance organization", async () => {
    const { token, org } = await adminOrg();

    // Single-org: the claimer sees exactly one organization, and it is THE
    // instance org.
    const orgs = await apiRequest<{ organizations: OrganizationSummary[] }>("/v1/organizations", {
      token,
    });
    expect(orgs.status).toBe(200);
    expect(orgs.body.organizations).toHaveLength(1);
    expect(orgs.body.organizations[0].id).toBe(org.id);
    expect(await getOrganizationIsInstance(org.id)).toBe(true);

    // The claimer holds OWNER on that org (not admin, not member).
    const members = await listMembers(token, org.id);
    const self = members.find((member) => member.email === ADMIN_EMAIL);
    expect(self).toBeDefined();
    expect(self!.role).toBe("owner");
    expect(self!.status).toBe("active");
  });

  test("a second context hitting /setup after the claim gets the closed 404 surface", async ({ page }) => {
    await ensureInstanceClaimed();

    // API: /setup is a hard 404 once claimed (uncached, poll to dodge the
    // boot-time token-cleanup race auth.spec.ts documents).
    await expect
      .poll(async () => (await fetch(`${apiBaseUrl()}/setup`)).status, { timeout: 15_000 })
      .toBe(404);

    // A fresh browser (this test's own context) lands on the closed page, not a
    // second claim form.
    await page.goto(`${apiBaseUrl()}/setup`);
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    await expect(page.getByText("There is nothing to set up here.")).toBeVisible();
    await expect(page.getByLabel("Setup token")).toHaveCount(0);
  });
});

test.describe("T2-SH-3: invite → register-with-token → invitee sign-in", () => {
  // The wrong-email negative fails a login on purpose; the limiter buckets by
  // client IP (shared 127.0.0.1) so clear it between tests, per auth.spec.ts.
  test.afterEach(async () => {
    await resetPasswordLoginRateLimits();
  });

  test("invitee registers through the token'd /register page and signs in to the app shell", async ({ page }) => {
    const { token: adminToken, org } = await adminOrg();
    const inviteeEmail = `sh3-invitee-${Date.now()}@t2intent.example.com`;
    const inviteePassword = "SelfHost3!Passw0rd";

    const invitation = await inviteMember(adminToken, org.id, inviteeEmail, "member");
    expect(invitation.status).toBe("pending");
    // No email locally → delivery is recorded as skipped, never sent.
    expect(invitation.deliveryStatus).toBe("skipped");

    // The invitee opens the link the email would have carried: the invitation
    // id rides as the registration token, prefilled with the invited email.
    await page.goto(
      `${apiBaseUrl()}/register?token=${invitation.id}&email=${encodeURIComponent(inviteeEmail)}`,
    );
    await expect(page.getByRole("heading", { name: "Join this Proliferate instance" })).toBeVisible();
    await expect(page.getByLabel("Invitation token")).toHaveValue(invitation.id);
    await expect(page.getByLabel("Email")).toHaveValue(inviteeEmail);
    await page.getByLabel("Password").fill(inviteePassword);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "You are all set" })).toBeVisible();

    // Membership is active with the invited role, in the one instance org.
    const inviteeToken = (await passwordLogin(inviteeEmail, inviteePassword)).access_token;
    const inviteeOrg = await getOwnOrganization(inviteeToken);
    expect(inviteeOrg.id).toBe(org.id);
    const members = await listMembers(adminToken, org.id);
    const membership = members.find((member) => member.email === inviteeEmail);
    expect(membership).toBeDefined();
    expect(membership!.status).toBe("active");
    expect(membership!.role).toBe("member");

    // The new member signs in through the desktop-web login surface.
    await signInThroughUi(page, inviteeEmail, inviteePassword);
    await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });
  });

  test("negative: a real token presented with the wrong email is rejected and creates no account", async () => {
    const { token: adminToken, org } = await adminOrg();
    const invitedEmail = `sh3-owner-${Date.now()}@t2intent.example.com`;
    const wrongEmail = `sh3-wrong-${Date.now()}@t2intent.example.com`;

    const invitation = await inviteMember(adminToken, org.id, invitedEmail, "member");

    // Correct token, mismatched email → the uniform 403 (_not_invited): the
    // token/email pair is what authorizes, never the token alone.
    const rejected = await registerInvitedAccountRaw({
      email: wrongEmail,
      password: "SelfHost3!Wrong0rd",
      invitationToken: invitation.id,
    });
    expect(rejected.status).toBe(403);

    // No account was minted for the wrong email.
    const login = await apiRequest("/auth/desktop/password/login", {
      method: "POST",
      body: { email: wrongEmail, password: "SelfHost3!Wrong0rd" },
    });
    expect(login.status).toBe(401);

    // The invitation is untouched for its rightful owner.
    const invitations = await apiRequest<{ invitations: Array<{ id: string; status: string }> }>(
      `/v1/organizations/${org.id}/invitations`,
      { token: adminToken },
    );
    const row = invitations.body.invitations.find((item) => item.id === invitation.id);
    expect(row?.status).toBe("pending");

    // Cleanup so a rerun on this profile DB starts clean.
    await revokeInvitation(adminToken, org.id, invitation.id);
  });
});

test.describe("T2-SH-4: sign-in surface adapts to the server's advertised methods", () => {
  test("no GitHub OAuth env (this deployment) → password form only, no GitHub button", async ({ page }) => {
    // Server seam: this stack boots with GITHUB_OAUTH_CLIENT_ID unset, so the
    // public probes advertise password-only.
    const methods = (await (await fetch(`${apiBaseUrl()}/auth/desktop/methods`)).json()) as AuthMethodsResponse;
    expect(methods.password_login).toBe(true);
    expect(methods.github).toBe(false);
    const availability = (await (
      await fetch(`${apiBaseUrl()}/auth/desktop/github/availability`)
    ).json()) as OAuthAvailabilityResponse;
    expect(availability.enabled).toBe(false);
    expect(availability.client_id).toBeNull();

    // Rendered consequence: the login screen shows the email/password form and
    // never the GitHub button.
    await page.goto(webBaseUrl());
    await expect(page.getByLabel("Email")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toHaveCount(0);
  });

  test("GitHub availability advertised → the GitHub button replaces the password form", async ({ page }) => {
    // The desktop-web build bakes its API base at build time, so a real
    // GitHub-configured server for the UI is the tier-3 lane (self-hosting.md
    // §4; the same ruling T2-AUTH-4 records). What tier 2 owns is the login
    // screen's ADAPTATION to the availability contract — assert it by answering
    // that one probe as a GitHub-configured server would, at the network
    // boundary the app reads (github availability drives githubSignInAvailable
    // in use-github-sign-in.ts).
    await page.route("**/auth/desktop/github/availability", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: true, client_id: "gh-test-client" }),
      });
    });

    await page.goto(webBaseUrl());
    const githubButton = page.getByRole("button", { name: "Continue with GitHub" });
    await expect(githubButton).toBeVisible({ timeout: 30_000 });
    // Enabled (not merely rendered-but-disabled): availability resolved to
    // enabled, so the button is actionable.
    await expect(githubButton).toBeEnabled();
    // The password form yields to the GitHub button when GitHub is offered.
    await expect(page.getByLabel("Password")).toHaveCount(0);
  });
});

async function signInThroughUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto(webBaseUrl());
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
