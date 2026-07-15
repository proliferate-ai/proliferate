import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLOUD_PROVISION_1_ID,
  DETERMINISTIC_PROMPT,
  REPRESENTATIVE_HARNESS,
  SANDBOX_RUNTIME_PORT,
  createCloudProvision1Driver,
  resolveBotSeedForAutomation,
  resolveWorldConstructionInputs,
  runCloudProvision1Cell,
  waitForSandboxLaunchOptions,
  type CloudProvision1Driver,
  type CoveredRepoVerification,
  type IsolationVerification,
  type SandboxConvergence,
  type TemplateVerification,
  type WorkerSupervisorVerification,
} from "./cloud-provision-1.js";
import { ScenarioBlockedError } from "./types.js";
import type { ScenarioRunContext } from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { EnvResolution } from "../config/env-resolution.js";
import type { AuthenticatedActor } from "../fixtures/authenticated-actor.js";
import type { CoreFundingResult } from "../fixtures/core-funding.js";
import type { E2BExecResult } from "../fixtures/e2b-verify.js";
import type { GithubAuthorizationBoundary } from "../fixtures/github-authorization.js";
import type { PlannedCellV1 } from "../runner/result.js";
import type { CorrelatedTurnSpend, SpendSnapshot } from "../services/qualification-litellm.js";
import type { BoxExec, ServerPythonOptions } from "../worlds/managed-cloud/box-exec.js";
import type { ManagedCloudCleanupEvidence } from "../worlds/managed-cloud/cleanup-kinds.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";

const REQUIRED_ENV_VARS: Record<string, string> = {
  AGENT_GATEWAY_LITELLM_BASE_URL: "https://admin.litellm.example",
  AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: "https://public.litellm.example",
  AGENT_GATEWAY_LITELLM_MASTER_KEY: "sk-test-master",
  RELEASE_E2E_E2B_API_KEY: "e2b-test-key",
  RELEASE_E2E_E2B_TEAM_ID: "team-test",
  RELEASE_E2E_CLOUD_AWS_REGION: "us-east-1",
  RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID: "Z000000TEST",
  RELEASE_E2E_CLOUD_GITHUB_APP_ID: "123456",
  RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID: "Iv1.testclientid",
  RELEASE_E2E_CLOUD_GITHUB_APP_INSTALLATION_ID: "78901",
  RELEASE_E2E_CLOUD_GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
  RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET: "test-client-secret",
};

function fakeCandidateMap(): CandidateBuildMapV1 {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "a".repeat(40),
    artifacts: [],
  };
}

function fakeEnv(overrides: Record<string, string | undefined> = {}): EnvResolution {
  const values: Record<string, string> = { ...REQUIRED_ENV_VARS };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete values[key];
    } else {
      values[key] = value;
    }
  }
  return {
    all: [],
    missing: [],
    present: (name) => values[name] !== undefined,
    get: (name) => values[name],
    require: (name) => {
      const value = values[name];
      if (!value) {
        throw new Error(`missing required env var "${name}"`);
      }
      return value;
    },
  };
}

