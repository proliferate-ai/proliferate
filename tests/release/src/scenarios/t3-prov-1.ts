import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "./types.js";
import { mintFreshUser } from "../fixtures/identity.js";
import { ApiClient } from "../fixtures/http.js";
import { DEFAULT_GITHUB_TEST_REPO } from "../config/env-manifest.js";
import {
  githubAppSeedAvailable,
  isGithubAppAuthorizationRequiredError,
  runGithubAppSeed,
  type StatusResult,
  type TriggerResult,
} from "../fixtures/github-app-seed.js";

/**
 * T3-PROV-1 — provision: new user (cold path) + GitHub-App trigger contract.
 * specs/developing/testing/scenarios.md#T3-PROV-1
 *
 * Trigger-under-test ruling (Pablo, 2026-07-09): the GitHub App authorization
 * callback (`complete_github_app_user_authorization_callback`,
 * server/proliferate/server/cloud/github_app/service.py:274) is what both
 * *gates* and *kicks off* personal-sandbox provisioning. Rather than bypass
 * that gate, we seed its OUTCOME (a real user-to-server authorization + the
 * real installation cache) and then invoke the real post-callback body —
 * everything the HTTP callback does minus the browser redirect / code
 * exchange. See tests/release/scripts/github_app_seed.py.
 *
 * Two modes:
 *  - REAL-TRIGGER (githubAppSeedAvailable): seed a real App authorization, then
 *    run ensure_personal_cloud_sandbox_exists + materialize +
 *    refresh_github_app_installation_cache in-process for the fresh user, and
 *    assert (a) no sandbox existed before the callback fired, (b) the callback
 *    body kicked one off, (c) the seed yields a real installation token, and
 *    (d) a real E2B sandbox reaches ready and answers GET /v1/agents.
 *  - FALLBACK (seed creds absent): the older ensure+materialize seam
 *    (tests/release/scripts/prov1_fallback.py) — real E2B, but without the
 *    real authorization/installation half of the trigger contract.
 *
 * Negative half of the trigger contract (both modes): a fresh user WITHOUT
 * seeded App auth gets no sandbox kicked off by that path, and the App-gated
 * repo-environment endpoint 409s `github_app_authorization_required` (the same
 * gate #1043 tracks). Distinct from #1026 (a NO-github user's *materialize*
 * logs a spurious GitHub-required warning) — the negative user never
 * materializes, it only exercises the gate.
 *
 * App-credential note (t3local, 2026-07-09): the profile's configured GitHub
 * App is `proliferate-dev` (id 2486507), installed only on `pablonyx` (all
 * repos, installation 99952777) — NOT the fixture doc's `proliferate-cloud-pablo`
 * / proliferate-e2e / installation 145311006. The seeded authorization is a
 * real pablonyx user-to-server token (refreshed from a real App refresh token,
 * no browser); the personal-sandbox trigger does not depend on which repos the
 * App covers, so the real-trigger contract is fully exercised regardless.
 */
