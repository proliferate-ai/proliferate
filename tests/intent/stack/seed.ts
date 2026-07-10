// Seeding helpers: password accounts, orgs, invitations, and the one
// legitimate direct-DB seed this suite needs (backdating an invitation's
// `expires_at`, since there is no API to fast-forward time — the same spirit
// as tier-2's Stripe test-clock convention, just without a clock object to
// drive). Nothing here fakes a sandbox, an LLM, or any third party; it only
// drives the product's own auth/org HTTP surface plus one raw SQL statement.

import { readFileSync } from "node:fs";
import { Client } from "pg";

// NOTE deliberately .example.com, not .test: RFC-reserved `.test` addresses
// expose a real product bug (first-run claim accepts them, but /users/me then
// 500s because UserRead's EmailStr rejects special-use TLDs — validation
// mismatch between account creation and profile serialization). Documented in
// the PR; the suite steers around it so it tests the intended flows.
export const ADMIN_EMAIL = "owner@t2intent.example.com";
export const ADMIN_PASSWORD = "Tier2Intent!Passw0rd";
export const ADMIN_ORG_NAME = "Tier2 Intent Org";

export function apiBaseUrl(): string {
  const value = process.env.TIER2_INTENT_API_BASE_URL;
  if (!value) {
    throw new Error("TIER2_INTENT_API_BASE_URL is not set — did globalSetup run?");
  }
  return value;
}

export function webBaseUrl(): string {
  const value = process.env.TIER2_INTENT_WEB_BASE_URL;
  if (!value) {
    throw new Error("TIER2_INTENT_WEB_BASE_URL is not set — did globalSetup run?");
  }
  return value;
}

/** The local AnyHarness runtime's base URL, published even when the runtime
 * itself is not running (TIER2_INTENT_SKIP_RUNTIME=1 in CI) — callers must
 * probe reachability and skip gracefully, per gateway-eligibility.spec.ts. */
export function anyharnessBaseUrl(): string {
  const value = process.env.TIER2_INTENT_ANYHARNESS_BASE_URL;
  if (!value) {
    throw new Error("TIER2_INTENT_ANYHARNESS_BASE_URL is not set — did globalSetup run?");
  }
  return value;
}

// Exported so sibling seed-*.ts files (e.g. seed-integrations.ts) share one
// source of truth for this instead of re-deriving it.
export function databaseUrl(): string {
  const value = process.env.TIER2_INTENT_DATABASE_URL;
  if (!value) {
    throw new Error("TIER2_INTENT_DATABASE_URL is not set — did globalSetup run?");
  }
  return value;
}

export function readSetupToken(): string {
  const path = process.env.TIER2_INTENT_SETUP_TOKEN_FILE;
  if (!path) {
    throw new Error("TIER2_INTENT_SETUP_TOKEN_FILE is not set — did globalSetup run?");
  }
  return readFileSync(path, "utf8").trim();
}

interface ApiResult<T> {
  status: number;
  body: T;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T) : (undefined as T);
  return { status: response.status, body };
}

/** POST a form-encoded body to a server-rendered page (`/setup`, `/register`). */
async function postForm(path: string, fields: Record<string, string>): Promise<{ status: number; html: string }> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
  return { status: response.status, html: await response.text() };
}

/**
 * Claim the instance if it hasn't been claimed yet, using the fixed admin
 * credentials every spec in this suite shares. Idempotent across spec files:
 * whichever spec runs first performs the real claim (auth.spec.ts's own
 * T2-AUTH-1 test drives this exact flow through the browser to assert it);
 * everything after just confirms the instance is claimed and reuses the
 * admin account. Single-org mode allows exactly one claim ever, so this must
 * never be called with different credentials across specs.
 */
export async function ensureInstanceClaimed(): Promise<void> {
  const openProbe = await fetch(`${apiBaseUrl()}/setup`);
  if (openProbe.status === 404) {
    return; // Already claimed (by this run or a prior one on this profile DB).
  }
  const token = readSetupToken();
  const result = await postForm("/setup", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    setup_token: token,
    organization_name: ADMIN_ORG_NAME,
  });
  if (result.status !== 200) {
    throw new Error(`Instance claim failed (${result.status}): ${result.html.slice(0, 500)}`);
  }
}

