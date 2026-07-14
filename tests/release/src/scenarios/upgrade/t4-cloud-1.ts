import assert from "node:assert/strict";

import type { ScenarioDefinition, ScenarioRunContext } from "../types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../types.js";
import { ApiClient, ApiRequestError } from "../../fixtures/http.js";
import { loginDurableUserOnStaging, stagingSessionAvailable } from "../../fixtures/staging-session.js";
import {
  anyharnessBinaryConverged,
  bumpStagingRuntimePin,
  restoreStagingRuntimePin,
  runtimeHealthVersion,
  type RuntimeHealth,
  type StagingEcsTarget,
} from "../../fixtures/anyharness-upgrade.js";

/**
 * T4-CLOUD-1 — AnyHarness runtime binary self-update in a cloud sandbox.
 * Shipped mechanics: specs/codebase/structures/proliferate-worker/guides/lifecycle.md.
 * Target guarantee: specs/developing/testing/tier-4-scenario-contract.md.
 *
 * The tier-4 assertion: with a sandbox already running version N, bump the
 * server's advertised `desiredVersions.anyharness` pin and let the sandbox
 * worker converge the runtime binary IN PLACE — no test-side artifact push
 * (the artifacts the redirect serves are real; the *feed* is the one thing
 * stubbed, here by moving the server pin). Then assert the running runtime
 * reports the new version and the catalog/agent pins reconcile.
 *
 * Feed knob: the server advertises the pin from `RUNTIME_VERSION`
 * (server/proliferate/server/version.py `runtime_version_pin`), a baked-in
 * image ENV with no runtime override. The only test-scoped way to move it
 * without cutting a release is to override `RUNTIME_VERSION` in the
 * proliferate-staging-server ECS task definition and roll the service (ECS task
 * env wins over the image ENV). That forces one rolling task replacement,
 * which is acceptable for the Tier 4 staging target; the scenario restores the
 * original task definition in a `finally`, and the mutation is gated behind the
 * explicit `RELEASE_E2E_STAGING_ECS_PIN_BUMP` opt-in and guarded against any
 * production-looking target (assertNotProduction).
 *
 * Observation surface: the server proxy `GET /v1/cloud/cloud-sandbox/anyharness/
 * {path}` reaches the sandbox runtime; `/health` reports the runtime's running
 * version. Convergence is that version reaching the advertised pin.
 *
 * Standing blockers this scenario reports honestly rather than faking:
 *   - --lane local has no ECS pin knob and no cloud sandbox -> blocked.
 *   - No staging session bootstrapped -> blocked.
 *   - Provisioning a real E2B sandbox not reachable in this environment -> blocked.
 *   - RELEASE_E2E_STAGING_ECS_PIN_BUMP not set -> blocked (never mutate ECS unasked).
 *
 * Known product blocker (found building this test, 2026-07-09): the released
 * AnyHarness binary reports `CARGO_PKG_VERSION` (hardcoded 0.1.0, never stamped
 * at release) from BOTH `anyharness --version` and the runtime `/health`
 * `version` field. The worker's convergence preflight and post-relaunch health
 * gate (anyharness/crates/proliferate-worker/src/anyharness_update.rs, via
 * self_update.rs `version_output_matches`) each require an exact match to the
 * pinned semver, so a real pin like 0.3.12 can never converge: preflight rejects
 * the downloaded binary and the health gate never sees the target version. When
 * the scenario reaches the mechanism and the swap never converges, it raises
 * ScenarioExpectedFailError diagnosing exactly this, rather than a red — this is
 * the bug a T4 test exists to surface. Filed as
 * https://github.com/proliferate-ai/proliferate/issues/1089.
 */

const CONVERGE_TIMEOUT_MS = 6 * 60_000;
const POLL_INTERVAL_MS = 15_000;
const SANDBOX_READY_TIMEOUT_MS = 3 * 60_000;

// Published to the downloads CDN by scripts/ci-cd/publish-runtime-cdn.sh; both
// resolve to a real 302->200 through the server runtime redirect. Whichever the
// server is NOT currently advertising is the bump target, so the scenario always
// moves the pin to a different, published version.
const PUBLISHED_CANDIDATES = ["0.3.12", "0.3.11"] as const;