export const t3Prov1: ScenarioDefinition = {
  id: "T3-PROV-1",
  title: "provision — new user (cold path) + GitHub-App trigger contract",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-PROV-1",
  lanes: ["sandbox"],
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ],
  plan: () => {
    const seedMode = githubAppSeedAvailable(process.env);
    return [
      { description: "mint a fresh user via T3-FIXTURE (invite + password register + login)" },
      seedMode
        ? {
            description:
              "REAL-TRIGGER: seed a real GitHub App authorization (refresh a real App token; no browser) " +
              "then invoke the real post-callback body (ensure_personal_cloud_sandbox_exists + materialize + " +
              "refresh_github_app_installation_cache) for the fresh user (github_app_seed.py trigger)",
          }
        : {
            description:
              "FALLBACK (seed creds absent): invoke ensure_personal_cloud_sandbox_exists + materialize_sandbox " +
              "in-process for the fresh user (prov1_fallback.py)",
          },
      { description: "poll sandbox status until ready (budget: p95 <=5min fail, warn at 3min)" },
      { description: "connect to the workspace's real AnyHarness runtime and probe GET /v1/agents" },
      { description: "assert ready within budget and a real agent status list comes back" },
      {
        description:
          "NEGATIVE trigger contract: a second fresh user WITHOUT seeded App auth gets no sandbox kicked off " +
          "and the repo-environment endpoint 409s github_app_authorization_required (#1043 gate)",
      },
      { description: "teardown: destroy each fresh user's sandbox + remove their org membership" },
    ];
  },
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.targetLane === "staging") {
      // Deferred from the first staging pass: the cold-path trigger mints
      // throwaway users INTO the shared durable org and provisions real E2B
      // sandboxes, and its App-authorization seed (github_app_seed.py) needs an
      // in-VPC DB the staging DB does not expose. Both mutate/charge shared
      // staging state, so this reports blocked (not red) until a dedicated,
      // non-shared staging fixture org + an in-VPC seed path exist. See
      // tests/release/README.md (staging-lane runbook).
      throw new ScenarioBlockedError(
        "T3-PROV-1/staging: deferred from the first staging pass — the cold-path trigger mints throwaway " +
          "users into the SHARED durable org and provisions real E2B sandboxes, and its GitHub-App seed " +
          "needs an in-VPC DB (staging's DB is VPC-only). Both would mutate/charge shared staging state. " +
          "Needs a dedicated non-shared staging fixture org + an in-VPC seed path before it can run for real.",
      );
    }
    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
    const durableCreds = {
      serverUrl,
      email: ctx.env.require("RELEASE_E2E_DURABLE_USER_EMAIL"),
      password: ctx.env.require("RELEASE_E2E_DURABLE_USER_PASSWORD"),
      organizationId: ctx.env.require("RELEASE_E2E_DURABLE_ORG_ID"),
    };
    const seedMode = githubAppSeedAvailable(process.env);

    // ── Positive half: provision a fresh user via the trigger ──────────────
    const fresh = await mintFreshUser(durableCreds);
    try {
      if (seedMode) {
        await runRealTrigger(fresh.email);
      } else {
        await runFallbackProvision(fresh.email);
      }
    } finally {
      if (seedMode) {
        await runGithubAppSeed(fresh.email, { command: "teardown" }).catch((error) =>
          console.warn(`[T3-PROV-1] sandbox teardown best-effort failed: ${String(error)}`),
        );
      } else {
        await runFallbackScript(fresh.email, { mode: "teardown" }).catch((error) =>
          console.warn(`[T3-PROV-1] sandbox teardown best-effort failed: ${String(error)}`),
        );
      }
      await fresh.teardown().catch((error) => console.warn(`[T3-PROV-1] membership teardown best-effort failed: ${String(error)}`));
    }

    // ── Negative half: the gate must NOT provision for an unseeded user ────
    await runNegativeTriggerContract(serverUrl, durableCreds, seedMode);
  },
};

async function runRealTrigger(email: string): Promise<void> {
  const result = await runGithubAppSeed<TriggerResult>(email, { command: "trigger", pollTimeoutSeconds: 300 });

  // Trigger contract: seed produced a real authorization + a real installation token.
  assert.equal(result.seeded?.status, "ready", "T3-PROV-1: seed must plant a ready GitHub App authorization");
  assert.ok(result.verify?.user_token_repo_listing_ok, "T3-PROV-1: seeded user token must list real repos");
  assert.ok(result.verify?.installation_token_minted, "T3-PROV-1: seed must yield a real installation token");
  // Trigger contract: the callback body is what kicked off the sandbox.
  assert.equal(result.preExistingSandbox, false, "T3-PROV-1: fresh user must have no sandbox before the callback fires");
  assert.equal(result.sandboxKickedOffByTrigger, true, "T3-PROV-1: the App-auth callback body must kick off sandbox creation");

  assertSandboxReady("T3-PROV-1 (real-trigger)", result);
  console.log(
    `[T3-PROV-1] real-trigger: seeded ${result.seeded?.github_login} authorization, ` +
      `minted installation token (status ${result.verify?.installation_token_mint_status}), ` +
      `sandbox ready in ${result.readyWithinSeconds}s — ${(result.agentsProbe as unknown[]).length} agents reported`,
  );
}