function fakeCtx(overrides: Partial<ScenarioRunContext> = {}): ScenarioRunContext {
  return {
    targetLane: "cloud",
    runtimeLane: "sandbox",
    desktop: "web",
    agents: [REPRESENTATIVE_HARNESS],
    dryRun: false,
    env: fakeEnv(),
    candidateBuildMap: fakeCandidateMap(),
    runIdentity: {
      run_id: "cloud-run-1",
      shard_id: "cloud-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    runDir: "/tmp/cloud-run-1",
    ports: null,
    ...overrides,
  };
}

function fakeCell(): PlannedCellV1 {
  return {
    cell_id: `${CLOUD_PROVISION_1_ID}/sandbox/harness=${REPRESENTATIVE_HARNESS}`,
    scenario_id: CLOUD_PROVISION_1_ID,
    registry_flow_ref: "specs/developing/testing/flows.md#cloud-provision",
    runtime_lane: "sandbox",
    dimensions: { harness: REPRESENTATIVE_HARNESS },
    required_env: [],
  };
}

function fakeArtifact(id: string) {
  return { artifact_id: id, version: "1.0.0", sha256: "a".repeat(64), path: `/tmp/${id.replace(/\//g, "-")}` };
}

function fakeWorld(closeImpl?: () => Promise<ManagedCloudCleanupEvidence>): ManagedCloudWorld {
  return {
    kind: "managed-cloud",
    run: fakeCtx().runIdentity!,
    artifacts: {
      server: fakeArtifact("server/linux/amd64"),
      anyharness: fakeArtifact("anyharness/x86_64-unknown-linux-musl"),
      worker: fakeArtifact("worker/x86_64-unknown-linux-musl"),
      supervisor: fakeArtifact("supervisor/x86_64-unknown-linux-musl"),
      credentialHelper: fakeArtifact("credential-helper/x86_64-unknown-linux-musl"),
      desktopRenderer: fakeArtifact("desktop-renderer/browser"),
      template: {
        artifact_id: "e2b-template/cloud-run-1",
        templateId: "tmpl_123",
        buildId: "build_456",
        inputHash: "b".repeat(64),
        bakedInputs: [],
      },
      candidateApi: {
        artifact_id: "candidate-api/cloud-run-1.qualification.proliferate.com",
        version: "1.0.0",
        sha256: "c".repeat(64),
        publicOrigin: "https://cloud-run-1.qualification.proliferate.com",
        ec2InstanceId: "i-0123456789",
      },
    },
    api: { baseUrl: "https://cloud-run-1.qualification.proliferate.com", client: {} as never },
    renderer: { baseUrl: "https://cloud-run-1.qualification.proliferate.com", browser: {} as never },
    gateway: {
      preflight: async () => ({ adminReachable: true as const, allowlistModels: [], eligibleClaudeModels: ["claude-haiku-4-5"] }),
      snapshotSpend: async (): Promise<SpendSnapshot> => ({
        tokenIdHash: "d".repeat(64),
        requestIds: [],
        takenAt: new Date().toISOString(),
      }),
      correlateTurn: async (): Promise<CorrelatedTurnSpend> => ({
        tokenIdHash: "d".repeat(64),
        requestIds: ["req-1"],
        modelId: "claude-haiku-4-5",
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        spendUsd: 0.001,
        windowStartedAt: new Date(Date.now() - 1000).toISOString(),
        windowFinishedAt: new Date().toISOString(),
      }),
    } as never,
    sandbox: { e2bTeamId: "team-test" },
    paths: { runDir: "/tmp/cloud-run-1", secretsDir: "/tmp/cloud-run-1/secrets" },
    registerCleanup: async () => undefined,
    trackActorSubjects: async () => undefined,
    close:
      closeImpl ??
      (async (): Promise<ManagedCloudCleanupEvidence> => ({
        ledgerIdHash: "e".repeat(64),
        registered: 10,
        reconciled: 10,
        failed: 0,
        sandboxesDeleted: true,
        templateDeleted: true,
        dnsRecordDeleted: true,
        ec2Terminated: true,
        securityGroupDeleted: true,
        keyPairDeleted: true,
        virtualKeyDeleted: true,
        litellmSubjectsDeleted: true,
        localPathsRemoved: true,
      })),
  };
}

function fakeActor(suffix = "a"): AuthenticatedActor {
  return {
    role: "owner",
    userId: `user-${suffix}`,
    organizationId: `org-${suffix}`,
    enrollmentId: `enrollment-${suffix}`,
    api: {} as never,
    session: {
      access_token: `token-${suffix}`,
      refresh_token: `refresh-${suffix}`,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      user_id: `user-${suffix}`,
      email: `${suffix}@example.com`,
      display_name: null,
    },
    gatewayKey: {
      userId: `user-${suffix}`,
      enrollmentId: `enrollment-${suffix}`,
      teamId: `team-${suffix}`,
      litellmUserId: `litellm-user-${suffix}`,
      keyAlias: `vk-user-${suffix}`,
      tokenId: `token-id-${suffix}`,
      tokenIdHash: "f".repeat(64),
    },
  };
}

function fakeConvergence(): SandboxConvergence {
  return { cloudSandboxId: "sandbox-a", providerSandboxId: "provider-sandbox-a" };
}

function fakeTemplateVerification(): TemplateVerification {
  return { templateId: "tmpl_123", buildId: "build_456", inputHash: "b".repeat(64), runningSince: new Date().toISOString(), timingSource: "e2b" };
}

function fakeWorkerVerification(): WorkerSupervisorVerification {
  return {
    workerVersion: "1.2.3",
    supervisorVersion: "1.2.3",
    anyharnessVersion: "1.2.3",
    supervisorIsParent: false,
    heartbeatRecent: true,
  };
}

function fakeCoveredRepo(): CoveredRepoVerification {
  return { name: "proliferate-e2e/e2e-fixture", commit: "a".repeat(40), noCredentialInRemote: true };
}

function fakeIsolation(): IsolationVerification {
  return { runtimeRejectsMissing: true, runtimeRejectsActorB: true };
}

/** A fully-wired fake driver for the happy path; individual tests override methods. */
function fakeDriver(overrides: Partial<CloudProvision1Driver> = {}): CloudProvision1Driver & { closeCalls: number } {
  const world = fakeWorld();
  const calls = { closeCalls: 0 };
  const driver: CloudProvision1Driver & { closeCalls: number } = {
    buildWorld: async () => world,
    createActor: async () => fakeActor("a"),
    createSecondActor: async () => fakeActor("b"),
    fundCore: async (): Promise<CoreFundingResult> => ({
      billingSubjectId: "sub-a",
      method: "stripe_checkout",
      disclosed: false,
      computeGateAdmits: true,
    }),
    trackActorSubjects: async () => undefined,
    authorizeGithub: async (): Promise<GithubAuthorizationBoundary> => ({
      mode: "manual_assist",
      authorizationCode: "code-a",
      state: "state-a",
    }),
    completeAndConverge: async () => fakeConvergence(),
    verifyTemplateAndRunning: async () => fakeTemplateVerification(),
    verifyWorkerSupervisor: async () => fakeWorkerVerification(),
    verifyAnyharnessHealth: async () => undefined,
    verifyCoveredRepo: async () => fakeCoveredRepo(),
    allowlistModels: async () => ["claude-haiku-4-5"],
    liveProbeModels: async () => ["claude-haiku-4-5"],
    runGatewayTurn: async () => ({ reply: "pong" }),
    snapshotSpend: async (): Promise<SpendSnapshot> => ({
      tokenIdHash: "f".repeat(64),
      requestIds: [],
      takenAt: new Date().toISOString(),
    }),
    correlateTurn: async (): Promise<CorrelatedTurnSpend> => ({
      tokenIdHash: "f".repeat(64),
      requestIds: ["req-1"],
      modelId: "claude-haiku-4-5",
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      spendUsd: 0.001,
      windowStartedAt: new Date(Date.now() - 1000).toISOString(),
      windowFinishedAt: new Date().toISOString(),
    }),
    verifyActorBIsolation: async () => fakeIsolation(),
    closeWorld: async (w) => {
      calls.closeCalls += 1;
      return w.close();
    },
    closeCalls: 0,
    ...overrides,
  };
  Object.defineProperty(driver, "closeCalls", {
    get: () => calls.closeCalls,
  });
  return driver;
}

test("resolveWorldConstructionInputs fails cleanly when the candidate build map is absent", () => {
  const result = resolveWorldConstructionInputs(fakeCtx({ candidateBuildMap: null }));
  assert.equal(result.ok, false);
});

test("resolveWorldConstructionInputs fails cleanly when a required cloud env var is missing", () => {
  const result = resolveWorldConstructionInputs(fakeCtx({ env: fakeEnv({ RELEASE_E2E_CLOUD_AWS_REGION: undefined }) }));
  assert.equal(result.ok, false);
});

test("resolveWorldConstructionInputs resolves every typed input on the happy path", () => {
  const result = resolveWorldConstructionInputs(fakeCtx());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.aws.region, "us-east-1");
    assert.equal(result.value.e2bTeamId, "team-test");
    assert.equal(result.value.github.appId, "123456");
    assert.equal(result.value.e2bApiKey, "e2b-test-key");
  }
});

