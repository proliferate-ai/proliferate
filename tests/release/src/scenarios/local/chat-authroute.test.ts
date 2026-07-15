import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  BYOK_ENV_BY_HARNESS,
  GATEWAY_PROVIDER_ID,
  HARNESSES_WITHOUT_GATEWAY_AUTH_SLOT,
  LOCAL6_REPRESENTATIVE_HARNESS,
  assertOpencodeProviderSource,
  buildLocalRouteTurnEvidence,
  collectLocal2GatewayCells,
  collectLocal3UserKeyCells,
  collectLocal6RouteChangeCell,
  type LocalRouteDriver,
  type RouteModelSelection,
} from "./chat-authroute.js";
import type { ScenarioRunContext } from "../types.js";
import { t3Authroute1 } from "../t3-authroute-1.js";
import type { CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import type { EnvResolution } from "../../config/env-resolution.js";
import type { AuthenticatedActor } from "../../fixtures/authenticated-actor.js";
import type { PreparedRepository } from "../../fixtures/prepared-repository.js";
import type { ProductPage } from "../../fixtures/product-page.js";
import type { PlannedCellV1 } from "../../runner/result.js";
import type { SpendSnapshot } from "../../services/qualification-litellm.js";
import type { LocalCleanupV1, LocalHarnessKind, LocalLitellmSpendV1, LocalRoute } from "../../evidence/schema.js";
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

function cell(scenarioId: string, dimensions: Record<string, string>): PlannedCellV1 {
  const dimPart = Object.entries(dimensions)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return {
    cell_id: `${scenarioId}/local/${dimPart}`,
    scenario_id: scenarioId,
    registry_flow_ref: "specs/developing/testing/tier-3-scenario-contract.md#local",
    runtime_lane: "local",
    dimensions,
    required_env: [],
  };
}

function cleanupEvidence(overrides: Partial<LocalWorldCleanupEvidence> = {}): LocalWorldCleanupEvidence {
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
    trackActorSubjects: async () => undefined,
    close: async () => cleanupEvidence(),
    ...overrides,
  };
}

function fakeActor(harness: LocalHarnessKind): AuthenticatedActor {
  return {
    role: "owner",
    userId: `user-${harness}`,
    organizationId: "org-1",
    enrollmentId: `enrollment-${harness}`,
    api: undefined as never,
    session: undefined as never,
    gatewayKey: {
      userId: `user-${harness}`,
      enrollmentId: `enrollment-${harness}`,
      teamId: "team-1",
      litellmUserId: "litellm-user-1",
      keyAlias: "vk-user-1",
      tokenId: "token-1",
      tokenIdHash: "token-hash-1",
    },
  };
}

function fakeSpend(): LocalLitellmSpendV1 {
  return {
    token_id_hash: "token-hash-1",
    request_ids: ["req-new-1"],
    window_started_at: "2026-01-01T00:00:00.000Z",
    window_finished_at: "2026-01-01T00:00:01.000Z",
    prompt_tokens: 10,
    completion_tokens: 3,
    total_tokens: 13,
    spend_usd: 0.0001,
  };
}

interface FakeDriverOptions {
  reply?: string;
  cleanup?: LocalWorldCleanupEvidence;
  buildWorldError?: Error;
  resolveRouteModel?: (harness: LocalHarnessKind, route: LocalRoute) => RouteModelSelection;
  managedSpendLeak?: boolean;
}

