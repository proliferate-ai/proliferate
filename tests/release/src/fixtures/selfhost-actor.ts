import { randomBytes } from "node:crypto";

import { ApiClient, ApiRequestError } from "./http.js";
import { toStoredSession, type StoredAuthSession } from "./authenticated-actor.js";
import type { ReadySelfHostWorld } from "../worlds/selfhost/world.js";

/**
 * Self-host owner + invitee fixtures (frozen spec cells `SH-INSTALL-CLAIM` and
 * `SH-INVITEE`). These are the self-host twins of `authenticated-actor.ts`,
 * driving the REMOTE self-host API over TLS instead of a local Docker server.
 *
 * The owner claim goes through the real one-time `/setup` path, reading the
 * setup token over SSH/SSM from the box (`world.control.readSetupToken()`),
 * never over HTTP. The claim/login/second-claim-rejection is the behavior under
 * test — this fixture performs the prerequisite/mechanical parts and exposes the
 * observations the `SH-INSTALL-CLAIM` cell asserts. Neither the setup token nor
 * any password is ever persisted on the returned actor (only the product
 * session tokens, exactly like `authenticated-actor.ts`).
 *
 *   `POST /setup` (form: email/password/setup_token/organization_name),
 *   `POST /auth/desktop/password/login` -> `DesktopTokenResponse`,
 *   `GET /v1/organizations` -> `{ organizations: [{ id, membership }] }`,
 *   `POST /v1/organizations/{orgId}/invitations` -> `{ id, status }`,
 *   `POST /auth/password/register` (invitationToken), then invitee login —
 *   verified against the retired `t3-sh-1` walk and `authenticated-actor.ts`.
 */

export interface SelfHostOwnerActor {
  role: "owner";
  userId: string;
  organizationId: string;
  /** Authenticated product API client over TLS (bearer set). */
  api: ApiClient;
  /** Browser-installable stored session (no raw password persisted). */
  session: StoredAuthSession;
}

export interface SelfHostInvitee {
  role: "member";
  userId: string;
  organizationId: string;
  email: string;
  invitationId: string;
  api: ApiClient;
  session: StoredAuthSession;
}

export interface SelfHostActorOptions {
  organizationName?: string;
  email?: string;
  loginTimeoutMs?: number;
}

/** The `DesktopTokenResponse` shape (mirrors `authenticated-actor.ts`). */
interface DesktopTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    display_name: string | null;
    github_login?: string | null;
    avatar_url?: string | null;
  };
}

interface OrganizationMembership {
  status?: string;
  role?: string;
}

interface OrganizationsListResponse {
  organizations: Array<{ id: string; membership?: OrganizationMembership }>;
}

interface InvitationResponse {
  id: string;
  status: string;
}

/**
 * Every network/SSH side effect factored out so unit tests can fake the
 * transport without a real box/Server. The default reads the token via the
 * world's SSH/SSM control handle and claims/logs in over the TLS API.
 */
export interface SelfHostActorTransport {
  readSetupToken(world: ReadySelfHostWorld): Promise<string>;
  claimSetup(params: {
    apiBaseUrl: string;
    email: string;
    password: string;
    setupToken: string;
    organizationName: string;
  }): Promise<void>;
  loginWithPassword(apiBaseUrl: string, email: string, password: string): Promise<DesktopTokenResponse>;
  listOrganizations(api: ApiClient): Promise<OrganizationsListResponse>;
  invite(api: ApiClient, orgId: string, email: string, role: "member"): Promise<InvitationResponse>;
  register(apiBaseUrl: string, params: { email: string; password: string; invitationToken: string }): Promise<void>;
  /** Status code the closed `/setup` endpoint returns to a second claimant (expected 404). */
  getSetupStatus(apiBaseUrl: string): Promise<number>;
}

