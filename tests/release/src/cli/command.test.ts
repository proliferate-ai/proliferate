import assert from "node:assert/strict";
import { test } from "node:test";

import { runReleaseCommand, type CommandDeps } from "./command.js";
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