function fakeDriver(options: FakeDriverOptions = {}): { driver: LocalRouteDriver; calls: string[]; world: ReadyLocalWorld } {
  const calls: string[] = [];
  const world = fakeWorld({ close: async () => (calls.push("closeWorld"), options.cleanup ?? cleanupEvidence()) });
  const before: SpendSnapshot = { tokenIdHash: "token-hash-1", requestIds: [], takenAt: "t0" };
  const resolve =
    options.resolveRouteModel ??
    ((_harness: LocalHarnessKind, route: LocalRoute): RouteModelSelection => ({
      route,
      modelId: "claude-haiku-4-5",
      providerId: route === "gateway" ? GATEWAY_PROVIDER_ID : "anthropic",
    }));

  const driver: LocalRouteDriver = {
    buildWorld: async () => {
      calls.push("buildWorld");
      if (options.buildWorldError) {
        throw options.buildWorldError;
      }
      return world;
    },
    createGatewayActor: async (_w, harness) => (calls.push(`createGatewayActor:${harness}`), fakeActor(harness)),
    createUserKeyActor: async (_w, harness) => (calls.push(`createUserKeyActor:${harness}`), fakeActor(harness)),
    createDualRouteActor: async (_w, harness) => (calls.push(`createDualRouteActor:${harness}`), fakeActor(harness)),
    prepareRepo: async (_w, _a, cellId) => {
      calls.push(`prepareRepo:${cellId}`);
      return { path: `/tmp/repo/${cellId}`, repoUrl: "https://github.com/example/fixture.git", commit: "deadbeef", repoRootId: "repo-root-1" } satisfies PreparedRepository;
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
    ensureHarnessReady: async (_w, _p, harness) => {
      calls.push(`ensureHarnessReady:${harness}`);
    },
    storeAndSelectUserKeyRoute: async (_p, harness) => {
      calls.push(`storeAndSelectUserKeyRoute:${harness}`);
    },
    switchSelectedRouteToGateway: async (_w, _p, harness) => {
      calls.push(`switchSelectedRouteToGateway:${harness}`);
    },
    waitForRouteSync: async (_w, _p, harness, route) => {
      calls.push(`waitForRouteSync:${harness}:${route}`);
    },
    selectRepoAndWorkLocally: async () => {
      calls.push("selectRepoAndWorkLocally");
    },
    resolveRouteModel: async (_w, _p, harness, route) => {
      calls.push(`resolveRouteModel:${harness}:${route}`);
      return resolve(harness, route);
    },
    selectModelInUi: async (_p, modelId) => {
      calls.push(`selectModelInUi:${modelId}`);
    },
    sendBoundedTurn: async (_w, _p, route) => {
      calls.push(`sendBoundedTurn:${route}`);
      return { workspaceId: "workspace-1", sessionId: `session-${route}`, reply: options.reply ?? "pong" };
    },
    reopenAndVerify: async (_w, _p, expect) => {
      calls.push(`reopenAndVerify:${expect.route}:${expect.sessionId}`);
    },
    correlateGatewaySpend: async () => {
      calls.push("correlateGatewaySpend");
      return fakeSpend();
    },
    snapshotGatewaySpend: async () => {
      calls.push("snapshotGatewaySpend");
      return before;
    },
    assertNoManagedSpend: async () => {
      calls.push("assertNoManagedSpend");
      if (options.managedSpendLeak) {
        throw new Error("assertNoManagedSpend: user-key route leaked 1 LiteLLM spend row(s)");
      }
      return { litellmSpendRows: 0, managedBalanceDeltaUsd: 0 };
    },
    closeWorld: (w) => w.close(),
  };
  return { driver, calls, world };
}

// ── LOCAL-2 (gateway per harness) ─────────────────────────────────────────────

test("LOCAL-2: a non-cursor harness produces a green local_route_turn (route=gateway) with folded cleanup", async () => {
  const { driver } = fakeDriver();
  const [outcome] = await collectLocal2GatewayCells(fakeCtx(), [cell("T3-CHAT-1", { harness: "claude" })], driver);
  assert.equal(outcome.status, "green");
  const ev = outcome.evidence as { kind: string; journey: string; route: string; harness: string; gateway_spend: unknown; user_key_isolation: unknown; route_change: unknown; billing_reconcile_deferred: boolean; transcript_reopened: boolean; cleanup: { failed: number } };
  assert.equal(ev.kind, "local_route_turn");
  assert.equal(ev.journey, "LOCAL-2");
  assert.equal(ev.route, "gateway");
  assert.equal(ev.harness, "claude");
  assert.ok(ev.gateway_spend);
  assert.equal(ev.user_key_isolation, null);
  assert.equal(ev.route_change, null);
  assert.equal(ev.billing_reconcile_deferred, true);
  assert.equal(ev.transcript_reopened, true);
  assert.equal(ev.cleanup.failed, 0);
});

test("LOCAL-2: cursor is a truthful typed-unsupported blocked cell with evidence:null, never dropped", async () => {
  assert.ok(HARNESSES_WITHOUT_GATEWAY_AUTH_SLOT.has("cursor"));
  const { driver, calls } = fakeDriver();
  const [outcome] = await collectLocal2GatewayCells(fakeCtx(), [cell("T3-CHAT-1", { harness: "cursor" })], driver);
  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.reason?.code, "scenario_blocked");
  assert.match(outcome.reason?.message ?? "", /gateway/i);
  assert.equal(outcome.evidence, undefined);
  // Cursor never creates an actor or runs a turn.
  assert.ok(!calls.some((c) => c.startsWith("createGatewayActor")));
  assert.ok(!calls.includes("sendBoundedTurn:gateway"));
});

