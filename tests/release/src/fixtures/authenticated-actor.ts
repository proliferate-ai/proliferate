import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
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
 * (`PUT {api_prefix}/v1/cloud/agent-gateway/selections/{harness_kind}?surface=…`)
 * to select `gateway` for the representative harness — prerequisite state only.
 * The surface defaults to `local` (what the desktop pushes to a local runtime);
 * the managed-cloud scenario overrides it to `cloud` via `gatewaySurface` so the
 * cloud sandbox's materialized state.json carries the gateway source.
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

export type ActorRole = "owner" | "member";

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
  /**
   * Which agent-auth SURFACE to write the gateway selection to (default
   * "local"). The local runtime (local-workspace world) reads the `local`
   * surface the desktop pushes; a CLOUD sandbox is materialized from the
   * `cloud` surface only (`materialize_agent_auth` →
   * `build_agent_auth_state(..., surface="cloud")`), and only a `cloud`-surface
   * PUT triggers `schedule_materialize_agent_auth`
   * (`agent_gateway/service.py`), so the managed-cloud scenario MUST select
   * "cloud" or the sandbox's state.json carries no gateway source to probe.
   */
  gatewaySurface?: "local" | "cloud";
  /**
   * Managed-cloud crash custody. Called with the exact run-owned email BEFORE
   * `/setup` creates the actor (and therefore before async LiteLLM enrollment
   * can create provider subjects). The returned binder promotes that same
   * durable intent after the exact enrollment resolves.
   */
  beginActorEnrollmentCustody?(params: { email: string }): Promise<{
    resolveAndTrack(params: { userId: string; enrollmentId: string }): Promise<ActorKeyIdentity>;
  }>;
  /**
   * Managed-cloud custody seam. Once the synced enrollment exposes the exact
   * product user + enrollment ids, resolve the provider subjects and durably
   * register their cleanup before this fixture performs any later selection or
   * returns control to the scenario. Local worlds omit this and resolve the key
   * directly because their cleanup owner is different.
   */
  resolveAndTrackActorSubjects?(params: {
    userId: string;
    enrollmentId: string;
  }): Promise<ActorKeyIdentity>;
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
  putGatewaySelection(api: ApiClient, harnessKind: string, surface: "local" | "cloud"): Promise<void>;
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
  async putGatewaySelection(api, harnessKind, surface) {
    await api.put(
      `/v1/cloud/agent-gateway/selections/${encodeURIComponent(harnessKind)}?surface=${encodeURIComponent(surface)}`,
      { sources: [{ sourceKind: "gateway", enabled: true }] },
    );
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
  const enrollmentCustody = await options.beginActorEnrollmentCustody?.({ email });

  await transport.claimSetup({ apiBaseUrl: world.api.baseUrl, email, password, setupToken, organizationName });

  let tokenResponse: DesktopTokenResponse;
  try {
    tokenResponse = await transport.loginWithPassword(world.api.baseUrl, email, password);
  } catch (error) {
    // Env-gated (LOCAL_WORLD_SMOKE_DEBUG_DIR) secret-free diagnostics for the
    // CI-only `POST /auth/desktop/password/login -> 401`. Distinguishes "claim
    // never persisted the owner" (setup still open) from "owner exists but the
    // password/verify path fails" (setup closed). Never writes the password,
    // setup token, access/refresh tokens, or any credential.
    await captureAuthFailureDiagnostics(world.api.baseUrl, email).catch(() => undefined);
    throw error;
  }
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

  const gatewayKey = await (enrollmentCustody?.resolveAndTrack ?? options.resolveAndTrackActorSubjects ?? ((params) => world.gateway.resolveActorKey(params)))({
    userId: session.user_id,
    enrollmentId: enrollment.id,
  });

  if (options.selectGatewayRoute !== false) {
    await transport.putGatewaySelection(api, harnessKind, options.gatewaySurface ?? "local");
  }

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

/**
 * Env-gated (`LOCAL_WORLD_SMOKE_DEBUG_DIR`) secret-free capture of why the
 * setup-claim → password-login handshake failed. Only read-only, credential-free
 * signals are recorded:
 *
 *   - `GET /setup`: 404/"nothing to set up" means the claim DID consume setup
 *     (owner exists → the 401 is a verify/state problem); a 200 setup form means
 *     the claim did NOT persist (commit/visibility problem);
 *   - `GET /auth/desktop/methods`: whether password login is enabled at all.
 *
 * The setup page HTML is reduced to a boolean marker; no page body, password,
 * setup token, or session token is ever written.
 */
async function captureAuthFailureDiagnostics(apiBaseUrl: string, email: string): Promise<void> {
  const dir = process.env.LOCAL_WORLD_SMOKE_DEBUG_DIR;
  if (!dir) {
    return;
  }
  const diag: Record<string, unknown> = { emailLocalPartLength: email.split("@")[0]?.length ?? 0 };

  try {
    const setup = await fetch(`${apiBaseUrl}/setup`, { method: "GET" });
    const body = await setup.text().catch(() => "");
    diag.setupGet = {
      status: setup.status,
      // Boolean markers only — never the page body.
      setupStillOpen: /name="setup_token"/.test(body),
      nothingToSetUp: /nothing to set up/i.test(body),
    };
  } catch (error) {
    diag.setupGet = `err: ${error instanceof Error ? error.message : String(error)}`;
  }

  try {
    const methods = await fetch(`${apiBaseUrl}/auth/desktop/methods`, { method: "GET" });
    diag.authMethods = { status: methods.status, body: await methods.json().catch(() => null) };
  } catch (error) {
    diag.authMethods = `err: ${error instanceof Error ? error.message : String(error)}`;
  }

  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `auth-failure-diag-${Date.now()}.json`), JSON.stringify(diag, null, 2));
  } catch {
    // Best-effort diagnostics.
  }
}