export interface DesktopTokens {
  access_token: string;
  refresh_token: string;
}

export async function passwordLogin(email: string, password: string): Promise<DesktopTokens> {
  const { status, body } = await apiRequest<DesktopTokens>("/auth/desktop/password/login", {
    method: "POST",
    body: { email, password },
  });
  if (status !== 200) {
    throw new Error(`Password login failed for ${email} (${status}): ${JSON.stringify(body)}`);
  }
  return body;
}

export interface OrganizationSummary {
  id: string;
  name: string;
}

export async function getOwnOrganization(token: string): Promise<OrganizationSummary> {
  const { status, body } = await apiRequest<{ organizations: OrganizationSummary[] }>(
    "/v1/organizations",
    { token },
  );
  if (status !== 200 || body.organizations.length === 0) {
    throw new Error(`Could not resolve the caller's organization (${status}): ${JSON.stringify(body)}`);
  }
  return body.organizations[0];
}

// Response field names follow the API's camelCase aliases
// (server/proliferate/server/organizations/models.py).
export interface InvitationSummary {
  id: string;
  organizationId: string;
  organizationName: string | null;
  email: string;
  role: string;
  status: string;
  deliveryStatus: string;
  acceptedByUserId: string | null;
  expiresAt: string;
}

export async function inviteMember(
  adminToken: string,
  organizationId: string,
  email: string,
  role: "member" | "admin" | "owner" = "member",
): Promise<InvitationSummary> {
  const { status, body } = await inviteMemberRaw(adminToken, organizationId, email, role);
  if (status !== 200 && status !== 201) {
    throw new Error(`Invite failed for ${email} (${status}): ${JSON.stringify(body)}`);
  }
  return body as InvitationSummary;
}

/** Non-throwing variant for negative cases (e.g. an admin invited-role
 * violation must surface as a 403 the caller asserts on, not an exception). */
export async function inviteMemberRaw(
  callerToken: string,
  organizationId: string,
  email: string,
  role: "member" | "admin" | "owner" = "member",
): Promise<ApiResult<InvitationSummary>> {
  return apiRequest<InvitationSummary>(`/v1/organizations/${organizationId}/invitations`, {
    method: "POST",
    token: callerToken,
    body: { email, role },
  });
}

export async function revokeInvitation(
  adminToken: string,
  organizationId: string,
  invitationId: string,
): Promise<ApiResult<InvitationSummary>> {
  return apiRequest<InvitationSummary>(`/v1/organizations/${organizationId}/invitations/${invitationId}`, {
    method: "DELETE",
    token: adminToken,
  });
}

export async function listInvitationsCurrent(token: string): Promise<InvitationSummary[]> {
  const { status, body } = await apiRequest<{ invitations: InvitationSummary[] }>(
    "/v1/organizations/invitations/current",
    { token },
  );
  if (status !== 200) {
    throw new Error(`Listing current-user invitations failed (${status}): ${JSON.stringify(body)}`);
  }
  return body.invitations;
}

export async function listOrganizationInvitations(
  adminToken: string,
  organizationId: string,
): Promise<InvitationSummary[]> {
  const { status, body } = await apiRequest<{ invitations: InvitationSummary[] }>(
    `/v1/organizations/${organizationId}/invitations`,
    { token: adminToken },
  );
  if (status !== 200) {
    throw new Error(`Listing organization invitations failed (${status}): ${JSON.stringify(body)}`);
  }
  return body.invitations;
}

export async function acceptCurrentInvitation(
  token: string,
  invitationId: string,
): Promise<ApiResult<unknown>> {
  return apiRequest(`/v1/organizations/invitations/current/${invitationId}/accept`, {
    method: "POST",
    token,
  });
}

export interface MemberSummary {
  membershipId: string;
  userId: string;
  email: string;
  role: string;
  status: string;
}

export async function listMembers(adminToken: string, organizationId: string): Promise<MemberSummary[]> {
  const { status, body } = await apiRequest<{ members: MemberSummary[] }>(
    `/v1/organizations/${organizationId}/members`,
    { token: adminToken },
  );
  if (status !== 200) {
    throw new Error(`Listing members failed (${status}): ${JSON.stringify(body)}`);
  }
  return body.members;
}