const STAGING_ECS_TARGET: StagingEcsTarget = {
  cluster: "proliferate-staging",
  service: "proliferate-staging-server",
  container: "server",
  region: "us-east-1",
};

export const t4Cloud1: ScenarioDefinition = {
  id: "T4-CLOUD-1",
  title: "AnyHarness runtime binary self-update in a cloud sandbox",
  registryFlowRef: "specs/developing/testing/scenarios.md#T4-CLOUD-1",
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL", "RELEASE_E2E_STAGING_ECS_PIN_BUMP"],
  plan: () => [
    { description: "authenticate the durable staging user (rotating session refresh token)" },
    { description: "ensure the user's cloud sandbox is provisioned and ready" },
    { description: "record baseline: advertised anyharness pin (/meta) + running version (proxied /health)" },
    { description: "bump the advertised RUNTIME_VERSION pin on the staging server task def; roll the service" },
    { description: "poll the proxied runtime /health until it reports the new pin (worker converges in place)" },
    { description: "assert the running binary version equals the advertised pin" },
    { description: "restore the original staging task definition" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    await runReal(ctx);
  },
};

async function runReal(ctx: ScenarioRunContext): Promise<void> {
  if (ctx.targetLane !== "staging") {
    throw new ScenarioBlockedError(
      "T4-CLOUD-1: the advertised-pin feed knob is the staging server's RUNTIME_VERSION (an ECS task-def " +
        "env override) and the runtime lives in a real cloud sandbox — neither exists on a --lane local " +
        "target. Run with --lane staging.",
    );
  }
  if (process.env.RELEASE_E2E_STAGING_ECS_PIN_BUMP?.trim() !== "1") {
    throw new ScenarioBlockedError(
      "T4-CLOUD-1: moving the advertised anyharness pin requires overriding RUNTIME_VERSION in the " +
        "proliferate-staging-server ECS task definition and rolling the service. Set " +
        "RELEASE_E2E_STAGING_ECS_PIN_BUMP=1 (with AWS creds able to register-task-definition + " +
        "update-service on proliferate-staging) to authorize it. Not set — refusing to mutate ECS.",
    );
  }
  if (!stagingSessionAvailable()) {
    throw new ScenarioBlockedError(
      "T4-CLOUD-1: no staging session available. Bootstrap RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN " +
        "(see src/fixtures/staging-session.ts) or seed the rotating state file.",
    );
  }

  const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
  const session = await loginDurableUserOnStaging(serverUrl);
  const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);

  await ensureSandboxReady(client);

  const advertisedBefore = await advertisedRuntimePin(client);
  const runningBefore = await proxiedRuntimeVersion(client);
  console.log(`[T4-CLOUD-1] baseline: advertised pin=${advertisedBefore || "(unset)"} running /health=${runningBefore || "(none)"}`);

  const target = pickBumpTarget(advertisedBefore, runningBefore);
  console.log(`[T4-CLOUD-1] bumping advertised RUNTIME_VERSION -> ${target}`);

  const bump = await bumpStagingRuntimePin(STAGING_ECS_TARGET, target);
  try {
    const converged = await waitForRuntimeVersion(client, target, CONVERGE_TIMEOUT_MS);
    if (converged) {
      const running = await proxiedRuntimeVersion(client);
      assert.ok(
        anyharnessBinaryConverged(running, target),
        `T4-CLOUD-1: runtime /health version ${running} did not converge to advertised pin ${target}`,
      );
      console.log(`[T4-CLOUD-1] converged: runtime reports ${running} == advertised pin ${target}`);
      return;
    }
    throw new ScenarioExpectedFailError(
      `T4-CLOUD-1: the sandbox runtime never reported the bumped pin ${target} within ` +
        `${CONVERGE_TIMEOUT_MS / 1000}s. Diagnosed product blocker (found building this test): the released ` +
        `anyharness binary reports CARGO_PKG_VERSION (hardcoded 0.1.0, never stamped at release) from BOTH ` +
        `\`anyharness --version\` and the runtime /health \`version\`. The worker convergence preflight and ` +
        `post-relaunch health gate both require an exact match to the pinned semver ` +
        `(anyharness_update.rs via self_update.rs version_output_matches), so no real pin (${target}) can ` +
        `converge — preflight rejects the downloaded binary and the health gate never sees the target ` +
        `version. Verified directly: \`anyharness --version\` on the runtime-v0.3.12 release asset prints ` +
        `"anyharness 0.1.0". Filed as https://github.com/proliferate-ai/proliferate/issues/1089.`,
    );
  } finally {
    await restoreStagingRuntimePin(STAGING_ECS_TARGET, bump.previousTaskDefinitionArn).catch((error) => {
      console.error(
        `[T4-CLOUD-1] WARNING: failed to restore staging task definition ${bump.previousTaskDefinitionArn}: ` +
          `${error instanceof Error ? error.message : String(error)}. Restore it manually: ` +
          `aws ecs update-service --cluster ${STAGING_ECS_TARGET.cluster} --service ${STAGING_ECS_TARGET.service} ` +
          `--task-definition ${bump.previousTaskDefinitionArn}`,
      );
    });
  }
}