test("runCloudProvision1Cell returns a clean failed outcome with no side effects when construction inputs are missing", async () => {
  const driver = fakeDriver();
  let buildWorldCalled = false;
  driver.buildWorld = async () => {
    buildWorldCalled = true;
    return fakeWorld();
  };
  const outcome = await runCloudProvision1Cell(fakeCell(), fakeCtx({ candidateBuildMap: null }), driver);
  assert.equal(outcome.status, "failed");
  assert.equal(buildWorldCalled, false);
});

test("runCloudProvision1Cell returns a clean failed outcome when world construction throws", async () => {
  const driver = fakeDriver({
    buildWorld: async () => {
      throw new Error("aws quota exceeded");
    },
  });
  const outcome = await runCloudProvision1Cell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /world construction failed/);
});

test("runCloudProvision1Cell reports blocked (not skip-as-success) when github authorization is blocked-honest", async () => {
  let closeCalls = 0;
  const driver = fakeDriver({
    authorizeGithub: async () => {
      throw new ScenarioBlockedError("Actions lane without the D2 bot seed: OAuth serial lane blocked honestly.");
    },
    closeWorld: async (world) => {
      closeCalls += 1;
      return world.close();
    },
  });
  const outcome = await runCloudProvision1Cell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "blocked");
  assert.equal(closeCalls, 1);
});

test("runCloudProvision1Cell goes green with complete cloud_provision_turn evidence on the happy path", async () => {
  const driver = fakeDriver();
  const outcome = await runCloudProvision1Cell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "green");
  assert.ok(outcome.evidence);
  assert.equal(outcome.evidence?.kind, "cloud_provision_turn");
  if (outcome.evidence?.kind === "cloud_provision_turn") {
    assert.equal(outcome.evidence.cleanup.failed, 0);
    assert.equal(outcome.evidence.worker.supervisor_is_parent, false);
    assert.equal(outcome.evidence.isolation.actor_b_denied, true);
    assert.equal(outcome.evidence.covered_repo.no_credential_in_remote, true);
    assert.ok(outcome.evidence.artifact_ids.includes("e2b-template/cloud-run-1"));
    assert.ok(outcome.evidence.artifact_ids.includes("candidate-api/cloud-run-1.qualification.proliferate.com"));
  }
});