async function runFallbackProvision(email: string): Promise<void> {
  const result = await runFallbackScript(email, { mode: "provision", pollTimeoutSeconds: 300 });
  assertSandboxReady("T3-PROV-1 (fallback)", result);
  console.log(
    `[T3-PROV-1] fallback: sandbox ready in ${result.readyWithinSeconds}s — ` +
      `${(result.agentsProbe as unknown[]).length} agents reported`,
  );
}

function assertSandboxReady(label: string, result: FallbackResult | TriggerResult): void {
  // `result.error` can be a *non-fatal* warning surfaced by the materializer
  // even when the sandbox is fully ready and reachable (see #1026), so it is
  // logged, not treated as a hard failure, as long as readiness + probe pass.
  const readyAndReachable = result.status === "ready" && Array.isArray(result.agentsProbe);
  if (result.error && !readyAndReachable) {
    throw new ScenarioExpectedFailError(
      `${label}: provisioning failed: ${result.error} (sandboxId=${result.sandboxId}, status=${result.status})`,
    );
  }
  if (result.error) {
    console.warn(`[T3-PROV-1] non-fatal materializer warning (sandbox still reached ready): ${result.error}`);
  }
  assert.equal(result.status, "ready", `${label}: sandbox must reach status=ready`);
  assert.ok(result.anyharnessBaseUrl, `${label}: sandbox must expose a runtime base URL`);
  assert.ok(Array.isArray(result.agentsProbe), `${label}: GET /v1/agents probe must return the agent list`);
  assert.ok((result.agentsProbe as unknown[]).length > 0, `${label}: agent list must be non-empty`);
  if (typeof result.readyWithinSeconds === "number" && result.readyWithinSeconds > 180) {
    console.warn(`[T3-PROV-1] readiness exceeded the 180s warn budget (${result.readyWithinSeconds}s)`);
  }
}

async function runNegativeTriggerContract(
  serverUrl: string,
  durableCreds: { serverUrl: string; email: string; password: string; organizationId: string },
  seedMode: boolean,
): Promise<void> {
  const negativeUser = await mintFreshUser(durableCreds);
  try {
    const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(negativeUser.session.accessToken);
    const [owner, repo] = (process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO).split("/");

    // The App-gated repo-environment endpoint must reject an unseeded user.
    let gated = false;
    try {
      await client.put(`/v1/cloud/repositories/${owner}/${repo}/environment`, {
        kind: "cloud",
        gitProvider: "github",
        defaultBranch: "develop",
        setupScript: "echo negative-guard",
        runCommand: "",
      });
    } catch (error) {
      if (isGithubAppAuthorizationRequiredError(error)) {
        gated = true;
      } else {
        throw error;
      }
    }
    assert.ok(gated, "T3-PROV-1 (negative): unseeded user must be gated with github_app_authorization_required");

    // And that user must have had no sandbox kicked off by the gate.
    if (seedMode) {
      const status = await runGithubAppSeed<StatusResult>(negativeUser.email, { command: "status" });
      assert.equal(status.authorized, false, "T3-PROV-1 (negative): unseeded user must not be GitHub-App-authorized");
      assert.equal(status.has_personal_sandbox, false, "T3-PROV-1 (negative): the gate must not have kicked off a sandbox");
    }
    console.log("[T3-PROV-1] negative trigger contract verified: unseeded user gated, no sandbox provisioned");
  } finally {
    if (seedMode) {
      await runGithubAppSeed(negativeUser.email, { command: "teardown" }).catch(() => undefined);
    }
    await negativeUser.teardown().catch((error) => console.warn(`[T3-PROV-1] negative-user teardown best-effort failed: ${String(error)}`));
  }
}

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
