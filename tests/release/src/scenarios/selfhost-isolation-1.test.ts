import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SELFHOST_ISOLATION_1_ID,
  SH_SWITCH_ISOLATION,
  attachSwitchCleanup,
  buildSwitchIsolationEvidence,
  cleanupIsClean,
  defaultSelfHostSwitchIsolationDriver,
  foldSelfHostCleanup,
  runSelfHostSwitchIsolationCells,
  switchUnavailableReason,
  type SelfHostSwitchCellResult,
  type SelfHostSwitchIsolationDriver,
} from "./selfhost-isolation-1.js";
import type { ScenarioRunContext } from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { EnvResolution } from "../config/env-resolution.js";
import { ALL_FINAL_STATUSES, type FinalTestStatus, type PlannedCellV1 } from "../runner/result.js";
import {
  expectedVerdict,
  validateReportV4,
  type TestRunReportV3,
  type TestRunReportV4,
} from "../evidence/schema.js";
import type { ReadySelfHostWorld, SelfHostWorldPair } from "../worlds/selfhost/world.js";
import type { SelfHostWorldCleanupEvidence } from "../worlds/selfhost/cleanup-kinds.js";

// ── Fakes (mirror selfhost-install-1.test.ts's fake-transport/fake-world seam) ──

function fakeCandidateMap(): CandidateBuildMapV1 {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: "a".repeat(40),
    artifacts: [
      { artifact_id: "server/linux-amd64", version: "1", sha256: "s".repeat(64), locator: { kind: "local_file", path: "/tmp/server.tar" } },
      { artifact_id: "selfhost-bundle/linux-amd64", version: "1", sha256: "b".repeat(64), locator: { kind: "local_file", path: "/tmp/bundle.tar.gz" } },
      { artifact_id: "anyharness/x86_64-unknown-linux-gnu", version: "1", sha256: "a".repeat(64), locator: { kind: "local_file", path: "/tmp/anyharness" } },
      { artifact_id: "desktop-renderer/browser", version: "1", sha256: "d".repeat(64), locator: { kind: "local_file", path: "/tmp/renderer.tar" } },
    ],
  };
}

