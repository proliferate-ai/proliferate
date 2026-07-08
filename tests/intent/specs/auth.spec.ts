// T2-AUTH-1 + T2-AUTH-2 (specs/developing/testing/scenarios.md).
//
// T2-AUTH-1: setup claim + password login lifecycle.
//   Fresh DB, SINGLE_ORG_MODE=true. Visit /setup → claim instance, set
//   password → logout → log back in via the password login through the UI.
//   Assert: claim succeeds once; re-visiting /setup shows already-claimed;
//   post-login the app shell renders with the seeded user.
//   Negatives: wrong password rejected; second claim attempt rejected.
//
// T2-AUTH-2: session revocation.
//   Log in in context A; revoke the session; context A performs any
//   authenticated call. Assert: the call fails and the UI returns to
//   signed-out state.
//
// Desktop-web conventions (scenarios.md): auth falls back to localStorage;
// nothing here goes near lib/access/tauri/credentials.ts.

import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_ORG_NAME,
  ADMIN_PASSWORD,
  apiBaseUrl,
  apiRequest,
  ensureInstanceClaimed,
  passwordLogin,
  readSetupToken,
  resetPasswordLoginRateLimits,
  webBaseUrl,
} from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

// This file deliberately fails logins (wrong password, nonexistent account).
// The product's limiter counts those per client IP (5 / 15 min) and every
// context here shares 127.0.0.1, so without clearing between tests the
// negatives would 429 later legitimate logins — limiter crosstalk, not the
// behavior under test. (A successful login only clears the email bucket.)
test.afterEach(async () => {
  await resetPasswordLoginRateLimits();
});

async function signInThroughUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto(webBaseUrl());
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function expectSignedInAppShell(page: Page): Promise<void> {
  // Past the auth gate: the login form is gone and the app shell owns the page.
  await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(async () => {
      const raw = await page.evaluate(() => window.localStorage.getItem("proliferate.auth.session"));
      return raw ? (JSON.parse(raw) as { email?: string }).email ?? null : null;
    }, { timeout: 30_000 })
    .toBe(ADMIN_EMAIL);
}

