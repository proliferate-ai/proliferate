import { randomBytes } from "node:crypto";

import {
  SYNCED_ENROLLMENT_STATUS,
  toStoredSession,
  type AuthenticatedActor,
} from "./authenticated-actor.js";
import { ApiClient } from "./http.js";
import type { ReadyLocalWorld } from "../worlds/local-workspace/world.js";
import type { ActorKeyIdentity } from "../services/qualification-litellm.js";

/**
 * A REAL second product identity (spec step 9 / MCW-001). Actor A cannot be
 * cloned by re-running `authenticatedActor` because that fixture claims the
 * one-time `/setup` path, which actor A already consumed — a second `/setup`
 * call fails, so a reused-setup actor B is not a viable independent identity on
 * this server. In single-org mode the real supported second-user seam is
 * INVITE → REGISTER → LOGIN:
 *
 *   1. actor A (an org admin) mints an invitation for actor B's email
 *      (`POST /v1/organizations/{orgId}/invitations`);
 *   2. actor B registers against that invitation
 *      (`POST /auth/password/register`, mounted only in single-org mode —
 *      `register_invited_account`), which creates the account and joins the
 *      instance org via the real membership policy;
 *   3. actor B logs in through the same desktop password path actor A used.
 *
 * The returned actor is a full `AuthenticatedActor` (own bearer session, own
 * user/org identity, own gateway enrollment + LiteLLM key), so the isolation
 * check can drive actor B's OWN product credential against actor A's resources
 * and assert the product/runtime denies it. Every effect is behind the injected
 * transport, so unit tests exercise the plumbing offline.
 */

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

interface InvitationResponse {
  id: string;
  email: string;
  status: string;
}

interface EnrollmentResponse {
  id: string;
  syncStatus: string;
  lastErrorCode: string | null;
}

interface OrganizationsListResponse {
  organizations: Array<{ id: string }>;
}

export interface InvitedActorTransport {
  /** actor A mints the invitation (returns its id, which doubles as the register token). */
  createInvitation(adminApi: ApiClient, organizationId: string, email: string): Promise<InvitationResponse>;
  /** actor B registers against the invitation token (single-org `/auth/password/register`). */
  registerInvited(apiBaseUrl: string, params: { email: string; password: string; invitationToken: string }): Promise<void>;
  loginWithPassword(apiBaseUrl: string, email: string, password: string): Promise<DesktopTokenResponse>;
  listOrganizations(api: ApiClient): Promise<OrganizationsListResponse>;
  getEnrollment(api: ApiClient): Promise<EnrollmentResponse>;
  putGatewaySelection(api: ApiClient, harnessKind: string, surface: "local" | "cloud"): Promise<void>;
}

export const defaultInvitedActorTransport: InvitedActorTransport = {
  async createInvitation(adminApi, organizationId, email) {
    return adminApi.post<InvitationResponse>(
      `/v1/organizations/${encodeURIComponent(organizationId)}/invitations`,
      { email, role: "member" },
    );
  },
  async registerInvited(apiBaseUrl, { email, password, invitationToken }) {
    const response = await fetch(`${apiBaseUrl}/auth/password/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, invitationToken }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`POST /auth/password/register -> ${response.status}: ${text.slice(0, 2000)}`);
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

export interface InvitedActorOptions {
  /** actor A — the org admin who mints the invitation and whose org actor B joins. */
  inviter: AuthenticatedActor;
  /** Overrides the derived invited email (defaults to a run-scoped local address). */
  email?: string;
  /** Bounded wait for enrollment sync (default 60s). */
  enrollmentTimeoutMs?: number;
  enrollmentPollMs?: number;
  harnessKind?: string;
  /** Which agent-auth surface to write the gateway selection to (default "cloud" for this world). */
  gatewaySurface?: "local" | "cloud";
  /** Set false to skip the gateway-selection PUT (default true). */
  selectGatewayRoute?: boolean;
  /** Managed-cloud cleanup custody, invoked before selection or return. */
  resolveAndTrackActorSubjects?(params: {
    userId: string;
    enrollmentId: string;
  }): Promise<ActorKeyIdentity>;
}

/**
 * Creates a real invited "member" actor: invite (as actor A) → register →
 * login → wait for enrollment `synced` → resolve the LiteLLM key → optionally
 * select the gateway route. Never persists the generated password.
 */
export async function invitedActor(
  world: ReadyLocalWorld,
  options: InvitedActorOptions,
  transport: InvitedActorTransport = defaultInvitedActorTransport,
): Promise<AuthenticatedActor> {
  const email = options.email ?? `qual-actor-b-${world.run.run_id}-${world.run.shard_id}@example.com`;
  const password = randomBytes(24).toString("hex");

  const invitation = await transport.createInvitation(options.inviter.api, options.inviter.organizationId, email);
  // The register token IS the invitation id (`register_invited_account` compares
  // the supplied token to `invitation.id` with a constant-time check).
  await transport.registerInvited(world.api.baseUrl, { email, password, invitationToken: invitation.id });

  const tokenResponse = await transport.loginWithPassword(world.api.baseUrl, email, password);
  const session = toStoredSession(tokenResponse);
  const api = world.api.client.withBearerToken(session.access_token);

  const organizations = await transport.listOrganizations(api);
  const organization = organizations.organizations[0];
  if (!organization) {
    throw new Error("invitedActor: the invited member has no organization membership after registration.");
  }

  const harnessKind = options.harnessKind ?? "claude";
  const enrollment = await waitForSyncedEnrollment(api, transport, {
    timeoutMs: options.enrollmentTimeoutMs ?? 60_000,
    pollMs: options.enrollmentPollMs ?? 2_000,
  });

  const gatewayKey = await (options.resolveAndTrackActorSubjects ?? ((params) => world.gateway.resolveActorKey(params)))({
    userId: session.user_id,
    enrollmentId: enrollment.id,
  });

  if (options.selectGatewayRoute !== false) {
    await transport.putGatewaySelection(api, harnessKind, options.gatewaySurface ?? "cloud");
  }

  return {
    role: "member",
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
  transport: InvitedActorTransport,
  options: { timeoutMs: number; pollMs: number },
): Promise<EnrollmentResponse> {
  const deadline = Date.now() + options.timeoutMs;
  let lastStatusNote = "no enrollment row yet";
  for (;;) {
    try {
      const enrollment = await transport.getEnrollment(api);
      lastStatusNote = `status "${enrollment.syncStatus}", lastErrorCode "${enrollment.lastErrorCode ?? "none"}"`;
      if (enrollment.syncStatus === SYNCED_ENROLLMENT_STATUS) {
        return enrollment;
      }
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
      lastStatusNote = "enrollment row not created yet (404)";
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `invitedActor: gateway enrollment did not reach "${SYNCED_ENROLLMENT_STATUS}" within ` +
          `${options.timeoutMs}ms (last: ${lastStatusNote}).`,
      );
    }
    await sleep(options.pollMs);
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: unknown }).status === 404;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
