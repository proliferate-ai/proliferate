// T2-AUTH-3 (specs/developing/testing/scenarios.md): SSO OIDC round trip via
// a mock IdP, org-scoped connection admin CRUD, JIT provisioning, and the
// three named negatives.
//
// ── Headline finding, read before touching this file ──
// Email-only discovery deliberately resolves deployment SSO only. Product-auth
// forbids email-domain-to-organization lookup as an enumeration defense; org
// SSO cold login uses the explicit slug/org-id entry points covered by
// sso-entry-points.spec.ts. This file drives the OIDC connection-id contract
// directly after admin configuration.
//
// Given that, this suite drives discovery/start/callback over HTTP directly
// (real server, real mock IdP, real DB) and only uses a real browser page for
// the one check that's about the browser: does the app's own
// session-bootstrap code accept a token minted through this flow. Everything
// else — the OIDC handshake, JIT provisioning, membership, the negatives — is
// the server's contract, asserted directly against it.
//
// Single-org mode: verified by reading membership_policy.py before writing
// this test, not assumed. `_resolve_organization_sso_user`'s JIT-create path
// calls `place_new_identity`, which is mode-aware
// (server/proliferate/server/organizations/membership_policy.py) and in
// SINGLE_ORG_MODE joins *the* instance org — which is also the only
// organization this suite's `sso_connection` can be scoped to (there is only
// one org). So the instance org's id and the connection's organizationId
// always coincide here; no hosted-mode boot variant was needed for this
// scenario.

import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  apiBaseUrl,
  ensureInstanceClaimed,
  getOwnOrganization,
  listMembers,
  passwordLogin,
  webBaseUrl,
} from "../stack/seed.ts";
import {
  countSsoIdentitiesForConnection,
  createOrganizationSsoConnection,
  DESKTOP_REDIRECT_URI,
  discoverSso,
  fetchRedirectHop,
  getSsoIdentityByConnectionAndSubject,
  enableOrganizationSsoConnection,
  newPkcePair,
  newSecret,
  pollDesktopAuthUntilReady,
  runSsoAuthorizationRoundTrip,
  startDesktopSsoAuth,
  type SsoConnectionSummary,
} from "../stack/sso.ts";
import { startMockIdp, type MockIdp } from "../fakes/mock-idp/server.ts";

test.describe.configure({ mode: "serial" });