test.describe("T2-AUTH-1: setup claim + password login lifecycle", () => {
  test("claims the instance once via /setup, then re-visiting shows already-claimed", async ({ page }) => {
    // The claim races nothing: this spec file runs first (serial, 1 worker)
    // against a fresh profile DB, so /setup must be open unless a previous
    // local run already claimed it (then we only assert the closed state).
    const probe = await fetch(`${apiBaseUrl()}/setup`);
    if (probe.status !== 404) {
      const token = readSetupToken();
      await page.goto(`${apiBaseUrl()}/setup`);
      await expect(page.getByRole("heading", { name: "Set up Proliferate" })).toBeVisible();
      await page.getByLabel("Email").fill(ADMIN_EMAIL);
      await page.getByLabel("Password").fill(ADMIN_PASSWORD);
      await page.getByLabel("Organization name").fill(ADMIN_ORG_NAME);
      await page.getByLabel("Setup token").fill(token);
      await page.getByRole("button", { name: "Claim this instance" }).click();
      await expect(page.getByRole("heading", { name: "You are all set" })).toBeVisible();
      await expect(page.getByText(ADMIN_EMAIL)).toBeVisible();
    }

    // Claim closes /setup permanently: "Not found — there is nothing to set
    // up here" IS the success state on re-visit (feature-worktree-auth.md).
    // Poll the server first (uncached) — the page render right after the
    // claim can race the boot-time token-cleanup task's session.
    await expect
      .poll(async () => (await fetch(`${apiBaseUrl()}/setup`)).status, { timeout: 15_000 })
      .toBe(404);
    await page.goto(`${apiBaseUrl()}/setup`);
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    await expect(page.getByText("There is nothing to set up here.")).toBeVisible();
  });

  test("second claim attempt is rejected (setup permanently closed)", async () => {
    await ensureInstanceClaimed();
    // POSTing the form again — even with a plausible token — must be a 404,
    // never a second account.
    const response = await fetch(`${apiBaseUrl()}/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "second-claimer@t2intent.example.com",
        password: "AnotherPassw0rd!",
        setup_token: "any-token-at-all",
        organization_name: "Should Never Exist",
      }).toString(),
    });
    expect(response.status).toBe(404);
    // And the would-be account must not authenticate.
    const login = await apiRequest("/auth/desktop/password/login", {
      method: "POST",
      body: { email: "second-claimer@t2intent.example.com", password: "AnotherPassw0rd!" },
    });
    expect(login.status).toBe(401);
  });

  test("logs in through the desktop-web UI with the claimed password", async ({ page }) => {
    await ensureInstanceClaimed();
    await signInThroughUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expectSignedInAppShell(page);
  });

  test("negative: wrong password is rejected with the uniform error", async ({ page }) => {
    await ensureInstanceClaimed();
    await signInThroughUi(page, ADMIN_EMAIL, "definitely-not-the-password");
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    // Still signed out: the password form remains.
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("logout returns the UI to signed-out state and re-login works", async ({ page }) => {
    await ensureInstanceClaimed();
    await signInThroughUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expectSignedInAppShell(page);

    // Sign out via Settings → Account.
    await page.goto(`${webBaseUrl()}/settings?section=account`);
    await page.getByRole("button", { name: "Sign out" }).click();
    // Signed-out state: back to the login surface with the password form.
    await expect(page.getByLabel("Password")).toBeVisible({ timeout: 30_000 });
    const stored = await page.evaluate(() => window.localStorage.getItem("proliferate.auth.session"));
    expect(stored).toBeNull();

    // Log back in via POST /auth/.../password/login through the UI.
    await signInThroughUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expectSignedInAppShell(page);
  });
});

test.describe("T2-AUTH-2: session revocation", () => {
  test("revoking the session makes context A's authenticated calls fail and the UI signs out", async ({ page }) => {
    await ensureInstanceClaimed();

    // Context A: a real signed-in browser session.
    await signInThroughUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expectSignedInAppShell(page);

    // Capture context A's credential (the token the app holds), then prove it
    // authenticates right now.
    const contextAToken = await page.evaluate(() => {
      const raw = window.localStorage.getItem("proliferate.auth.session");
      return raw ? (JSON.parse(raw) as { access_token: string }).access_token : null;
    });
    expect(contextAToken).toBeTruthy();
    const before = await page.request.get(`${apiBaseUrl()}/users/me`, {
      headers: { Authorization: `Bearer ${contextAToken}` },
    });
    expect(before.status()).toBe(200);

    // Revoke from "elsewhere" (context B): a password change bumps the user's
    // token_generation, revoking every previously issued access and refresh
    // token on ALL surfaces — the same mechanism the product's logout and
    // "log out everywhere" paths use (auth/identity/sessions.py). This is the
    // all-surface revocation the product exposes to an API caller.
    const contextB = await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
    const NEW_PASSWORD = "Tier2Intent!Passw0rd2";
    const change = await apiRequest("/auth/password", {
      method: "PUT",
      token: contextB.access_token,
      body: { current_password: ADMIN_PASSWORD, new_password: NEW_PASSWORD },
    });
    expect(change.status).toBe(200);
    // Restore the canonical password for the specs that follow (the change
    // above bumped token_generation — the revocation under test — and this
    // second change bumps it again, which only strengthens the assertion).
    const freshTokens = await passwordLogin(ADMIN_EMAIL, NEW_PASSWORD);
    const restore = await apiRequest("/auth/password", {
      method: "PUT",
      token: freshTokens.access_token,
      body: { current_password: NEW_PASSWORD, new_password: ADMIN_PASSWORD },
    });
    expect(restore.status).toBe(200);

    // Context A's captured token is now dead server-side.
    const after = await page.request.get(`${apiBaseUrl()}/users/me`, {
      headers: { Authorization: `Bearer ${contextAToken}` },
    });
    expect(after.status()).toBe(401);

    // And the UI returns to signed-out state: reload → bootstrap validates the
    // stored session against the server, gets the definitive 401 (refresh is
    // revoked too), clears it, and lands on the login screen.
    await page.reload();
    await expect(page.getByLabel("Password")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => page.evaluate(() => window.localStorage.getItem("proliferate.auth.session")))
      .toBeNull();
  });
});