test("runCloudProvision1Cell reports failed (not green) when cleanup does not fully reconcile", async () => {
  const driver = fakeDriver({
    closeWorld: async () => ({
      ledgerIdHash: "e".repeat(64),
      registered: 10,
      reconciled: 9,
      failed: 1,
      sandboxesDeleted: false,
      templateDeleted: true,
      dnsRecordDeleted: true,
      ec2Terminated: true,
      securityGroupDeleted: true,
      keyPairDeleted: true,
      virtualKeyDeleted: true,
      litellmSubjectsDeleted: true,
      localPathsRemoved: true,
    }),
  });
  const outcome = await runCloudProvision1Cell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "failed");
  assert.ok(outcome.evidence, "a failed cleanup still carries evidence recording the failure");
});

test("runCloudProvision1Cell reports blocked when no eligible live model intersects the allowlist", async () => {
  const driver = fakeDriver({ liveProbeModels: async () => [] });
  const outcome = await runCloudProvision1Cell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "blocked");
});

test("runCloudProvision1Cell calls closeWorld exactly once even when a late step throws", async () => {
  const driver = fakeDriver({
    runGatewayTurn: async () => {
      throw new Error("turn timed out");
    },
  });
  const outcome = await runCloudProvision1Cell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "failed");
  assert.equal(driver.closeCalls, 1);
});

test("runCloudProvision1Cell sends the deterministic bounded prompt", async () => {
  let seenPrompt: string | undefined;
  const driver = fakeDriver({
    runGatewayTurn: async (_world, _actor, _convergence, _modelId, prompt) => {
      seenPrompt = prompt;
      return { reply: "pong" };
    },
  });
  const outcome = await runCloudProvision1Cell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "green");
  assert.equal(seenPrompt, DETERMINISTIC_PROMPT);
});

test("resolveBotSeedForAutomation returns null when the staging App OAuth creds are absent", () => {
  const resolved = resolveBotSeedForAutomation({ RELEASE_E2E_CLOUD_GITHUB_BOT_REFRESH_TOKEN: "ghr_x" });
  assert.equal(resolved, null);
});

test("resolveBotSeedForAutomation resolves from the env refresh token when present", () => {
  const resolved = resolveBotSeedForAutomation({
    RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID: "Iv23xxxx",
    RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET: "secret",
    RELEASE_E2E_CLOUD_GITHUB_BOT_REFRESH_TOKEN: "ghr_env",
    RELEASE_E2E_CLOUD_GITHUB_BOT_SEED_STATE: "/nonexistent/seed.json",
  });
  assert.ok(resolved);
  assert.equal(resolved!.refreshToken, "ghr_env");
  assert.equal(resolved!.clientId, "Iv23xxxx");
});

test("resolveBotSeedForAutomation returns null when creds exist but no refresh token is available", () => {
  const resolved = resolveBotSeedForAutomation({
    RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID: "Iv23xxxx",
    RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET: "secret",
    RELEASE_E2E_CLOUD_GITHUB_BOT_SEED_STATE: "/nonexistent/seed.json",
  });
  assert.equal(resolved, null);
});

// ---------------------------------------------------------------------------
// createCloudProvision1Driver: the real (non-faked) driver methods, exercised
// against a fake box-exec seam + a fake execInProviderSandbox — proves the
// server-DB worker-enrollment query and the port-8457/bearer-auth wiring
// without a live sandbox, DB, or E2B call.
// ---------------------------------------------------------------------------

const FAKE_BEARER_TOKEN = "fake-runtime-bearer-abc123";

/** Redirects `process.stderr.write` into an in-memory buffer so a test can
 * assert on (or scrub) the runner-log diagnostics a driver emits, then restore
 * it. Mirrors the inline capture in the bearer-token-leak test below. */
function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return { lines, restore: () => { process.stderr.write = original; } };
}

