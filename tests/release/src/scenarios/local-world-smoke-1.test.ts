import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DETERMINISTIC_PROMPT,
  LOCAL_WORLD_SMOKE_1_ID,
  REPRESENTATIVE_HARNESS,
  localWorldSmoke1,
  resolveWorldConstructionInputs,
  runLocalWorldSmokeCell,
  type LocalWorldSmokeDriver,
} from "./local-world-smoke-1.js";
import type { ScenarioRunContext } from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { EnvResolution } from "../config/env-resolution.js";
import type { AuthenticatedActor } from "../fixtures/authenticated-actor.js";
import type { PreparedRepository } from "../fixtures/prepared-repository.js";
import type { ProductPage } from "../fixtures/product-page.js";
import type { PlannedCellV1 } from "../runner/result.js";
import type { CorrelatedTurnSpend, SpendSnapshot } from "../services/qualification-litellm.js";
import type { LocalWorldCleanupEvidence } from "../worlds/local-workspace/cleanup.js";
import type { LocalWorldPorts, ReadyLocalWorld } from "../worlds/local-workspace/world.js";

function fakeCandidateMap(): CandidateBuildMapV1 {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "a".repeat(40),
    artifacts: [
      {
        artifact_id: "server/linux-amd64",
        version: "1",
        sha256: "s".repeat(64),
        locator: { kind: "local_file", path: "/tmp/server.tar" },
      },
      {
        artifact_id: "anyharness/x86_64-unknown-linux-gnu",
        version: "1",
        sha256: "a".repeat(64),
        locator: { kind: "local_file", path: "/tmp/anyharness" },
      },
      {
        artifact_id: "desktop-renderer/browser",
        version: "1",
        sha256: "d".repeat(64),
        locator: { kind: "local_file", path: "/tmp/renderer.tar" },
      },
    ],
  };
}

function fakePorts(): LocalWorldPorts {
  return { server: 1, postgres: 2, redis: 3, anyharness: 4, renderer: 5 };
}

function fakeEnv(vars: Record<string, string> = {}): EnvResolution {
  const defaults: Record<string, string> = {
    AGENT_GATEWAY_LITELLM_BASE_URL: "https://admin.litellm.example",
    AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: "https://public.litellm.example",
    AGENT_GATEWAY_LITELLM_MASTER_KEY: "sk-test-master",
    ...vars,
  };
  return {
    all: [],
    missing: [],
    present: (name) => defaults[name] !== undefined,
    get: (name) => defaults[name],
    require: (name) => {
      const value = defaults[name];
      if (!value) {
        throw new Error(`missing required env var "${name}"`);
      }
      return value;
    },
  };
}

