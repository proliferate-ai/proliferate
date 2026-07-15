import { ApiClient } from "./http.js";
import type { ReadySelfHostWorld } from "../worlds/selfhost/world.js";
import type { SelfHostOwnerActor } from "./selfhost-actor.js";
import type { ProductPage } from "./product-page.js";

/**
 * The BYOK selection driver (frozen spec decision 6, cell `SH-BASE-TURN`). The
 * owner stores a run-scoped raw provider key through the product and selects it
 * for the harness on the LOCAL surface; the Desktop renderer (NOT this fixture)
 * fetches the rendered state (`GET /state?surface=local`) and pushes it into the
 * controller-local candidate AnyHarness, which spawns the harness with the raw
 * key. No LiteLLM/E2B is involved — BYOK is a direct-provider call.
 *
 *   POST /v1/cloud/agent-gateway/keys            { title, value: <rawKey> } -> { id }
 *   PUT  /v1/cloud/agent-gateway/selections/{harness}?surface=local
 *          { sources: [{ sourceKind: "api_key", apiKeyId, envVarName, enabled: true }] }
 *   GET  /v1/cloud/agent-gateway/state?surface=local   (Desktop fetches + pushes)
 *
 * The raw provider key and setup token are NEVER stored in evidence — only a
 * hash of the created key id is (stamped by workstream D). `envVarName` defaults
 * to `ANTHROPIC_API_KEY`.
 *
 * SH-BASE-TURN's live turn is blocked on a real BYOK key (the local
 * qualification file's `RELEASE_E2E_BYOK_ANTHROPIC_A/B_API_KEY` are placeholders
 * that 401). `preflightByokKey` MUST run before storing/selecting; if it rejects
 * the key, the `SH-BASE-TURN` cell fails closed HONESTLY (status `failed`, not
 * blocked/skipped) — never a false green. This fixture never pushes AnyHarness
 * state itself.
 */

export const DEFAULT_BYOK_ENV_VAR = "ANTHROPIC_API_KEY";

/** Bounded default for the provider preflight call and the desktop-sync poll. */
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 15_000;
// The claude ACP agent builds from git on first install, so becoming launchable
// (installed + Desktop's api_key push probed) is generously bounded — mirrors
// LOCAL-WORLD-SMOKE-1's HARNESS_READY_TIMEOUT_MS.
const DEFAULT_SYNC_TIMEOUT_MS = 300_000;
const DEFAULT_SYNC_POLL_MS = 2_000;

/** Anthropic's list-models endpoint — a bounded, side-effect-free authenticated GET. */
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1";
const ANTHROPIC_VERSION = "2023-06-01";

export interface ByokPreflightResult {
  ok: boolean;
  /** Bounded, secret-free reason on rejection (e.g. "provider returned 401 on /models"). */
  reason?: string;
}

export interface ByokSelection {
  /** Server-side id of the stored key (raw key value never returned/stored). */
  apiKeyId: string;
  harnessKind: string;
  envVarName: string;
}

/**
 * The bounded, side-effect-free provider check, factored out so unit tests run
 * OFFLINE (no real Anthropic call). Returns only a status code — never the raw
 * key or the response body.
 */
export interface ByokPreflightProbe {
  checkKey(rawKey: string, timeoutMs: number): Promise<{ status: number }>;
}

export const defaultByokPreflightProbe: ByokPreflightProbe = {
  async checkKey(rawKey, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(ANTHROPIC_MODELS_URL, {
        method: "GET",
        headers: {
          // The raw key is sent only in the request header, never logged/returned.
          "x-api-key": rawKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        signal: controller.signal,
      });
      return { status: response.status };
    } finally {
      clearTimeout(timer);
    }
  },
};

/**
 * Fail-closed preflight: verifies the raw provider key can make a bounded,
 * side-effect-free authenticated call (list models) BEFORE it is stored or
 * selected. Never logs/stores/returns the key. Returns `ok:false` (never throws
 * the raw key) when the provider rejects it or the call cannot complete.
 */
export async function preflightByokKey(
  rawKey: string,
  options: { timeoutMs?: number } = {},
  probe: ByokPreflightProbe = defaultByokPreflightProbe,
): Promise<ByokPreflightResult> {
  if (typeof rawKey !== "string" || rawKey.trim().length === 0) {
    return { ok: false, reason: "no BYOK provider key configured" };
  }
  let status: number;
  try {
    ({ status } = await probe.checkKey(rawKey, options.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS));
  } catch (error) {
    // Scrub to a bounded, secret-free reason; never surface a message that could
    // echo the key back.
    const name = error instanceof Error ? error.name : "unknown";
    return { ok: false, reason: `provider preflight call failed (${name})` };
  }
  if (status === 200) {
    return { ok: true };
  }
  return { ok: false, reason: `provider returned ${status} on /models` };
}

/**
 * The product-API side effects of storing + selecting the key, factored out so
 * unit tests can assert the exact wire shape without a real Server.
 */
export interface ByokStoreTransport {
  createKey(api: ApiClient, body: { title: string; value: string }): Promise<{ id: string }>;
  putSelection(
    api: ApiClient,
    harnessKind: string,
    body: { sources: Array<{ sourceKind: "api_key"; apiKeyId: string; envVarName: string; enabled: true }> },
  ): Promise<void>;
}

