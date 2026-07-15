import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildLocalConfigMatrixEvidence,
  buildLocalSessionTabsEvidence,
  collectLocal4ConfigCells,
  collectLocal5SessionTabsCell,
  configSurfaceFor,
  cycleConfigControls,
  type LocalConfigControl,
  type LocalConfigDriver,
  type LocalSessionTabsDriver,
} from "./config-session.js";
import type { ScenarioRunContext } from "../types.js";
import type { CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import type { EnvResolution } from "../../config/env-resolution.js";
import type { AuthenticatedActor } from "../../fixtures/authenticated-actor.js";
import type { PreparedRepository } from "../../fixtures/prepared-repository.js";
import type { ProductPage } from "../../fixtures/product-page.js";
import type { PlannedCellV1 } from "../../runner/result.js";
import type { LocalWorldCleanupEvidence } from "../../worlds/local-workspace/cleanup.js";
import type { LocalWorldPorts, ReadyLocalWorld } from "../../worlds/local-workspace/world.js";

// ── Shared fakes (offline; no world/browser/network) ─────────────────────────

function fakeCandidateMap(): CandidateBuildMapV1 {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "a".repeat(40),
    artifacts: [
      { artifact_id: "server/linux-amd64", version: "1", sha256: "s".repeat(64), locator: { kind: "local_file", path: "/tmp/s" } },
      { artifact_id: "anyharness/x86_64-unknown-linux-gnu", version: "1", sha256: "a".repeat(64), locator: { kind: "local_file", path: "/tmp/a" } },
      { artifact_id: "desktop-renderer/browser", version: "1", sha256: "d".repeat(64), locator: { kind: "local_file", path: "/tmp/d" } },
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
    agents: ["all"],
    dryRun: false,
    env: fakeEnv(),
    candidateBuildMap: fakeCandidateMap(),
    runIdentity: {
      run_id: "run-1",
      shard_id: "shard-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    runDir: "/tmp/run-1",
    ports: fakePorts(),
    ...overrides,
  };
}

function cfgCell(harness: string): PlannedCellV1 {
  return {
    cell_id: `T3-CFG-1/local/harness=${harness}`,
    scenario_id: "T3-CFG-1",
    registry_flow_ref: "specs/developing/testing/scenarios.md#T3-CFG-1",
    runtime_lane: "local",
    dimensions: { harness },
    required_env: [],
  };
}

function sessionCell(): PlannedCellV1 {
  return {
    cell_id: "T3-SESSION-1/local/harness=claude",
    scenario_id: "T3-SESSION-1",
    registry_flow_ref: "specs/developing/testing/tier-3-scenario-contract.md#local-5",
    runtime_lane: "local",
    dimensions: { harness: "claude" },
    required_env: [],
  };
}

function cleanupEvidence(overrides: Partial<LocalWorldCleanupEvidence> = {}): LocalWorldCleanupEvidence {
  return {
    ledgerIdHash: "ledger-hash",
    registered: 5,
    reconciled: 5,
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

function fakeWorld(): ReadyLocalWorld {
  return {
    kind: "local-workspace",
    run: fakeCtx().runIdentity!,
    artifacts: {
      server: { artifact_id: "server/linux-amd64", version: "1.2.3", sha256: "s".repeat(64), path: "/tmp/server" },
      anyharness: { artifact_id: "anyharness/x86_64-unknown-linux-gnu", version: "4.5.6", sha256: "a".repeat(64), path: "/tmp/any" },
      desktopRenderer: { artifact_id: "desktop-renderer/browser", version: "1", sha256: "d".repeat(64), path: "/tmp/r" },
    },
    api: undefined as never,
    runtime: undefined as never,
    renderer: undefined as never,
    gateway: undefined as never,
    paths: undefined as never,
    trackActorSubjects: async () => undefined,
    close: async () => cleanupEvidence(),
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
      keyAlias: "vk-1",
      tokenId: "token-1",
      tokenIdHash: "token-hash-1",
    },
  };
}

function fakePage(): ProductPage {
  return { context: undefined as never, page: undefined as never, debug: { console: [], network: [] }, close: async () => undefined };
}

function control(overrides: Partial<LocalConfigControl> = {}): LocalConfigControl {
  return {
    key: "reasoning",
    rawConfigId: "reasoning_effort",
    currentValue: "low",
    settable: true,
    values: ["low", "high"],
    surface: "reasoning",
    ...overrides,
  };
}

// ── LOCAL-4 ──────────────────────────────────────────────────────────────────

function makeConfigDriver(
  options: {
    controls?: LocalConfigControl[];
    accept?: (key: string, value: string) => boolean;
    baselineThrowFor?: string;
    cleanup?: LocalWorldCleanupEvidence;
    buildError?: Error;
  } = {},
): { driver: LocalConfigDriver; calls: string[] } {
  const world = fakeWorld();
  const calls: string[] = [];
  const accept = options.accept ?? (() => true);
  const driver: LocalConfigDriver = {
    buildWorld: async () => {
      calls.push("buildWorld");
      if (options.buildError) throw options.buildError;
      return world;
    },
    createActor: async () => {
      calls.push("createActor");
      return fakeActor();
    },
    prepareRepo: async () => ({ path: "/tmp/repo", repoUrl: "https://github.com/x/y.git", commit: "c", repoRootId: "rr" }) satisfies PreparedRepository,
    openPage: async () => fakePage(),
    ensureHarnessReady: async () => undefined,
    selectRepoAndWorkLocally: async () => undefined,
    runBaselineTurn: async (_w, _p, harness) => {
      if (options.baselineThrowFor === harness) throw new Error(`baseline blew up for ${harness}`);
      return { workspaceId: `ws-${harness}`, sessionId: `sess-${harness}`, modelId: `model-${harness}` };
    },
    enumerateControls: async () => options.controls ?? [control()],
    selectConfigValueInUi: async (_p, ctl, value) => {
      const accepted = accept(ctl.key, value);
      return { accepted, readback: accepted ? value : ctl.currentValue };
    },
    closeWorld: async () => options.cleanup ?? cleanupEvidence(),
  };
  return { driver, calls };
}

test("LOCAL-4: green per-harness cells carry local_config_matrix evidence with accepted controls", async () => {
  const { driver } = makeConfigDriver();
  const cells = [cfgCell("claude"), cfgCell("grok")];
  const outcomes = await collectLocal4ConfigCells(fakeCtx(), cells, driver);

  assert.equal(outcomes.length, 2);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "green");
    assert.ok(outcome.evidence);
    assert.equal(outcome.evidence!.kind, "local_config_matrix");
  }
  const claude = outcomes[0]!.evidence as { harness: string; model_id: string; controls: Array<{ control_key: string; accepted_value: string; rejected: boolean }>; known_1063_expected_fail: boolean };
  assert.equal(claude.harness, "claude");
  assert.equal(claude.model_id, "model-claude");
  assert.equal(claude.controls[0]!.control_key, "reasoning");
  assert.equal(claude.controls[0]!.accepted_value, "high");
  assert.equal(claude.controls[0]!.rejected, false);
  assert.equal(claude.known_1063_expected_fail, false);
});

test("LOCAL-4: cursor is typed unsupported (blocked, no evidence), never green", async () => {
  const { driver } = makeConfigDriver();
  const outcomes = await collectLocal4ConfigCells(fakeCtx(), [cfgCell("cursor")], driver);
  assert.equal(outcomes[0]!.status, "blocked");
  assert.equal(outcomes[0]!.reason?.code, "scenario_blocked");
  assert.match(outcomes[0]!.reason?.message ?? "", /no gateway auth slot/);
  assert.equal(outcomes[0]!.evidence, undefined);
});

test("LOCAL-4: an unknown harness dimension is cleanly blocked", async () => {
  const { driver } = makeConfigDriver();
  const outcomes = await collectLocal4ConfigCells(fakeCtx(), [cfgCell("mystery")], driver);
  assert.equal(outcomes[0]!.status, "blocked");
  assert.match(outcomes[0]!.reason?.message ?? "", /unknown harness/);
});

test("LOCAL-4: a #1063 advertised-but-rejected control is expected_fail, never green", async () => {
  const { driver } = makeConfigDriver({
    controls: [control({ key: "reasoning", values: ["low", "high"] })],
    accept: () => false, // every applied value is rejected on apply
  });
  const outcomes = await collectLocal4ConfigCells(fakeCtx(), [cfgCell("claude")], driver);
  assert.equal(outcomes[0]!.status, "expected_fail");
  assert.equal(outcomes[0]!.reason?.code, "known_gap");
  assert.match(outcomes[0]!.reason?.message ?? "", /1063/);
  const ev = outcomes[0]!.evidence as { known_1063_expected_fail: boolean; controls: Array<{ rejected: boolean }> };
  assert.equal(ev.known_1063_expected_fail, true);
  assert.equal(ev.controls[0]!.rejected, true);
});

test("LOCAL-4: a rejected value restores last-accepted — accepted sibling keeps the cell green", async () => {
  // First value rejected-and-restored, second accepted → cell green, not #1063.
  const { driver } = makeConfigDriver({
    controls: [control({ key: "mode", surface: "mode", currentValue: "a", values: ["a", "b", "c"] })],
    accept: (_key, value) => value === "c",
  });
  const outcomes = await collectLocal4ConfigCells(fakeCtx(), [cfgCell("claude")], driver);
  assert.equal(outcomes[0]!.status, "green");
  const ev = outcomes[0]!.evidence as { controls: Array<{ accepted_value: string; rejected: boolean }> };
  assert.equal(ev.controls[0]!.accepted_value, "c");
  assert.equal(ev.controls[0]!.rejected, false);
});

test("LOCAL-4: no settable control round-tripping fails that cell only, siblings survive", async () => {
  const { driver } = makeConfigDriver({ baselineThrowFor: "grok" });
  const outcomes = await collectLocal4ConfigCells(fakeCtx(), [cfgCell("claude"), cfgCell("grok")], driver);
  assert.equal(outcomes[0]!.status, "green");
  assert.equal(outcomes[1]!.status, "failed");
  assert.match(outcomes[1]!.reason?.message ?? "", /baseline blew up/);
});

test("LOCAL-4: a session that advertises no settable control fails the cell", async () => {
  const { driver } = makeConfigDriver({ controls: [control({ settable: false })] });
  const outcomes = await collectLocal4ConfigCells(fakeCtx(), [cfgCell("claude")], driver);
  assert.equal(outcomes[0]!.status, "failed");
  assert.match(outcomes[0]!.reason?.message ?? "", /no settable/);
});

test("LOCAL-4: a missing candidate map fails every cell before any world side effect", async () => {
  const { driver, calls } = makeConfigDriver();
  const outcomes = await collectLocal4ConfigCells(fakeCtx({ candidateBuildMap: null }), [cfgCell("claude")], driver);
  assert.equal(outcomes[0]!.status, "failed");
  assert.deepEqual(calls, []);
});

test("LOCAL-4: world construction failure fails every cell cleanly (no throw)", async () => {
  const { driver } = makeConfigDriver({ buildError: new Error("docker load failed") });
  const outcomes = await collectLocal4ConfigCells(fakeCtx(), [cfgCell("claude"), cfgCell("grok")], driver);
  assert.equal(outcomes.length, 2);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed");
    assert.match(outcome.reason?.message ?? "", /world construction failed: docker load failed/);
  }
});