function fakeCtx(overrides: Partial<ScenarioRunContext> = {}): ScenarioRunContext {
  return {
    targetLane: "local",
    runtimeLane: "local",
    desktop: "web",
    agents: [REPRESENTATIVE_HARNESS],
    dryRun: false,
    env: fakeEnv(),
    candidateBuildMap: fakeCandidateMap(),
    runIdentity: {
      run_id: "local-run-1",
      shard_id: "local-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    runDir: "/tmp/run-1",
    ports: fakePorts(),
    ...overrides,
  };
}

function fakeCell(): PlannedCellV1 {
  return {
    cell_id: `${LOCAL_WORLD_SMOKE_1_ID}/local/harness=${REPRESENTATIVE_HARNESS}`,
    scenario_id: LOCAL_WORLD_SMOKE_1_ID,
    registry_flow_ref: "specs/developing/testing/flows.md#local-world-smoke",
    runtime_lane: "local",
    dimensions: { harness: REPRESENTATIVE_HARNESS },
    required_env: [],
  };
}

function fakeWorld(): ReadyLocalWorld {
  return {
    kind: "local-workspace",
    run: fakeCtx().runIdentity!,
    artifacts: {
      server: { artifact_id: "server/linux-amd64", version: "1.2.3", sha256: "s".repeat(64), path: "/tmp/server" },
      anyharness: {
        artifact_id: "anyharness/x86_64-unknown-linux-gnu",
        version: "4.5.6",
        sha256: "a".repeat(64),
        path: "/tmp/anyharness",
      },
      desktopRenderer: {
        artifact_id: "desktop-renderer/browser",
        version: "1",
        sha256: "d".repeat(64),
        path: "/tmp/renderer",
      },
    },
    api: undefined as never,
    runtime: undefined as never,
    renderer: undefined as never,
    gateway: undefined as never,
    paths: undefined as never,
    close: async () => cleanupEvidence({}),
  };
}

function cleanupEvidence(overrides: Partial<LocalWorldCleanupEvidence>): LocalWorldCleanupEvidence {
  return {
    ledgerIdHash: "ledger-hash",
    registered: 10,
    reconciled: 10,
    failed: 0,
    virtualKeyDeleted: true,
    litellmSubjectsDeleted: true,
    browserClosed: true,
    processesStopped: true,
    containersRemoved: true,
    localPathsRemoved: true,
    ...overrides,
  };
}

function fakeActor(): AuthenticatedActor {
  return {
    role: "owner",
    userId: "user-1",
    organizationId: "org-1",
    enrollmentId: "enrollment-1",
    api: undefined as never,
    session: undefined as never,
    gatewayKey: {
      userId: "user-1",
      enrollmentId: "enrollment-1",
      teamId: "team-1",
      litellmUserId: "litellm-user-1",
      keyAlias: "vk-user-user-1-enrollme",
      tokenId: "token-1",
      tokenIdHash: "token-hash-1",
    },
  };
}

interface DriverCallLog {
  calls: string[];
}

function fakeDriver(
  options: {
    allowlist?: string[];
    liveProbe?: string[];
    reply?: string;
    correlated?: CorrelatedTurnSpend;
    cleanup?: LocalWorldCleanupEvidence;
    buildWorldError?: Error;
  } = {},
): { driver: LocalWorldSmokeDriver; log: DriverCallLog } {
  const calls: string[] = [];
  const world = fakeWorld();
  const before: SpendSnapshot = { tokenIdHash: "token-hash-1", requestIds: ["req-existing"], takenAt: "t0" };
  const correlated: CorrelatedTurnSpend = options.correlated ?? {
    tokenIdHash: "token-hash-1",
    requestIds: ["req-new-1"],
    modelId: "claude-haiku-4-5",
    promptTokens: 10,
    completionTokens: 3,
    totalTokens: 13,
    spendUsd: 0.0001,
    windowStartedAt: "2026-01-01T00:00:00.000Z",
    windowFinishedAt: "2026-01-01T00:00:01.000Z",
  };
  const cleanup = options.cleanup ?? cleanupEvidence({});

  const driver: LocalWorldSmokeDriver = {
    buildWorld: async () => {
      calls.push("buildWorld");
      if (options.buildWorldError) {
        throw options.buildWorldError;
      }
      return world;
    },
    createActor: async (w) => {
      calls.push(`createActor:${w === world}`);
      return fakeActor();
    },
    prepareRepo: async (w, actor, cellId) => {
      calls.push(`prepareRepo:${cellId}`);
      return {
        path: `/tmp/repo/${cellId}`,
        repoUrl: "https://github.com/example/fixture.git",
        commit: "deadbeef",
        repoRootId: "repo-root-1",
      } satisfies PreparedRepository;
    },
    openPage: async () => {
      calls.push("openPage");
      return {
        context: undefined as never,
        page: undefined as never,
        debug: { console: [], network: [] },
        close: async () => {
          calls.push("page.close");
        },
      } satisfies ProductPage;
    },
    waitForGatewaySync: async (_world, _page, harnessKind) => {
      calls.push(`waitForGatewaySync:${harnessKind}`);
    },
    ensureHarnessReady: async (_world, _page, harnessKind) => {
      calls.push(`ensureHarnessReady:${harnessKind}`);
    },
    selectRepoAndWorkLocally: async () => {
      calls.push("selectRepoAndWorkLocally");
    },
    liveProbeModels: async () => {
      calls.push("liveProbeModels");
      return options.liveProbe ?? ["claude-haiku-4-5", "claude-sonnet-4-5"];
    },
    allowlistModels: async () => {
      calls.push("allowlistModels");
      return options.allowlist ?? ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-fable-9"];
    },
    selectModelInUi: async (_page, modelId) => {
      calls.push(`selectModelInUi:${modelId}`);
    },
    sendPromptAndMaterialize: async (_world, _page, prompt) => {
      calls.push(`sendPromptAndMaterialize:${prompt}`);
      return { workspaceId: "workspace-1", sessionId: "session-1", reply: options.reply ?? "pong" };
    },
    reopenAndVerify: async (_world, _page, expectations) => {
      calls.push(`reopenAndVerify:${expectations.workspaceId}:${expectations.sessionId}:${expectations.modelId}`);
    },
    snapshotSpend: async () => {
      calls.push("snapshotSpend");
      return before;
    },
    correlateTurn: async (_w, params) => {
      calls.push(`correlateTurn:${params.acceptedModelId}`);
      return correlated;
    },
    closeWorld: async (w) => {
      calls.push(`closeWorld:${w === world}`);
      return cleanup;
    },
  };
  return { driver, log: { calls } };
}

test("runLocalWorldSmokeCell drives every step in order and attaches complete evidence on success", async () => {
  const { driver, log } = fakeDriver();
  const outcome = await runLocalWorldSmokeCell(fakeCell(), fakeCtx(), driver);

  assert.equal(outcome.status, "green");
  assert.ok(outcome.evidence);
  assert.equal(outcome.evidence!.kind, "local_workspace_turn");
  assert.equal(outcome.evidence!.harness, "claude");
  assert.equal(outcome.evidence!.model_id, "claude-haiku-4-5");
  assert.equal(outcome.evidence!.transcript_reopened, true);
  assert.equal(outcome.evidence!.server_version, "1.2.3");
  assert.equal(outcome.evidence!.anyharness_version, "4.5.6");
  assert.deepEqual(outcome.evidence!.artifact_ids, [
    "server/linux-amd64",
    "anyharness/x86_64-unknown-linux-gnu",
    "desktop-renderer/browser",
  ]);
  assert.equal(outcome.evidence!.litellm.request_ids.length, 1);
  assert.equal(outcome.evidence!.cleanup.failed, 0);
  assert.equal(outcome.evidence!.cleanup.virtual_key_deleted, true);

  assert.deepEqual(log.calls, [
    "buildWorld",
    "createActor:true",
    "prepareRepo:LOCAL-WORLD-SMOKE-1/local/harness=claude",
    "openPage",
    "waitForGatewaySync:claude",
    "ensureHarnessReady:claude",
    "selectRepoAndWorkLocally",
    "allowlistModels",
    "liveProbeModels",
    "selectModelInUi:claude-haiku-4-5",
    "snapshotSpend",
    `sendPromptAndMaterialize:${DETERMINISTIC_PROMPT}`,
    "reopenAndVerify:workspace-1:session-1:claude-haiku-4-5",
    "correlateTurn:claude-haiku-4-5",
    "closeWorld:true",
    "page.close",
  ]);
});

test("model choice: prefers haiku over sonnet and excludes the fable tier", async () => {
  const { driver } = fakeDriver({
    allowlist: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-fable-9"],
    liveProbe: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-fable-9"],
    correlated: {
      tokenIdHash: "token-hash-1",
      requestIds: ["req-new-1"],
      modelId: "claude-haiku-4-5",
      promptTokens: 10,
      completionTokens: 3,
      totalTokens: 13,
      spendUsd: 0.0001,
      windowStartedAt: "2026-01-01T00:00:00.000Z",
      windowFinishedAt: "2026-01-01T00:00:01.000Z",
    },
  });
  const outcome = await runLocalWorldSmokeCell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "green");
  assert.equal(outcome.evidence!.model_id, "claude-haiku-4-5");
});

