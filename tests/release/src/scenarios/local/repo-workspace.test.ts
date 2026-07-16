import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectLocal1WorkspaceCell,
  runLocal1WorkspaceLeaf,
  type LocalRepoWorkspaceDriver,
} from "./repo-workspace.js";
import { ScenarioBlockedError } from "../types.js";
import type { ScenarioRunContext } from "../types.js";
import type { CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import type { EnvResolution } from "../../config/env-resolution.js";
import type { AuthenticatedActor } from "../../fixtures/authenticated-actor.js";
import type { PreparedRepository } from "../../fixtures/prepared-repository.js";
import type { ProductPage } from "../../fixtures/product-page.js";
import type { PlannedCellV1 } from "../../runner/result.js";
import type { LocalWorldCleanupEvidence } from "../../worlds/local-workspace/cleanup.js";
import type { ReadyLocalWorld } from "../../worlds/local-workspace/world.js";

// ── Fakes (offline: no world, browser, container, or network) ────────────────

function fakeCandidateMap(): CandidateBuildMapV1 {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "a".repeat(40),
    artifacts: [
      { artifact_id: "server/linux-amd64", version: "1", sha256: "s".repeat(64), locator: { kind: "local_file", path: "/tmp/server.tar" } },
      { artifact_id: "anyharness/x86_64-unknown-linux-gnu", version: "1", sha256: "a".repeat(64), locator: { kind: "local_file", path: "/tmp/anyharness" } },
      { artifact_id: "desktop-renderer/browser", version: "1", sha256: "d".repeat(64), locator: { kind: "local_file", path: "/tmp/renderer.tar" } },
    ],
  };
}

function fakeEnv(): EnvResolution {
  const defaults: Record<string, string> = {
    AGENT_GATEWAY_LITELLM_BASE_URL: "https://admin.litellm.example",
    AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: "https://public.litellm.example",
    AGENT_GATEWAY_LITELLM_MASTER_KEY: "sk-test-master",
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
    agents: ["all"],
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
    ports: { server: 1, postgres: 2, redis: 3, anyharness: 4, renderer: 5 },
    ...overrides,
  };
}

function cell(scenarioId: string): PlannedCellV1 {
  return {
    cell_id: `${scenarioId}/local`,
    scenario_id: scenarioId,
    registry_flow_ref: "specs/developing/testing/tier-3-scenario-contract.md#local-1",
    runtime_lane: "local",
    dimensions: {},
    required_env: [],
  };
}