export async function removeMembership(
  adminToken: string,
  organizationId: string,
  membershipId: string,
): Promise<ApiResult<unknown>> {
  return apiRequest(`/v1/organizations/${organizationId}/members/${membershipId}`, {
    method: "DELETE",
    token: adminToken,
  });
}

// Response shape for PATCH .../members/{id} (organizations/models.py
// membership_response) — note this is the *membership* record, not the
// member-with-email shape `listMembers` returns: no email field, and the
// row id is `id`, not `membershipId`.
export interface MembershipUpdateResult {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  status: string;
  joinedAt: string;
  removedAt: string | null;
}

export async function updateMembership(
  adminToken: string,
  organizationId: string,
  membershipId: string,
  patch: { role?: "owner" | "admin" | "member"; status?: "active" | "removed" },
): Promise<ApiResult<MembershipUpdateResult>> {
  return apiRequest<MembershipUpdateResult>(`/v1/organizations/${organizationId}/members/${membershipId}`, {
    method: "PATCH",
    token: adminToken,
    body: patch,
  });
}

/**
 * Invite `email` with `role` (an admin/owner action) and complete their
 * self-registration through the product's own `/register` surface — the
 * single-org allowlist path every real teammate uses. Shared across specs
 * that need more than one live role (org-roles, secrets) so each doesn't
 * reimplement the invite+register dance.
 */
export async function inviteAndRegisterMember(
  inviterToken: string,
  organizationId: string,
  email: string,
  password: string,
  role: "member" | "admin" | "owner" = "member",
): Promise<string> {
  // Idempotent, same spirit as invitation.spec.ts's ensureInviteeAccount: a
  // retry (Playwright's built-in retry=1, or a rerun against this profile's
  // persisted DB) must not try to register the same email twice and 409.
  // Only for REUSABLE (fixed-email) accounts — see registerFreshMember for
  // guaranteed-new emails, where this login-first probe would be a doomed
  // attempt every single run, needlessly burning the shared password-login
  // rate-limit budget (5 failures / 15 min / IP, shared 127.0.0.1 across the
  // whole suite; auth.spec.ts's header explains the bucket).
  try {
    return (await passwordLogin(email, password)).access_token;
  } catch {
    // Fall through and invite+register.
  }
  return registerFreshMember(inviterToken, organizationId, email, password, role);
}

/**
 * Invite + register a brand-new (never-before-seen) email with no
 * login-first probe. Use this for Date.now()-suffixed emails minted fresh
 * every run — a login-first probe against a guaranteed-nonexistent account
 * is a guaranteed failure that only costs shared rate-limit budget.
 */
export async function registerFreshMember(
  inviterToken: string,
  organizationId: string,
  email: string,
  password: string,
  role: "member" | "admin" | "owner" = "member",
): Promise<string> {
  const invitation = await inviteMember(inviterToken, organizationId, email, role);
  await registerInvitedAccount({ email, password, invitationToken: invitation.id });
  return (await loginRightAfterMutation(() => passwordLogin(email, password))).access_token;
}

/**
 * Retry a call that reads state a mutation (registration, membership update)
 * just wrote. `get_async_session`'s commit happens in the dependency's
 * teardown after the endpoint body returns — invitation.spec.ts's accept-flow
 * comment names the same class of lag ("can land a beat after the response
 * is written"). Observed directly here too: a login immediately after
 * self-registration occasionally 401s on the very first attempt. Short,
 * bounded retry, not a real rate-limit risk since each attempt after the
 * first uses the SAME (by-then-correct) credentials, so no more than one
 * spurious failure per call is expected — and this is a distinct kind of
 * accepted flake from network first-contact (playwright.config.ts's own
 * retries: 1), so it's absorbed here rather than by a whole-test retry.
 */
async function loginRightAfterMutation<T>(attempt: () => Promise<T>, tries = 5): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw lastError;
}

/**
 * Create the invitee's password account through the product's own invited
 * self-registration surface (`POST /register`), the only account-creation
 * path single-org mode exposes besides the one-time first-run claim. This is
 * "seeding via the product's API", not a backdoor: it's exactly what an
 * invited teammate's browser does when they open the invite link.
 */
export async function registerInvitedAccount(params: {
  email: string;
  password: string;
  invitationToken: string;
}): Promise<void> {
  const result = await registerInvitedAccountRaw(params);
  if (result.status !== 200) {
    throw new Error(`Invited registration failed for ${params.email} (${result.status}): ${result.html.slice(0, 500)}`);
  }
}

