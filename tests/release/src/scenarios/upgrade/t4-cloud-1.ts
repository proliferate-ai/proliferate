import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import type { ScenarioDefinition, ScenarioRunContext } from "../types.js";
import { ScenarioBlockedError } from "../types.js";
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
import {
  QUALIFICATION_MCP_TOOL,
  assertAgentArtifactsMatchPins,
  assertQualificationMcpApplied,
  assertReconcileCompletedForAgent,
  assertSameDurableSession,
  assertServedCatalogMatchesCandidate,
  assertTerminalTurnEvidence,
  maxEventSeq,
  selectQualificationAgent,
  type QualificationAgent,
  type QualificationCatalogDocument,
  type RuntimeAgentSummary,
  type RuntimeLaunchOptions,
  type RuntimeReconcileStatus,
  type RuntimeSessionEventEnvelope,
  type RuntimeSessionSummary,
} from "./t4-cloud-evidence.js";

/**
 * T4-CLOUD-1 — AnyHarness runtime binary self-update in a cloud sandbox.
 * specs/tbd/anyharness-self-update-v1.md §7; flows.md "Upgrade & release".
 *
 * The tier-4 assertion (spec §5, "converged"): with a sandbox already running
 * explicit N-1, start a durable live session, bump the server's advertised
 * `desiredVersions.anyharness` pin to explicit candidate N, and
 * let the sandbox worker converge the runtime binary IN PLACE — no test-side
 * artifact push. Then assert the running runtime reports N, the candidate
 * catalog and installed native/ACP-facing artifacts reconcile, the same
 * durable session resumes, its product MCP binding is applied, and a real
 * post-update turn completes a structured MCP tool invocation.
 *
 * Feed knob: the server advertises the pin from `RUNTIME_VERSION`
 * (server/proliferate/server/version.py `runtime_version_pin`), a baked-in
 * image ENV with no runtime override. The only test-scoped way to move it
 * without cutting a release is to override `RUNTIME_VERSION` in the
 * proliferate-staging-server ECS task definition and roll the service (ECS task
 * env wins over the image ENV). That forces one rolling task replacement, which
 * the spec's testing ruling accepts for a nightly test; the scenario restores
 * the original task definition in a `finally`, and the mutation is gated behind
 * the explicit `RELEASE_E2E_STAGING_ECS_PIN_BUMP` opt-in and guarded against any
 * production-looking target (assertNotProduction).
 *
 * Observation surface: the server gateway proxy
 * `GET /v1/gateway/cloud-sandbox/anyharness/{path}` reaches the sandbox runtime.
 * `/health`, `/v1/catalogs/agents/version`, `/v1/agents*`, `/v1/sessions*`, and
 * the structured event log jointly prove convergence. The old
 * `/v1/cloud/cloud-sandbox/anyharness/*` path does not exist.
 *
 * Standing blockers this scenario reports honestly rather than faking:
 *   - --lane local has no ECS pin knob and no cloud sandbox -> blocked.
 *   - No staging session bootstrapped -> blocked.
 *   - Provisioning a real E2B sandbox not reachable in this environment -> blocked.
 *   - RELEASE_E2E_STAGING_ECS_PIN_BUMP not set -> blocked (never mutate ECS unasked).
 *
 * A product break is red. Missing fixture infrastructure may block before the
 * ECS mutation, but version, catalog, reconcile, session, or MCP failures after
 * the mutation are never converted to expected-fail.
 */