test("LOCAL-4: a cleanup failure downgrades an otherwise-green cell to failed but retains evidence", async () => {
  const { driver } = makeConfigDriver({ cleanup: cleanupEvidence({ failed: 1, reconciled: 4 }) });
  const outcomes = await collectLocal4ConfigCells(fakeCtx(), [cfgCell("claude")], driver);
  assert.equal(outcomes[0]!.status, "failed");
  assert.match(outcomes[0]!.reason?.message ?? "", /cleanup did not fully reconcile/);
  assert.ok(outcomes[0]!.evidence);
});

test("cycleConfigControls: requires at least one control to round-trip", async () => {
  await assert.rejects(
    cycleConfigControls(fakePage(), [control({ settable: false })], { selectConfigValueInUi: async () => ({ accepted: true, readback: "x" }) }),
    /no settable/,
  );
});

// ── LOCAL-5 ──────────────────────────────────────────────────────────────────

function makeSessionDriver(
  overrides: Partial<LocalSessionTabsDriver> = {},
  options: { cleanup?: LocalWorldCleanupEvidence; buildError?: Error } = {},
): { driver: LocalSessionTabsDriver; calls: string[] } {
  const world = fakeWorld();
  const calls: string[] = [];
  const base: LocalSessionTabsDriver = {
    buildWorld: async () => {
      calls.push("buildWorld");
      if (options.buildError) throw options.buildError;
      return world;
    },
    createActor: async () => fakeActor(),
    prepareRepo: async () => ({ path: "/tmp/repo", repoUrl: "https://github.com/x/y.git", commit: "c", repoRootId: "rr" }) satisfies PreparedRepository,
    openPage: async () => fakePage(),
    ensureHarnessReady: async () => undefined,
    selectRepoAndWorkLocally: async () => undefined,
    createEmptyChat: async () => ({ workspaceId: "ws-1", sessionId: "s0", tabId: "tab-0" }),
    switchHarnessEmptyChat: async () => ({ oldSessionId: "s0", newSessionId: "s1", tabId: "tab-0" }),
    sendMessage: async () => ({ sessionId: "s1" }),
    switchHarnessAfterMessages: async () => ({ preservedTabId: "tab-0", newTabId: "tab-1", newSessionId: "s2" }),
    changeModelSameHarness: async () => ({ sessionId: "s2", stayedInSession: true }),
    reloadAndVerifyTabs: async () => undefined,
    closeWorld: async () => options.cleanup ?? cleanupEvidence(),
    ...overrides,
  };
  return { driver: base, calls };
}

