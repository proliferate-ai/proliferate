import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildLocalConfigMatrixEvidence,
  buildLocalSessionTabsEvidence,
  collectLocal4ConfigCells,
  collectLocal5SessionTabsCell,
  configSurfaceFor,
  cycleConfigControls,
  defaultLocalConfigDriver,
  selectDistinctEligibleModel,
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
    db: { databaseUrl: "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5599/proliferate" },
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
    selectGatewayRoute: async (_actor, harness) => {
      calls.push(`selectGatewayRoute:${harness}`);
    },
    prepareRepo: async () => ({ path: "/tmp/repo", repoUrl: "https://github.com/x/y.git", commit: "c", repoRootId: "rr" }) satisfies PreparedRepository,
    openPage: async () => {
      calls.push("openPage");
      return fakePage();
    },
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

test("LOCAL-4: Grok records a distinct model-picker value on its existing baseline session", async () => {
  const { driver } = makeConfigDriver({
    controls: [control({
      key: "model",
      rawConfigId: "model",
      currentValue: "model-grok",
      values: ["model-grok", "grok-code-fast-1"],
      surface: "model",
    })],
  });
  let seen: { harness?: string; sessionId?: string; value?: string } = {};
  driver.selectConfigValueInUi = async (context, _control, value) => {
    seen = { harness: context.harness, sessionId: context.sessionId, value };
    return { accepted: true, readback: value };
  };
  const [outcome] = await collectLocal4ConfigCells(fakeCtx(), [cfgCell("grok")], driver);
  assert.equal(outcome?.status, "green");
  assert.deepEqual(seen, {
    harness: "grok",
    sessionId: "sess-grok",
    value: "grok-code-fast-1",
  });
  const evidence = outcome?.evidence as {
    model_id: string;
    controls: Array<{ control_key: string; accepted_value: string }>;
  };
  assert.equal(evidence.model_id, "model-grok");
  assert.deepEqual(evidence.controls, [{
    control_key: "model",
    accepted_value: "grok-code-fast-1",
    rejected: false,
  }]);
});

test("LOCAL-4: selects the gateway route for EVERY runnable harness before the page boots", async () => {
  // Regression for run 29628880856: the reused owner actor only had claude's
  // gateway route selected, so codex/grok never synced a route into AnyHarness
  // and never became launchable. Each runnable harness must get its own
  // selection, all before `openPage` (the real renderer syncs routes at boot).
  const { driver, calls } = makeConfigDriver();
  const outcomes = await collectLocal4ConfigCells(
    fakeCtx(),
    [cfgCell("claude"), cfgCell("grok"), cfgCell("cursor")],
    driver,
  );
  for (const harness of ["claude", "grok"]) {
    assert.ok(calls.includes(`selectGatewayRoute:${harness}`), `expected a gateway selection for ${harness}`);
  }
  // Cursor ships no gateway slot — it must never be selected for.
  assert.ok(!calls.includes("selectGatewayRoute:cursor"), "cursor must not get a gateway selection");
  // All selections happen before the page opens.
  const firstOpen = calls.indexOf("openPage");
  assert.ok(firstOpen === -1 || calls.filter((c) => c.startsWith("selectGatewayRoute:")).every((c) => calls.indexOf(c) < firstOpen));
  // The claude/grok cells still finish green (cursor stays blocked).
  assert.equal(outcomes.find((o) => (o.evidence as { harness?: string } | undefined)?.harness === "grok")?.status, "green");
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
    materializeFirstChat: async () => ({ workspaceId: "ws-1", sessionId: "s0", tabId: "tab-0" }),
    switchHarnessAfterMessages: async () => ({ preservedTabId: "tab-0", preservedTabHarness: "claude", newTabId: "tab-1", newTabHarness: "codex", newTabIndex: 1, newSessionId: "s1" }),
    switchHarnessEmptyChat: async () => ({ oldSessionId: "s1", newSessionId: "s2", tabIndex: 1, tabCountUnchanged: true, noOp: false }),
    sendMessage: async () => ({ sessionId: "s2" }),
    changeModelSameHarness: async () => ({ sessionId: "s2", fromModelId: "claude-a", toModelId: "claude-b", stayedInSession: true }),
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
  // s0 (tab A), s1 (after-messages switch), s2 (empty-chat switch; sendMessage
  // and the model change both stay on s2) → 3 distinct hashes after dedupe.
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
    switchHarnessEmptyChat: async () => ({ oldSessionId: "s1", newSessionId: "s1", tabIndex: 1, tabCountUnchanged: true, noOp: false }),
  });
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /did not replace the backend session/);
});