/**
 * Non-throwing variant of {@link registerInvitedAccount}: POST the invited
 * `/register` form and hand back the raw status + rendered HTML. Used for the
 * negative cases (wrong email against a real token → the uniform 403
 * `_not_invited` re-render) where the caller asserts on the rejection instead
 * of treating a non-200 as an error.
 */
export async function registerInvitedAccountRaw(params: {
  email: string;
  password: string;
  invitationToken: string;
}): Promise<{ status: number; html: string }> {
  return postForm("/register", {
    email: params.email,
    password: params.password,
    invitation_token: params.invitationToken,
  });
}

/**
 * Read an organization's `is_instance` flag straight from Postgres. Single-org
 * mode's claim marks THE instance organization with this column and no product
 * API surfaces it, so this is the same "state the product exposes no API for"
 * direct-DB read as the slug/invitation-expiry helpers above.
 */
export async function getOrganizationIsInstance(organizationId: string): Promise<boolean> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    const result = await client.query<{ is_instance: boolean }>(
      `SELECT is_instance FROM organization WHERE id = $1`,
      [organizationId],
    );
    if (result.rows.length === 0) {
      throw new Error(`Organization ${organizationId} not found`);
    }
    return result.rows[0].is_instance;
  } finally {
    await client.end();
  }
}

// ── Cloud secrets (T2-SEC-1) ──
// Response field names follow CloudSecretsResponse's camelCase aliases
// (server/proliferate/server/cloud/secrets/models.py). Values are never
// present in these payloads by design — only metadata (id/name/byteSize/
// updatedAt) — so there is nothing to assert-never-echoed beyond "the field
// doesn't exist on the type", which the TS shape itself pins.
export interface CloudSecretEnvVarMetadata {
  id: string;
  name: string;
  byteSize: number;
  updatedAt: string;
}

export interface CloudSecretFileMetadata {
  id: string;
  path: string;
  byteSize: number;
  updatedAt: string;
}

export interface CloudSecretsMaterialization {
  status: "pending" | "running" | "ready" | "error";
  lastError: string | null;
  materializedAt: string | null;
}

export interface CloudSecretsResponse {
  scopeKind: "personal" | "organization" | "workspace";
  version: number;
  envVars: CloudSecretEnvVarMetadata[];
  files: CloudSecretFileMetadata[];
  materialization: CloudSecretsMaterialization | null;
}

export async function getPersonalSecrets(token: string): Promise<ApiResult<CloudSecretsResponse>> {
  return apiRequest<CloudSecretsResponse>("/v1/cloud/secrets/personal", { token });
}

export async function putPersonalSecretEnvVar(
  token: string,
  name: string,
  value: string,
): Promise<ApiResult<CloudSecretsResponse>> {
  return apiRequest<CloudSecretsResponse>(`/v1/cloud/secrets/personal/env-vars/${name}`, {
    method: "PUT",
    token,
    body: { value },
  });
}

export async function deletePersonalSecretEnvVar(
  token: string,
  name: string,
): Promise<ApiResult<CloudSecretsResponse>> {
  return apiRequest<CloudSecretsResponse>(`/v1/cloud/secrets/personal/env-vars/${name}`, {
    method: "DELETE",
    token,
  });
}

export async function putPersonalSecretFile(
  token: string,
  path: string,
  content: string,
): Promise<ApiResult<CloudSecretsResponse>> {
  return apiRequest<CloudSecretsResponse>("/v1/cloud/secrets/personal/files", {
    method: "PUT",
    token,
    body: { path, content },
  });
}

export async function getOrganizationSecrets(
  token: string,
  organizationId: string,
): Promise<ApiResult<CloudSecretsResponse>> {
  return apiRequest<CloudSecretsResponse>(`/v1/cloud/organizations/${organizationId}/secrets`, { token });
}

export async function putOrganizationSecretEnvVar(
  token: string,
  organizationId: string,
  name: string,
  value: string,
): Promise<ApiResult<CloudSecretsResponse>> {
  return apiRequest<CloudSecretsResponse>(
    `/v1/cloud/organizations/${organizationId}/secrets/env-vars/${name}`,
    { method: "PUT", token, body: { value } },
  );
}