function fakeEnv(vars: Record<string, string> = {}): EnvResolution {
  const defaults: Record<string, string> = {
    RELEASE_E2E_SELFHOST_REGION: "us-east-1",
    RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID: "Z123",
    RELEASE_E2E_SELFHOST_INSTANCE_TYPE: "t3.small",
    RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY: "sk-ant-test-key",
    RELEASE_E2E_QUALIFICATION_TLS_CERTIFICATE_B64: "Y2VydA==",
    RELEASE_E2E_QUALIFICATION_TLS_PRIVATE_KEY_B64: "a2V5",
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
    runtimeLane: "selfhost",
    desktop: "web",
    agents: ["claude"],
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

const SWITCH_CELL_ID = `${SELFHOST_ISOLATION_1_ID}/selfhost/cell=${SH_SWITCH_ISOLATION},harness=claude`;

function switchCell(): PlannedCellV1 {
  return {
    cell_id: SWITCH_CELL_ID,
    scenario_id: SELFHOST_ISOLATION_1_ID,
    registry_flow_ref: "specs/developing/testing/tier-3-scenario-contract.md#sh-switch-isolation",
    runtime_lane: "selfhost",
    dimensions: { cell: SH_SWITCH_ISOLATION, harness: "claude" },
    required_env: [],
  };
}

function fakeWorld(apiHost: string): ReadySelfHostWorld {
  return {
    api: { baseUrl: `https://${apiHost}` },
    runtime: { baseUrl: "http://127.0.0.1:4" },
    artifacts: {
      serverImage: { artifact_id: "server/linux-amd64", version: "1.2.3", sha256: "s".repeat(64), path: "/tmp/server.tar" },
      bundle: { artifact_id: "selfhost-bundle/linux-amd64", version: "1.2.3", sha256: "b".repeat(64), path: "/tmp/bundle.tar.gz" },
      anyharness: { artifact_id: "anyharness/x86_64-unknown-linux-gnu", version: "4.5.6", sha256: "a".repeat(64), path: "/tmp/anyharness" },
      desktopRenderer: { artifact_id: "desktop-renderer/browser", version: "0.1.0", sha256: "d".repeat(64), path: "/tmp/renderer.tar" },
    },
    close: async () => cleanCleanup(),
  } as unknown as ReadySelfHostWorld;
}

const SERVER_A_HOST = "sh-a.qualification.proliferate.com";
const SERVER_B_HOST = "sh-b.qualification.proliferate.com";

function fakePair(): SelfHostWorldPair {
  return { a: fakeWorld(SERVER_A_HOST), b: fakeWorld(SERVER_B_HOST) };
}

function cleanCleanup(): SelfHostWorldCleanupEvidence {
  return {
    ledgerIdHash: "l".repeat(64),
    registered: 6,
    reconciled: 6,
    failed: 0,
    ec2Terminated: true,
    securityGroupDeleted: true,
    keyPairDeleted: true,
    route53RecordDeleted: true,
    browserClosed: true,
    processesStopped: true,
    localPathsRemoved: true,
  };
}

function dirtyCleanup(): SelfHostWorldCleanupEvidence {
  return { ...cleanCleanup(), ledgerIdHash: "m".repeat(64), failed: 1, ec2Terminated: false };
}

interface DriverState {
  buildCalls: number;
  closeCalls: number;
  pair: SelfHostWorldPair;
}

function greenDriver(overrides: Partial<SelfHostSwitchIsolationDriver> = {}): {
  driver: SelfHostSwitchIsolationDriver;
  state: DriverState;
} {
  const state: DriverState = { buildCalls: 0, closeCalls: 0, pair: fakePair() };
  const driver: SelfHostSwitchIsolationDriver = {
    buildWorldPair: async () => {
      state.buildCalls += 1;
      return state.pair;
    },
    runSwitchIsolation: async (pair): Promise<SelfHostSwitchCellResult> => ({
      status: "green",
      evidence: buildSwitchIsolationEvidence(pair),
    }),
    closeWorld: async () => {
      state.closeCalls += 1;
      return cleanCleanup();
    },
    ...overrides,
  };
  return { driver, state };
}

// ── Orchestration: green path ──────────────────────────────────────────────

test("runSelfHostSwitchIsolationCells: green cell folds BOTH boxes' cleanup into one block", async () => {
  const { driver, state } = greenDriver();
  const outcomes = await runSelfHostSwitchIsolationCells(fakeCtx(), [switchCell()], driver);
  assert.equal(outcomes.length, 1);
  const [outcome] = outcomes;
  assert.equal(outcome.status, "green", JSON.stringify(outcome));
  assert.ok(outcome.evidence, "green cell must carry evidence");
  const evidence = outcome.evidence as { kind: string; cleanup: { registered: number; failed: number } };
  assert.equal(evidence.kind, "selfhost_switch_isolation");
  // Both boxes were closed and the two clean summaries folded (6 + 6 registered).
  assert.equal(state.closeCalls, 2);
  assert.equal(evidence.cleanup.registered, 12);
  assert.equal(evidence.cleanup.failed, 0);
});

test("runSelfHostSwitchIsolationCells: the emitted green evidence passes the real report validator", async () => {
  const { driver } = greenDriver();
  const outcomes = await runSelfHostSwitchIsolationCells(fakeCtx(), [switchCell()], driver);
  const evidence = outcomes[0].evidence;
  assert.ok(evidence);
  // Schema-validate the folded green evidence end-to-end through validateReportV4.
  validateReportV4(reportWithEvidence(evidence, "green"));
});

// ── Orchestration: fail-closed switch (the production reality) ──────────────

test("runSelfHostSwitchIsolationCells: a fail-closed switch fails the cell with no evidence, both boxes torn down", async () => {
  const { driver, state } = greenDriver({
    runSwitchIsolation: (pair) => defaultSelfHostSwitchIsolationDriver.runSwitchIsolation(pair),
  });
  const outcomes = await runSelfHostSwitchIsolationCells(fakeCtx(), [switchCell()], driver);
  const [outcome] = outcomes;
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.evidence, undefined);
  assert.match(outcome.reason?.message ?? "", /SHR-F01/);
  // The two provisioned boxes are still cleaned up even though the cell failed.
  assert.equal(state.closeCalls, 2);
});

test("defaultSelfHostSwitchIsolationDriver.runSwitchIsolation: fails closed, bounded + secret-free, names both origins", async () => {
  const result = await defaultSelfHostSwitchIsolationDriver.runSwitchIsolation(fakePair());
  assert.equal(result.status, "failed");
  assert.equal(result.evidence, undefined);
  const message = result.reason?.message ?? "";
  assert.match(message, /SHR-F01/);
  assert.ok(message.includes(SERVER_A_HOST), "message should name server A's origin");
  assert.ok(message.includes(SERVER_B_HOST), "message should name server B's origin");
  // Bounded and secret-free: only safe origin HOSTS, never a raw scheme/URL/key.
  assert.ok(message.length < 4096, "message must stay bounded");
  assert.ok(!message.includes("https://"), "message must not leak a raw URL/scheme");
});

// ── Orchestration: cleanup + failure semantics ─────────────────────────────

test("runSelfHostSwitchIsolationCells: a non-clean teardown of EITHER box downgrades the green cell", async () => {
  let call = 0;
  const { driver } = greenDriver({
    closeWorld: async () => {
      call += 1;
      // Server B leaks (dirty); server A is clean.
      return call === 1 ? cleanCleanup() : dirtyCleanup();
    },
  });
  const outcomes = await runSelfHostSwitchIsolationCells(fakeCtx(), [switchCell()], driver);
  const [outcome] = outcomes;
  assert.equal(outcome.status, "failed", JSON.stringify(outcome));
  assert.match(outcome.reason?.message ?? "", /did not fully reconcile/);
  // The folded cleanup block is still attached so the leak is inspectable.
  const evidence = outcome.evidence as { cleanup: { failed: number; ec2_terminated: boolean } };
  assert.ok(evidence);
  assert.equal(evidence.cleanup.failed, 1);
  assert.equal(evidence.cleanup.ec2_terminated, false);
});

test("runSelfHostSwitchIsolationCells: a world-pair build failure fails the cell without closing anything", async () => {
  const { driver, state } = greenDriver({
    buildWorldPair: async () => {
      throw new Error("EC2 run-instances failed for server B");
    },
  });
  const outcomes = await runSelfHostSwitchIsolationCells(fakeCtx(), [switchCell()], driver);
  assert.equal(outcomes[0].status, "failed");
  assert.match(outcomes[0].reason?.message ?? "", /world pair construction failed/);
  assert.equal(state.closeCalls, 0);
});

test("runSelfHostSwitchIsolationCells: a typed input-resolution failure fails the cell without building a pair", async () => {
  const { driver, state } = greenDriver();
  const outcomes = await runSelfHostSwitchIsolationCells(fakeCtx({ candidateBuildMap: null }), [switchCell()], driver);
  assert.equal(outcomes[0].status, "failed");
  assert.equal(state.buildCalls, 0);
});

test("runSelfHostSwitchIsolationCells: a close throw fails the evidence-bearing cell (no false green)", async () => {
  const { driver } = greenDriver({
    closeWorld: async () => {
      throw new Error("AWS terminate-instances timed out");
    },
  });
  const outcomes = await runSelfHostSwitchIsolationCells(fakeCtx(), [switchCell()], driver);
  assert.equal(outcomes[0].status, "failed");
  assert.equal(outcomes[0].evidence, undefined);
  assert.match(outcomes[0].reason?.message ?? "", /cleanup threw/i);
});

test("runSelfHostSwitchIsolationCells: an unexpected extra assigned cell fails cleanly", async () => {
  const { driver } = greenDriver();
  const extra: PlannedCellV1 = { ...switchCell(), cell_id: `${SELFHOST_ISOLATION_1_ID}/selfhost/cell=SH-BOGUS,harness=claude`, dimensions: { cell: "SH-BOGUS", harness: "claude" } };
  const outcomes = await runSelfHostSwitchIsolationCells(fakeCtx(), [switchCell(), extra], driver);
  const byId = new Map(outcomes.map((o) => [o.cellId, o]));
  assert.equal(byId.get(SWITCH_CELL_ID)?.status, "green");
  assert.equal(byId.get(extra.cell_id)?.status, "failed");
  assert.match(byId.get(extra.cell_id)?.reason?.message ?? "", /not expected/);
});

// ── Pure helpers ───────────────────────────────────────────────────────────

test("foldSelfHostCleanup: sums counts, ANDs deletion flags, emits a 64-hex ledger hash", () => {
  const folded = foldSelfHostCleanup(cleanCleanup(), dirtyCleanup());
  assert.equal(folded.registered, 12);
  assert.equal(folded.reconciled, 12);
  assert.equal(folded.failed, 1);
  assert.equal(folded.ec2Terminated, false); // dirty B drags it false
  assert.equal(folded.securityGroupDeleted, true);
  assert.match(folded.ledgerIdHash, /^[0-9a-f]{64}$/);
  assert.equal(cleanupIsClean(folded), false);
  assert.equal(cleanupIsClean(foldSelfHostCleanup(cleanCleanup(), cleanCleanup())), true);
});

test("buildSwitchIsolationEvidence: api_origin === server_a_origin, distinct from server_b_origin, all invariants asserted", () => {
  const evidence = buildSwitchIsolationEvidence(fakePair());
  assert.equal(evidence.kind, "selfhost_switch_isolation");
  assert.equal(evidence.api_origin, SERVER_A_HOST);
  assert.equal(evidence.server_a_origin, SERVER_A_HOST);
  assert.equal(evidence.server_b_origin, SERVER_B_HOST);
  assert.notEqual(evidence.server_a_origin, evidence.server_b_origin);
  for (const flag of [
    evidence.no_cross_origin_token,
    evidence.no_cross_origin_pending_auth,
    evidence.no_cross_origin_credential,
    evidence.no_cross_origin_runtime_identity,
    evidence.no_cross_origin_workspace_session,
    evidence.b_started_anonymous,
    evidence.b_authenticated_independently,
    evidence.a_state_restored_origin_scoped,
  ]) {
    assert.equal(flag, true);
  }
});

test("attachSwitchCleanup: projects the folded pair cleanup to the snake_case evidence block", () => {
  const evidence = attachSwitchCleanup(buildSwitchIsolationEvidence(fakePair()), foldSelfHostCleanup(cleanCleanup(), cleanCleanup()));
  assert.equal(evidence.cleanup.registered, 12);
  assert.equal(evidence.cleanup.ec2_terminated, true);
  assert.equal(evidence.cleanup.route53_record_deleted, true);
  assert.equal(evidence.cleanup.local_paths_removed, true);
  assert.match(evidence.cleanup.ledger_id_hash, /^[0-9a-f]{64}$/);
});

test("switchUnavailableReason: bounded, cites SHR-F01 and both origins, no raw URL", () => {
  const reason = switchUnavailableReason(SERVER_A_HOST, SERVER_B_HOST);
  assert.match(reason, /SHR-F01/);
  assert.ok(reason.includes(SERVER_A_HOST) && reason.includes(SERVER_B_HOST));
  assert.ok(!reason.includes("https://"));
});

// ── Report envelope for schema validation ──────────────────────────────────

function reportWithEvidence(
  evidence: NonNullable<import("./types.js").ScenarioCellOutcome["evidence"]>,
  status: FinalTestStatus,
): TestRunReportV4 {
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((s) => [s, 0])) as Record<FinalTestStatus, number>;
  byStatus[status] = 1;
  const base: TestRunReportV3 = {
    schema_version: 3,
    kind: "proliferate.test-run",
    candidate_build: null,
    run: {
      run_id: "run-1",
      shard_id: "shard-1",
      attempt: 1,
      source_sha: "d".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
      behavior: "diagnostic",
      execution: "real",
      started_at: "2026-07-13T00:00:00Z",
      finished_at: "2026-07-13T00:01:00Z",
    },
    inputs: { target_lane: "local", desktop: "web", agents: "all", scenarios: "all" },
    selected_cells: [
      {
        cell_id: SWITCH_CELL_ID,
        scenario_id: SELFHOST_ISOLATION_1_ID,
        registry_flow_ref: "specs#sh-switch-isolation",
        runtime_lane: "selfhost",
        dimensions: { cell: SH_SWITCH_ISOLATION, harness: "claude" },
        required_env: [],
      },
    ],
    results: [
      {
        cell_id: SWITCH_CELL_ID,
        scenario_id: SELFHOST_ISOLATION_1_ID,
        registry_flow_ref: "specs#sh-switch-isolation",
        runtime_lane: "selfhost",
        dimensions: { cell: SH_SWITCH_ISOLATION, harness: "claude" },
        status,
        started_at: "2026-07-13T00:00:01Z",
        finished_at: "2026-07-13T00:00:59Z",
        duration_ms: 58_000,
        reason: null,
        plan_steps: [],
      },
    ],
    summary: {
      selected: 1,
      finalized: 1,
      by_status: byStatus,
      integrity_errors: [],
      runner_errors: [],
      intended_exit_code: 0,
    },
    verdict: { status: "non_qualifying", scope: "selected_cells", completeness: "partial", reasons: [] },
  };
  base.verdict.reasons = expectedVerdict(base).reasons;
  return { ...base, schema_version: 4, results: base.results.map((r) => ({ ...r, evidence })) };
}
