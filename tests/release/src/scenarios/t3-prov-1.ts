import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioExpectedFailError } from "./types.js";
import { mintFreshUser } from "../fixtures/identity.js";

/**
 * T3-PROV-1 — provision: new user (cold path).
 * specs/developing/testing/scenarios.md#T3-PROV-1
 *
 * Trigger-under-test ruling: the real GitHub App authorization callback.
 * Real attempt made 2026-07-08: infeasible on a dedicated `t3local` profile
 * — `specs/developing/local/feature-worktree-auth.md` Layer C is explicit
 * that "the dev GitHub app's callback URL is registered against main's
 * port; it will not work" for any other profile, and there is no
 * test-only registration escape hatch for a real GitHub authorize redirect
 * either. Using the contract's sanctioned fallback instead: "invoke the
 * exact post-authorization service call the callback makes" —
 * `tests/release/scripts/prov1_fallback.py` calls
 * `ensure_personal_cloud_sandbox_exists` + the real materializer in-process
 * (never a faked GitHub — see that file's docstring for why this also
 * legitimately bypasses the separately-tracked `current_product_user` gate,
 * since that dependency lives in FastAPI route wiring, not the service
 * functions themselves).
 *
 * Verified for real against a running `t3local` profile, 2026-07-08: this
 * produced a genuine E2B sandbox (`https://<id>.e2b.app`), reachable and
 * returning real per-agent install status from inside it. One real product
 * finding surfaced in that run, filed as
 * https://github.com/proliferate-ai/proliferate/issues/1026: the
 * materializer logged a `CloudApiError: Connect the Proliferate GitHub App
 * before using GitHub Cloud repos.` for a password-only user even on the
 * *personal* (non-repo) sandbox path — non-fatal (the sandbox still reached
 * ready), but worth its own look.
 */
export const t3Prov1: ScenarioDefinition = {
  id: "T3-PROV-1",
  title: "provision — new user (cold path)",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-PROV-1",
  lanes: ["sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ],
  plan: () => [
    { description: "mint a fresh user via T3-FIXTURE (invite + password register + login)" },
    {
      description:
        "fallback seam (real GitHub App OAuth redirect infeasible on a feature profile): invoke " +
        "ensure_personal_cloud_sandbox_exists + materialize_sandbox in-process for the fresh user " +
        "(tests/release/scripts/prov1_fallback.py)",
    },
    { description: "poll sandbox status until ready (budget: p95 <=5min fail, warn at 3min)" },
    { description: "connect to the workspace's real AnyHarness runtime and probe GET /v1/agents" },
    { description: "assert ready within budget and a real agent status list comes back" },
    { description: "teardown: destroy the fresh user's sandbox + remove their org membership" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    const durableCreds = {
      serverUrl,
      email: ctx.env.require("RELEASE_E2E_DURABLE_USER_EMAIL"),
      password: ctx.env.require("RELEASE_E2E_DURABLE_USER_PASSWORD"),
      organizationId: ctx.env.require("RELEASE_E2E_DURABLE_ORG_ID"),
    };
    const fresh = await mintFreshUser(durableCreds);
    try {
      const result = await runFallbackScript(fresh.email, { mode: "provision", pollTimeoutSeconds: 300 });
      // The scenario's actual assertion surface (per scenarios.md#T3-PROV-1)
      // is "ready within budget; connect and run one shell command" — here,
      // "reached status=ready" + "a real per-agent status list comes back
      // from inside it" (the closest equivalent this fallback path can
      // reach). `result.error` can be a *non-fatal* warning surfaced by the
      // materializer even when the sandbox is fully ready and reachable —
      // found running this for real 2026-07-08 (see the file-level doc
      // comment on the CloudApiError finding) — so it is logged, not treated
      // as a hard failure, as long as readiness + the probe both succeeded.
      const readyAndReachable = result.status === "ready" && Array.isArray(result.agentsProbe);
      if (result.error && !readyAndReachable) {
        throw new ScenarioExpectedFailError(
          `T3-PROV-1: fallback provisioning failed: ${result.error} ` +
            `(sandboxId=${result.sandboxId}, status=${result.status})`,
        );
      }
      if (result.error) {
        console.warn(`[T3-PROV-1] non-fatal warning from the materializer (sandbox still reached ready): ${result.error}`);
      }
      assert.equal(result.status, "ready", "T3-PROV-1: sandbox must reach status=ready");
      assert.ok(result.anyharnessBaseUrl, "T3-PROV-1: sandbox must expose a runtime base URL");
      assert.ok(Array.isArray(result.agentsProbe), "T3-PROV-1: GET /v1/agents probe must return the agent list");
      assert.ok((result.agentsProbe as unknown[]).length > 0, "T3-PROV-1: agent list must be non-empty");
      console.log(
        `[T3-PROV-1] sandbox ready in ${result.readyWithinSeconds}s (warn budget: 180s, fail budget: 300s) — ` +
          `${(result.agentsProbe as unknown[]).length} agents reported`,
      );
      if (typeof result.readyWithinSeconds === "number" && result.readyWithinSeconds > 180) {
        console.warn(`[T3-PROV-1] readiness exceeded the 180s warn budget (${result.readyWithinSeconds}s)`);
      }
    } finally {
      await runFallbackScript(fresh.email, { mode: "teardown" }).catch((error) =>
        console.warn(`[T3-PROV-1] sandbox teardown best-effort failed: ${String(error)}`),
      );
      await fresh.teardown().catch((error) => console.warn(`[T3-PROV-1] membership teardown best-effort failed: ${String(error)}`));
    }
  },
};

interface FallbackResult {
  sandboxId: string | null;
  status: string | null;
  anyharnessBaseUrl: string | null;
  readyWithinSeconds: number | null;
  agentsProbe: unknown;
  error: string | null;
}

async function runFallbackScript(
  email: string,
  options: { mode: "provision"; pollTimeoutSeconds: number } | { mode: "teardown" },
): Promise<FallbackResult> {
  const databaseUrl = process.env.RELEASE_E2E_LOCAL_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "T3-PROV-1: RELEASE_E2E_LOCAL_DATABASE_URL is required for the fallback seam " +
        "(see src/config/env-manifest.ts) — e.g. " +
        "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5432/proliferate_dev_<profile>",
    );
  }
  const scriptPath = path.resolve(import.meta.dirname, "../../scripts/prov1_fallback.py");
  const serverDir = path.resolve(import.meta.dirname, "../../../../server");
  const args =
    options.mode === "provision"
      ? [scriptPath, email, "--poll-timeout-seconds", String(options.pollTimeoutSeconds)]
      : [scriptPath, email, "--teardown"];

  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "python", ...args], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`prov1_fallback.py (${options.mode}) exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const lastLine = stdout.trim().split("\n").pop() ?? "{}";
        resolve(JSON.parse(lastLine) as FallbackResult);
      } catch (error) {
        reject(new Error(`prov1_fallback.py (${options.mode}) did not print valid JSON: ${stdout}\n${error}`));
      }
    });
  });
}
