/**
 * Product-flow helpers shared by the sandbox-lane scenarios (T3-PROV-2,
 * T3-SEC-MAT-1) for driving/observing a personal cloud sandbox purely
 * through the real server API -- no DB, no E2B SDK. The E2B-direct backdoor
 * (pause + in-sandbox ground-truth reads) lives in `e2b-verify.ts`.
 *
 * `GET /v1/gateway/cloud-sandbox/anyharness/{path}` is the server's real
 * proxy into the sandbox's own AnyHarness runtime
 * (server/proliferate/server/cloud/gateway/api.py, mounted at
 * `{api_prefix}/v1/gateway` in server/proliferate/main.py -- NOT
 * `/v1/cloud/cloud-sandbox/anyharness/*`, which several pre-existing doc
 * comments elsewhere in this package assume; verified for real against
 * t3local 2026-07-09, that path 404s) -- the same route the desktop app
 * uses. `probeAgentsThroughGateway` calls its workspace-free
 * `GET /v1/agents` for a real exec/connectivity proof-of-life, matching the
 * pattern T3-PROV-1 already established (its `agentsProbe` assertion).
 */

import { ApiClient, ApiRequestError } from "./http.js";
import { ScenarioBlockedError } from "../scenarios/types.js";

export interface CloudSandboxStatus {
  id: string;
  status: string;
  lastError: string | null;
  readyAt: string | null;
}

export interface AgentSummary {
  kind: string;
  [key: string]: unknown;
}

export async function getCloudSandbox(client: ApiClient): Promise<CloudSandboxStatus | null> {
  return client.get<CloudSandboxStatus | null>("/v1/cloud/cloud-sandbox");
}

export async function ensureCloudSandboxRow(client: ApiClient): Promise<CloudSandboxStatus> {
  return client.post<CloudSandboxStatus>("/v1/cloud/cloud-sandbox/ensure", {});
}

export async function wakeCloudSandbox(client: ApiClient): Promise<CloudSandboxStatus> {
  return client.post<CloudSandboxStatus>("/v1/cloud/cloud-sandbox/wake", {});
}

/** Real exec/connectivity proof-of-life via the server's anyharness proxy -- no sandbox workspace required. */
export async function probeAgentsThroughGateway(client: ApiClient): Promise<AgentSummary[]> {
  return client.get<AgentSummary[]>("/v1/gateway/cloud-sandbox/anyharness/v1/agents");
}

export async function pollCloudSandboxStatus(
  client: ApiClient,
  predicate: (status: CloudSandboxStatus | null) => boolean,
  options: { timeoutMs: number; pollMs?: number } = { timeoutMs: 60_000 },
): Promise<CloudSandboxStatus | null> {
  const pollMs = options.pollMs ?? 2000;
  const deadline = Date.now() + options.timeoutMs;
  let last = await getCloudSandbox(client);
  while (!predicate(last) && Date.now() < deadline) {
    await sleep(pollMs);
    last = await getCloudSandbox(client);
  }
  return last;
}

/**
 * Forces the durable user's personal cloud sandbox through a REAL, full
 * materialization pass (E2B create/resume + AnyHarness launch), for
 * identities whose sandbox has never been touched before (e.g. a
 * freshly-provisioned staging durable user).
 *
 * `POST /cloud-sandbox/ensure` and `/wake`
 * (server/proliferate/server/cloud/cloud_sandboxes/service.py) only ensure
 * the DB row exists -- neither calls into `connect_ready_sandbox` (the
 * function that actually talks to E2B and launches AnyHarness; see
 * server/proliferate/server/cloud/materialization/sandbox_io/connect.py).
 * The real trigger for a full connect is `run_cloud_sandbox_operation`
 * (server/proliferate/server/cloud/materialization/operation.py), which a
 * secret PUT schedules via `materialize_secret_set`
 * (.../materialize/secret_set.py). PUTting a harmless personal env-var
 * secret is therefore the real, product-sanctioned lever to force a cold
 * sandbox to fully materialize -- not a bypass, the same trigger a real user
 * setting their first secret would hit.
 */
export async function warmPersonalCloudSandbox(
  client: ApiClient,
  options: { timeoutMs: number } = { timeoutMs: 180_000 },
): Promise<CloudSandboxStatus> {
  const existing = await getCloudSandbox(client);
  if (existing === null) {
    await ensureCloudSandboxRow(client);
  }
  await client.put<{ materialization: { status: string } }>(
    `/v1/cloud/secrets/personal/env-vars/T3_WARMUP_PING`,
    { value: String(Date.now()) },
  );
  const ready = await pollCloudSandboxStatus(client, (status) => status?.status === "ready", {
    timeoutMs: options.timeoutMs,
  });
  if (!ready || ready.status !== "ready") {
    throw new Error(
      `warmPersonalCloudSandbox: sandbox did not reach status=ready within ${options.timeoutMs}ms ` +
        `(last observed: ${JSON.stringify(ready)}).`,
    );
  }
  return ready;
}

/**
 * True for the 402 `billing_credits_exhausted` the LIVE billing gate raises
 * (`assert_cloud_sandbox_resume_allowed_for_owner`,
 * server/proliferate/server/billing/authorization.py) when an owner's org
 * has zero remaining included sandbox seconds. Verified for real 2026-07-09:
 * staging's `e2e-tests` durable org currently has `remaining_seconds: 0`,
 * which 402s `POST /cloud-sandbox/ensure` before a sandbox can even be
 * created for the first time. This is a fixture/ops credits-provisioning gap
 * (the org needs a grant), not a product bug and not a scenario bug -- treat
 * it as a known, reportable gate the same way `withProductGate` treats
 * `github_link_required`.
 */
export function isBillingCreditsExhaustedError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError) || error.status !== 402) {
    return false;
  }
  if (typeof error.body !== "object" || error.body === null) {
    return false;
  }
  const body = error.body as { code?: unknown; detail?: { code?: unknown } };
  return body.code === "billing_credits_exhausted" || body.detail?.code === "billing_credits_exhausted";
}

/** Wraps a scenario body that touches the cloud-sandbox billing gate; see `isBillingCreditsExhaustedError`. */
export async function withCloudSandboxBillingGate<T>(scenarioId: string, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isBillingCreditsExhaustedError(error)) {
      throw new ScenarioBlockedError(
        `${scenarioId}: the durable identity's organization has zero remaining included sandbox seconds ` +
          "(billing_credits_exhausted, remaining_seconds=0) -- a fixture/ops credits-provisioning gap on the " +
          "target deployment, not a product or scenario bug. Grant the e2e-tests org a cloud-sandbox credit " +
          "top-up (or enroll it on a plan with included hours) to unblock every sandbox-lane T3 scenario.",
      );
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