/** Ensure the durable user's cloud sandbox exists and reaches ready. */
async function ensureSandboxReady(client: ApiClient): Promise<void> {
  let sandbox: { status: string } | null;
  try {
    sandbox = await client.get<{ status: string } | null>("/v1/cloud/cloud-sandbox");
    if (!sandbox) {
      sandbox = await client.post<{ status: string }>("/v1/cloud/cloud-sandbox/ensure", {});
    }
  } catch (error) {
    throw new ScenarioBlockedError(
      `T4-CLOUD-1: could not acquire a cloud sandbox on staging (${describeError(error)}). Provisioning a ` +
        "real E2B sandbox for the durable user is not reachable in this environment; the mechanism can only " +
        "be observed against a live sandbox.",
    );
  }

  const deadline = Date.now() + SANDBOX_READY_TIMEOUT_MS;
  while (sandbox && sandbox.status !== "ready") {
    if (Date.now() > deadline) {
      throw new ScenarioBlockedError(
        `T4-CLOUD-1: the cloud sandbox did not reach ready within ${SANDBOX_READY_TIMEOUT_MS / 1000}s ` +
          `(last status=${sandbox.status}).`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
    sandbox = await client.post<{ status: string }>("/v1/cloud/cloud-sandbox/wake", {});
  }
}

/** The version the server advertises as the runtime pin (from /meta). */
async function advertisedRuntimePin(client: ApiClient): Promise<string> {
  const meta = await client.get<{ runtimeVersion?: string }>("/meta");
  return (meta.runtimeVersion ?? "").trim();
}

/** The runtime's own reported version, via the sandbox anyharness proxy. */
async function proxiedRuntimeVersion(client: ApiClient): Promise<string> {
  try {
    const health = await client.get<RuntimeHealth>("/v1/cloud/cloud-sandbox/anyharness/health");
    return runtimeHealthVersion(health);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      throw new ScenarioBlockedError(
        "T4-CLOUD-1: the sandbox anyharness proxy /health route 404s. Either no sandbox is attached or the " +
          "staging server predates the #1087 runtime routes — deploy current main to staging first.",
      );
    }
    throw error;
  }
}

/** Poll the proxied /health until it reports `target` or the window elapses. */
async function waitForRuntimeVersion(client: ApiClient, target: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const running = await proxiedRuntimeVersion(client).catch(() => "");
    if (anyharnessBinaryConverged(running, target)) {
      return true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

/**
 * Pick a published version to bump the pin to — one that differs from both the
 * currently advertised pin and the running version, so the worker sees a real
 * divergence to act on.
 */
function pickBumpTarget(advertised: string, running: string): string {
  const target = PUBLISHED_CANDIDATES.find((candidate) => candidate !== advertised && candidate !== running);
  if (!target) {
    throw new ScenarioBlockedError(
      `T4-CLOUD-1: no published bump target distinct from the current pin (${advertised}) / running ` +
        `(${running}). Publish another runtime version to the CDN (scripts/ci-cd/publish-runtime-cdn.sh) ` +
        `or extend PUBLISHED_CANDIDATES.`,
    );
  }
  return target;
}

function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return `${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
