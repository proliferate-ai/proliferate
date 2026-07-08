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

function databaseUrl(): string {
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
  role: "member" | "admin" = "member",
): Promise<InvitationSummary> {
  const { status, body } = await apiRequest<InvitationSummary>(
    `/v1/organizations/${organizationId}/invitations`,
    { method: "POST", token: adminToken, body: { email, role } },
  );
  if (status !== 200 && status !== 201) {
    throw new Error(`Invite failed for ${email} (${status}): ${JSON.stringify(body)}`);
  }
  return body;
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
  const result = await postForm("/register", {
    email: params.email,
    password: params.password,
    invitation_token: params.invitationToken,
  });
  if (result.status !== 200) {
    throw new Error(`Invited registration failed for ${params.email} (${result.status}): ${result.html.slice(0, 500)}`);
  }
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

/** The server uses asyncpg's SQLAlchemy URL scheme; node-postgres needs the
 * plain `postgresql://` scheme, and its resolver chokes on the bracketed
 * `[::1]` host the macOS profile default uses — Docker's Postgres publishes
 * on localhost for both stacks, so map it. */
function toPostgresDriverUrl(url: string): string {
  return url
    .replace(/^postgresql\+asyncpg:\/\//, "postgresql://")
    .replace("@[::1]:", "@localhost:");
}
