/**
 * Production-server gateway-enrollment path for the local-runtime world.
 *
 * LOCAL-2 requires a "fresh gateway actor enrolled through the production
 * server path producing a scoped LiteLLM virtual key". This module drives the
 * real product endpoints a signed-in client (the Desktop dispatch worker) uses:
 *
 *   GET /v1/cloud/agent-gateway/capabilities   -> is the gateway enabled + public base url
 *   GET /v1/cloud/agent-gateway/enrollment     -> the actor's enrollment (team id, sync status)
 *   GET /v1/cloud/agent-gateway/state?surface=local
 *        -> the rendered state.json v2 document carrying the actor's OWN gateway
 *           virtual key + inference base url, per harness (server/proliferate/
 *           server/cloud/agent_gateway/api.py:get_agent_auth_state_endpoint).
 *
 * The scoped virtual key's `token_id` (the LiteLLM key-hash used to correlate
 * spend rows) is deliberately NOT exposed over HTTP — the enrollment payload
 * omits it and the state doc carries only the raw key. `token_id` is read from
 * the enrollment row through the DB probe (`spend.ts`), never printed. LiteLLM
 * admin/master credentials stay private to the server/provisioner: the runner
 * never holds them.
 */

import { ApiClient } from "../../../fixtures/http.js";

export const AGENT_GATEWAY_PREFIX = "/v1/cloud/agent-gateway";

export interface GatewayCapabilities {
  gatewayEnabled: boolean;
  publicBaseUrl: string | null;
  enrollmentStatus: string;
}

export interface GatewayEnrollment {
  id: string;
  subjectKind: string;
  litellmTeamId: string | null;
  syncStatus: string;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentAuthStateSource {
  kind: string;
  base_url?: string | null;
  key?: string | null;
  env_var_name?: string | null;
  value?: string | null;
}

export interface AgentAuthStateHarness {
  harness_kind: string;
  sources: AgentAuthStateSource[];
  settings?: Record<string, unknown> | null;
}

export interface AgentAuthState {
  version: number;
  revision: number;
  user_id?: string | null;
  harnesses: AgentAuthStateHarness[];
}

export async function getGatewayCapabilities(client: ApiClient): Promise<GatewayCapabilities> {
  return client.get<GatewayCapabilities>(`${AGENT_GATEWAY_PREFIX}/capabilities`);
}

export async function getGatewayEnrollment(client: ApiClient): Promise<GatewayEnrollment> {
  return client.get<GatewayEnrollment>(`${AGENT_GATEWAY_PREFIX}/enrollment`);
}

/**
 * Select the managed-gateway route for a harness on a surface through the
 * production selection path (`PUT /agent-gateway/selections/{harness}`), exactly
 * as the Desktop settings UI does. The state renderer only emits a gateway
 * `source` for a harness that has an ENABLED gateway selection, so this is the
 * "select managed gateway" action of LOCAL-2 (contract step 4). Idempotent:
 * replaces the scope's desired set with a single enabled gateway source.
 */
export async function enableGatewaySelection(
  client: ApiClient,
  harness: string,
  surface = "local",
): Promise<void> {
  await client.put(
    `${AGENT_GATEWAY_PREFIX}/selections/${harness}?surface=${surface}`,
    { sources: [{ sourceKind: "gateway", enabled: true }] },
  );
}

/**
 * Enrollment is scheduled fire-and-forget on signup/join and completed by the
 * backfill worker; the gateway key is only handed out once it is `synced`. Poll
 * the production enrollment endpoint until it reports synced (or throw on
 * timeout) so the state fetch does not race an unsynced enrollment.
 */
export async function waitForEnrollmentSynced(
  client: ApiClient,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<GatewayEnrollment> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollMs = options.pollMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let last: GatewayEnrollment | undefined;
  for (;;) {
    last = await getGatewayEnrollment(client).catch(() => undefined);
    if (last && last.syncStatus === "synced") {
      return last;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `gateway enrollment did not reach synced within ${timeoutMs}ms ` +
          `(last=${last?.syncStatus ?? "none"}${last?.lastErrorCode ? `, error=${last.lastErrorCode}` : ""})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** The local-surface state.json v2 document (raw gateway key material for the caller). */
export async function getLocalGatewayAuthState(client: ApiClient): Promise<AgentAuthState> {
  return client.get<AgentAuthState>(`${AGENT_GATEWAY_PREFIX}/state?surface=local`);
}

/**
 * Push a server-rendered state.json v2 document to the LOCAL AnyHarness runtime
 * (`PUT /v1/agent-auth/state`) exactly as the Desktop dispatch worker does after
 * fetching `surface=local`. The document is forwarded VERBATIM — the raw gateway
 * key inside it is the actor's own credential and is never logged or redacted
 * away here (redaction happens at the evidence boundary). This is the production
 * materialization path, distinct from `fixtures/agent-auth.ts`'s
 * `pushGatewayAuthState`, which composes a document from a shared env test key.
 */
export async function pushAgentAuthStateToRuntime(
  runtimeUrl: string,
  document: AgentAuthState,
): Promise<void> {
  const response = await fetch(`${runtimeUrl.replace(/\/+$/, "")}/v1/agent-auth/state`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(document),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PUT /v1/agent-auth/state -> ${response.status}: ${body}`);
  }
}

export interface GatewaySource {
  harnessKind: string;
  baseUrl: string;
  key: string;
}

/**
 * Extract the gateway (managed-LiteLLM) source for `harness` from a state doc.
 * Returns undefined when the harness has no gateway source (e.g. the gateway is
 * disabled, or the actor selected a user-key route). The key is secret and must
 * be redacted from any evidence.
 */
export function gatewaySourceForHarness(
  state: AgentAuthState,
  harness: string,
): GatewaySource | undefined {
  const harnessState = state.harnesses.find((h) => h.harness_kind === harness);
  if (!harnessState) {
    return undefined;
  }
  const source = harnessState.sources.find(
    (s) => s.kind === "gateway" && Boolean(s.base_url) && Boolean(s.key),
  );
  if (!source || !source.base_url || !source.key) {
    return undefined;
  }
  return { harnessKind: harness, baseUrl: source.base_url, key: source.key };
}