test("model choice: a fable-only intersection is blocked, never selected", async () => {
  const { driver, log } = fakeDriver({
    allowlist: ["claude-fable-9"],
    liveProbe: ["claude-fable-9"],
  });
  const outcome = await runLocalWorldSmokeCell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.reason?.code, "scenario_blocked");
  assert.ok(!log.calls.includes("selectModelInUi:claude-fable-9"));
  // World must still be closed on a blocked outcome.
  assert.ok(log.calls.includes("closeWorld:true"));
});

test("model choice: an empty intersection (no live-probed model in the allowlist) is blocked", async () => {
  const { driver } = fakeDriver({ allowlist: ["claude-haiku-4-5"], liveProbe: ["claude-sonnet-4-5"] });
  const outcome = await runLocalWorldSmokeCell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "blocked");
});

test("failure propagation: world construction failure yields a bounded failed outcome, no throw", async () => {
  const { driver } = fakeDriver({ buildWorldError: new Error("docker load failed") });
  const outcome = await runLocalWorldSmokeCell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /world construction failed: docker load failed/);
});

test("failure propagation: an empty assistant reply fails the cell and still closes the world", async () => {
  const { driver, log } = fakeDriver({ reply: "" });
  const outcome = await runLocalWorldSmokeCell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /empty assistant reply/);
  assert.ok(log.calls.includes("closeWorld:true"));
  assert.equal(outcome.evidence, undefined);
});