test("LOCAL-2: a green harness cannot hide the cursor blocked child — both emit explicit results", async () => {
  const { driver } = fakeDriver();
  const cells = [cell("T3-CHAT-1", { harness: "claude" }), cell("T3-CHAT-1", { harness: "cursor" })];
  const outcomes = await collectLocal2GatewayCells(fakeCtx(), cells, driver);
  assert.equal(outcomes.length, 2);
  const byId = new Map(outcomes.map((o) => [o.cellId, o]));
  assert.equal(byId.get("T3-CHAT-1/local/harness=claude")?.status, "green");
  assert.equal(byId.get("T3-CHAT-1/local/harness=cursor")?.status, "blocked");
});

test("LOCAL-2: the gateway cell drives every step in the contract order and closes the world once", async () => {
  const { driver, calls } = fakeDriver();
  await collectLocal2GatewayCells(fakeCtx(), [cell("T3-CHAT-1", { harness: "claude" })], driver);
  assert.deepEqual(calls, [
    "buildWorld",
    "createGatewayActor:claude",
    "prepareRepo:T3-CHAT-1/local/harness=claude",
    "openPage",
    "waitForRouteSync:claude:gateway",
    "ensureHarnessReady:claude",
    "selectRepoAndWorkLocally",
    "resolveRouteModel:claude:gateway",
    "selectModelInUi:claude-haiku-4-5",
    "snapshotGatewaySpend",
    "sendBoundedTurn:gateway",
    "reopenAndVerify:gateway:session-gateway",
    "correlateGatewaySpend",
    "page.close",
    "closeWorld",
  ]);
});

test("LOCAL-2: OpenCode gateway cell must select the injected proliferate provider or the cell fails", async () => {
  const { driver } = fakeDriver({
    resolveRouteModel: (_h, route) => ({ route, modelId: "anthropic/claude-haiku", providerId: "anthropic" }),
  });
  const [outcome] = await collectLocal2GatewayCells(fakeCtx(), [cell("T3-CHAT-1", { harness: "opencode" })], driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /opencode.*proliferate/i);
});

test("LOCAL-2: OpenCode gateway cell is green when the model comes from the proliferate provider", async () => {
  const { driver } = fakeDriver({
    resolveRouteModel: (_h, route) => ({ route, modelId: "claude-haiku-4-5", providerId: GATEWAY_PROVIDER_ID }),
  });
  const [outcome] = await collectLocal2GatewayCells(fakeCtx(), [cell("T3-CHAT-1", { harness: "opencode" })], driver);
  assert.equal(outcome.status, "green");
});

test("LOCAL-2: an empty assistant reply fails the cell and still closes the world", async () => {
  const { driver, calls } = fakeDriver({ reply: "" });
  const [outcome] = await collectLocal2GatewayCells(fakeCtx(), [cell("T3-CHAT-1", { harness: "claude" })], driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /empty assistant reply/);
  assert.ok(calls.includes("closeWorld"));
});

// ── LOCAL-3 (user-key per harness) ─────────────────────────────────────────────

