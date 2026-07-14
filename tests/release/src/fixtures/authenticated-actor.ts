import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ApiClient } from "./http.js";
import type { ReadyLocalWorld } from "../worlds/local-workspace/world.js";
import type { ActorKeyIdentity } from "../services/qualification-litellm.js";

/**
 * `authenticatedActor("owner")` (spec "Fixtures"). Only prerequisites are
 * fixtures; workspace/session creation and the turn remain behavior under test.
 * This fixture:
 *
 *   - claims the fresh Server through the real one-time `/setup` path
 *     (mounted only with SINGLE_ORG_MODE=true);
 *   - logs in through `/auth/desktop/password/login` and maps the response
 *     through the same stored-session shape the Desktop client uses;
 *   - relies on eager personal gateway enrollment scheduled from the first-run
 *     claim (a narrowly tested product fix), and still polls the PUBLIC
 *     enrollment endpoint so eventual recovery stays covered;
 *   - waits for the real gateway enrollment to become `synced`;
 *   - returns actor/user/organization identity and a product API session; and
 *   - never persists the generated password or raw virtual key in evidence.
 *
 * It MAY use the authenticated gateway-selection API
 * (`PUT {api_prefix}/v1/cloud/agent-gateway/selections/{harness_kind}`) to
 * select `gateway` for the representative harness — prerequisite state only.
 * It MUST NOT call `PUT /v1/agent-auth/state` itself; Desktop pushes that.
 *
 * Verified against `origin/main` `0eab251fd`:
 *   - `POST /setup` is a FORM post (`email`, `password`, `setup_token`,
 *     `organization_name` — `server/proliferate/server/setup/api.py`), gated by
 *     a token written to `settings.setup_token_file`
 *     (`PROLIFERATE_SETUP_TOKEN_FILE`/`SETUP_TOKEN_FILE`, default
 *     `/var/lib/proliferate/setup/setup-token`). The world/Docker controller
 *     (workstream A) must bind-mount that file to a run-owned path readable by
 *     this fixture; this module assumes the convention `<runDir>/setup-token`,
 *     overridable via `setupTokenPath` — flagged for the integrator to confirm
 *     against `docker.ts`.
 *   - `POST /auth/desktop/password/login`
 *     (`server/proliferate/auth/desktop/api.py`) returns `DesktopTokenResponse
 *     { access_token, refresh_token, token_type, expires_in, user: {...} }`;
 *     the real Desktop `toStoredSession()`
 *     (`apps/desktop/src/lib/integrations/auth/proliferate-auth.ts`) maps it to
 *     the SNAKE_CASE `StoredAuthSession` in
 *     `apps/desktop/src/lib/domain/auth/stored-auth-session.ts` — not the
 *     camelCase placeholder shape the contracts-stage skeleton sketched.
 *     Corrected here since this type is owned by this workstream's file (see
 *     final report for the disclosed deviation).
 *   - `GET {api_prefix}/v1/cloud/agent-gateway/enrollment` returns
 *     `syncStatus` (`AgentGatewayEnrollmentResponse`,
 *     `server/proliferate/server/cloud/agent_gateway/models.py`); the synced
 *     value is `AGENT_GATEWAY_SYNC_STATUS_SYNCED = "synced"`
 *     (`server/proliferate/constants/agent_gateway.py`).
 *   - `PUT {api_prefix}/v1/cloud/agent-gateway/selections/{harness_kind}?surface=local`
 *     body `{ sources: [{ sourceKind: "gateway", enabled: true }] }`
 *     (`AgentAuthSelectionsPutRequest`/`AgentAuthSourceInput`, same file).
 *   - Organization identity comes from `GET {api_prefix}/v1/organizations`
 *     (`{ organizations: [{ id, ... }] }`), same pattern
 *     `RELEASE_E2E_DURABLE_ORG_ID` documents for the durable-user fixtures.
 */

export type ActorRole = "owner";