test("LOCAL-5: green cell carries local_session_tabs evidence with four proofs + deduped session hashes", async () => {
  const { driver } = makeSessionDriver();
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "green");
  const ev = outcome.evidence as {
    kind: string;
    harness: string;
    empty_switch_session_replaced: boolean;
    messaged_switch_new_tab: boolean;
    same_harness_model_change_in_session: boolean;
    reload_preserved: boolean;
    session_id_hashes: string[];
  };
  assert.equal(ev.kind, "local_session_tabs");
  assert.equal(ev.harness, "claude");
  assert.equal(ev.empty_switch_session_replaced, true);
  assert.equal(ev.messaged_switch_new_tab, true);
  assert.equal(ev.same_harness_model_change_in_session, true);
  assert.equal(ev.reload_preserved, true);
  // s0, s1, s2 distinct (s1 seen twice — deduped) → 3 hashes.
  assert.equal(ev.session_id_hashes.length, 3);
  assert.equal(new Set(ev.session_id_hashes).size, 3);
});

test("LOCAL-5: a diagnostic run (no candidate map) is cleanly blocked, not failed", async () => {
  const { driver } = makeSessionDriver();
  const outcome = await collectLocal5SessionTabsCell(fakeCtx({ candidateBuildMap: null }), sessionCell(), driver);
  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.reason?.code, "scenario_blocked");
  assert.match(outcome.reason?.message ?? "", /requires the candidate world/);
});