test("LOCAL-3: a user-key harness is green with route=user_key, zero-isolation, and no gateway spend", async () => {
  const { driver, calls } = fakeDriver();
  const [outcome] = await collectLocal3UserKeyCells(fakeCtx(), [cell("T3-AUTHROUTE-1", { harness: "claude" })], driver);
  assert.equal(outcome.status, "green");
  const ev = outcome.evidence as { journey: string; route: string; gateway_spend: unknown; user_key_isolation: { litellm_spend_rows: number; managed_balance_delta_usd: number } | null };
  assert.equal(ev.journey, "LOCAL-3");
  assert.equal(ev.route, "user_key");
  assert.equal(ev.gateway_spend, null);
  assert.deepEqual(ev.user_key_isolation, { litellm_spend_rows: 0, managed_balance_delta_usd: 0 });
  // The user key is stored + selected through the UI before the turn, and no
  // managed spend is correlated (isolation asserted, gateway never correlated).
  assert.ok(calls.includes("storeAndSelectUserKeyRoute:claude"));
  assert.ok(calls.includes("assertNoManagedSpend"));
  assert.ok(!calls.includes("correlateGatewaySpend"));
});

test("LOCAL-3: leaked managed spend on the user-key route fails the cell", async () => {
  const { driver } = fakeDriver({ managedSpendLeak: true });
  const [outcome] = await collectLocal3UserKeyCells(fakeCtx(), [cell("T3-AUTHROUTE-1", { harness: "grok" })], driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /leaked/i);
});

test("LOCAL-3: stores + selects the user key BEFORE gating harness readiness (decision #3)", async () => {
  // The api_key route only surfaces launch-options models after the key is
  // stored AND selected, so `ensureHarnessReady` (launchable gate) must come
  // AFTER store+select and the user-key route sync. Gating readiness first is
  // what timed out in run-1 ("never became launchable").
  const { driver, calls } = fakeDriver();
  await collectLocal3UserKeyCells(fakeCtx(), [cell("T3-AUTHROUTE-1", { harness: "claude" })], driver);
  const store = calls.indexOf("storeAndSelectUserKeyRoute:claude");
  const sync = calls.indexOf("waitForRouteSync:claude:user_key");
  const ready = calls.indexOf("ensureHarnessReady:claude");
  assert.ok(store >= 0 && sync >= 0 && ready >= 0, `missing a step: ${calls.join(",")}`);
  assert.ok(store < sync, "store+select must precede the user-key route sync");
  assert.ok(sync < ready, "the user-key route sync must precede the launchable gate");
});

test("LOCAL-6: stores + selects the user key BEFORE gating harness readiness (decision #3)", async () => {
  const { driver, calls } = fakeDriver();
  await collectLocal6RouteChangeCell(fakeCtx(), cell("T3-AUTHROUTE-1", { route: "change" }), driver);
  const store = calls.indexOf("storeAndSelectUserKeyRoute:claude");
  const sync = calls.indexOf("waitForRouteSync:claude:user_key");
  const ready = calls.indexOf("ensureHarnessReady:claude");
  assert.ok(store >= 0 && sync >= 0 && ready >= 0, `missing a step: ${calls.join(",")}`);
  assert.ok(store < sync && sync < ready, "store+select → user-key sync → readiness gate order");
});

test("LOCAL-3: OpenCode user-key cell must select a DIRECT provider, not the proliferate gateway provider", async () => {
  const { driver } = fakeDriver({
    resolveRouteModel: (_h, route) => ({ route, modelId: "claude-haiku-4-5", providerId: GATEWAY_PROVIDER_ID }),
  });
  const [outcome] = await collectLocal3UserKeyCells(fakeCtx(), [cell("T3-AUTHROUTE-1", { harness: "opencode" })], driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /opencode.*direct/i);
});

// ── LOCAL-6 (route change) ─────────────────────────────────────────────────────

test("LOCAL-6: route change proves a new gateway session while recording the original user-key session", async () => {
  const { driver, calls } = fakeDriver();
  const outcome = await collectLocal6RouteChangeCell(fakeCtx(), cell("T3-AUTHROUTE-1", { route: "change" }), driver);
  assert.equal(outcome.status, "green");
  const ev = outcome.evidence as {
    journey: string;
    route: string;
    gateway_spend: unknown;
    route_change: { original_route: string; original_session_id_hash: string; new_route: string; new_session_id_hash: string } | null;
  };
  assert.equal(ev.journey, "LOCAL-6");
  assert.equal(ev.route, "gateway");
  assert.ok(ev.gateway_spend);
  assert.ok(ev.route_change);
  assert.equal(ev.route_change!.original_route, "user_key");
  assert.equal(ev.route_change!.new_route, "gateway");
  assert.equal(ev.route_change!.original_session_id_hash, sha256Hex("session-user_key"));
  assert.equal(ev.route_change!.new_session_id_hash, sha256Hex("session-gateway"));
  // The representative single-source harness is claude, and both routes are driven.
  assert.ok(calls.includes(`createDualRouteActor:${LOCAL6_REPRESENTATIVE_HARNESS}`));
  assert.ok(calls.includes("switchSelectedRouteToGateway:claude"));
  assert.ok(calls.includes("sendBoundedTurn:user_key"));
  assert.ok(calls.includes("sendBoundedTurn:gateway"));
});