/**
 * The stored-session shape the Desktop client persists under
 * `proliferate.auth.session`
 * (`apps/desktop/src/lib/domain/auth/stored-auth-session.ts`, mapped by
 * `toStoredSession()` in
 * `apps/desktop/src/lib/integrations/auth/proliferate-auth.ts`). The
 * product-page fixture installs exactly this into browser storage before boot.
 */
export interface StoredAuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  user_id: string;
  email: string;
  display_name: string | null;
  github_login?: string | null;
  avatar_url?: string | null;
}

export interface AuthenticatedActor {
  role: ActorRole;
  userId: string;
  organizationId: string;
  enrollmentId: string;
  /** Authenticated product API client (bearer set). */
  api: ApiClient;
  /** Browser-installable stored session (no raw password persisted). */
  session: StoredAuthSession;
  /** The actor's resolved LiteLLM key identity (token id stays in memory). */
  gatewayKey: ActorKeyIdentity;
}

export interface AuthenticatedActorOptions {
  /** Overrides the derived organization name (defaults to a run-scoped name). */
  organizationName?: string;
  /** Overrides the derived claim email (defaults to a run-scoped local address). */
  email?: string;
  /** Path to the plaintext setup-token file; defaults to `<runDir>/setup-token`. */
  setupTokenPath?: string;
  /** Bounded wait for enrollment sync (default 60s). */
  enrollmentTimeoutMs?: number;
  /** Poll interval while waiting for enrollment sync (default 2s). */
  enrollmentPollMs?: number;
  /** Harness to select the gateway route for (default "claude"). */
  harnessKind?: string;
  /** Set false to skip the gateway-selection PUT (default true). */
  selectGatewayRoute?: boolean;
}

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

