// SSO-specific stack helpers for T2-AUTH-3: org SSO connection CRUD (the
// admin surface), the desktop PKCE + mock-IdP round trip (the auth surface),
// and the one direct-DB read this spec needs (asserting the `sso_identity`
// row — the product exposes no read API for it, same spirit as seed.ts's
// existing direct-DB reads/writes: real state, no product surface to read it
// back through).
//
// Finding this suite exists to document (see specs/sso.spec.ts and the PR
// body for the full writeup): the desktop-web login screen's SSO button
// never discovers or starts an *organization*-scoped connection — it calls
// `/auth/sso/discover` and `/auth/desktop/sso/start` with no email,
// organizationId, or connectionId (apps/desktop/src/hooks/auth/workflows/
// use-sso-sign-in.ts + .../access/cloud/auth/use-sso-discovery.ts), and
// `_connection_for_start`'s email-only branch resolves *only* the
// deployment-scoped (env-var) connection regardless of the email's domain
// (server/proliferate/auth/sso/service.py). There is no UI path — not even a
// hypothetical "enter your email first" step — that reaches an
// admin-configured org connection today. So this suite drives discovery and
// the start call directly via the connection's id (the only way the org-scope
// contract is reachable at all right now), and only uses a real browser page
// for the final "does the app's own bootstrap accept this session" check.
// Everything in between (discover, start, the mock-IdP hop, the callback,
// JIT provisioning, the poll exchange) goes through the product's real HTTP
// surface, unmocked.

import { randomBytes, createHash } from "node:crypto";
import { Client } from "pg";
import { apiBaseUrl, apiRequest } from "./seed.ts";

function databaseUrl(): string {
  const value = process.env.TIER2_INTENT_DATABASE_URL;
  if (!value) {
    throw new Error("TIER2_INTENT_DATABASE_URL is not set — did globalSetup run?");
  }
  return value;
}

function toPostgresDriverUrl(url: string): string {
  return url
    .replace(/^postgresql\+asyncpg:\/\//, "postgresql://")
    .replace("@[::1]:", "@localhost:");
}

// ── PKCE ──

export interface PkcePair {
  verifier: string;
  challenge: string;
}

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

export function newPkcePair(): PkcePair {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier, "ascii").digest());
  return { verifier, challenge };
}

export function newSecret(): string {
  return base64url(randomBytes(24));
}

// The desktop app's real redirect URI for local/web-fallback hosts
// (apps/desktop/src/lib/integrations/auth/proliferate-auth-redirect.ts:
// `desktopRedirectScheme()` resolves to `proliferate-local` for
// localhost/127.0.0.1/::1). `validate_redirect_uri`'s "desktop" branch only
// checks the scheme, so the exact host/path just needs to match what the
// product itself uses.
export const DESKTOP_REDIRECT_URI = "proliferate-local://auth/callback";

// ── Org SSO connection admin CRUD (POST /organizations/{id}/sso/connections, .../enable) ──

export interface SsoConnectionSummary {
  id: string;
  organizationId: string;
  status: string;
  jitPolicy: string;
  defaultRole: string;
  allowedDomains: string[];
}

export interface CreateSsoConnectionParams {
  displayName: string;
  jitPolicy: "disabled" | "existing_user" | "create_member";
  defaultRole: "owner" | "admin" | "member";
  allowedDomains: string[];
  oidc: {
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    jwksUri: string;
    clientId: string;
    clientSecret: string;
  };
}

export async function createOrganizationSsoConnection(
  adminToken: string,
  organizationId: string,
  params: CreateSsoConnectionParams,
): Promise<SsoConnectionSummary> {
  const { status, body } = await apiRequest<SsoConnectionSummary>(
    `/v1/organizations/${organizationId}/sso/connections`,
    {
      method: "POST",
      token: adminToken,
      body: {
        protocol: "oidc",
        displayName: params.displayName,
        loginPolicy: "optional",
        jitPolicy: params.jitPolicy,
        defaultRole: params.defaultRole,
        allowedDomains: params.allowedDomains,
        oidcIssuerUrl: params.oidc.issuer,
        oidcAuthorizationEndpoint: params.oidc.authorizationEndpoint,
        oidcTokenEndpoint: params.oidc.tokenEndpoint,
        oidcJwksUri: params.oidc.jwksUri,
        oidcClientId: params.oidc.clientId,
        oidcClientSecret: params.oidc.clientSecret,
        oidcTokenEndpointAuthMethod: "client_secret_basic",
      },
    },
  );
  if (status !== 201) {
    throw new Error(`Creating SSO connection failed (${status}): ${JSON.stringify(body)}`);
  }
  return body;
}

export async function enableOrganizationSsoConnection(
  adminToken: string,
  organizationId: string,
  connectionId: string,
): Promise<SsoConnectionSummary> {
  const { status, body } = await apiRequest<SsoConnectionSummary>(
    `/v1/organizations/${organizationId}/sso/connections/${connectionId}/enable`,
    { method: "POST", token: adminToken },
  );
  if (status !== 200) {
    throw new Error(`Enabling SSO connection failed (${status}): ${JSON.stringify(body)}`);
  }
  return body;
}

// ── Public discovery/start/callback surface ──

export interface SsoDiscoveryResult {
  enabled: boolean;
  scope: "deployment" | "organization" | null;
  connectionId: string | null;
  organizationId: string | null;
  protocol: string | null;
  displayName: string | null;
  reason: string | null;
}