export async function getWorkspaceSecrets(
  token: string,
  gitOwner: string,
  gitRepoName: string,
): Promise<ApiResult<CloudSecretsResponse>> {
  return apiRequest<CloudSecretsResponse>(`/v1/cloud/repos/${gitOwner}/${gitRepoName}/secrets`, { token });
}

export async function putWorkspaceSecretEnvVar(
  token: string,
  gitOwner: string,
  gitRepoName: string,
  name: string,
  value: string,
): Promise<ApiResult<CloudSecretsResponse>> {
  return apiRequest<CloudSecretsResponse>(
    `/v1/cloud/repos/${gitOwner}/${gitRepoName}/secrets/env-vars/${name}`,
    { method: "PUT", token, body: { value } },
  );
}

/**
 * Upload a personal secret file via the multipart endpoint
 * (`PUT /secrets/personal/files/upload`). Used to drive the binary-content
 * negative (`invalid_secret_file_upload`): the server decodes the upload as
 * UTF-8 and rejects anything that fails to decode.
 */
export async function uploadPersonalSecretFile(
  token: string,
  path: string,
  content: Uint8Array,
  filename = "upload.bin",
): Promise<ApiResult<CloudSecretsResponse>> {
  const form = new FormData();
  form.append("path", path);
  form.append("file", new Blob([content]), filename);
  const response = await fetch(`${apiBaseUrl()}/v1/cloud/secrets/personal/files/upload`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as CloudSecretsResponse) : (undefined as unknown as CloudSecretsResponse);
  return { status: response.status, body };
}

// ── Cloud workspaces (T2-WS-1, seam only) ──

export async function createCloudWorkspace(
  token: string,
  params: {
    gitOwner: string;
    gitRepoName: string;
    branchName: string;
    baseBranch?: string;
    displayName?: string;
  },
): Promise<ApiResult<unknown>> {
  return apiRequest("/v1/cloud/workspaces", {
    method: "POST",
    token,
    body: {
      gitProvider: "github",
      gitOwner: params.gitOwner,
      gitRepoName: params.gitRepoName,
      branchName: params.branchName,
      baseBranch: params.baseBranch,
      displayName: params.displayName,
      source: "web",
    },
  });
}

/**
 * Backdate a pending invitation's `expires_at` directly in Postgres. There is
 * no product API to fast-forward time, so this is the direct-DB analog of
 * tier-2's Stripe test-clock convention (real state, just time-shifted).
 */
export async function backdateInvitationExpiry(invitationId: string, expiresAt: Date): Promise<void> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    await client.query(
      `UPDATE organization_invitation SET expires_at = $1 WHERE id = $2`,
      [expiresAt.toISOString(), invitationId],
    );
  } finally {
    await client.end();
  }
}

/**
 * Clear password-login rate-limit counters. The limiter buckets failures per
 * email AND per client IP (5 failures / 15 min, constants/auth.py); every
 * browser context in this suite shares 127.0.0.1, so the deliberate
 * wrong-password/wrong-account negatives would trip the IP bucket for every
 * later login in the run. Between tests that is limiter noise, not the
 * behavior under test, so specs reset the limiter's real table after
 * intentionally failing logins.
 */
export async function resetPasswordLoginRateLimits(): Promise<void> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    await client.query(`DELETE FROM password_login_attempt`);
  } finally {
    await client.end();
  }
}

// ── Org SSO entry points (T2-AUTH-5) ──
// The web/desktop SSO entry points resolve an org **slug** (or org id) to that
// org's SSO connection through `GET /sso/discover`, then hand off to the
// existing start flow. Discover reads the connection's stored state only — it
// never contacts the IdP (that happens at `start`), so an enabled connection
// row seeded directly in Postgres is enough to exercise the slug/org-id
// resolution seam without a live IdP round-trip (the round-trip itself is
// T2-AUTH-3, landed separately). Slugs are generated per org (lowercase,
// URL-safe, unique); there is no API that returns an org's slug, so we read it
// straight from the row the migration/creation path wrote.