interface EnrollmentResponse {
  id: string;
  subjectKind: string;
  litellmTeamId: string | null;
  syncStatus: string;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OrganizationsListResponse {
  organizations: Array<{ id: string }>;
}

export const SYNCED_ENROLLMENT_STATUS = "synced";

/**
 * Every network/filesystem side effect this fixture performs, factored out so
 * unit tests can fake the transport without a real Server/filesystem. The
 * default (`defaultAuthenticatedActorTransport`) is what production wiring
 * uses.
 */
export interface AuthenticatedActorTransport {
  readSetupToken(setupTokenPath: string): Promise<string>;
  claimSetup(params: {
    apiBaseUrl: string;
    email: string;
    password: string;
    setupToken: string;
    organizationName: string;
  }): Promise<void>;
  loginWithPassword(apiBaseUrl: string, email: string, password: string): Promise<DesktopTokenResponse>;
  listOrganizations(api: ApiClient): Promise<OrganizationsListResponse>;
  getEnrollment(api: ApiClient): Promise<EnrollmentResponse>;
  putGatewaySelection(api: ApiClient, harnessKind: string): Promise<void>;
}

export const defaultAuthenticatedActorTransport: AuthenticatedActorTransport = {
  async readSetupToken(setupTokenPath) {
    return (await readFile(setupTokenPath, "utf8")).trim();
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
  async getEnrollment(api) {
    return api.get<EnrollmentResponse>("/v1/cloud/agent-gateway/enrollment");
  },
  async putGatewaySelection(api, harnessKind) {
    await api.put(`/v1/cloud/agent-gateway/selections/${encodeURIComponent(harnessKind)}?surface=local`, {
      sources: [{ sourceKind: "gateway", enabled: true }],
    });
  },
};

/** Maps the real `/auth/desktop/password/login` response onto the browser-installable session. */
export function toStoredSession(response: DesktopTokenResponse): StoredAuthSession {
  const expiresAt = new Date(Date.now() + response.expires_in * 1000).toISOString();
  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: expiresAt,
    user_id: response.user.id,
    email: response.user.email,
    display_name: response.user.display_name,
    github_login: response.user.github_login ?? null,
    avatar_url: response.user.avatar_url ?? null,
  };
}

/**
 * Creates the fresh owner actor against a ready world: setup claim → desktop
 * password login → wait for gateway enrollment `synced` → resolve the actor
 * LiteLLM key → optionally select the `gateway` route for the harness.
 */
export async function authenticatedActor(
  world: ReadyLocalWorld,
  role: ActorRole,
  options: AuthenticatedActorOptions = {},
  transport: AuthenticatedActorTransport = defaultAuthenticatedActorTransport,
): Promise<AuthenticatedActor> {
  if (role !== "owner") {
    throw new Error(`authenticatedActor: unsupported role "${role}" (only "owner" is implemented).`);
  }

  const setupTokenPath = options.setupTokenPath ?? path.join(world.paths.runDir, "setup-token");
  const setupToken = await transport.readSetupToken(setupTokenPath);

  // NOTE: a real, non-reserved TLD is required. `normalize_account_email`
  // (server/proliferate/server/setup/accounts.py) rejects the special-use TLDs
  // `.invalid`/`.test`/`.local`/`.localhost` with a 400, so the claim uses a
  // syntactically valid `example.com` address (no mail is ever sent).
  const email = options.email ?? `qual-owner-${world.run.run_id}-${world.run.shard_id}@example.com`;
  const password = randomBytes(24).toString("hex");
  const organizationName = options.organizationName ?? `local-world-smoke-${world.run.run_id}`;

  await transport.claimSetup({ apiBaseUrl: world.api.baseUrl, email, password, setupToken, organizationName });

  const tokenResponse = await transport.loginWithPassword(world.api.baseUrl, email, password);
  const session = toStoredSession(tokenResponse);
  const api = world.api.client.withBearerToken(session.access_token);

  const organizations = await transport.listOrganizations(api);
  const organization = organizations.organizations[0];
  if (!organization) {
    throw new Error("authenticatedActor: claimed owner has no organization membership.");
  }

  const harnessKind = options.harnessKind ?? "claude";
  const enrollment = await waitForSyncedEnrollment(api, transport, {
    timeoutMs: options.enrollmentTimeoutMs ?? 60_000,
    pollMs: options.enrollmentPollMs ?? 2_000,
  });

  if (options.selectGatewayRoute !== false) {
    await transport.putGatewaySelection(api, harnessKind);
  }

  const gatewayKey = await world.gateway.resolveActorKey({
    userId: session.user_id,
    enrollmentId: enrollment.id,
  });

  return {
    role,
    userId: session.user_id,
    organizationId: organization.id,
    enrollmentId: enrollment.id,
    api,
    session,
    gatewayKey,
  };
}

async function waitForSyncedEnrollment(
  api: ApiClient,
  transport: AuthenticatedActorTransport,
  options: { timeoutMs: number; pollMs: number },
): Promise<EnrollmentResponse> {
  const deadline = Date.now() + options.timeoutMs;
  let last: EnrollmentResponse | undefined;
  let lastStatusNote = "no enrollment row yet";
  for (;;) {
    try {
      last = await transport.getEnrollment(api);
      lastStatusNote = `status "${last.syncStatus}", lastErrorCode "${last.lastErrorCode ?? "none"}"`;
      if (last.syncStatus === SYNCED_ENROLLMENT_STATUS) {
        return last;
      }
    } catch (error) {
      // The enrollment row is created asynchronously by the server's backfill
      // loop (server/proliferate/server/cloud/agent_gateway/enrollment.py); the
      // setup-claim account path does not eagerly enrol. Until the first
      // backfill pass runs, `GET .../enrollment` returns 404 — a transient
      // not-yet-enrolled state to poll through, not a hard failure.
      if (!isNotFound(error)) {
        throw error;
      }
      lastStatusNote = "enrollment row not created yet (404)";
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `authenticatedActor: gateway enrollment did not reach "${SYNCED_ENROLLMENT_STATUS}" within ` +
          `${options.timeoutMs}ms (last: ${lastStatusNote}).`,
      );
    }
    await sleep(options.pollMs);
  }
}

/** True for a 404 from the enrollment endpoint (ApiRequestError.status === 404). */
function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: unknown }).status === 404;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