const CONVERGE_TIMEOUT_MS = 6 * 60_000;
const QUALIFICATION_TIMEOUT_MS = 4 * 60_000;
const TURN_TIMEOUT_MS = 2 * 60_000;
const POLL_INTERVAL_MS = 15_000;
const TURN_POLL_INTERVAL_MS = 1_000;
const SANDBOX_READY_TIMEOUT_MS = 3 * 60_000;
const RUNTIME_GATEWAY_PREFIX = "/v1/gateway/cloud-sandbox/anyharness";
const CANDIDATE_CATALOG_URL = new URL("../../../../../catalogs/agents/catalog.json", import.meta.url);

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
  requiredEnv: [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_STAGING_ECS_PIN_BUMP",
    "RELEASE_E2E_CLOUD_UPDATE_FROM",
    "RELEASE_E2E_CLOUD_UPDATE_TO",
  ],
  plan: () => [
    { description: "authenticate the durable staging user (rotating session refresh token)" },
    { description: "ensure the user's cloud sandbox is provisioned and ready" },
    { description: "bind the staging catalog feed and all agent artifact pins to the candidate checkout" },
    { description: "at explicit N-1, choose a ready cheap harness with exact native + agent-process pins" },
    { description: "start a durable session with the applied subagents HTTP MCP binding; complete a baseline turn" },
    { description: "bump the advertised RUNTIME_VERSION pin on the staging server task def; roll the service" },
    { description: "wait for server pin + proxied /health to report explicit candidate N" },
    { description: "assert candidate catalog active and startup installed-only reconcile completed for the harness" },
    { description: "assert native CLI + ACP-facing agent-process paths and versions equal candidate pins" },
    { description: "resume the same durable session and assert its subagents MCP binding is still applied" },
    { description: `run a real post-update turn that completes ${QUALIFICATION_MCP_TOOL} and ends successfully` },
    { description: "restore the original staging task definition in finally; restoration failure is red" },
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
  const productSession = await loginDurableUserOnStaging(serverUrl);
  const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(productSession.accessToken);

  await ensureSandboxReady(client);

  const candidateCatalog = await readCandidateCatalog();
  const servedCatalog = await client.get<QualificationCatalogDocument>("/v1/catalogs/agents");
  assertServedCatalogMatchesCandidate(candidateCatalog, servedCatalog);

  const advertisedBefore = await advertisedRuntimePin(client);
  const runningBefore = await proxiedRuntimeVersion(client);
  const fromVersion = releaseVersion(ctx.env.require("RELEASE_E2E_CLOUD_UPDATE_FROM"), "N-1");
  const target = releaseVersion(ctx.env.require("RELEASE_E2E_CLOUD_UPDATE_TO"), "candidate N");
  assert.notEqual(fromVersion, target, `T4-CLOUD-1: N-1 and candidate N are identical (${target})`);
  assert.equal(
    advertisedBefore,
    fromVersion,
    `T4-CLOUD-1: server advertises ${advertisedBefore || "(unset)"}, not configured N-1 ${fromVersion}`,
  );
  assert.equal(
    runningBefore,
    fromVersion,
    `T4-CLOUD-1: sandbox runs ${runningBefore || "(unset)"}, not configured N-1 ${fromVersion}`,
  );
  const baselineCatalog = await runtimeGet<RuntimeCatalogVersion>(client, "/v1/catalogs/agents/version");
  assert.equal(
    baselineCatalog.catalogVersion,
    candidateCatalog.catalogVersion,
    `T4-CLOUD-1: N-1 runtime has active catalog ${baselineCatalog.catalogVersion}, ` +
      `not candidate catalog ${candidateCatalog.catalogVersion}`,
  );

  console.log(
    `[T4-CLOUD-1] baseline: advertised=${advertisedBefore} runtime=${runningBefore} ` +
      `catalog=${baselineCatalog.catalogVersion}/${baselineCatalog.source}`,
  );

  const workspace = await qualificationWorkspace(client);
  const launchOptions = await runtimeGet<RuntimeLaunchOptions>(
    client,
    `/v1/agents/launch-options?workspace_id=${encodeURIComponent(workspace.id)}`,
  );
  const qualificationAgent = selectQualificationAgent(ctx.agents, launchOptions, candidateCatalog);
  const baselineAgent = await runtimeGet<RuntimeAgentSummary>(
    client,
    `/v1/agents/${encodeURIComponent(qualificationAgent.kind)}`,
  );
  assertAgentArtifactsMatchPins(baselineAgent, qualificationAgent);

  let durableSession: RuntimeSessionSummary | undefined;
  try {
    durableSession = await runtimePost<RuntimeSessionSummary>(client, "/v1/sessions", {
      workspaceId: workspace.id,
      agentKind: qualificationAgent.kind,
      modelId: qualificationAgent.modelId,
      subagentsEnabled: true,
    });
    assert.ok(durableSession.nativeSessionId, "T4-CLOUD-1: N-1 session has no native session id");
    assert.equal(
      durableSession.executionSummary?.hasLiveHandle,
      true,
      "T4-CLOUD-1: N-1 session did not start a live agent handle",
    );
    assertQualificationMcpApplied(durableSession);

    await runtimePost(client, `/v1/sessions/${encodeURIComponent(durableSession.id)}/prompt`, {
      blocks: [{ type: "text", text: "Complete one short readiness turn without using tools." }],
    });
    const baselineEvents = await waitForTerminalTurn(client, durableSession.id, 0, TURN_TIMEOUT_MS);
    const baselineTurn = assertTerminalTurnEvidence(baselineEvents, 0);
    const baselineLastSeq = maxEventSeq(baselineEvents);
    console.log(
      `[T4-CLOUD-1] N-1 live session=${durableSession.id} agent=${qualificationAgent.kind} ` +
        `model=${qualificationAgent.modelId} turn=${baselineTurn.turnId} lastSeq=${baselineLastSeq}`,
    );

    await qualifyRuntimeUpdate({
      client,
      target,
      restorePin: fromVersion,
      candidateCatalog,
      qualificationAgent,
      durableSession,
      baselineLastSeq,
    });
  } finally {
    if (durableSession) {
      await runtimePost(
        client,
        `/v1/sessions/${encodeURIComponent(durableSession.id)}/close`,
        {},
      ).catch((error) => {
        console.warn(`[T4-CLOUD-1] session cleanup failed: ${describeError(error)}`);
      });
    }
  }
}