/** The org's generated login slug (`/login/<slug>`), read from Postgres. */
export async function getOrganizationSlug(organizationId: string): Promise<string> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    const result = await client.query<{ slug: string | null }>(
      `SELECT slug FROM organization WHERE id = $1`,
      [organizationId],
    );
    const slug = result.rows[0]?.slug;
    if (!slug) {
      throw new Error(`Organization ${organizationId} has no slug (did the slug migration run?)`);
    }
    return slug;
  } finally {
    await client.end();
  }
}

/**
 * Seed an ENABLED organization-scope OIDC SSO connection directly in Postgres
 * and return its id. Discover only reads status/scope/protocol/display_name/
 * organization_id off this row, so the OIDC endpoint fields stay null — a
 * `start` against it would need a real IdP, which is deliberately out of scope
 * here (T2-AUTH-3 owns the round-trip). Columns with server defaults
 * (login_policy, jit_policy, default_role, allowed_domains_json, oidc scopes)
 * are left to fill themselves.
 */
export async function seedEnabledOrgSsoConnection(
  organizationId: string,
  displayName = "Acme Okta",
): Promise<string> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    // Seed a structurally COMPLETE OIDC config: discovery now advertises only
    // usable connections (server oidc_configuration_error gate), so an enabled
    // row with null client id/issuer would correctly report enabled=false and
    // the entry-point discovery this fixture backs would see nothing. A public
    // client (token_endpoint_auth_method='none') needs no secret, so client id +
    // issuer is enough to be "startable" without a real IdP or a ciphertext.
    const result = await client.query<{ id: string }>(
      `INSERT INTO sso_connection (
         id, scope, organization_id, protocol, status, display_name,
         oidc_client_id, oidc_issuer_url, oidc_token_endpoint_auth_method,
         created_at, updated_at
       )
       VALUES (
         gen_random_uuid(), 'organization', $1, 'oidc', 'enabled', $2,
         'seed-client-id', 'https://idp.seed.example', 'none',
         now(), now()
       )
       RETURNING id`,
      [organizationId, displayName],
    );
    return result.rows[0].id;
  } finally {
    await client.end();
  }
}

/**
 * Seed an org-scope OIDC connection marked `status='enabled'` but missing its
 * `oidc_client_id` — the drift case `enable_organization_sso_connection`
 * itself cannot produce (it re-tests the live OIDC endpoints before flipping
 * status), but that a later admin edit CAN: nothing in `update_organization_
 * sso_connection` re-validates or revokes `enabled` when a required field is
 * cleared. Discover's `oidc_configuration_error` gate (server/proliferate/
 * auth/sso/service.py's `_discover_for_context`) exists precisely to catch
 * this — an "enabled" row that would only fail at the provider must still
 * report `enabled=false`, not a false positive. Only reachable via direct
 * seed: the product's own admin API always tests before enabling.
 */
export async function seedIncompleteEnabledOrgSsoConnection(
  organizationId: string,
  displayName = "Acme Okta (incomplete)",
): Promise<string> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO sso_connection (
         id, scope, organization_id, protocol, status, display_name,
         oidc_issuer_url, oidc_token_endpoint_auth_method,
         created_at, updated_at
       )
       VALUES (
         gen_random_uuid(), 'organization', $1, 'oidc', 'enabled', $2,
         'https://idp.seed.example', 'none',
         now(), now()
       )
       RETURNING id`,
      [organizationId, displayName],
    );
    return result.rows[0].id;
  } finally {
    await client.end();
  }
}

/** Remove every SSO connection for an org (test cleanup — keep the seeded
 * connection from leaking into sibling specs that share this profile DB). */
export async function deleteOrgSsoConnections(organizationId: string): Promise<void> {
  const client = new Client({ connectionString: toPostgresDriverUrl(databaseUrl()) });
  await client.connect();
  try {
    await client.query(`DELETE FROM sso_connection WHERE organization_id = $1`, [organizationId]);
  } finally {
    await client.end();
  }
}

/** The server uses asyncpg's SQLAlchemy URL scheme; node-postgres needs the
 * plain `postgresql://` scheme, and its resolver chokes on the bracketed
 * `[::1]` host the macOS profile default uses — Docker's Postgres publishes
 * on localhost for both stacks, so map it. Exported for the same reason as
 * `databaseUrl` above. */
export function toPostgresDriverUrl(url: string): string {
  return url
    .replace(/^postgresql\+asyncpg:\/\//, "postgresql://")
    .replace("@[::1]:", "@localhost:");
}
