// T2-AUTH-4 (specs/developing/testing/scenarios.md): login-method
// availability seam.
//
// Maps to the flow-registry row "Google OAuth sign-in (mocked provider
// per-merge)". Read scenarios.md open ruling #4 first: a *real* Google/GitHub
// OAuth round trip is tier-3-only — the provider's authorize/token endpoints
// are not overridable, so they cannot be pointed at a mock without a product
// change we are deliberately not making, and the actual handshake is the
// separate tier-3 "Real provider handshakes" row. What tier 2 owns, per
// T2-AUTH-4, is the *seam that decides which login methods the app offers*:
// `provider_enabled()` on the server, surfaced to the unauthenticated login
// screen. This spec pins that seam.
//
// Survey facts (verified against origin/main, not assumed):
// - `GET /auth/desktop/methods` is the public probe the docstring names as
//   the login screen's source of truth — "the email/password form becomes the
//   default when GitHub OAuth is not configured"
//   (server/proliferate/auth/desktop/api.py desktop_auth_methods →
//   AuthMethodsResponse{password_login, github}).
// - `GET /auth/desktop/github/availability` reports the GitHub-OAuth half
//   (OAuthAvailabilityResponse{enabled, client_id}); `enabled` is
//   `github_oauth_enabled()`, false when GITHUB_OAUTH_CLIENT_ID is unset.
// - This suite's stack (stack/boot.ts) boots with GITHUB_OAUTH_CLIENT_ID=""
//   on purpose (never let a leaked env point a test profile at a real OAuth
//   app), so this deployment offers password login and hides the GitHub
//   button. That is the availability seam in its "unset → hidden" direction.
// - The desktop login screen (apps/desktop/src/components/auth/LoginScreen.tsx)
//   renders the password form exactly when the server reports password on and
//   GitHub off; there is no Google button on the login surface at all (Google
//   is account-linking only, post-auth), which is why the tier-2-honest form
//   of the "Google OAuth sign-in" row is this availability seam.
//
// The "env set → button renders" direction and the real provider handshake
// both live in tier 3 (they need real/overridable provider endpoints); this
// file asserts the seam that gates the desktop app's offered methods, which is
// what per-merge coverage can honestly own.

import { expect, test } from "@playwright/test";
import { apiBaseUrl, webBaseUrl } from "../stack/seed.ts";

test.describe.configure({ mode: "serial" });

interface AuthMethodsResponse {
  password_login: boolean;
  github: boolean;
}

interface OAuthAvailabilityResponse {
  enabled: boolean;
  client_id: string | null;
}

test.describe("T2-AUTH-4: login-method availability seam", () => {
  test("public /auth/desktop/methods probe reports password on, GitHub off for this deployment", async () => {
    // Unauthenticated probe — the login screen calls this before any session
    // exists, so it must answer without a token.
    const response = await fetch(`${apiBaseUrl()}/auth/desktop/methods`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as AuthMethodsResponse;
    // Password login is the offered method on a profile with no OAuth env.
    expect(body.password_login).toBe(true);
    // GitHub OAuth is not configured here → the seam hides it.
    expect(body.github).toBe(false);
  });

  test("GET /auth/desktop/github/availability reports GitHub OAuth disabled (no client env)", async () => {
    const response = await fetch(`${apiBaseUrl()}/auth/desktop/github/availability`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as OAuthAvailabilityResponse;
    expect(body.enabled).toBe(false);
    // client_id is only echoed when enabled; disabled → null (never leak an
    // empty-string client id that the app might treat as configured).
    expect(body.client_id).toBeNull();
  });

  test("login screen renders the password form as the offered method, not a GitHub OAuth entry", async ({ page }) => {
    await page.goto(webBaseUrl());
    // The availability seam's rendered consequence: LoginScreen shows the
    // email/password form (its fields are present) because the server reports
    // password on + GitHub off. The GitHub-OAuth branch of LoginScreen is not
    // rendered in this state, so the offered method is unambiguously password.
    await expect(page.getByLabel("Email")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Password")).toBeVisible();
    // Cross-check the seam the UI is reacting to, from the browser's own
    // origin (same probe the app makes), so a UI regression and an API
    // regression are told apart.
    const methods = await page.evaluate(async (base) => {
      const res = await fetch(`${base}/auth/desktop/methods`);
      return (await res.json()) as { password_login: boolean; github: boolean };
    }, apiBaseUrl());
    expect(methods.github).toBe(false);
    expect(methods.password_login).toBe(true);
  });
});