test("LOCAL-5: empty-chat switch that is a no-op (same harness) fails the cell", async () => {
  const { driver } = makeSessionDriver({
    switchHarnessEmptyChat: async () => ({ oldSessionId: "s1", newSessionId: "s1", tabIndex: 1, tabCountUnchanged: true, noOp: true }),
  });
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /was a no-op/);
});

test("LOCAL-5: empty-chat switch that changes the tab count fails the cell", async () => {
  const { driver } = makeSessionDriver({
    switchHarnessEmptyChat: async () => ({ oldSessionId: "s1", newSessionId: "s2", tabIndex: 1, tabCountUnchanged: false, noOp: false }),
  });
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /changed the number of tabs/);
});

test("LOCAL-5: empty-chat switch that moves the tab's position fails the cell", async () => {
  const { driver } = makeSessionDriver({
    switchHarnessEmptyChat: async () => ({ oldSessionId: "s1", newSessionId: "s2", tabIndex: 2, tabCountUnchanged: true, noOp: false }),
  });
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /moved the tab's position/);
});

test("LOCAL-5: a same-harness model change that leaves the session fails the cell", async () => {
  const { driver } = makeSessionDriver({
    changeModelSameHarness: async () => ({ sessionId: "s2", fromModelId: "claude-a", toModelId: "claude-b", stayedInSession: false }),
  });
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /did not stay in the session/);
});

test("LOCAL-5: a same-harness model change that is a no-op (same model id) fails the cell", async () => {
  const { driver } = makeSessionDriver({
    changeModelSameHarness: async () => ({ sessionId: "s2", fromModelId: "claude-a", toModelId: "claude-a", stayedInSession: true }),
  });
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /no-op \(model id unchanged\)/);
});

test("LOCAL-5: switch-after-messages that reuses the same tab fails the cell", async () => {
  const { driver } = makeSessionDriver({
    switchHarnessAfterMessages: async () => ({ preservedTabId: "tab-0", preservedTabHarness: "claude", newTabId: "tab-0", newTabHarness: "codex", newTabIndex: 1, newSessionId: "s1" }),
  });
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /did not open a new tab/);
});