test("LOCAL-5: empty-chat switch that does NOT replace the backend session fails the cell", async () => {
  const { driver } = makeSessionDriver({
    switchHarnessEmptyChat: async () => ({ oldSessionId: "s0", newSessionId: "s0", tabId: "tab-0" }),
  });
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /did not replace the backend session/);
});

test("LOCAL-5: a same-harness model change that leaves the session fails the cell", async () => {
  const { driver } = makeSessionDriver({
    changeModelSameHarness: async () => ({ sessionId: "s2", stayedInSession: false }),
  });
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /did not stay in the session/);
});

test("LOCAL-5: switch-after-messages that reuses the same tab fails the cell", async () => {
  const { driver } = makeSessionDriver({
    switchHarnessAfterMessages: async () => ({ preservedTabId: "tab-0", newTabId: "tab-0", newSessionId: "s2" }),
  });
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /did not open a new tab/);
});

test("LOCAL-5: a cleanup failure downgrades the green cell to failed but retains evidence", async () => {
  const { driver } = makeSessionDriver({}, { cleanup: cleanupEvidence({ browserClosed: false }) });
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "failed");
  assert.ok(outcome.evidence);
});

// ── Evidence builders + surface mapping ──────────────────────────────────────

function localCleanup() {
  return {
    ledger_id_hash: "h",
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
}

test("buildLocalConfigMatrixEvidence hashes ids and maps controls", () => {
  const ev = buildLocalConfigMatrixEvidence({
    harness: "claude",
    artifactIds: ["server/linux-amd64"],
    serverVersion: "1.2.3",
    anyharnessVersion: "4.5.6",
    modelId: "claude-haiku",
    workspaceId: "ws",
    sessionId: "sess",
    controls: [{ controlKey: "mode", acceptedValue: "chat", rejected: false }],
    known1063ExpectedFail: false,
    cleanup: localCleanup(),
  });
  assert.equal(ev.kind, "local_config_matrix");
  assert.match(ev.workspace_id_hash, /^[0-9a-f]{64}$/);
  assert.match(ev.session_id_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(ev.controls, [{ control_key: "mode", accepted_value: "chat", rejected: false }]);
});

test("buildLocalSessionTabsEvidence pins the four proofs true and hashes each session id", () => {
  const ev = buildLocalSessionTabsEvidence({
    harness: "claude",
    artifactIds: ["server/linux-amd64"],
    serverVersion: "1.2.3",
    anyharnessVersion: "4.5.6",
    workspaceId: "ws",
    sessionIds: ["s0", "s1"],
    cleanup: localCleanup(),
  });
  assert.equal(ev.empty_switch_session_replaced, true);
  assert.equal(ev.reload_preserved, true);
  assert.equal(ev.session_id_hashes.length, 2);
  for (const hash of ev.session_id_hashes) {
    assert.match(hash, /^[0-9a-f]{64}$/);
  }
});

test("configSurfaceFor routes model/mode/reasoning/config to the right testid family", () => {
  assert.equal(configSurfaceFor("model", "model_id"), "model");
  assert.equal(configSurfaceFor("reasoning", "reasoning_effort"), "reasoning");
  assert.equal(configSurfaceFor("thinking", "thinking_level"), "reasoning");
  assert.equal(configSurfaceFor("mode", "session_mode"), "mode");
  assert.equal(configSurfaceFor("temperature", "temp"), "config");
});