test("LOCAL-6: a route switch that reuses the same session id fails (route not process-bound)", async () => {
  const { driver } = fakeDriver();
  // Force both turns to return the same session id.
  driver.sendBoundedTurn = async () => ({ workspaceId: "workspace-1", sessionId: "same-session", reply: "pong" });
  const outcome = await collectLocal6RouteChangeCell(fakeCtx(), cell("T3-AUTHROUTE-1", { route: "change" }), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /new session/i);
});

// ── Batch lifecycle: world construction, cleanup, non-world-backed ────────────

test("world construction failure fails the whole batch cleanly, no throw", async () => {
  const { driver } = fakeDriver({ buildWorldError: new Error("docker load failed") });
  const outcomes = await collectLocal3UserKeyCells(
    fakeCtx(),
    [cell("T3-AUTHROUTE-1", { harness: "claude" }), cell("T3-AUTHROUTE-1", { harness: "codex" })],
    driver,
  );
  assert.equal(outcomes.length, 2);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed");
    assert.match(outcome.reason?.message ?? "", /world construction failed: docker load failed/);
  }
});

test("a non-world-backed run yields a clean per-cell blocked (T3-AUTHROUTE-1 has no legacy path)", async () => {
  const { driver, calls } = fakeDriver();
  const outcomes = await collectLocal3UserKeyCells(
    fakeCtx({ candidateBuildMap: null }),
    [cell("T3-AUTHROUTE-1", { harness: "claude" })],
    driver,
  );
  assert.equal(outcomes[0].status, "blocked");
  assert.equal(outcomes[0].reason?.code, "scenario_blocked");
  assert.match(outcomes[0].reason?.message ?? "", /requires the candidate world/i);
  // No world is ever built.
  assert.deepEqual(calls, []);
});

test("a shared cleanup failure fails every green cell but retains its evidence", async () => {
  const { driver } = fakeDriver({ cleanup: cleanupEvidence({ failed: 1, reconciled: 9 }) });
  const [outcome] = await collectLocal2GatewayCells(fakeCtx(), [cell("T3-CHAT-1", { harness: "claude" })], driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /cleanup did not fully reconcile/);
  assert.ok(outcome.evidence);
});

test("a false cleanup deletion boolean fails an otherwise-green cell", async () => {
  const { driver } = fakeDriver({ cleanup: cleanupEvidence({ virtualKeyDeleted: false }) });
  const [outcome] = await collectLocal2GatewayCells(fakeCtx(), [cell("T3-CHAT-1", { harness: "claude" })], driver);
  assert.equal(outcome.status, "failed");
});

// ── Evidence assembly ─────────────────────────────────────────────────────────

test("buildLocalRouteTurnEvidence hashes ids, maps isolation to snake_case, and pins the deferred-billing flag", () => {
  const cleanup: LocalCleanupV1 = {
    ledger_id_hash: "ledger",
    registered: 1,
    reconciled: 1,
    failed: 0,
    virtual_key_deleted: true,
    litellm_subjects_deleted: true,
    browser_closed: true,
    processes_stopped: true,
    containers_removed: true,
    local_paths_removed: true,
  };
  const evidence = buildLocalRouteTurnEvidence({
    journey: "LOCAL-3",
    route: "user_key",
    harness: "codex",
    artifactIds: ["server/linux-amd64"],
    serverVersion: "1.2.3",
    anyharnessVersion: "4.5.6",
    modelId: "gpt-cheap",
    workspaceId: "workspace-xyz",
    sessionId: "session-xyz",
    gatewaySpend: null,
    userKeyIsolation: { litellmSpendRows: 0, managedBalanceDeltaUsd: 0 },
    routeChange: null,
    cleanup,
  });
  assert.equal(evidence.kind, "local_route_turn");
  assert.equal(evidence.workspace_id_hash, sha256Hex("workspace-xyz"));
  assert.equal(evidence.session_id_hash, sha256Hex("session-xyz"));
  assert.equal(evidence.transcript_reopened, true);
  assert.equal(evidence.billing_reconcile_deferred, true);
  assert.equal(evidence.gateway_spend, null);
  assert.deepEqual(evidence.user_key_isolation, { litellm_spend_rows: 0, managed_balance_delta_usd: 0 });
});

