import assert from "node:assert/strict";
import { test } from "node:test";

import { runReleaseCommand, synthesizeSourceCandidateBuild, type CommandDeps } from "./command.js";
import { BuildMapError, type CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { LocalWorldPorts } from "../worlds/local-workspace/ports.js";
import type { RunIdentityV1 } from "../runner/identity.js";
import type { TestRunReportV3, TestRunReportV4 } from "../evidence/schema.js";
import { ALL_FINAL_STATUSES, type FinalTestStatus } from "../runner/result.js";
import type { ScenarioDefinition } from "../scenarios/types.js";

const SHA = "c".repeat(40);

const IDENTITY: RunIdentityV1 = {
  run_id: "run-1",
  shard_id: "shard-1",
  attempt: 1,
  source_sha: SHA,
  origin: { kind: "local", github_run_id: null, github_job: null },
};

const SCENARIO: ScenarioDefinition = {
  id: "T3-FAKE",
  title: "fake",
  registryFlowRef: "specs#T3-FAKE",
  lanes: ["local"],
  requiredEnv: [],
  plan: () => [],
  run: async () => undefined,
};

const PORTS: LocalWorldPorts = { server: 8100, postgres: 8101, redis: 8102, anyharness: 8103, renderer: 8104 };

const VALID_MAP: CandidateBuildMapV1 = {
  schema_version: 1,
  kind: "proliferate.candidate-build",
  source_sha: SHA,
  artifacts: [
    {
      artifact_id: "anyharness/test-host",
      version: "9.9.9",
      sha256: "d".repeat(64),
      locator: { kind: "local_file", path: "/tmp/anyharness" },
    },
  ],
};

function fakeReport(candidateBuild: TestRunReportV3["candidate_build"]): TestRunReportV3 {
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) as Record<
    FinalTestStatus,
    number
  >;
  byStatus.green = 1;
  return {
    schema_version: 3,
    kind: "proliferate.test-run",
    candidate_build: candidateBuild,
    run: {
      ...IDENTITY,
      behavior: "diagnostic",
      execution: "real",
      started_at: "2026-07-14T00:00:00Z",
      finished_at: "2026-07-14T00:00:01Z",
    },
    inputs: { target_lane: "local", desktop: "web", agents: "all", scenarios: "all" },
    selected_cells: [
      {
        cell_id: "T3-FAKE/local",
        scenario_id: "T3-FAKE",
        registry_flow_ref: "specs#T3-FAKE",
        runtime_lane: "local",
        dimensions: {},
        required_env: [],
      },
    ],
    results: [
      {
        cell_id: "T3-FAKE/local",
        scenario_id: "T3-FAKE",
        registry_flow_ref: "specs#T3-FAKE",
        runtime_lane: "local",
        dimensions: {},
        status: "green",
        started_at: null,
        finished_at: "2026-07-14T00:00:01Z",
        duration_ms: null,
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
}

function makeDeps(overrides: Partial<CommandDeps> = {}): { deps: CommandDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: CommandDeps = {
    resolveIdentity: async () => {
      calls.push("identity");
      return IDENTITY;
    },
    selectScenarios: () => {
      calls.push("select");
      return [SCENARIO];
    },
    loadBuildMap: async () => {
      calls.push("loadBuildMap");
      return VALID_MAP;
    },
    loadLocalWorldPorts: async () => {
      calls.push("loadLocalWorldPorts");
      return PORTS;
    },
    seedLocalDurableUser: async () => {
      calls.push("seed");
    },
    pushLocalGatewayAuth: async () => {
      calls.push("gateway");
    },
    printEnvManifestReport: () => {
      calls.push("envManifest");
    },
    execute: async (options) => {
      calls.push("execute");
      return fakeReport(options.candidateBuild ?? null);
    },
    write: async () => {
      calls.push("write");
      return "/tmp/report.json";
    },
    fileIssues: async () => {
      calls.push("fileIssues");
      return [];
    },
    log: () => undefined,
    error: () => undefined,
    ...overrides,
  };
  return { deps, calls };
}

test("a valid supplied map is loaded after selection and before any setup side effect", async () => {
  const { deps, calls } = makeDeps();
  const exit = await runReleaseCommand(
    ["--behavior", "diagnostic", "--candidate-build-map", "/tmp/map.json"],
    deps,
  );
  assert.equal(exit, 0);
  assert.deepEqual(calls, ["identity", "select", "loadBuildMap", "loadLocalWorldPorts", "seed", "gateway", "envManifest", "execute", "write"]);
});

test("an invalid supplied map exits 2 with zero setup, execution, or report side effects", async () => {
  const { deps, calls } = makeDeps();
  deps.loadBuildMap = async () => {
    calls.push("loadBuildMap");
    throw new BuildMapError("bytes do not match the declared SHA-256");
  };
  const exit = await runReleaseCommand(
    ["--behavior", "diagnostic", "--candidate-build-map", "/tmp/map.json"],
    deps,
  );
  assert.equal(exit, 2);
  assert.deepEqual(calls, ["identity", "select", "loadBuildMap"]);
});

test("the map loader receives the resolved run identity's source SHA", async () => {
  let received: string | undefined;
  const { deps } = makeDeps();
  deps.loadBuildMap = async (mapPath, expectedSourceSha) => {
    received = expectedSourceSha;
    assert.equal(mapPath, "/tmp/map.json");
    return VALID_MAP;
  };
  await runReleaseCommand(["--behavior", "diagnostic", "--candidate-build-map", "/tmp/map.json"], deps);
  assert.equal(received, SHA);
});

test("diagnostic omission records explicit null and never calls the loader", async () => {
  let candidateSeen: unknown = "unset";
  const { deps, calls } = makeDeps();
  deps.execute = async (options) => {
    calls.push("execute");
    candidateSeen = options.candidateBuild;
    return fakeReport(options.candidateBuild ?? null);
  };
  const exit = await runReleaseCommand(["--behavior", "diagnostic"], deps);
  assert.equal(exit, 0);
  assert.equal(candidateSeen, null);
  assert.ok(!calls.includes("loadBuildMap"));
});

test("strict omission is rejected at parse time with zero dependency calls", async () => {
  const { deps, calls } = makeDeps();
  const exit = await runReleaseCommand(["--behavior", "strict"], deps);
  assert.equal(exit, 2);
  assert.deepEqual(calls, []);
});

test("--help exits 0 without identity, map loading, or a report", async () => {
  const { deps, calls } = makeDeps();
  const exit = await runReleaseCommand(["--help"], deps);
  assert.equal(exit, 0);
  assert.deepEqual(calls, []);
});

test("the validated map's evidence reaches execute and the written report", async () => {
  let written: TestRunReportV4 | undefined;
  const { deps } = makeDeps();
  deps.write = async (_outputDir, report) => {
    written = report;
    return "/tmp/report.json";
  };
  const exit = await runReleaseCommand(
    ["--behavior", "diagnostic", "--candidate-build-map", "/tmp/map.json"],
    deps,
  );
  assert.equal(exit, 0);
  assert.deepEqual(written?.candidate_build, {
    artifacts: [{ artifact_id: "anyharness/test-host", version: "9.9.9", sha256: "d".repeat(64) }],
  });
  // The evidence that reaches the report never carries locator paths.
  assert.ok(!JSON.stringify(written?.candidate_build).includes("/tmp/anyharness"));
});

test("report V4: schema_version 4 and null evidence for a scenario that attaches none", async () => {
  let written: TestRunReportV4 | undefined;
  const { deps } = makeDeps();
  deps.write = async (_outputDir, report) => {
    written = report;
    return "/tmp/report.json";
  };
  const exit = await runReleaseCommand(["--behavior", "diagnostic"], deps);
  assert.equal(exit, 0);
  assert.equal(written?.schema_version, 4);
  assert.equal(written?.results.length, 1);
  assert.equal(written?.results[0].evidence, null);
});

test("a report write failure still exits 2", async () => {
  const { deps } = makeDeps();
  deps.write = async () => {
    throw new Error("disk full");
  };
  const exit = await runReleaseCommand(["--behavior", "diagnostic"], deps);
  assert.equal(exit, 2);
});

test("an invalid cell expansion exits 2 before any setup side effect and writes no report", async () => {
  const brokenMatrix = {
    id: "T3-BROKEN",
    title: "broken matrix",
    registryFlowRef: "specs#T3-BROKEN",
    lanes: ["local"],
    requiredEnv: [],
    kind: "matrix",
    expandCells: () => {
      throw new Error("expansion bug");
    },
    planCell: () => [],
    runCells: async () => [],
  } as const;
  const { deps, calls } = makeDeps();
  deps.selectScenarios = () => {
    calls.push("select");
    return [brokenMatrix as unknown as ScenarioDefinition];
  };
  const exit = await runReleaseCommand(["--behavior", "diagnostic"], deps);
  assert.equal(exit, 2);
  // Identity and selection happen, planning fails; zero user/gateway/
  // provider/fixture/scenario setup and no report write follow.
  assert.deepEqual(calls, ["identity", "select"]);
});

function twoCellMatrix(): ScenarioDefinition {
  return {
    id: "T3-TWO",
    title: "two-cell matrix",
    registryFlowRef: "specs#T3-TWO",
    lanes: ["local"],
    requiredEnv: [],
    kind: "matrix",
    expandCells: () => [
      { dimensions: { cell: "CELL-A" } },
      { dimensions: { cell: "CELL-B" } },
    ],
    planCell: () => [],
    runCells: async () => [],
  } as unknown as ScenarioDefinition;
}

/**
 * A faithful model of SELFHOST-INSTALL-1: a `kind:"matrix"` scenario whose four
 * baseline cells EACH carry a `cell` dimension (SH-INSTALL-CLAIM / SH-DESKTOP-OWNER
 * / SH-BASE-TURN / SH-INVITEE). Using this (not a dimensionless leaf) is what
 * PR7-CONTROL-005 requires — the drop bug only reproduces with real cell dims.
 */
function selfhostInstallLike(): ScenarioDefinition {
  return {
    id: "SELFHOST-INSTALL-1",
    title: "selfhost install (four baseline cells)",
    registryFlowRef: "specs#SELFHOST-INSTALL-1",
    // `local` lane here only so this filter unit test plans under the default
    // `--lane local`; the --cells filter itself is lane-agnostic (the real
    // scenarios are lanes:["selfhost"], exercised by plan.test).
    lanes: ["local"],
    requiredEnv: [],
    kind: "matrix",
    expandCells: () => [
      { dimensions: { cell: "SH-INSTALL-CLAIM", harness: "claude" } },
      { dimensions: { cell: "SH-DESKTOP-OWNER", harness: "claude" } },
      { dimensions: { cell: "SH-BASE-TURN", harness: "claude" } },
      { dimensions: { cell: "SH-INVITEE", harness: "claude" } },
    ],
    planCell: () => [],
    runCells: async () => [],
  } as unknown as ScenarioDefinition;
}

/** A faithful model of SELFHOST-QUAL-1's staged cells (each carries a `cell` dimension). */
function selfhostQualLike(): ScenarioDefinition {
  return {
    id: "SELFHOST-QUAL-1",
    title: "selfhost qual (staged cells)",
    registryFlowRef: "specs#SELFHOST-QUAL-1",
    lanes: ["local"],
    requiredEnv: [],
    kind: "matrix",
    expandCells: () => [
      { dimensions: { cell: "SH-GITHUB-AUTH", harness: "claude" } },
      { dimensions: { cell: "SH-GATEWAY", harness: "claude" } },
      { dimensions: { cell: "SH-CLOUD-ADDON", harness: "claude" } },
    ],
    planCell: () => [],
    runCells: async () => [],
  } as unknown as ScenarioDefinition;
}

test("--cells keeps only the selected matrix cell and threads it to execute", async () => {
  let executedCells: Array<Record<string, string>> = [];
  const { deps } = makeDeps();
  deps.selectScenarios = () => [twoCellMatrix()];
  deps.execute = async (options) => {
    executedCells = options.cells.map((c) => c.dimensions);
    return fakeReport(options.candidateBuild ?? null);
  };
  const exit = await runReleaseCommand(
    ["--behavior", "diagnostic", "--cells", "CELL-B"],
    deps,
  );
  assert.equal(exit, 0);
  assert.deepEqual(executedCells, [{ cell: "CELL-B" }]);
});

test("--cells preserves SELFHOST-INSTALL-1's four baseline cells while narrowing SELFHOST-QUAL-1 (PR7-CONTROL-005)", async () => {
  // The exact scenario CONTROL flagged: SELFHOST-INSTALL-1 is a MATRIX with a
  // `cell` dimension on every cell, so it must be preserved by SCENARIO
  // OWNERSHIP (it owns none of the wanted cells), NOT by absence of a dimension.
  let executed: Array<Record<string, string>> = [];
  const { deps } = makeDeps();
  deps.selectScenarios = () => [selfhostInstallLike(), selfhostQualLike()];
  deps.execute = async (options) => {
    executed = options.cells.map((c) => c.dimensions);
    return fakeReport(options.candidateBuild ?? null);
  };
  const exit = await runReleaseCommand(["--behavior", "diagnostic", "--cells", "SH-GATEWAY"], deps);
  assert.equal(exit, 0);
  const cellNames = executed.map((d) => d.cell).sort();
  // All four install baseline cells survive; only SH-GATEWAY of QUAL-1 remains.
  assert.deepEqual(cellNames, [
    "SH-BASE-TURN",
    "SH-DESKTOP-OWNER",
    "SH-GATEWAY",
    "SH-INSTALL-CLAIM",
    "SH-INVITEE",
  ]);
  // The other QUAL-1 cells are dropped (narrowed within the owning scenario).
  assert.ok(!executed.some((d) => d.cell === "SH-GITHUB-AUTH"), "SH-GITHUB-AUTH must be dropped");
  assert.ok(!executed.some((d) => d.cell === "SH-CLOUD-ADDON"), "SH-CLOUD-ADDON must be dropped");
});

test("--cells matching no planned cell exits 2 before setup", async () => {
  const { deps, calls } = makeDeps();
  deps.selectScenarios = () => {
    calls.push("select");
    return [twoCellMatrix()];
  };
  const exit = await runReleaseCommand(
    ["--behavior", "diagnostic", "--cells", "CELL-Z"],
    deps,
  );
  assert.equal(exit, 2);
  assert.deepEqual(calls, ["identity", "select"]);
});

test("the validated path-bearing candidate build map reaches execute (not just its evidence)", async () => {
  let seenMap: unknown = "unset";
  const { deps } = makeDeps();
  deps.execute = async (options) => {
    seenMap = (options as unknown as { candidateBuildMap?: unknown }).candidateBuildMap;
    return fakeReport(options.candidateBuild ?? null);
  };
  const exit = await runReleaseCommand(
    ["--behavior", "diagnostic", "--candidate-build-map", "/tmp/map.json"],
    deps,
  );
  assert.equal(exit, 0);
  assert.deepEqual(seenMap, VALID_MAP);
});

test("diagnostic omission threads a null candidateBuildMap to execute", async () => {
  let seenMap: unknown = "unset";
  const { deps } = makeDeps();
  deps.execute = async (options) => {
    seenMap = (options as unknown as { candidateBuildMap?: unknown }).candidateBuildMap;
    return fakeReport(options.candidateBuild ?? null);
  };
  const exit = await runReleaseCommand(["--behavior", "diagnostic"], deps);
  assert.equal(exit, 0);
  assert.equal(seenMap, null);
});

test("planning happens after map validation and before setup in the dependency order", async () => {
  const { deps, calls } = makeDeps();
  const exit = await runReleaseCommand(
    ["--behavior", "diagnostic", "--candidate-build-map", "/tmp/map.json"],
    deps,
  );
  assert.equal(exit, 0);
  assert.deepEqual(calls, ["identity", "select", "loadBuildMap", "loadLocalWorldPorts", "seed", "gateway", "envManifest", "execute", "write"]);
});

test("the run dir (the map's directory) and its ports sidecar reach execute", async () => {
  let seenRunDir: unknown = "unset";
  let seenPorts: unknown = "unset";
  let loaderRunDir: string | undefined;
  const { deps } = makeDeps();
  deps.loadLocalWorldPorts = async (runDir) => {
    loaderRunDir = runDir;
    return PORTS;
  };
  deps.execute = async (options) => {
    seenRunDir = (options as unknown as { runDir?: unknown }).runDir;
    seenPorts = (options as unknown as { ports?: unknown }).ports;
    return fakeReport(options.candidateBuild ?? null);
  };
  const exit = await runReleaseCommand(
    ["--behavior", "diagnostic", "--candidate-build-map", "/run/dir/candidate-build.json"],
    deps,
  );
  assert.equal(exit, 0);
  assert.equal(loaderRunDir, "/run/dir");
  assert.equal(seenRunDir, "/run/dir");
  assert.deepEqual(seenPorts, PORTS);
});

test("diagnostic omission threads null runDir/ports and never loads the ports sidecar", async () => {
  let seenRunDir: unknown = "unset";
  let seenPorts: unknown = "unset";
  const { deps, calls } = makeDeps();
  deps.execute = async (options) => {
    seenRunDir = (options as unknown as { runDir?: unknown }).runDir;
    seenPorts = (options as unknown as { ports?: unknown }).ports;
    return fakeReport(options.candidateBuild ?? null);
  };
  const exit = await runReleaseCommand(["--behavior", "diagnostic"], deps);
  assert.equal(exit, 0);
  assert.equal(seenRunDir, null);
  assert.equal(seenPorts, null);
  assert.ok(!calls.includes("loadLocalWorldPorts"));
});

test("a malformed ports sidecar exits 2 before any setup side effect", async () => {
  const { deps, calls } = makeDeps();
  deps.loadLocalWorldPorts = async () => {
    calls.push("loadLocalWorldPorts");
    throw new Error("local-world-ports.json: \"server\" must be an integer TCP port");
  };
  const exit = await runReleaseCommand(
    ["--behavior", "diagnostic", "--candidate-build-map", "/tmp/map.json"],
    deps,
  );
  assert.equal(exit, 2);
  assert.deepEqual(calls, ["identity", "select", "loadBuildMap", "loadLocalWorldPorts"]);
});

// ── --source-candidate (BRIEF §1/§7 deviation 1) ────────────────────────────

test("synthesizeSourceCandidateBuild names the server/<platform> artifact with a non-empty version and a 64-hex digest", () => {
  const evidence = synthesizeSourceCandidateBuild("a".repeat(40));
  assert.equal(evidence.artifacts.length, 1);
  const [artifact] = evidence.artifacts;
  assert.equal(artifact.artifact_id, `server/${process.platform}`);
  assert.ok(artifact.version.length > 0);
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
});

test("synthesizeSourceCandidateBuild binds the digest to the source sha (two different commits never collide)", () => {
  const a = synthesizeSourceCandidateBuild("a".repeat(40));
  const b = synthesizeSourceCandidateBuild("b".repeat(40));
  assert.notEqual(a.artifacts[0].sha256, b.artifacts[0].sha256);
});

test("--source-candidate threads a non-null candidate_build into the written report with no map materialization", async () => {
  const { deps } = makeDeps();
  deps.selectScenarios = () => [{ ...SCENARIO, id: "T2-FAKE", sourceBacked: true }];
  let written: TestRunReportV4 | undefined;
  deps.write = async (_dir, report) => {
    written = report;
    return "/tmp/report.json";
  };
  const exit = await runReleaseCommand(["--behavior", "diagnostic", "--source-candidate"], deps);
  assert.equal(exit, 0);
  assert.ok(written?.candidate_build !== null, "candidate_build is non-null for a source-candidate run");
  assert.equal(written?.candidate_build?.artifacts[0].artifact_id, `server/${process.platform}`);
});

test("--source-candidate refuses non-source-backed scenarios with exit 2 and no report (T2R-R01)", async () => {
  const { deps, calls } = makeDeps();
  // The default SCENARIO is a Tier-3 shape with no sourceBacked marker — a
  // strict T3/T4 selection must never substitute a synthetic source identity
  // for the exact candidate-build map.
  let wrote = false;
  deps.write = async () => {
    wrote = true;
    return "/tmp/report.json";
  };
  const errors: string[] = [];
  deps.error = (message) => {
    errors.push(message);
  };
  const exit = await runReleaseCommand(["--behavior", "strict", "--source-candidate"], deps);
  assert.equal(exit, 2);
  assert.equal(wrote, false, "no report is written");
  assert.ok(
    errors.some((e) => e.includes("T3-FAKE") && e.includes("source-backed")),
    "the refusal names the offending scenario",
  );
  assert.ok(!calls.includes("execute"), "no scenario executes");
});