export const defaultSelfHostActorTransport: SelfHostActorTransport = {
  async readSetupToken(world) {
    // Read over SSH/SSM (never over HTTP) via the world's control handle.
    return (await world.control.readSetupToken()).trim();
  },
  async claimSetup({ apiBaseUrl, email, password, setupToken, organizationName }) {
    const body = new URLSearchParams({
      email,
      password,
      setup_token: setupToken,
      organization_name: organizationName,
    });
    const response = await fetch(`${apiBaseUrl}/setup`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`POST /setup -> ${response.status}: ${text.slice(0, 2000)}`);
    }
  },
  async loginWithPassword(apiBaseUrl, email, password) {
    const response = await fetch(`${apiBaseUrl}/auth/desktop/password/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`POST /auth/desktop/password/login -> ${response.status}: ${text.slice(0, 2000)}`);
    }
    return (await response.json()) as DesktopTokenResponse;
  },
  async listOrganizations(api) {
    return api.get<OrganizationsListResponse>("/v1/organizations");
  },
  async invite(api, orgId, email, role) {
    return api.post<InvitationResponse>(`/v1/organizations/${encodeURIComponent(orgId)}/invitations`, { email, role });
  },
  async register(apiBaseUrl, { email, password, invitationToken }) {
    const api = new ApiClient({ baseUrl: apiBaseUrl });
    await api.post("/auth/password/register", { email, password, invitationToken });
  },
  async getSetupStatus(apiBaseUrl) {
    const response = await fetch(`${apiBaseUrl}/setup`, { method: "GET" });
    return response.status;
  },
};

/** A random product password satisfying the server's 12-character minimum; never persisted. */
function generatePassword(): string {
  return randomBytes(24).toString("hex");
}

/**
 * A run-scoped, non-reserved email. `normalize_account_email`
 * (server/proliferate/server/setup/accounts.py) rejects the special-use TLDs
 * `.invalid`/`.test`/`.local`/`.localhost` with a 400, so we use `example.com`
 * (no mail is ever sent). Mirrors `authenticated-actor.ts`.
 */
function ownerEmail(world: ReadySelfHostWorld): string {
  return `qual-owner-${world.run.run_id}-${world.run.shard_id}@example.com`;
}

function inviteeEmail(world: ReadySelfHostWorld): string {
  return `qual-invitee-${world.run.run_id}-${world.run.shard_id}@example.com`;
}

/**
 * Claims the fresh instance as first owner: read setup token over SSH/SSM →
 * `POST /setup` → password login → resolve the single org (exactly one, owner,
 * active). Returns the owner actor and product session. The setup token and the
 * generated password never leave this function (only session tokens do).
 */
export async function claimSelfHostOwner(
  world: ReadySelfHostWorld,
  options: SelfHostActorOptions = {},
  transport: SelfHostActorTransport = defaultSelfHostActorTransport,
): Promise<SelfHostOwnerActor> {
  const setupToken = (await transport.readSetupToken(world)).trim();
  if (setupToken.length === 0) {
    throw new Error("claimSelfHostOwner: read an empty setup token from the box.");
  }

  const email = options.email ?? ownerEmail(world);
  const password = generatePassword();
  const organizationName = options.organizationName ?? `selfhost-install-${world.run.run_id}`;

  await transport.claimSetup({ apiBaseUrl: world.api.baseUrl, email, password, setupToken, organizationName });

  const tokenResponse = await transport.loginWithPassword(world.api.baseUrl, email, password);
  const session = toStoredSession(tokenResponse);
  const api = world.api.client.withBearerToken(session.access_token);

  const organizations = await transport.listOrganizations(api);
  if (organizations.organizations.length !== 1) {
    throw new Error(
      `claimSelfHostOwner: claimed owner should belong to exactly one org, got ${organizations.organizations.length}.`,
    );
  }
  const organization = organizations.organizations[0];
  if (organization.membership?.status !== undefined && organization.membership.status !== "active") {
    throw new Error(`claimSelfHostOwner: owner membership is not active (${organization.membership.status}).`);
  }
  if (organization.membership?.role !== undefined && organization.membership.role !== "owner") {
    throw new Error(`claimSelfHostOwner: claimer is not the org owner (${organization.membership.role}).`);
  }

  return {
    role: "owner",
    userId: session.user_id,
    organizationId: organization.id,
    api,
    session,
  };
}

/**
 * Asserts a second `/setup` claim is permanently rejected (`/setup` closed/404).
 * Reads the endpoint status through the transport so unit tests stay offline.
 */
export async function assertSecondClaimRejected(
  world: ReadySelfHostWorld,
  transport: SelfHostActorTransport = defaultSelfHostActorTransport,
): Promise<void> {
  const status = await transport.getSetupStatus(world.api.baseUrl);
  if (status !== 404) {
    throw new Error(
      `assertSecondClaimRejected: /setup should be permanently closed (404) after the first claim, got ${status}.`,
    );
  }
}

/**
 * Invites a member through the product, captures the invitation response, and
 * registers the invitee. The `SH-INVITEE` cell drives login from a SECOND
 * isolated product page and asserts the intended role + one authenticated
 * member action; this fixture performs the invite/register prerequisite and
 * returns the invitee identity + a product session. The generated password is
 * never persisted on the returned invitee.
 */
export async function inviteAndRegisterMember(
  world: ReadySelfHostWorld,
  owner: SelfHostOwnerActor,
  options: { email?: string; role?: "member" } = {},
  transport: SelfHostActorTransport = defaultSelfHostActorTransport,
): Promise<SelfHostInvitee> {
  const email = options.email ?? inviteeEmail(world);
  const role = options.role ?? "member";
  const password = generatePassword();

  const invitation = await transport.invite(owner.api, owner.organizationId, email, role);
  if (invitation.status !== "pending") {
    throw new Error(`inviteAndRegisterMember: invitation should be pending, got ${invitation.status}.`);
  }

  // The invitation id doubles as the invitation token in `/auth/password/register`
  // (verified against the retired `t3-sh-1` walk).
  await transport.register(world.api.baseUrl, { email, password, invitationToken: invitation.id });

  const tokenResponse = await transport.loginWithPassword(world.api.baseUrl, email, password);
  const session = toStoredSession(tokenResponse);
  const api = world.api.client.withBearerToken(session.access_token);

  const organizations = await transport.listOrganizations(api);
  if (organizations.organizations.length !== 1) {
    throw new Error(
      `inviteAndRegisterMember: invitee should belong to exactly one org, got ${organizations.organizations.length}.`,
    );
  }
  const organization = organizations.organizations[0];
  if (organization.id !== owner.organizationId) {
    throw new Error("inviteAndRegisterMember: invitee joined the wrong organization.");
  }

  return {
    role: "member",
    userId: session.user_id,
    organizationId: organization.id,
    email,
    invitationId: invitation.id,
    api,
    session,
  };
}

/** True for a 404 `ApiRequestError` (helper for callers asserting closed endpoints). */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}