test("failure propagation: a UI step throwing fails the cell without losing world cleanup", async () => {
  const { driver, log } = fakeDriver();
  driver.selectRepoAndWorkLocally = async () => {
    throw new Error("could not find the 'Work locally' control");
  };
  const outcome = await runLocalWorldSmokeCell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /Work locally/);
  assert.ok(log.calls.includes("closeWorld:true"));
});

test("required cleanup failure: a nonzero cleanup.failed count fails an otherwise-successful cell", async () => {
  const { driver } = fakeDriver({ cleanup: cleanupEvidence({ failed: 1, reconciled: 9 }) });
  const outcome = await runLocalWorldSmokeCell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /cleanup did not fully reconcile/);
  // Evidence is still retained (spec: "safe evidence retained" on failure).
  assert.ok(outcome.evidence);
});

test("required cleanup failure: a false deletion boolean fails the cell even with failed === 0", async () => {
  const { driver } = fakeDriver({ cleanup: cleanupEvidence({ virtualKeyDeleted: false }) });
  const outcome = await runLocalWorldSmokeCell(fakeCell(), fakeCtx(), driver);
  assert.equal(outcome.status, "failed");
});

test("resolveWorldConstructionInputs fails closed when the candidate map is absent", () => {
  const result = resolveWorldConstructionInputs(fakeCtx({ candidateBuildMap: null }));
  assert.equal(result.ok, false);
});

test("resolveWorldConstructionInputs fails closed when run identity is absent", () => {
  const result = resolveWorldConstructionInputs(fakeCtx({ runIdentity: undefined }));
  assert.equal(result.ok, false);
});

test("resolveWorldConstructionInputs fails closed when a required LiteLLM env var is missing", () => {
  const result = resolveWorldConstructionInputs(
    fakeCtx({ env: fakeEnv({ AGENT_GATEWAY_LITELLM_MASTER_KEY: "" }) }),
  );
  assert.equal(result.ok, false);
});

test("missing world-construction inputs never reach buildWorld — the cell fails before any side effect", async () => {
  const { driver, log } = fakeDriver();
  const outcome = await runLocalWorldSmokeCell(fakeCell(), fakeCtx({ candidateBuildMap: null }), driver);
  assert.equal(outcome.status, "failed");
  assert.deepEqual(log.calls, []);
});

test("scenario definition declares the required LiteLLM env vars and the single harness=claude cell", async () => {
  assert.equal(localWorldSmoke1.id, LOCAL_WORLD_SMOKE_1_ID);
  assert.equal(localWorldSmoke1.kind, "matrix");
  assert.deepEqual(localWorldSmoke1.requiredEnv, [
    "AGENT_GATEWAY_LITELLM_BASE_URL",
    "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL",
    "AGENT_GATEWAY_LITELLM_MASTER_KEY",
  ]);
  if (localWorldSmoke1.kind !== "matrix") {
    throw new Error("expected a matrix scenario");
  }
  const cells = await localWorldSmoke1.expandCells({ runtimeLane: "local", desktop: "web", agents: ["claude"] });
  assert.deepEqual(cells, [{ dimensions: { harness: "claude" } }]);
});

test("planCell lists all ten spec-numbered steps plus cleanup, cell-id-prefixed", () => {
  if (localWorldSmoke1.kind !== "matrix") {
    throw new Error("expected a matrix scenario");
  }
  const steps = localWorldSmoke1.planCell({ runtimeLane: "local", desktop: "web", agents: ["claude"] }, fakeCell());
  assert.ok(steps.length >= 10);
  for (const step of steps) {
    assert.ok(step.description.startsWith(`[${fakeCell().cell_id}]`));
  }
});