function cleanupEvidence(overrides: Partial<LocalWorldCleanupEvidence> = {}): LocalWorldCleanupEvidence {
  return {
    ledgerIdHash: "ledger-hash",
    registered: 6,
    reconciled: 6,
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

function fakeWorld(overrides: Partial<ReadyLocalWorld> = {}): ReadyLocalWorld {
  return {
    kind: "local-workspace",
    run: fakeCtx().runIdentity!,
    artifacts: {
      server: { artifact_id: "server/linux-amd64", version: "1.2.3", sha256: "s".repeat(64), path: "/tmp/server" },
      anyharness: { artifact_id: "anyharness/x86_64-unknown-linux-gnu", version: "4.5.6", sha256: "a".repeat(64), path: "/tmp/anyharness" },
      desktopRenderer: { artifact_id: "desktop-renderer/browser", version: "1", sha256: "d".repeat(64), path: "/tmp/renderer" },
    },
    api: undefined as never,
    runtime: undefined as never,
    renderer: undefined as never,
    gateway: undefined as never,
    paths: undefined as never,
    db: { databaseUrl: "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5599/proliferate" },
    trackActorSubjects: async () => undefined,
    close: async () => cleanupEvidence(),
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
      keyAlias: "vk-user-1",
      tokenId: "token-1",
      tokenIdHash: "token-hash-1",
    },
  };
}

const REPO_PATH = "/tmp/repo/e2e-fixture";
const REPO_NAME = "e2e-fixture";

interface FakeDriverOptions {
  cleanup?: LocalWorldCleanupEvidence;
  buildWorldError?: Error;
  created?: { workspaceId: string; sessionId: string; repoName: string; defaultBranch: string };
  emptyChatError?: Error;
  reloadError?: Error;
}

function fakeDriver(options: FakeDriverOptions = {}): { driver: LocalRepoWorkspaceDriver; calls: string[] } {
  const calls: string[] = [];
  const world = fakeWorld({ close: async () => (calls.push("closeWorld"), options.cleanup ?? cleanupEvidence()) });
  const driver: LocalRepoWorkspaceDriver = {
    buildWorld: async () => {
      calls.push("buildWorld");
      if (options.buildWorldError) {
        throw options.buildWorldError;
      }
      return world;
    },
    createActor: async () => (calls.push("createActor"), fakeActor()),
    prepareRepo: async (_w, _a, cellId) => {
      calls.push(`prepareRepo:${cellId}`);
      return { path: REPO_PATH, repoUrl: "https://github.com/example/e2e-fixture.git", commit: "deadbeef", repoRootId: "repo-root-1" } satisfies PreparedRepository;
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
    prepareAndAssertPendingComposer: async () => {
      calls.push("prepareAndAssertPendingComposer");
    },
    materializeBySend: async () => {
      calls.push("materializeBySend");
      return options.created ?? { workspaceId: "workspace-1", sessionId: "session-1", repoName: REPO_NAME, defaultBranch: "develop" };
    },
    assertSingleTabCommandable: async (_w, _p, workspaceId) => {
      calls.push(`assertSingleTabCommandable:${workspaceId}`);
      if (options.emptyChatError) {
        throw options.emptyChatError;
      }
    },
    reloadAndVerifyContinuity: async (_w, _p, expect) => {
      calls.push(`reloadAndVerifyContinuity:${expect.workspaceId}:${expect.defaultBranch}`);
      if (options.reloadError) {
        throw options.reloadError;
      }
    },
    closeWorld: (w) => w.close(),
  };
  return { driver, calls };
}

// ── LOCAL-1 (repository to workspace) ─────────────────────────────────────────

test("LOCAL-1: a world-backed run creates the workspace and returns green with evidence:null", async () => {
  const { driver } = fakeDriver();
  const outcome = await collectLocal1WorkspaceCell(fakeCtx(), cell("T3-WT-1"), driver);
  assert.equal(outcome.status, "green");
  // LOCAL-1 has no LLM turn and no kind-scoped evidence variant — the green
  // status is the proof (audit ruling #3).
  assert.equal(outcome.evidence, undefined);
});

test("LOCAL-1: the cell drives every step in contract order and closes the world once (no seeding)", async () => {
  const { driver, calls } = fakeDriver();
  await collectLocal1WorkspaceCell(fakeCtx(), cell("T3-WT-1"), driver);
  assert.deepEqual(calls, [
    "buildWorld",
    "createActor",
    "prepareRepo:T3-WT-1/local",
    "openPage",
    "prepareAndAssertPendingComposer",
    "materializeBySend",
    "assertSingleTabCommandable:workspace-1",
    "reloadAndVerifyContinuity:workspace-1:develop",
    "closeWorld",
    "page.close",
  ]);
  // Live-proof ruling (fix round 3): "no seeding" means no DIRECT DB/API
  // injection of a workspace/session/transcript — materializing through the
  // product's real send path is the requirement, not a violation. The driver
  // interface therefore exposes the pre-send empty-composer assertion followed by
  // a materialize-via-send step, and NO direct seed/inject seam.
  assert.ok(calls.includes("prepareAndAssertPendingComposer"));
  assert.ok(calls.includes("materializeBySend"));
  assert.ok(!calls.some((c) => /seed|inject/i.test(c)));
});

test("LOCAL-1: a non-world-backed run is a clean blocked cell and never builds a world", async () => {
  const { driver, calls } = fakeDriver();
  const outcome = await collectLocal1WorkspaceCell(fakeCtx({ candidateBuildMap: null }), cell("T3-WT-1"), driver);
  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.reason?.code, "scenario_blocked");
  assert.match(outcome.reason?.message ?? "", /candidate world/i);
  assert.ok(!calls.includes("buildWorld"));
});

test("LOCAL-1: a world-construction failure fails cleanly, never throwing", async () => {
  const { driver } = fakeDriver({ buildWorldError: new Error("boom: server image failed to load") });
  const outcome = await collectLocal1WorkspaceCell(fakeCtx(), cell("T3-WT-1"), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /world construction failed/i);
});

test("LOCAL-1: a repository mismatch fails the cell (T3-REPO-1 correct-repository assertion)", async () => {
  const { driver } = fakeDriver({ created: { workspaceId: "workspace-1", sessionId: "session-1", repoName: "some-other-repo", defaultBranch: "develop" } });
  const outcome = await collectLocal1WorkspaceCell(fakeCtx(), cell("T3-WT-1"), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /does not match the prepared repo/i);
});

test("LOCAL-1: a missing default branch fails the cell (T3-REPO-1 default-branch assertion)", async () => {
  const { driver } = fakeDriver({ created: { workspaceId: "workspace-1", sessionId: "session-1", repoName: REPO_NAME, defaultBranch: "" } });
  const outcome = await collectLocal1WorkspaceCell(fakeCtx(), cell("T3-WT-1"), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /default branch/i);
});

test("LOCAL-1: an empty-chat assertion failure fails the cell and still closes the world", async () => {
  const { driver, calls } = fakeDriver({ emptyChatError: new Error("saw 2 tabs") });
  const outcome = await collectLocal1WorkspaceCell(fakeCtx(), cell("T3-WT-1"), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /saw 2 tabs/);
  assert.ok(calls.includes("closeWorld"));
});

test("LOCAL-1: a cleanup that does not fully reconcile fails the cell", async () => {
  const { driver } = fakeDriver({ cleanup: cleanupEvidence({ failed: 1, containersRemoved: false }) });
  const outcome = await collectLocal1WorkspaceCell(fakeCtx(), cell("T3-WT-1"), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /cleanup did not fully reconcile/i);
});

// ── Leaf adapter (T3-WT-1 / T3-REPO-1) ────────────────────────────────────────

test("runLocal1WorkspaceLeaf: green outcome resolves without throwing", async () => {
  const { driver } = fakeDriver();
  await runLocal1WorkspaceLeaf(
    fakeCtx(),
    { scenarioId: "T3-REPO-1", registryFlowRef: "specs/developing/testing/tier-3-scenario-contract.md#local-1" },
    driver,
  );
});

test("runLocal1WorkspaceLeaf: a non-world-backed run throws ScenarioBlockedError (leaf blocked)", async () => {
  const { driver } = fakeDriver();
  await assert.rejects(
    () =>
      runLocal1WorkspaceLeaf(
        fakeCtx({ candidateBuildMap: null }),
        { scenarioId: "T3-WT-1", registryFlowRef: "ref" },
        driver,
      ),
    (error: unknown) => error instanceof ScenarioBlockedError && /candidate world/i.test((error as Error).message),
  );
});

test("runLocal1WorkspaceLeaf: a failure throws a plain Error (leaf red)", async () => {
  const { driver } = fakeDriver({ buildWorldError: new Error("boom") });
  await assert.rejects(
    () =>
      runLocal1WorkspaceLeaf(fakeCtx(), { scenarioId: "T3-WT-1", registryFlowRef: "ref" }, driver),
    (error: unknown) => error instanceof Error && !(error instanceof ScenarioBlockedError) && /world construction failed/i.test((error as Error).message),
  );
});