test.describe("T2-AUTH-3: SSO OIDC round trip (mock IdP)", () => {
  let idp: MockIdp;
  let adminToken: string;
  let organizationId: string;
  let happyConnection: SsoConnectionSummary;
  let restrictedConnection: SsoConnectionSummary;
  let firstLoginUserId: string;

  test.beforeAll(async () => {
    idp = await startMockIdp();
    await ensureInstanceClaimed();
    const tokens = await passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
    adminToken = tokens.access_token;
    const org = await getOwnOrganization(adminToken);
    organizationId = org.id;

    // Precondition per scenarios.md: admin creates the connection, then
    // enables it — two calls, matching the product's own create-then-enable
    // shape (POST .../connections defaults to status "draft"). No Stripe/plan
    // setup here: SSO config is admin-role gated only in code today (survey
    // fact); current_path_org_admin is the only guard on both calls.
    happyConnection = await createOrganizationSsoConnection(adminToken, organizationId, {
      displayName: "Tier2 Mock IdP",
      jitPolicy: "create_member",
      defaultRole: "member",
      allowedDomains: ["allowed.example.com"],
      oidc: {
        issuer: idp.endpoints.issuer,
        authorizationEndpoint: idp.endpoints.authorization,
        tokenEndpoint: idp.endpoints.token,
        jwksUri: idp.endpoints.jwks,
        clientId: idp.clientId,
        clientSecret: idp.clientSecret,
      },
    });
    await enableOrganizationSsoConnection(adminToken, organizationId, happyConnection.id);

    // A second, stricter connection for the jit_policy negative: distinct
    // allowed_domains so it can't be reached by accident through the happy
    // connection, and jit_policy "disabled" so an unknown identity is
    // rejected instead of provisioned.
    restrictedConnection = await createOrganizationSsoConnection(adminToken, organizationId, {
      displayName: "Tier2 Mock IdP (JIT disabled)",
      jitPolicy: "disabled",
      defaultRole: "member",
      allowedDomains: ["restricted.example.com"],
      oidc: {
        issuer: idp.endpoints.issuer,
        authorizationEndpoint: idp.endpoints.authorization,
        tokenEndpoint: idp.endpoints.token,
        jwksUri: idp.endpoints.jwks,
        clientId: idp.clientId,
        clientSecret: idp.clientSecret,
      },
    });
    await enableOrganizationSsoConnection(adminToken, organizationId, restrictedConnection.id);
  });

  test.afterAll(async () => {
    await idp?.stop();
  });

  test("discover by connectionId resolves the organization-scoped connection", async () => {
    const { status, body } = await discoverSso({ connectionId: happyConnection.id });
    expect(status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.scope).toBe("organization");
    expect(body.protocol).toBe("oidc");
    expect(body.organizationId).toBe(organizationId);
  });

  test("security: email-only discovery never enumerates an organization-scoped connection", async () => {
    // Even though the connection allows this domain, explicit slug/org-id or
    // connection context is required. This uniform response prevents domain
    // probing from revealing which organizations configured SSO.
    const { status, body } = await discoverSso({ email: "newuser@allowed.example.com" });
    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.reason).toBe("not_configured");
  });

  test("negative: email on a non-configured domain — discover finds no connection", async () => {
    const { status, body } = await discoverSso({ email: "someone@no-such-domain.example.com" });
    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.reason).toBe("not_configured");
  });

  test("happy path: mock IdP round trip creates sso_identity, signs the user in, and joins with default_role", async ({ page }) => {
    const identity = {
      sub: "t2intent-newuser-subject",
      email: "newuser@allowed.example.com",
      emailVerified: true,
      name: "New User",
    };
    idp.setIdentity(identity);

    const { verifier, challenge } = newPkcePair();
    const clientState = newSecret();
    const start = await startDesktopSsoAuth({
      connectionId: happyConnection.id,
      clientState,
      codeChallenge: challenge,
    });
    expect(start.status).toBe(200);
    expect(start.body.connectionId).toBe(happyConnection.id);

    const { callbackLocation } = await runSsoAuthorizationRoundTrip(start.body.authorizationUrl);
    expect(callbackLocation.startsWith(DESKTOP_REDIRECT_URI)).toBe(true);
    expect(callbackLocation).toContain(`state=${encodeURIComponent(clientState)}`);

    const poll = await pollDesktopAuthUntilReady(clientState, verifier);
    expect(poll.status).toBe(200);
    expect(poll.body.user?.email).toBe(identity.email);
    expect(poll.body.access_token).toBeTruthy();
    expect(poll.body.refresh_token).toBeTruthy();
    firstLoginUserId = poll.body.user!.id;

    const identityRow = await getSsoIdentityByConnectionAndSubject(happyConnection.id, identity.sub);
    expect(identityRow).not.toBeNull();
    expect(identityRow?.email).toBe(identity.email);
    expect(identityRow?.email_verified).toBe(true);
    expect(identityRow?.user_id).toBe(firstLoginUserId);

    const members = await listMembers(adminToken, organizationId);
    const newMember = members.find((member) => member.email === identity.email);
    expect(newMember).toBeTruthy();
    expect(newMember?.role).toBe("member");
    expect(newMember?.status).toBe("active");

    // Browser-acceptance check: this is the one part of the scenario that's
    // actually about the browser. There is no UI path that reaches this
    // token today (see file header), so we apply it the same way the app's
    // own browser-fallback storage does (apps/desktop/src/lib/access/tauri/
    // auth.ts's `writeBrowserSession`, keyed "proliferate.auth.session") and
    // let the app's real bootstrap logic (re-validated against the server on
    // load, same mechanism auth.spec.ts's revocation test exercises) prove
    // the session is honored.
    await page.goto(webBaseUrl());
    await page.evaluate(
      (session) => window.localStorage.setItem("proliferate.auth.session", JSON.stringify(session)),
      {
        access_token: poll.body.access_token,
        refresh_token: poll.body.refresh_token,
        expires_at: new Date(Date.now() + (poll.body.expires_in ?? 900) * 1000).toISOString(),
        user_id: poll.body.user!.id,
        email: poll.body.user!.email,
        display_name: poll.body.user!.display_name,
        github_login: poll.body.user!.github_login,
        avatar_url: poll.body.user!.avatar_url,
      },
    );
    await page.reload();
    await expect(page.getByLabel("Password")).toHaveCount(0, { timeout: 30_000 });
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => window.localStorage.getItem("proliferate.auth.session"));
        return raw ? (JSON.parse(raw) as { email?: string }).email ?? null : null;
      }, { timeout: 30_000 })
      .toBe(identity.email);
  });

  test("re-login with the same identity reuses the existing user (no duplicate)", async () => {
    const identity = {
      sub: "t2intent-newuser-subject",
      email: "newuser@allowed.example.com",
      emailVerified: true,
      name: "New User",
    };
    idp.setIdentity(identity);

    const before = await countSsoIdentitiesForConnection(happyConnection.id);

    const { verifier, challenge } = newPkcePair();
    const clientState = newSecret();
    const start = await startDesktopSsoAuth({
      connectionId: happyConnection.id,
      clientState,
      codeChallenge: challenge,
    });
    expect(start.status).toBe(200);
    const { callbackLocation } = await runSsoAuthorizationRoundTrip(start.body.authorizationUrl);
    expect(callbackLocation.startsWith(DESKTOP_REDIRECT_URI)).toBe(true);

    const poll = await pollDesktopAuthUntilReady(clientState, verifier);
    expect(poll.status).toBe(200);
    expect(poll.body.user?.id).toBe(firstLoginUserId);

    const after = await countSsoIdentitiesForConnection(happyConnection.id);
    expect(after).toBe(before);

    const members = await listMembers(adminToken, organizationId);
    expect(members.filter((member) => member.email === identity.email)).toHaveLength(1);
  });

  test("negative: jit_policy disabled + unknown user — enumerated error, not a 500", async () => {
    idp.setIdentity({
      sub: "t2intent-ghost-subject",
      email: "ghost@restricted.example.com",
      emailVerified: true,
    });

    const { challenge } = newPkcePair();
    const clientState = newSecret();
    const start = await startDesktopSsoAuth({
      connectionId: restrictedConnection.id,
      clientState,
      codeChallenge: challenge,
    });
    expect(start.status).toBe(200);

    const { callbackLocation } = await runSsoAuthorizationRoundTrip(start.body.authorizationUrl);
    // Handled failure: a redirect carrying an enumerated error code, not a
    // 500 and not the app's redirect_uri (no code was ever minted).
    expect(callbackLocation).toContain("/auth/error");
    expect(callbackLocation).toContain("code=sso_user_not_team_member");
    expect(callbackLocation.startsWith(DESKTOP_REDIRECT_URI)).toBe(false);

    // And the identity was never persisted.
    const identityRow = await getSsoIdentityByConnectionAndSubject(
      restrictedConnection.id,
      "t2intent-ghost-subject",
    );
    expect(identityRow).toBeNull();
  });

  test("negative: tampered state on callback is rejected, not a 500", async () => {
    const hop = await fetchRedirectHop(
      `${apiBaseUrl()}/auth/sso/oidc/callback?state=not-a-real-state&code=whatever-code`,
    );
    expect(hop.status).toBeGreaterThanOrEqual(300);
    expect(hop.status).toBeLessThan(400);
    expect(hop.location).toContain("/auth/error");
    expect(hop.location).toContain("code=sso_state_invalid");
  });
});