test("LOCAL-5: switch-after-messages that is not a real harness switch (both tabs same harness) fails the cell", async () => {
  const { driver } = makeSessionDriver({
    switchHarnessAfterMessages: async () => ({ preservedTabId: "tab-0", preservedTabHarness: "claude", newTabId: "tab-1", newTabHarness: "claude", newTabIndex: 1, newSessionId: "s1" }),
  });
  const outcome = await collectLocal5SessionTabsCell(fakeCtx(), sessionCell(), driver);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason?.message ?? "", /was not a real harness switch/);
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

test("enumerateControls keeps only UI-drivable controls and drops a reasoning ladder shadowed by effort", async () => {
  const liveConfig = {
    rawConfigOptions: [],
    sourceSeq: 1,
    normalizedControls: {
      model: {
        key: "model",
        rawConfigId: "model",
        label: "Model",
        currentValue: "default",
        settable: true,
        values: [{ value: "default", label: "Default" }, { value: "opus", label: "Opus" }],
      },
      effort: {
        key: "effort",
        rawConfigId: "model.effort",
        label: "Effort",
        currentValue: "default",
        settable: true,
        values: [{ value: "default", label: "Default" }, { value: "high", label: "High" }],
      },
      reasoning: {
        key: "reasoning",
        rawConfigId: "reasoning",
        label: "Reasoning",
        currentValue: "on",
        settable: true,
        values: [{ value: "on", label: "On" }, { value: "off", label: "Off" }],
      },
      mode: {
        key: "mode",
        rawConfigId: "permission_mode",
        label: "Mode",
        currentValue: "default",
        settable: true,
        values: [{ value: "default", label: "Default" }, { value: "plan", label: "Plan" }],
      },
    },
  };
  const world = {
    ...fakeWorld(),
    runtime: { baseUrl: "http://fake", client: { getLiveConfig: async () => liveConfig } },
  } as unknown as ReadyLocalWorld;
  const controls = await defaultLocalConfigDriver.enumerateControls(world, "session-1", "claude", "claude-haiku");
  assert.deepEqual(
    controls.map((control) => `${control.key}:${control.surface}`).sort(),
    ["effort:reasoning", "mode:mode"],
  );
});

test("Grok catalog model control resolves one distinct allowlisted live-probed picker target", async () => {
  const catalog = JSON.parse(
    readFileSync(
      new URL("../../../../../catalogs/agents/catalog.json", import.meta.url),
      "utf8",
    ),
  ) as {
    agents: Array<{
      kind: string;
      session: {
        controls: Array<{ key: string; mapping?: { switchVia?: string } }>;
        gatewayPolicy?: { seedModels?: string[] };
      };
    }>;
  };
  const grok = catalog.agents.find((agent) => agent.kind === "grok");
  assert.ok(grok?.session.controls.some(
    (entry) => entry.key === "model" && entry.mapping?.switchVia === "setSessionModel",
  ));
  assert.deepEqual(grok?.session.gatewayPolicy?.seedModels, [
    "grok-4",
    "grok-4-fast",
    "grok-code-fast-1",
    "grok-build",
  ]);

  const liveConfig = {
    rawConfigOptions: [],
    sourceSeq: 1,
    normalizedControls: {
      model: {
        key: "model",
        rawConfigId: "model",
        label: "Model",
        currentValue: "raw-probe-default",
        settable: true,
        values: [
          { value: "raw-probe-default", label: "Raw default" },
          { value: "raw-probe-other", label: "Raw other" },
        ],
      },
    },
  };
  const probed = ["grok-4", "grok-4-fast", "grok-code-fast-1", "grok-build"];
  const world = {
    ...fakeWorld(),
    runtime: {
      baseUrl: "http://fake",
      client: {
        getLiveConfig: async () => liveConfig,
        getGatewayModels: async () => probed.map((id) => ({ id })),
      },
    },
    gateway: {
      preflight: async () => ({
        adminReachable: true,
        allowlistModels: [...probed, "not-probed"],
        eligibleClaudeModels: [],
      }),
    },
  } as unknown as ReadyLocalWorld;
  const controls = await defaultLocalConfigDriver.enumerateControls(
    world,
    "session-grok",
    "grok",
    "grok-4-fast",
  );
  assert.deepEqual(controls, [{
    key: "model",
    rawConfigId: "model",
    currentValue: "grok-4-fast",
    settable: true,
    values: ["grok-4-fast", "grok-code-fast-1"],
    surface: "model",
  }]);
  assert.equal(
    selectDistinctEligibleModel("grok-4-fast", probed, probed),
    "grok-code-fast-1",
  );
  assert.equal(
    selectDistinctEligibleModel("grok-4-fast", ["grok-4-fast"], probed),
    null,
  );
});

test("Grok materializes its catalog-backed model control when ACP omits the raw model option", async () => {
  const probed = ["grok-4", "grok-4-fast", "grok-code-fast-1"];
  const world = {
    ...fakeWorld(),
    runtime: {
      baseUrl: "http://fake",
      client: {
        getLiveConfig: async () => ({
          rawConfigOptions: [],
          sourceSeq: 1,
          normalizedControls: {},
        }),
        getGatewayModels: async () => probed.map((id) => ({ id })),
      },
    },
    gateway: {
      preflight: async () => ({
        adminReachable: true,
        allowlistModels: probed,
        eligibleClaudeModels: [],
      }),
    },
  } as unknown as ReadyLocalWorld;

  const controls = await defaultLocalConfigDriver.enumerateControls(
    world,
    "session-grok",
    "grok",
    "grok-4-fast",
  );
  assert.deepEqual(controls, [{
    key: "model",
    rawConfigId: "catalog:model",
    currentValue: "grok-4-fast",
    settable: true,
    values: ["grok-4-fast", "grok-code-fast-1"],
    surface: "model",
  }]);
});

test("default Grok model picker proof preserves the session and correlates one post-switch turn", async () => {
  const sessionId = "sess-grok";
  const targetModelId = "grok-code-fast-1";
  let selectedModelId = "grok-4-fast";
  let sent = false;
  let correlated: { acceptedModelId?: string; windowStartedAt?: string; windowFinishedAt?: string } | undefined;

  const locatorFor = (selector: string) => {
    const locator = {
      first: () => locator,
      waitFor: async () => undefined,
      count: async () => selector.includes("data-model-option") ? 1 : 0,
      click: async () => {
        if (selector.includes(`data-model-option=\"${targetModelId}\"`)) {
          selectedModelId = targetModelId;
        }
        if (selector.includes("data-chat-send-button")) {
          sent = true;
        }
      },
      fill: async () => undefined,
      getAttribute: async (name: string) => {
        if (name === "data-chat-tab-session-id") return sessionId;
        if (name === "data-composer-selected-model") return selectedModelId;
        return null;
      },
    };
    return locator;
  };
  const product = {
    context: undefined as never,
    page: {
      locator: (selector: string) => locatorFor(selector),
      keyboard: { press: async () => undefined },
    } as never,
    debug: { console: [], network: [] },
    close: async () => undefined,
  } satisfies ProductPage;
  const baselineEvent = { sessionId, seq: 1, timestamp: "2026-07-20T00:00:00Z", event: { type: "turn_ended" } };
  const switchedEvent = { sessionId, seq: 2, timestamp: "2026-07-20T00:00:01Z", event: { type: "turn_ended" } };
  const world = {
    ...fakeWorld(),
    runtime: {
      baseUrl: "http://fake",
      client: {
        getSession: async () => ({
          id: sessionId,
          workspaceId: "ws-grok",
          agentKind: "grok",
          modelId: selectedModelId,
          requestedModelId: selectedModelId,
          status: "idle",
        }),
        getLiveConfig: async () => ({
          rawConfigOptions: [],
          sourceSeq: 2,
          normalizedControls: {
            model: {
              key: "model",
              rawConfigId: "model",
              label: "Model",
              currentValue: selectedModelId,
              settable: true,
              values: [],
            },
          },
        }),
        getEvents: async () => sent ? [baselineEvent, switchedEvent] : [baselineEvent],
      },
    },
    gateway: {
      snapshotSpend: async () => ({ tokenIdHash: "token-hash-1", requestIds: ["before"], takenAt: "2026-07-20T00:00:00Z" }),
      correlateTurn: async (params: typeof correlated & { actor: unknown; before: unknown }) => {
        correlated = params;
        return {
          tokenIdHash: "token-hash-1",
          requestIds: ["after"],
          modelId: params.acceptedModelId!,
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          spendUsd: 0.001,
          windowStartedAt: params.windowStartedAt!,
          windowFinishedAt: params.windowFinishedAt!,
        };
      },
    },
  } as unknown as ReadyLocalWorld;

  const result = await defaultLocalConfigDriver.selectConfigValueInUi(
    { world, page: product, actor: fakeActor(), harness: "grok", sessionId },
    control({
      key: "model",
      rawConfigId: "model",
      currentValue: "grok-4-fast",
      values: ["grok-4-fast", targetModelId],
      surface: "model",
    }),
    targetModelId,
  );
  assert.deepEqual(result, { accepted: true, readback: targetModelId });
  assert.equal(sent, true);
  assert.equal(correlated?.acceptedModelId, targetModelId);
  assert.ok(Date.parse(correlated?.windowStartedAt ?? "") <= Date.parse(correlated?.windowFinishedAt ?? ""));
});

test("model config selection remains unavailable to non-Grok harnesses", async () => {
  await assert.rejects(
    defaultLocalConfigDriver.selectConfigValueInUi(
      { world: fakeWorld(), page: fakePage(), actor: fakeActor(), harness: "codex", sessionId: "sess-codex" },
      control({ key: "model", surface: "model", currentValue: "codex-a", values: ["codex-a", "codex-b"] }),
      "codex-b",
    ),
    /bounded to Grok/,
  );
});

test("configSurfaceFor maps the catalog model picker and promoted live-composer controls", () => {
  // The live chat composer renders exactly the promoted control groups
  // (ChatInputControlRow): effort/reasoning bars and the working-mode control.
  assert.equal(configSurfaceFor("effort"), "reasoning");
  assert.equal(configSurfaceFor("reasoning"), "reasoning");
  assert.equal(configSurfaceFor("mode"), "mode");
  assert.equal(configSurfaceFor("collaboration_mode"), "mode");
  assert.equal(configSurfaceFor("model"), "model");
  // fast_mode has no testid, and arbitrary ACP controls have no live-composer strip.
  assert.equal(configSurfaceFor("fast_mode"), null);
  assert.equal(configSurfaceFor("temperature"), null);
});