test("assertOpencodeProviderSource is a no-op for non-opencode harnesses and enforces route-correctness for opencode", () => {
  // Non-opencode: any provider passes.
  assert.doesNotThrow(() => assertOpencodeProviderSource("claude", "gateway", { route: "gateway", modelId: "m" }));
  // Opencode gateway: must be the proliferate provider.
  assert.throws(() => assertOpencodeProviderSource("opencode", "gateway", { route: "gateway", modelId: "m", providerId: "anthropic" }));
  assert.doesNotThrow(() => assertOpencodeProviderSource("opencode", "gateway", { route: "gateway", modelId: "m", providerId: GATEWAY_PROVIDER_ID }));
  // Opencode user-key: must be a direct provider, not proliferate.
  assert.throws(() => assertOpencodeProviderSource("opencode", "user_key", { route: "user_key", modelId: "m", providerId: GATEWAY_PROVIDER_ID }));
  assert.doesNotThrow(() => assertOpencodeProviderSource("opencode", "user_key", { route: "user_key", modelId: "anthropic/x", providerId: "anthropic" }));
});

// ── Cell expansion (T3-AUTHROUTE-1) ────────────────────────────────────────────

test("T3-AUTHROUTE-1 expands one user-key cell per BYOK-mapped harness (cursor excluded) plus one route=change cell", async () => {
  const specs = await t3Authroute1.expandCells({ runtimeLane: "local", desktop: "web", agents: ["all"] });
  const userKeyHarnesses = specs
    .filter((spec) => spec.dimensions.route !== "change")
    .map((spec) => spec.dimensions.harness);
  // Cursor is never a user-key cell.
  assert.ok(!userKeyHarnesses.includes("cursor"));
  // Every BYOK-mapped harness present in the catalog gets a user-key cell.
  for (const harness of Object.keys(BYOK_ENV_BY_HARNESS)) {
    assert.ok(userKeyHarnesses.includes(harness), `expected a user-key cell for ${harness}`);
  }
  // Exactly one route=change cell.
  const routeChange = specs.filter((spec) => spec.dimensions.route === "change");
  assert.equal(routeChange.length, 1);
});

test("T3-AUTHROUTE-1 --agents claude expands ONLY the claude user-key cell + route=change (decision #6)", async () => {
  // Run-1 expanded claude+codex+grok+opencode despite AGENTS=claude because
  // expandCells ignored ctx.agents. It must now consume the selector.
  const specs = await t3Authroute1.expandCells({ runtimeLane: "local", desktop: "web", agents: ["claude"] });
  const userKeyHarnesses = specs
    .filter((spec) => spec.dimensions.route !== "change")
    .map((spec) => spec.dimensions.harness);
  assert.deepEqual(userKeyHarnesses, ["claude"]);
  // The representative route-change harness (claude) IS selected, so its cell is planned.
  assert.equal(specs.filter((spec) => spec.dimensions.route === "change").length, 1);
  assert.equal(specs.length, 2);
});

test("T3-AUTHROUTE-1 --agents codex expands only codex and no route=change (representative not selected)", async () => {
  const specs = await t3Authroute1.expandCells({ runtimeLane: "local", desktop: "web", agents: ["codex"] });
  const userKeyHarnesses = specs
    .filter((spec) => spec.dimensions.route !== "change")
    .map((spec) => spec.dimensions.harness);
  assert.deepEqual(userKeyHarnesses, ["codex"]);
  // The LOCAL-6 route-change cell is driven by the representative harness
  // (claude); an --agents codex run must not plan an unrunnable route-change cell.
  assert.equal(specs.filter((spec) => spec.dimensions.route === "change").length, 0);
});

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