export async function discoverSso(
  params: { email?: string; connectionId?: string; organizationId?: string } = {},
): Promise<{ status: number; body: SsoDiscoveryResult }> {
  const query = new URLSearchParams();
  if (params.email) query.set("email", params.email);
  if (params.connectionId) query.set("connectionId", params.connectionId);
  if (params.organizationId) query.set("organizationId", params.organizationId);
  const qs = query.toString();
  return apiRequest<SsoDiscoveryResult>(`/auth/sso/discover${qs ? `?${qs}` : ""}`);
}

export interface StartSsoAuthParams {
  connectionId: string;
  clientState: string;
  codeChallenge: string;
  redirectUri?: string;
}

export interface StartSsoAuthResult {
  authorizationUrl: string;
  state: string;
  nonce: string;
  connectionId: string | null;
}

export async function startDesktopSsoAuth(
  params: StartSsoAuthParams,
): Promise<{ status: number; body: StartSsoAuthResult }> {
  return apiRequest<StartSsoAuthResult>("/auth/desktop/sso/start", {
    method: "POST",
    body: {
      clientState: params.clientState,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: "S256",
      redirectUri: params.redirectUri ?? DESKTOP_REDIRECT_URI,
      connectionId: params.connectionId,
      prompt: "select_account",
    },
  });
}

/**
 * Fetch a URL without following redirects, returning the status and
 * `Location` header. Used to walk the OIDC round trip one hop at a time: the
 * mock IdP's `/authorize` auto-redirects to the server's own
 * `/auth/sso/oidc/callback`, which in turn redirects either to the app's
 * (custom-scheme) redirect_uri on success or to `/auth/error?code=...` on a
 * handled failure — both are plain 302s, no login UI, no interactive step,
 * so a manual-redirect fetch chain exercises the exact same network round
 * trip a browser would (mock IdP's real HTTP token/jwks endpoints, the
 * server's real token exchange + id_token verification, JIT
 * provisioning/membership) without needing a browser.
 */
export async function fetchRedirectHop(
  url: string,
): Promise<{ status: number; location: string | null }> {
  const response = await fetch(url, { redirect: "manual" });
  return { status: response.status, location: response.headers.get("location") };
}

/** Runs the two expected hops (mock IdP `/authorize` -> server
 * `/auth/sso/oidc/callback`) and returns the final Location, asserting both
 * hops actually redirected (never a raw 200/500 mid-chain). */
export async function runSsoAuthorizationRoundTrip(
  authorizationUrl: string,
): Promise<{ callbackLocation: string }> {
  const idpHop = await fetchRedirectHop(authorizationUrl);
  if (idpHop.status < 300 || idpHop.status >= 400 || !idpHop.location) {
    throw new Error(`mock IdP /authorize did not redirect (status ${idpHop.status})`);
  }
  const callbackHop = await fetchRedirectHop(idpHop.location);
  if (callbackHop.status < 300 || callbackHop.status >= 400 || !callbackHop.location) {
    throw new Error(`server /auth/sso/oidc/callback did not redirect (status ${callbackHop.status})`);
  }
  return { callbackLocation: callbackHop.location };
}

export interface DesktopPollResult {
  status: number;
  body: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user?: {
      id: string;
      email: string;
      display_name: string | null;
      github_login: string | null;
      avatar_url: string | null;
    };
    status?: "pending";
    detail?: unknown;
  };
}

export async function pollDesktopAuth(
  state: string,
  codeVerifier: string,
): Promise<DesktopPollResult> {
  return apiRequest(`/auth/desktop/poll`, {
    method: "POST",
    body: { state, code_verifier: codeVerifier },
  });
}

/** Poll until the auth code lands (mirrors the real app's poll loop) or the
 * budget is exhausted — the callback's DB commit and this poll call are two
 * separate HTTP round trips against the same real server, not a shared
 * process, so a single immediate poll is not guaranteed to win the race. */
export async function pollDesktopAuthUntilReady(
  state: string,
  codeVerifier: string,
  { timeoutMs = 15_000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<DesktopPollResult> {
  const deadline = Date.now() + timeoutMs;
  let last: DesktopPollResult | null = null;
  while (Date.now() < deadline) {
    const result = await pollDesktopAuth(state, codeVerifier);
    last = result;
    if (result.status !== 202) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (!last) {
    throw new Error("pollDesktopAuthUntilReady never called poll (unreachable)");
  }
  return last;
}

// ── Direct-DB read: sso_identity (no product read API exists for it) ──

export interface SsoIdentityRow {
  id: string;
  user_id: string;
  connection_id: string | null;
  provider_subject: string;
  email: string | null;
  email_verified: boolean;
}

export async function getSsoIdentityByConnectionAndSubject(
  connectionId: string,
  providerSubject: string,
): Promise<SsoIdentityRow | null> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT id, user_id, connection_id, provider_subject, email, email_verified
         FROM sso_identity
        WHERE connection_id = $1 AND provider_subject = $2`,
      [connectionId, providerSubject],
    );
    return (result.rows[0] as SsoIdentityRow | undefined) ?? null;
  } finally {
    await client.end();
  }
}

export async function countSsoIdentitiesForConnection(connectionId: string): Promise<number> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT count(*)::int AS count FROM sso_identity WHERE connection_id = $1`,
      [connectionId],
    );
    return (result.rows[0] as { count: number }).count;
  } finally {
    await client.end();
  }
}

export { apiBaseUrl };