export const defaultByokStoreTransport: ByokStoreTransport = {
  async createKey(api, body) {
    return api.post<{ id: string }>("/v1/cloud/agent-gateway/keys", body);
  },
  async putSelection(api, harnessKind, body) {
    await api.put(`/v1/cloud/agent-gateway/selections/${encodeURIComponent(harnessKind)}?surface=local`, body);
  },
};

/**
 * Stores the raw key through the product (`POST /keys`) and selects it for the
 * harness on the local surface (`PUT /selections/{harness}?surface=local`,
 * `sourceKind:"api_key"`). Returns the selection (key id + env var); the raw
 * value stays only in the request body.
 */
export async function storeAndSelectByokKey(
  owner: SelfHostOwnerActor,
  params: { rawKey: string; harnessKind: string; envVarName?: string; title?: string },
  transport: ByokStoreTransport = defaultByokStoreTransport,
): Promise<ByokSelection> {
  const envVarName = params.envVarName ?? DEFAULT_BYOK_ENV_VAR;
  const title = params.title ?? `selfhost-byok-${params.harnessKind}`;

  const created = await transport.createKey(owner.api, { title, value: params.rawKey });
  if (!created.id) {
    throw new Error("storeAndSelectByokKey: POST /keys returned no key id.");
  }

  await transport.putSelection(owner.api, params.harnessKind, {
    sources: [{ sourceKind: "api_key", apiKeyId: created.id, envVarName, enabled: true }],
  });

  return { apiKeyId: created.id, harnessKind: params.harnessKind, envVarName };
}

export interface WaitForDesktopByokSyncOptions {
  timeoutMs?: number;
  pollMs?: number;
  /**
   * Reads the controller-local AnyHarness launch options (the observable result
   * of Desktop pushing the api_key source into the runtime). Defaults to the
   * world's runtime client so unit tests can inject a fake.
   */
  readLaunchOptions?: () => Promise<Array<{ kind: string; models: Array<{ id: string }> }>>;
  /** Reads an agent's install/readiness (default: the world runtime client). */
  readAgent?: (kind: string) => Promise<{ installState: string; readiness: string }>;
  /** Triggers a one-shot agent install (default: the world runtime client). */
  installAgent?: (kind: string) => Promise<unknown>;
}

/**
 * Waits (bounded) until the Desktop renderer has fetched `GET /state?surface=local`
 * and pushed the api_key source into the controller-local candidate AnyHarness —
 * observed as the selected harness becoming LAUNCHABLE in the runtime (a
 * non-empty `models` list on `GET /v1/agents/launch-options`). The world scrubs
 * all ambient provider/gateway keys, so the ONLY way the harness becomes
 * launchable is the api_key push — observing launchability IS observing the
 * BYOK sync. Fixtures NEVER push AnyHarness state directly; this only reads the
 * runtime's resulting state. Fails closed if the sync never lands.
 *
 * `page` is the isolated Desktop renderer that performs the push; it is passed
 * for interface fidelity (the pusher), while this fixture waits on the runtime.
 */
export async function waitForDesktopByokSync(
  world: ReadySelfHostWorld,
  page: ProductPage,
  selection: ByokSelection,
  options: WaitForDesktopByokSyncOptions = {},
): Promise<void> {
  void page;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_SYNC_POLL_MS;
  const readLaunchOptions = options.readLaunchOptions ?? (() => world.runtime.client.getAgentLaunchOptions());
  const readAgent = options.readAgent ?? (async (kind) => world.runtime.client.getAgent(kind));
  const installAgent = options.installAgent ?? (async (kind) => world.runtime.client.installAgent(kind));

  const deadline = Date.now() + timeoutMs;
  let lastNote = "no launch options observed yet";
  // Launchability requires BOTH the api_key source Desktop pushed AND the agent
  // binary being installed. The candidate AnyHarness starts with no agents
  // installed, and Desktop does not reliably auto-install, so — exactly as
  // LOCAL-WORLD-SMOKE-1's ensureHarnessReady does — trigger the install once.
  // This installs the agent binary; it never pushes the BYOK auth state (that
  // stays Desktop's job, observed via launchability).
  let triggeredInstall = false;
  for (;;) {
    try {
      const agents = await readLaunchOptions();
      const entry = agents.find((agent) => agent.kind === selection.harnessKind);
      if (entry && entry.models.length > 0) {
        return;
      }
      lastNote = entry
        ? `harness "${selection.harnessKind}" present but has no launchable models yet`
        : `harness "${selection.harnessKind}" not yet in launch options`;
      if (!triggeredInstall) {
        const agent = await readAgent(selection.harnessKind).catch(() => undefined);
        if (agent && agent.installState !== "installing" && (agent.readiness === "install_required" || agent.installState === "not_installed")) {
          triggeredInstall = true;
          await installAgent(selection.harnessKind).catch(() => undefined);
        }
      }
    } catch (error) {
      lastNote = `launch-options read failed: ${error instanceof Error ? error.name : "unknown"}`;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForDesktopByokSync: Desktop did not push the api_key source for "${selection.harnessKind}" into ` +
          `the controller-local AnyHarness within ${timeoutMs}ms (last: ${lastNote}).`,
      );
    }
    await sleep(pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