/** A `cloud_runtime_worker` row shaped exactly like `QUERY_WORKER_ENROLLMENT_PY`'s JSON output. */
function fakeOnlineWorkerRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "online",
    worker_version: "1.4.0",
    anyharness_version: "1.4.0",
    enrolled_at: new Date(Date.now() - 30_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * A `BoxExec` fake that answers `serverPython` by the two scripts this driver
 * runs — routed by `scriptName` (set on every real call) rather than by
 * parsing script text. `workers` defaults to one healthy, recently-seen
 * enrollment; `token` defaults to a fake, obviously-not-real bearer value.
 */
function fakeBoxExec(opts: { token?: string | null; workers?: Array<Record<string, unknown>> } = {}): BoxExec {
  const token = opts.token === undefined ? FAKE_BEARER_TOKEN : opts.token;
  const workers = opts.workers ?? [fakeOnlineWorkerRow()];
  const serverPython = async (
    _script: string,
    options?: ServerPythonOptions,
  ): Promise<{ stdout: string; stderr: string }> => {
    if (options?.scriptName === "resolve-runtime-bearer-token.py") {
      return { stdout: JSON.stringify({ token }), stderr: "" };
    }
    if (options?.scriptName === "query-worker-enrollment.py") {
      return { stdout: JSON.stringify({ workers }), stderr: "" };
    }
    return { stdout: "{}", stderr: "" };
  };
  return {
    exec: async () => ({ stdout: "", stderr: "" }),
    putSecretFile: async () => "/tmp/fake-secret",
    readRemoteFile: async () => "",
    removeRemoteFile: async () => undefined,
    serverPython,
  };
}

/** A captured `execInProviderSandbox` call, with the bearer curl script/token split out for assertions. */
interface CapturedExec {
  providerSandboxId: string;
  command: readonly string[];
  /** Set only for `sh -c '...'` bearer-curl calls (see `curlWithBearerArgs`/`curlPostWithBearerArgs`). */
  curlScript: string | undefined;
  curlToken: string | undefined;
  /** `"GET"` or `"POST"`, set only for bearer-curl calls. */
  curlMethod: string | undefined;
}

/**
 * A fake `execInProviderSandbox` that answers `--version` execs with a fixed
 * version string and authenticated-curl execs (`sh -c 'TOK="$1"; curl ...' sh
 * <token>`, GET or POST) with `byUrl(url, method)`. Records every call for
 * assertions on the argv shape (port, header, and that the token rides as its
 * own argv element). `byUrl` may return an `E2BExecResult`-shaped object
 * directly (e.g. to fake a non-zero `exitCode`) or a bare string, treated as
 * `stdout` with `exitCode: 0`.
 */
function fakeExecInProviderSandbox(
  byUrl: (url: string, method: string) => string | Partial<E2BExecResult>,
) {
  const calls: CapturedExec[] = [];
  const fn = async (providerSandboxId: string, command: readonly string[]): Promise<E2BExecResult> => {
    const isBearerCurl = command[0] === "sh" && command[1] === "-c" && command[3] === "sh";
    const curlScript = isBearerCurl ? (command[2] as string) : undefined;
    const curlToken = isBearerCurl ? (command[4] as string) : undefined;
    const curlMethod = isBearerCurl ? (curlScript!.includes("-X POST") ? "POST" : "GET") : undefined;
    calls.push({ providerSandboxId, command, curlScript, curlToken, curlMethod });
    if (isBearerCurl) {
      const urlMatch = curlScript!.match(/-H "Authorization: Bearer \$TOK" '([^']*)'/);
      const result = byUrl(urlMatch?.[1] ?? "", curlMethod!);
      if (typeof result === "string") {
        return { stdout: result, stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0, ...result };
    }
    // A binary `--version` exec.
    return { stdout: "1.4.0", stderr: "", exitCode: 0 };
  };
  return { fn, calls };
}

function fakeConvergenceForDriver(): SandboxConvergence {
  return { cloudSandboxId: "11111111-1111-1111-1111-111111111111", providerSandboxId: "provider-sandbox-a" };
}

test("createCloudProvision1Driver().verifyWorkerSupervisor asserts worker enrollment via the server DB, not ps", async () => {
  const box = fakeBoxExec();
  const { fn: exec, calls } = fakeExecInProviderSandbox(() => "[]");
  const driver = createCloudProvision1Driver({ execInProviderSandbox: exec });
  const world: ManagedCloudWorld = { ...fakeWorld(), box };
  const result = await driver.verifyWorkerSupervisor(world, fakeConvergenceForDriver());
  assert.equal(result.workerVersion, "1.4.0");
  assert.equal(result.supervisorVersion, "1.4.0");
  assert.equal(result.anyharnessVersion, "1.4.0");
  assert.equal(result.supervisorIsParent, false, "supervisor-parentage stays deferred to PR 9");
  assert.equal(result.heartbeatRecent, true);
  // No `ps` invocation anywhere in the captured execInProviderSandbox calls.
  assert.ok(calls.every((c) => !c.command.join(" ").includes("ps -A")));
  // Exactly the three binary --version execs (worker/supervisor/anyharness).
  assert.equal(calls.length, 3);
});

test("createCloudProvision1Driver().verifyWorkerSupervisor throws when the world exposes no box-exec seam", async () => {
  const { fn: exec } = fakeExecInProviderSandbox(() => "[]");
  const driver = createCloudProvision1Driver({ execInProviderSandbox: exec });
  await assert.rejects(
    () => driver.verifyWorkerSupervisor(fakeWorld(), fakeConvergenceForDriver()),
    /box-exec seam/,
  );
});

test("createCloudProvision1Driver().verifyWorkerSupervisor throws when no worker row has enrolled yet", async () => {
  const box = fakeBoxExec({ workers: [] });
  const { fn: exec } = fakeExecInProviderSandbox(() => "[]");
  // The real poll is bounded to 90s; override to a near-zero bound so this
  // assertion does not actually wait out the production timeout.
  const driver = createCloudProvision1Driver({
    execInProviderSandbox: exec,
    workerEnrollmentPollTimeoutMs: 10,
    workerEnrollmentPollIntervalMs: 5,
  });
  const world: ManagedCloudWorld = { ...fakeWorld(), box };
  await assert.rejects(
    () => driver.verifyWorkerSupervisor(world, fakeConvergenceForDriver()),
    /cloud_runtime_worker/,
  );
});

test("createCloudProvision1Driver().verifyAnyharnessHealth curls the authenticated runtime on port 8457", async () => {
  const box = fakeBoxExec();
  const { fn: exec, calls } = fakeExecInProviderSandbox((url) =>
    url.includes("/v1/agents") ? JSON.stringify([{ id: "claude-haiku-4-5" }]) : "[]",
  );
  const driver = createCloudProvision1Driver({ execInProviderSandbox: exec });
  const world: ManagedCloudWorld = { ...fakeWorld(), box };
  await driver.verifyAnyharnessHealth(world, fakeConvergenceForDriver());

  const curlCall = calls.find((c) => c.curlScript);
  assert.ok(curlCall, "expected one authenticated curl call");
  assert.match(curlCall!.curlScript!, new RegExp(`127\\.0\\.0\\.1:${SANDBOX_RUNTIME_PORT}/v1/agents`));
  assert.match(curlCall!.curlScript!, /Authorization: Bearer \$TOK/);
  // The token rides as its own argv element ($1), never interpolated into the script text.
  assert.equal(curlCall!.curlToken, FAKE_BEARER_TOKEN);
  assert.ok(!curlCall!.curlScript!.includes(FAKE_BEARER_TOKEN));
});

test("createCloudProvision1Driver().verifyAnyharnessHealth fails closed on an empty catalog", async () => {
  const box = fakeBoxExec();
  const { fn: exec } = fakeExecInProviderSandbox(() => "[]");
  const driver = createCloudProvision1Driver({ execInProviderSandbox: exec });
  const world: ManagedCloudWorld = { ...fakeWorld(), box };
  await assert.rejects(
    () => driver.verifyAnyharnessHealth(world, fakeConvergenceForDriver()),
    /catalog is empty/,
  );
});

/** Simulates the `curlPostCaptureArgs` wire output: the response body with the
 * numeric HTTP status appended on its own trailing line (`-w '\n%{http_code}'`),
 * and a zero curl exit (curl without `-f` succeeds even on a 4xx/5xx). */
function capturedResponse(body: string, status: number): { stdout: string; stderr: string; exitCode: number } {
  return { stdout: `${body}\n${status}`, stderr: "", exitCode: 0 };
}

test("createCloudProvision1Driver().liveProbeModels POSTs refresh-gateway (body+status capture) and returns the model ids on a 200", async () => {
  const box = fakeBoxExec();
  const { fn: exec, calls } = fakeExecInProviderSandbox((url) =>
    url.includes("/v1/agents/claude/catalog/refresh-gateway")
      ? capturedResponse(JSON.stringify({ models: ["claude-haiku-4-5"], probedAt: new Date().toISOString() }), 200)
      : "[]",
  );
  const driver = createCloudProvision1Driver({ execInProviderSandbox: exec });
  const world: ManagedCloudWorld = { ...fakeWorld(), box };
  const modelIds = await driver.liveProbeModels(world, fakeConvergenceForDriver(), "claude");
  assert.deepEqual(modelIds, ["claude-haiku-4-5"]);

  const curlCall = calls.find((c) => c.curlScript);
  assert.ok(curlCall, "expected one authenticated curl call");
  assert.equal(curlCall!.curlMethod, "POST", "refresh-gateway is a POST endpoint, not GET");
  assert.match(
    curlCall!.curlScript!,
    new RegExp(`127\\.0\\.0\\.1:${SANDBOX_RUNTIME_PORT}/v1/agents/claude/catalog/refresh-gateway`),
  );
  assert.match(curlCall!.curlScript!, /Authorization: Bearer \$TOK/);
  // Captures the body even on errors: no `-f`, status appended via `-w`.
  assert.ok(!curlCall!.curlScript!.includes("-fsS"), "refresh-gateway curl must drop -f so a 4xx body is captured");
  assert.match(curlCall!.curlScript!, /-w '\\n%\{http_code\}'/);
  assert.equal(curlCall!.curlToken, FAKE_BEARER_TOKEN);
  // Exactly one call: the materializer had already synced the gateway
  // selection, so the first refresh-gateway attempt succeeds — no poll needed.
  assert.equal(calls.length, 1);
});

test("createCloudProvision1Driver().liveProbeModels polls refresh-gateway until the cloud materializer syncs the gateway selection", async () => {
  const box = fakeBoxExec();
  let attempts = 0;
  const { fn: exec, calls } = fakeExecInProviderSandbox((url) => {
    if (!url.includes("/v1/agents/claude/catalog/refresh-gateway")) {
      return "[]";
    }
    attempts += 1;
    if (attempts < 3) {
      // 400 GATEWAY_REFRESH_NO_SELECTION: materialize_agent_auth hasn't written
      // the gateway source into state.json yet. curl (no -f) exits 0 and the
      // body carries the error code; status is the appended `\n400`.
      return capturedResponse(JSON.stringify({ code: "GATEWAY_REFRESH_NO_SELECTION" }), 400);
    }
    return capturedResponse(JSON.stringify({ models: ["claude-haiku-4-5"], probedAt: new Date().toISOString() }), 200);
  });
  const driver = createCloudProvision1Driver({
    execInProviderSandbox: exec,
    gatewayProbePollTimeoutMs: 10_000,
    gatewayProbePollIntervalMs: 1,
  });
  const world: ManagedCloudWorld = { ...fakeWorld(), box };
  const modelIds = await driver.liveProbeModels(world, fakeConvergenceForDriver(), "claude");
  assert.deepEqual(modelIds, ["claude-haiku-4-5"]);
  assert.equal(attempts, 3);
  assert.equal(calls.filter((c) => c.curlMethod === "POST").length, 3);
});

test("createCloudProvision1Driver().liveProbeModels surfaces the exact 400 error code (http=400 body=…) and times out", async () => {
  const box = fakeBoxExec();
  const { fn: exec } = fakeExecInProviderSandbox(() =>
    capturedResponse(
      '{"type":"about:blank","title":"no gateway route source for harness \'claude\'","code":"GATEWAY_REFRESH_NO_SELECTION"}',
      400,
    ),
  );
  const driver = createCloudProvision1Driver({
    execInProviderSandbox: exec,
    gatewayProbePollTimeoutMs: 10,
    gatewayProbePollIntervalMs: 5,
  });
  const world: ManagedCloudWorld = { ...fakeWorld(), box };
  const writes = captureStderr();
  try {
    await assert.rejects(
      () => driver.liveProbeModels(world, fakeConvergenceForDriver(), "claude"),
      /never returned a non-empty model list/,
    );
  } finally {
    writes.restore();
  }
  const surfaced = writes.lines.find((line) => line.startsWith("[cloud-model-probe]"));
  assert.ok(surfaced, "expected the raw refresh-gateway response to be surfaced under [cloud-model-probe]");
  assert.match(surfaced!, /http=400/);
  assert.match(surfaced!, /GATEWAY_REFRESH_NO_SELECTION/);
  // The status line must NOT leak into the surfaced body, and the bearer token
  // must never appear anywhere in the surfaced diagnostics.
  assert.ok(!/body=.*\n400/.test(surfaced!));
  assert.ok(!writes.lines.some((line) => line.includes(FAKE_BEARER_TOKEN)));
});

test("createCloudProvision1Driver().liveProbeModels surfaces a hard curl exit (no HTTP response) and times out", async () => {
  const box = fakeBoxExec();
  const { fn: exec } = fakeExecInProviderSandbox(() => ({
    stdout: "",
    stderr: "curl: (7) Failed to connect to 127.0.0.1 port 8457: Connection refused",
    exitCode: 7,
  }));
  const driver = createCloudProvision1Driver({
    execInProviderSandbox: exec,
    gatewayProbePollTimeoutMs: 10,
    gatewayProbePollIntervalMs: 5,
  });
  const world: ManagedCloudWorld = { ...fakeWorld(), box };
  const writes = captureStderr();
  try {
    await assert.rejects(
      () => driver.liveProbeModels(world, fakeConvergenceForDriver(), "claude"),
      /never returned a non-empty model list/,
    );
  } finally {
    writes.restore();
  }
  const surfaced = writes.lines.find((line) => line.startsWith("[cloud-model-probe]"));
  assert.ok(surfaced, "expected the hard curl exit to be surfaced");
  assert.match(surfaced!, /exit=7/);
  assert.match(surfaced!, /Connection refused/);
});

test("createCloudProvision1Driver().liveProbeModels surfaces the raw body and times out when refresh-gateway returns 0 models (empty gateway)", async () => {
  const box = fakeBoxExec();
  const { fn: exec } = fakeExecInProviderSandbox((url) =>
    url.includes("/v1/agents/claude/catalog/refresh-gateway")
      ? capturedResponse(JSON.stringify({ models: [], probedAt: new Date().toISOString() }), 200)
      : "[]",
  );
  const driver = createCloudProvision1Driver({
    execInProviderSandbox: exec,
    gatewayProbePollTimeoutMs: 10,
    gatewayProbePollIntervalMs: 5,
  });
  const world: ManagedCloudWorld = { ...fakeWorld(), box };
  const writes = captureStderr();
  try {
    await assert.rejects(
      () => driver.liveProbeModels(world, fakeConvergenceForDriver(), "claude"),
      /returned 0 models|never returned a non-empty model list/,
    );
  } finally {
    writes.restore();
  }
  const surfaced = writes.lines.find((line) => line.startsWith("[cloud-model-probe]"));
  assert.ok(surfaced, "expected the raw empty-models body to be surfaced");
  assert.match(surfaced!, /http=200/);
  assert.match(surfaced!, /"models":\[\]/);
});

test("waitForSandboxLaunchOptions polls until the runtime lists the harness with models", async () => {
  let attempts = 0;
  const { fn: exec, calls } = fakeExecInProviderSandbox((url) => {
    if (!url.endsWith("/v1/agents/launch-options")) {
      return "[]";
    }
    attempts += 1;
    // Empty at first (readiness not flipped), then claude appears with a model.
    return attempts < 3
      ? JSON.stringify({ agents: [] })
      : JSON.stringify({ agents: [{ kind: "claude", models: [{ id: "claude-haiku-4-5" }] }] });
  });
  await waitForSandboxLaunchOptions(exec, "provider-sandbox-a", FAKE_BEARER_TOKEN, "claude", 10_000, 1);
  assert.equal(attempts, 3);
  // Bearer-authed, correct port and path, token as its own argv element.
  const curlCall = calls.find((c) => c.curlScript?.includes("/v1/agents/launch-options"));
  assert.ok(curlCall);
  assert.match(curlCall!.curlScript!, new RegExp(`127\\.0\\.0\\.1:${SANDBOX_RUNTIME_PORT}/v1/agents/launch-options`));
  assert.equal(curlCall!.curlToken, FAKE_BEARER_TOKEN);
});

test("waitForSandboxLaunchOptions requires the harness to carry at least one model, not just be listed", async () => {
  const { fn: exec } = fakeExecInProviderSandbox((url) =>
    url.endsWith("/v1/agents/launch-options")
      ? JSON.stringify({ agents: [{ kind: "claude", models: [] }] })
      : JSON.stringify([]),
  );
  const writes = captureStderr();
  try {
    await assert.rejects(
      () => waitForSandboxLaunchOptions(exec, "provider-sandbox-a", FAKE_BEARER_TOKEN, "claude", 10, 5),
      /never listed "claude" with models/,
    );
  } finally {
    writes.restore();
  }
});

test("waitForSandboxLaunchOptions dumps per-agent readiness on timeout so the failing precondition names itself", async () => {
  const { fn: exec } = fakeExecInProviderSandbox((url) => {
    if (url.endsWith("/v1/agents/launch-options")) {
      return JSON.stringify({ agents: [] });
    }
    if (url.endsWith("/v1/agents")) {
      // The decisive signal: claude installed=false → InstallRequired, the
      // state a gateway route deliberately never clears.
      return JSON.stringify([
        {
          kind: "claude",
          installState: "install_required",
          credentialState: "login_required",
          readiness: "install_required",
          native: { installed: false },
          agentProcess: { installed: false },
          message: "claude binary not found under the runtime home",
        },
      ]);
    }
    return "[]";
  });
  const writes = captureStderr();
  try {
    await assert.rejects(
      () => waitForSandboxLaunchOptions(exec, "provider-sandbox-a", FAKE_BEARER_TOKEN, "claude", 10, 5),
      /never listed "claude" with models/,
    );
  } finally {
    writes.restore();
  }
  const readiness = writes.lines.find((line) => line.startsWith("[cloud-agents-readiness]"));
  assert.ok(readiness, "expected the per-agent readiness dump under [cloud-agents-readiness]");
  assert.match(readiness!, /install_required/);
  assert.match(readiness!, /"agentProcessInstalled":false/);
  // The empty launch-options body is surfaced too, and the token never leaks.
  assert.ok(writes.lines.some((line) => line.startsWith("[cloud-launch-options]")));
  assert.ok(!writes.lines.some((line) => line.includes(FAKE_BEARER_TOKEN)));
});

test("createCloudProvision1Driver()'s runtime bearer token never appears in a thrown error message", async () => {
  const box = fakeBoxExec({ token: null });
  const { fn: exec } = fakeExecInProviderSandbox(() => "[]");
  const driver = createCloudProvision1Driver({ execInProviderSandbox: exec });
  const world: ManagedCloudWorld = { ...fakeWorld(), box };
  await assert.rejects(
    () => driver.verifyAnyharnessHealth(world, fakeConvergenceForDriver()),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /did not report a runtime bearer token/);
      assert.ok(!error.message.includes(FAKE_BEARER_TOKEN));
      return true;
    },
  );
});

test("createCloudProvision1Driver() never writes the resolved bearer token to the runner's stderr stream", async () => {
  const box = fakeBoxExec();
  const { fn: exec } = fakeExecInProviderSandbox((url) =>
    url.includes("/v1/agents") ? JSON.stringify([{ id: "claude-haiku-4-5" }]) : "[]",
  );
  const driver = createCloudProvision1Driver({ execInProviderSandbox: exec });
  const world: ManagedCloudWorld = { ...fakeWorld(), box };
  const originalWrite = process.stderr.write.bind(process.stderr);
  const writes: string[] = [];
  process.stderr.write = ((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    await driver.verifyAnyharnessHealth(world, fakeConvergenceForDriver());
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.ok(!writes.some((line) => line.includes(FAKE_BEARER_TOKEN)));
});