interface RuntimeCatalogVersion {
  catalogVersion: string;
  source: string;
}

interface RuntimeWorkspaceSummary {
  id: string;
  kind: string;
  surface: string;
  lifecycleState: string;
  createdAt?: string;
}

interface RuntimeQualificationInput {
  client: ApiClient;
  target: string;
  restorePin: string;
  candidateCatalog: QualificationCatalogDocument;
  qualificationAgent: QualificationAgent;
  durableSession: RuntimeSessionSummary;
  baselineLastSeq: number;
}

async function qualifyRuntimeUpdate(input: RuntimeQualificationInput): Promise<void> {
  const {
    client,
    target,
    restorePin,
    candidateCatalog,
    qualificationAgent,
    durableSession,
    baselineLastSeq,
  } = input;
  console.log(`[T4-CLOUD-1] bumping advertised RUNTIME_VERSION -> ${target}`);
  const bump = await bumpStagingRuntimePin(STAGING_ECS_TARGET, target);
  let qualificationError: unknown;
  try {
    const advertisedConverged = await waitForAdvertisedRuntimePin(client, target, CONVERGE_TIMEOUT_MS);
    assert.ok(advertisedConverged, `T4-CLOUD-1: staging /meta never advertised candidate N ${target}`);

    const binaryConverged = await waitForRuntimeVersion(client, target, CONVERGE_TIMEOUT_MS);
    assert.ok(
      binaryConverged,
      `T4-CLOUD-1: AnyHarness did not converge in place to candidate N ${target} within ` +
        `${CONVERGE_TIMEOUT_MS / 1000}s`,
    );
    const running = await proxiedRuntimeVersion(client);
    assert.ok(
      anyharnessBinaryConverged(running, target),
      `T4-CLOUD-1: runtime /health version ${running} did not converge to advertised pin ${target}`,
    );

    await waitForRuntimeQualification(
      client,
      candidateCatalog.catalogVersion,
      qualificationAgent,
      QUALIFICATION_TIMEOUT_MS,
    );

    const persisted = await runtimeGet<RuntimeSessionSummary>(
      client,
      `/v1/sessions/${encodeURIComponent(durableSession.id)}`,
    );
    assertSameDurableSession(durableSession, persisted);

    const resumed = await runtimePost<RuntimeSessionSummary>(
      client,
      `/v1/sessions/${encodeURIComponent(durableSession.id)}/resume`,
      {},
    );
    assertSameDurableSession(durableSession, resumed);
    assert.equal(
      resumed.executionSummary?.hasLiveHandle,
      true,
      "T4-CLOUD-1: candidate N did not recreate a live handle for the durable session",
    );
    assertQualificationMcpApplied(resumed);

    const eventsAfterResume = await runtimeGet<RuntimeSessionEventEnvelope[]>(
      client,
      `/v1/sessions/${encodeURIComponent(durableSession.id)}/events?limit=5000`,
    );
    assert.ok(
      maxEventSeq(eventsAfterResume) >= baselineLastSeq,
      "T4-CLOUD-1: persisted event log regressed across the runtime swap",
    );

    await runtimePost(client, `/v1/sessions/${encodeURIComponent(durableSession.id)}/prompt`, {
      blocks: [
        {
          type: "text",
          text:
            "Use the subagents MCP server now. Call list_subagents exactly once, wait for its result, " +
            "then reply briefly. Do not call any other tool.",
        },
      ],
    });
    const postUpdateEvents = await waitForTerminalTurn(
      client,
      durableSession.id,
      baselineLastSeq,
      TURN_TIMEOUT_MS,
    );
    const postUpdateTurn = assertTerminalTurnEvidence(
      postUpdateEvents,
      baselineLastSeq,
      QUALIFICATION_MCP_TOOL,
    );
    console.log(
      `[T4-CLOUD-1] qualified N=${target}: catalog=${candidateCatalog.catalogVersion} ` +
        `agent=${qualificationAgent.kind} MCP=${QUALIFICATION_MCP_TOOL} ` +
        `session=${durableSession.id} turn=${postUpdateTurn.turnId} terminalSeq=${postUpdateTurn.terminalSeq}`,
    );
  } catch (error) {
    qualificationError = error;
  }

  let restoreError: unknown;
  try {
    await restoreStagingRuntimePin(STAGING_ECS_TARGET, bump.previousTaskDefinitionArn);
    const restored = await waitForAdvertisedRuntimePin(client, restorePin, CONVERGE_TIMEOUT_MS);
    assert.ok(restored, `T4-CLOUD-1: staging /meta did not return to the original runtime pin ${restorePin}`);
  } catch (error) {
    restoreError = error;
  }
  if (restoreError) {
    const restoreMessage =
      `failed to restore staging task definition ${bump.previousTaskDefinitionArn}; manual command: ` +
      `aws ecs update-service --cluster ${STAGING_ECS_TARGET.cluster} --service ${STAGING_ECS_TARGET.service} ` +
      `--task-definition ${bump.previousTaskDefinitionArn}`;
    const errors = qualificationError ? [qualificationError, restoreError] : [restoreError];
    throw new AggregateError(errors, `T4-CLOUD-1: ${restoreMessage}`);
  }
  if (qualificationError) {
    throw qualificationError;
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

async function readCandidateCatalog(): Promise<QualificationCatalogDocument> {
  const contents = await readFile(CANDIDATE_CATALOG_URL, "utf8");
  const catalog = JSON.parse(contents) as QualificationCatalogDocument;
  assert.ok(catalog.catalogVersion?.trim(), "T4-CLOUD-1: candidate catalogVersion is missing");
  assert.ok(Array.isArray(catalog.agents) && catalog.agents.length > 0, "T4-CLOUD-1: candidate catalog has no agents");
  return catalog;
}

async function qualificationWorkspace(client: ApiClient): Promise<RuntimeWorkspaceSummary> {
  let workspaces: RuntimeWorkspaceSummary[];
  try {
    workspaces = await runtimeGet<RuntimeWorkspaceSummary[]>(client, "/v1/workspaces");
  } catch (error) {
    if (isTransientGatewayError(error)) {
      throw new ScenarioBlockedError(
        "T4-CLOUD-1: the durable staging user's sandbox row is ready but its AnyHarness gateway is not " +
          "reachable. Fully materialize the dedicated sandbox before qualification.",
      );
    }
    throw error;
  }
  const candidates = workspaces
    .filter((workspace) => workspace.surface === "standard" && workspace.lifecycleState === "active")
    .sort((left, right) => {
      if (left.kind === "local" && right.kind !== "local") return -1;
      if (right.kind === "local" && left.kind !== "local") return 1;
      return (right.createdAt ?? "").localeCompare(left.createdAt ?? "");
    });
  const selected = candidates[0];
  if (!selected) {
    throw new ScenarioBlockedError(
      "T4-CLOUD-1: the dedicated staging sandbox has no active standard AnyHarness workspace. " +
        "Provision one repository workspace for the durable qualification user before running the scenario; " +
        "the update test will create and later close only its own session.",
    );
  }
  return selected;
}

/** The version the server advertises as the runtime pin (from /meta). */
async function advertisedRuntimePin(client: ApiClient): Promise<string> {
  const meta = await client.get<{ runtimeVersion?: string }>("/meta");
  return (meta.runtimeVersion ?? "").trim();
}

/** The runtime's own reported version, via the sandbox anyharness proxy. */
async function proxiedRuntimeVersion(client: ApiClient): Promise<string> {
  try {
    const health = await runtimeGet<RuntimeHealth>(client, "/health");
    assert.equal(health.status, "ok", `T4-CLOUD-1: runtime /health status is ${health.status ?? "missing"}`);
    return runtimeHealthVersion(health);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      throw new ScenarioBlockedError(
        "T4-CLOUD-1: the sandbox AnyHarness gateway /health route 404s. Deploy a server with the real " +
          "/v1/gateway/cloud-sandbox/anyharness/* proxy before qualification.",
      );
    }
    throw error;
  }
}

async function waitForAdvertisedRuntimePin(client: ApiClient, target: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const advertised = await advertisedRuntimePin(client).catch(() => "");
    if (advertised === target) {
      return true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
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

async function waitForRuntimeQualification(
  client: ApiClient,
  expectedCatalogVersion: string,
  expectedAgent: QualificationAgent,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastObserved = "no runtime response";
  while (Date.now() < deadline) {
    try {
      const [catalog, reconcile, agent] = await Promise.all([
        runtimeGet<RuntimeCatalogVersion>(client, "/v1/catalogs/agents/version"),
        runtimeGet<RuntimeReconcileStatus>(client, "/v1/agents/reconcile"),
        runtimeGet<RuntimeAgentSummary>(client, `/v1/agents/${encodeURIComponent(expectedAgent.kind)}`),
      ]);
      const reconcileResult = reconcile.results.find((entry) => entry.kind === expectedAgent.kind);
      lastObserved =
        `catalog=${catalog.catalogVersion}/${catalog.source}, reconcile=${reconcile.status}/` +
        `${reconcileResult?.outcome ?? "missing"}, agentProcess=${agent.agentProcess?.version ?? "missing"}, ` +
        `native=${agent.native?.version ?? "n/a"}`;

      if (reconcile.status === "failed") {
        throw new Error(`T4-CLOUD-1: startup agent reconcile failed: ${reconcile.message ?? "no detail"}`);
      }
      if (catalog.catalogVersion !== expectedCatalogVersion || reconcile.status !== "completed") {
        await sleep(TURN_POLL_INTERVAL_MS);
        continue;
      }
      if (!reconcileResult) {
        await sleep(TURN_POLL_INTERVAL_MS);
        continue;
      }
      assertReconcileCompletedForAgent(reconcile, expectedAgent.kind);
      assertAgentArtifactsMatchPins(agent, expectedAgent);
      return;
    } catch (error) {
      if (!isTransientGatewayError(error)) {
        throw error;
      }
      lastObserved = describeError(error);
      await sleep(TURN_POLL_INTERVAL_MS);
    }
  }
  throw new Error(
    `T4-CLOUD-1: runtime catalog/agent reconciliation did not converge within ${timeoutMs / 1000}s; ` +
      `last observed ${lastObserved}`,
  );
}

async function waitForTerminalTurn(
  client: ApiClient,
  sessionId: string,
  afterSeq: number,
  timeoutMs: number,
): Promise<RuntimeSessionEventEnvelope[]> {
  const deadline = Date.now() + timeoutMs;
  let lastEvents: RuntimeSessionEventEnvelope[] = [];
  while (Date.now() < deadline) {
    lastEvents = await runtimeGet<RuntimeSessionEventEnvelope[]>(
      client,
      `/v1/sessions/${encodeURIComponent(sessionId)}/events?after_seq=${afterSeq}&limit=5000&oldest_first=true`,
    );
    const error = lastEvents.find((entry) => entry.event.type === "error");
    if (error) {
      throw new Error(
        `T4-CLOUD-1: session ${sessionId} emitted error at seq ${error.seq}: ` +
          `${error.event.message ?? "unknown runtime error"}`,
      );
    }
    if (lastEvents.some((entry) => entry.event.type === "turn_ended")) {
      return lastEvents;
    }
    await sleep(TURN_POLL_INTERVAL_MS);
  }
  throw new Error(
    `T4-CLOUD-1: session ${sessionId} did not reach a terminal turn within ${timeoutMs / 1000}s ` +
      `(observed ${lastEvents.length} post-seq-${afterSeq} event(s))`,
  );
}

function runtimeGet<T>(client: ApiClient, path: string): Promise<T> {
  return client.get<T>(`${RUNTIME_GATEWAY_PREFIX}${normalizeRuntimePath(path)}`);
}

function runtimePost<T = unknown>(client: ApiClient, path: string, body: unknown): Promise<T> {
  return client.post<T>(`${RUNTIME_GATEWAY_PREFIX}${normalizeRuntimePath(path)}`, body);
}

function normalizeRuntimePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function releaseVersion(value: string, label: string): string {
  const version = value.trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`T4-CLOUD-1: ${label} version is not an immutable semver: ${JSON.stringify(value)}`);
  }
  return version;
}

function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return `${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function isTransientGatewayError(error: unknown): boolean {
  return (
    (error instanceof ApiRequestError && [502, 503, 504].includes(error.status)) ||
    error instanceof TypeError
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
