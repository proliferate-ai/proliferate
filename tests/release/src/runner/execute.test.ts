import assert from "node:assert/strict";
import { test } from "node:test";

import type { EnvResolution, ResolvedEnvVar } from "../config/env-resolution.js";
import type {
  LeafScenarioDefinition,
  MatrixScenarioDefinition,
  ScenarioCellOutcome,
  ScenarioDefinition,
} from "../scenarios/types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../scenarios/types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { CellEvidenceV1 } from "../evidence/schema.js";
import { executeSelectedCells, type ExecuteOptions } from "./execute.js";
import { buildPlannedCells } from "./plan.js";
import type { RunIdentityV1 } from "./identity.js";

const IDENTITY: RunIdentityV1 = {
  run_id: "run-1",
  shard_id: "shard-1",
  attempt: 1,
  source_sha: "c".repeat(40),
  origin: { kind: "local", github_run_id: null, github_job: null },
};

interface FakeScenarioOptions {
  id: string;
  lanes?: Array<"local" | "sandbox">;
  requiredEnv?: string[];
  run?: LeafScenarioDefinition["run"];
  plan?: LeafScenarioDefinition["plan"];
}

function fakeScenario(options: FakeScenarioOptions): LeafScenarioDefinition {
  return {
    id: options.id,
    title: `${options.id} title`,
    registryFlowRef: `specs#${options.id}`,
    lanes: options.lanes ?? ["local"],
    requiredEnv: options.requiredEnv ?? [],
    plan: options.plan ?? (() => [{ description: `plan ${options.id}` }]),
    run: options.run ?? (async () => undefined),
  };
}

interface FakeMatrixOptions {
  id: string;
  lanes?: Array<"local" | "sandbox">;
  requiredEnv?: string[];
  cells?: Array<Record<string, string>>;
  cellRequiredEnv?: Record<string, string[]>;
  runCells?: MatrixScenarioDefinition["runCells"];
  planCell?: MatrixScenarioDefinition["planCell"];
}

function fakeMatrix(options: FakeMatrixOptions): MatrixScenarioDefinition {
  const dims = options.cells ?? [{ child: "a" }, { child: "b" }, { child: "c" }];
  return {
    id: options.id,
    title: `${options.id} title`,
    registryFlowRef: `specs#${options.id}`,
    lanes: options.lanes ?? ["local"],
    requiredEnv: options.requiredEnv ?? [],
    kind: "matrix",
    expandCells: () =>
      dims.map((dimensions) => ({
        dimensions,
        requiredEnv: options.cellRequiredEnv?.[Object.values(dimensions)[0]],
      })),
    planCell: options.planCell ?? ((_ctx, cell) => [{ description: `plan ${cell.cell_id}` }]),
    runCells:
      options.runCells ??
      (async (_ctx, cells) => cells.map((cell) => ({ cellId: cell.cell_id, status: "green" as const }))),
  };
}

function fakeEnv(presentNames: string[] = [], secretValues: Record<string, string> = {}): EnvResolution {
  const names = new Set([...presentNames, ...Object.keys(secretValues)]);
  const all: ResolvedEnvVar[] = [...names].map((name) => ({
    spec: {
      name,
      description: name,
      whereItLives: "test",
      secret: name in secretValues,
    } as ResolvedEnvVar["spec"],
    value: secretValues[name] ?? "value",
    present: true,
  }));
  return {
    all,
    missing: [],
    present: (name) => names.has(name),
    get: (name) => (names.has(name) ? (secretValues[name] ?? "value") : undefined),
    require: (name) => {
      const value = secretValues[name] ?? (names.has(name) ? "value" : undefined);
      if (value === undefined) {
        throw new Error(`missing ${name}`);
      }
      return value;
    },
  };
}

async function optionsFor(
  scenarios: ScenarioDefinition[],
  overrides: Partial<ExecuteOptions> = {},
): Promise<ExecuteOptions> {
  const cells =
    overrides.cells ??
    (await buildPlannedCells(scenarios, {
      desktop: "web",
      agents:
        overrides.inputs?.agents === undefined || overrides.inputs.agents === "all"
          ? ["all"]
          : overrides.inputs.agents,
    }));
  return {
    behavior: "diagnostic",
    execution: "real",
    identity: IDENTITY,
    inputs: { targetLane: "local", desktop: "web", agents: "all", scenarios: "all" },
    scenarios,
    cells,
    resolveNeededEnv: () => fakeEnv(),
    resolveSecretValues: () => [],
    ...overrides,
  };
}

test("normal leaf return normalizes to green with timestamps and duration", async () => {
  const report = await executeSelectedCells(await optionsFor([fakeScenario({ id: "A" })]));
  const [result] = report.results;
  assert.equal(result.status, "green");
  assert.equal(result.cell_id, "A/local");
  assert.deepEqual(result.dimensions, {});
  assert.ok(result.started_at !== null);
  assert.ok(typeof result.duration_ms === "number");
  assert.equal(report.verdict.status, "non_qualifying");
  assert.equal(report.summary.intended_exit_code, 0);
});

test("leaf ScenarioBlockedError, ScenarioExpectedFailError, Error, and non-Error throws normalize correctly", async () => {
  const scenarios = [
    fakeScenario({ id: "BLOCKED", run: async () => { throw new ScenarioBlockedError("gate"); } }),
    fakeScenario({ id: "XFAIL", run: async () => { throw new ScenarioExpectedFailError("known gap"); } }),
    fakeScenario({ id: "RED", run: async () => { throw new Error("assertion failed"); } }),
    fakeScenario({ id: "WEIRD", run: async () => { throw "a string"; } }),
    fakeScenario({ id: "GREEN" }),
  ];
  const report = await executeSelectedCells(await optionsFor(scenarios));
  const byId = new Map(report.results.map((result) => [result.cell_id, result]));
  assert.equal(byId.get("BLOCKED/local")?.status, "blocked");
  assert.equal(byId.get("BLOCKED/local")?.reason?.code, "scenario_blocked");
  assert.equal(byId.get("XFAIL/local")?.status, "expected_fail");
  assert.equal(byId.get("XFAIL/local")?.reason?.code, "known_gap");
  assert.equal(byId.get("RED/local")?.status, "failed");
  assert.equal(byId.get("RED/local")?.reason?.code, "scenario_failure");
  assert.equal(byId.get("WEIRD/local")?.status, "failed");
  // Diagnostic continues every independent sibling after each terminal state.
  assert.equal(byId.get("GREEN/local")?.status, "green");
  assert.equal(report.summary.intended_exit_code, 1);
});

test("a three-cell collector returning green/failed/green preserves all three; strict exits 1", async () => {
  const matrix = fakeMatrix({
    id: "M",
    runCells: async (_ctx, cells) =>
      cells.map((cell, index) => ({
        cellId: cell.cell_id,
        status: index === 1 ? ("failed" as const) : ("green" as const),
        reason: index === 1 ? { code: "scenario_failure" as const, message: "child b broke" } : undefined,
      })),
  });
  const report = await executeSelectedCells(await optionsFor([matrix], { behavior: "strict" }));
  assert.equal(report.results.length, 3);
  assert.deepEqual(
    report.results.map((result) => result.status),
    ["green", "failed", "green"],
  );
  assert.equal(report.verdict.status, "selected_cells_failed");
  assert.equal(report.summary.intended_exit_code, 1);
});

test("an omitted child outcome is synthesized as missing with integrity exit 2", async () => {
  const matrix = fakeMatrix({
    id: "M",
    runCells: async (_ctx, cells) =>
      cells
        .filter((cell) => cell.dimensions.child !== "b")
        .map((cell) => ({ cellId: cell.cell_id, status: "green" as const })),
  });
  const report = await executeSelectedCells(await optionsFor([matrix]));
  const omitted = report.results.find((result) => result.dimensions.child === "b");
  assert.equal(omitted?.status, "missing");
  assert.ok(report.summary.integrity_errors.length > 0);
  assert.equal(report.summary.intended_exit_code, 2);
});

test("a duplicate child outcome keeps the first result and records an integrity error", async () => {
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "a" }],
    runCells: async (_ctx, cells) => [
      { cellId: cells[0].cell_id, status: "green" as const },
      { cellId: cells[0].cell_id, status: "failed" as const },
    ],
  });
  const report = await executeSelectedCells(await optionsFor([matrix]));
  assert.equal(report.results[0].status, "green");
  assert.ok(report.summary.integrity_errors.some((error) => error.code === "duplicate_result"));
  assert.equal(report.summary.intended_exit_code, 2);
});

test("an unknown child outcome — even another group's planned cell — is an integrity error", async () => {
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "a" }],
    runCells: async (_ctx, cells) => [
      { cellId: cells[0].cell_id, status: "green" as const },
      { cellId: "OTHER/local", status: "green" as const },
    ],
  });
  const other = fakeScenario({ id: "OTHER" });
  const report = await executeSelectedCells(await optionsFor([matrix, other]));
  // The leaf OTHER/local must carry its own real result, not the collector's.
  const otherResult = report.results.find((result) => result.cell_id === "OTHER/local");
  assert.equal(otherResult?.status, "green");
  assert.ok(report.summary.integrity_errors.some((error) => error.message.includes("unassigned cell")));
  assert.equal(report.summary.intended_exit_code, 2);
});

test("a one-child matrix still must return one explicit child outcome", async () => {
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "only" }],
    runCells: async () => [],
  });
  const report = await executeSelectedCells(await optionsFor([matrix]));
  assert.equal(report.results[0].status, "missing");
  assert.equal(report.summary.intended_exit_code, 2);
});

test("a collector-level throw finalizes all assigned runnable cells honestly", async () => {
  const failing = fakeMatrix({
    id: "MFAIL",
    runCells: async () => {
      throw new Error("shared setup exploded");
    },
  });
  const blocked = fakeMatrix({
    id: "MBLOCK",
    runCells: async () => {
      throw new ScenarioBlockedError("shared gate");
    },
  });
  const xfail = fakeMatrix({
    id: "MXFAIL",
    runCells: async () => {
      throw new ScenarioExpectedFailError("shared known gap");
    },
  });
  const sibling = fakeScenario({ id: "GREEN" });
  const report = await executeSelectedCells(await optionsFor([failing, blocked, xfail, sibling]));
  const byId = new Map(report.results.map((result) => [result.cell_id, result]));
  for (const child of ["a", "b", "c"]) {
    assert.equal(byId.get(`MFAIL/local/child=${child}`)?.status, "failed");
    assert.equal(byId.get(`MBLOCK/local/child=${child}`)?.status, "blocked");
    assert.equal(byId.get(`MXFAIL/local/child=${child}`)?.status, "expected_fail");
  }
  // Independent scenario/runtime collectors continue after one collector fails.
  assert.equal(byId.get("GREEN/local")?.status, "green");
  assert.equal(report.summary.integrity_errors.length, 0);
});

test("a collector cannot self-declare runner-only terminal states", async () => {
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "a" }],
    runCells: async (_ctx, cells) => [
      { cellId: cells[0].cell_id, status: "cancelled" } as unknown as ScenarioCellOutcome,
    ],
  });
  const report = await executeSelectedCells(await optionsFor([matrix]));
  assert.equal(report.results[0].status, "missing");
  assert.ok(report.summary.integrity_errors.some((error) => error.message.includes("runner-only status")));
  assert.equal(report.summary.intended_exit_code, 2);
});

test("runCells is invoked once per scenario/runtime lane with its assigned cells", async () => {
  const invocations: Array<{ lane: string; cellIds: string[] }> = [];
  const matrix = fakeMatrix({
    id: "M",
    lanes: ["local", "sandbox"],
    runCells: async (ctx, cells) => {
      invocations.push({ lane: ctx.runtimeLane, cellIds: cells.map((cell) => cell.cell_id) });
      return cells.map((cell) => ({ cellId: cell.cell_id, status: "green" as const }));
    },
  });
  await executeSelectedCells(await optionsFor([matrix]));
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations.map((invocation) => invocation.lane).sort(), ["local", "sandbox"]);
  for (const invocation of invocations) {
    assert.equal(invocation.cellIds.length, 3);
  }
});

test("diagnostic missing requirements block only affected cells; the collector receives the rest", async () => {
  let received: string[] = [];
  const matrix = fakeMatrix({
    id: "M",
    cellRequiredEnv: { b: ["MISSING_VAR"] },
    runCells: async (_ctx, cells) => {
      received = cells.map((cell) => cell.cell_id);
      return cells.map((cell) => ({ cellId: cell.cell_id, status: "green" as const }));
    },
  });
  const report = await executeSelectedCells(await optionsFor([matrix]));
  const byId = new Map(report.results.map((result) => [result.cell_id, result]));
  assert.equal(byId.get("M/local/child=b")?.status, "blocked");
  assert.equal(byId.get("M/local/child=b")?.reason?.code, "missing_requirement");
  assert.equal(byId.get("M/local/child=a")?.status, "green");
  assert.equal(byId.get("M/local/child=c")?.status, "green");
  assert.deepEqual(received.sort(), ["M/local/child=a", "M/local/child=c"]);
  assert.equal(report.summary.intended_exit_code, 0);
});

test("strict missing preflight executes zero collector bodies, blocks affected, cancels the rest", async () => {
  let collectorRan = false;
  let leafRan = false;
  const matrix = fakeMatrix({
    id: "M",
    cellRequiredEnv: { b: ["MISSING_VAR"] },
    runCells: async (_ctx, cells) => {
      collectorRan = true;
      return cells.map((cell) => ({ cellId: cell.cell_id, status: "green" as const }));
    },
  });
  const leaf = fakeScenario({
    id: "FREE",
    run: async () => {
      leafRan = true;
    },
  });
  const report = await executeSelectedCells(await optionsFor([matrix, leaf], { behavior: "strict" }));
  assert.equal(collectorRan, false);
  assert.equal(leafRan, false);
  const byId = new Map(report.results.map((result) => [result.cell_id, result]));
  assert.equal(byId.get("M/local/child=b")?.status, "blocked");
  assert.equal(byId.get("M/local/child=a")?.status, "cancelled");
  assert.equal(byId.get("FREE/local")?.status, "cancelled");
  assert.equal(report.verdict.status, "selected_cells_failed");
  assert.equal(report.summary.intended_exit_code, 1);
});

test("dry-run lists and reports every exact cell without executing collectors", async () => {
  let collectorRan = false;
  const planned: string[] = [];
  const matrix = fakeMatrix({
    id: "M",
    planCell: (_ctx, cell) => {
      planned.push(cell.cell_id);
      return [{ description: `steps for ${cell.cell_id}` }];
    },
    runCells: async () => {
      collectorRan = true;
      return [];
    },
  });
  const leaf = fakeScenario({ id: "LEAF" });
  const report = await executeSelectedCells(await optionsFor([matrix, leaf], { execution: "dry_run" }));
  assert.equal(collectorRan, false);
  assert.equal(planned.length, 3);
  assert.equal(report.results.length, 4);
  for (const result of report.results) {
    assert.equal(result.status, "not_run");
    assert.equal(result.reason?.code, "dry_run");
    assert.ok(result.plan_steps.length > 0);
  }
  assert.equal(report.summary.intended_exit_code, 0);
});

test("a throwing planCell becomes not_run/plan_error, records a runner error, continues, exits 2", async () => {
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "a" }, { child: "b" }],
    planCell: (_ctx, cell) => {
      if (cell.dimensions.child === "a") {
        throw new Error("plan bug");
      }
      return [{ description: "fine" }];
    },
  });
  const report = await executeSelectedCells(await optionsFor([matrix], { execution: "dry_run" }));
  const byId = new Map(report.results.map((result) => [result.cell_id, result]));
  assert.equal(byId.get("M/local/child=a")?.reason?.code, "plan_error");
  assert.equal(byId.get("M/local/child=b")?.reason?.code, "dry_run");
  assert.equal(report.summary.runner_errors.length, 1);
  assert.equal(report.summary.intended_exit_code, 2);
});

test("a post-selection runner defect finalizes every pending cell and still produces a report", async () => {
  const scenarios = [fakeScenario({ id: "A" }), fakeScenario({ id: "B" })];
  const report = await executeSelectedCells(
    await optionsFor(scenarios, {
      resolveNeededEnv: () => {
        throw new Error('resolveEnv: "NOT_IN_MANIFEST" is not declared');
      },
    }),
  );
  assert.equal(report.results.length, 2);
  for (const result of report.results) {
    assert.equal(result.status, "missing");
  }
  assert.equal(report.summary.runner_errors.length, 1);
  assert.equal(report.summary.intended_exit_code, 2);
});

test("exact resolved secret values are redacted from the report", async () => {
  const secret = "sk-super-secret-value";
  const scenarios = [
    fakeScenario({
      id: "LEAKY",
      requiredEnv: ["SECRET_VAR"],
      run: async () => {
        throw new Error(`request failed with key ${secret}`);
      },
    }),
  ];
  const report = await executeSelectedCells(
    await optionsFor(scenarios, {
      resolveNeededEnv: () => fakeEnv([], { SECRET_VAR: secret }),
      resolveSecretValues: () => [secret],
    }),
  );
  assert.ok(!JSON.stringify(report).includes(secret));
  assert.match(report.results[0].reason!.message, /\[REDACTED\]/);
});

test("the report records identity, inputs, candidate evidence, and selected/result equality", async () => {
  const evidence = {
    artifacts: [{ artifact_id: "anyharness/test-host", version: "9.9.9", sha256: "e".repeat(64) }],
  };
  const report = await executeSelectedCells(
    await optionsFor([fakeScenario({ id: "A", lanes: ["local", "sandbox"] })], {
      inputs: { targetLane: "staging", desktop: "native", agents: ["claude"], scenarios: ["A"] },
      candidateBuild: evidence,
    }),
  );
  assert.equal(report.schema_version, 3);
  assert.equal(report.run.run_id, "run-1");
  assert.equal(report.inputs.target_lane, "staging");
  assert.deepEqual(report.candidate_build, evidence);
  assert.deepEqual(
    report.selected_cells.map((cell) => cell.cell_id).sort(),
    report.results.map((result) => result.cell_id).sort(),
  );
  assert.equal(report.summary.selected, report.summary.finalized);
});

test("candidate evidence defaults to explicit null when omitted", async () => {
  const report = await executeSelectedCells(await optionsFor([fakeScenario({ id: "A" })]));
  assert.equal(report.candidate_build, null);
});

test("strict all-green across leaf and matrix cells is the only strict exit-0 result", async () => {
  const report = await executeSelectedCells(
    await optionsFor([fakeScenario({ id: "A" }), fakeMatrix({ id: "M" })], { behavior: "strict" }),
  );
  assert.equal(report.verdict.status, "selected_cells_passed");
  assert.equal(report.verdict.scope, "selected_cells");
  assert.equal(report.verdict.completeness, "partial");
  assert.equal(report.summary.intended_exit_code, 0);
});

test("a collector mutating its received cells cannot alter the plan or evidence (ETM-002)", async () => {
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "a" }],
    runCells: async (_ctx, cells) => {
      // Hostile collector: rewrites everything it was handed.
      const cell = cells[0] as { cell_id: string; dimensions: Record<string, string>; required_env: string[] };
      const originalId = cell.cell_id;
      cell.cell_id = "M/local/child=tampered";
      cell.dimensions.child = "tampered";
      cell.required_env.push("INJECTED_VAR");
      return [{ cellId: originalId, status: "green" as const }];
    },
  });
  const report = await executeSelectedCells(await optionsFor([matrix]));
  assert.equal(report.selected_cells[0].cell_id, "M/local/child=a");
  assert.deepEqual(report.selected_cells[0].dimensions, { child: "a" });
  assert.deepEqual(report.selected_cells[0].required_env, []);
  assert.equal(report.results[0].cell_id, "M/local/child=a");
  assert.deepEqual(report.results[0].dimensions, { child: "a" });
  assert.equal(report.results[0].status, "green");
  assert.equal(report.summary.integrity_errors.length, 0);
});

test("null, undefined, and malformed collector output is runner integrity, never a product failure (ETM-003)", async () => {
  for (const bad of [null, undefined, "green", { cellId: 1 }]) {
    const matrix = fakeMatrix({
      id: "M",
      cells: [{ child: "a" }],
      runCells: (async () => (Array.isArray(bad) || typeof bad !== "object" || bad === null
        ? bad
        : [bad])) as unknown as MatrixScenarioDefinition["runCells"],
    });
    const report = await executeSelectedCells(await optionsFor([matrix]));
    assert.equal(report.results[0].status, "missing", `for output ${JSON.stringify(bad)}`);
    assert.notEqual(report.results[0].status, "failed");
    assert.ok(report.summary.integrity_errors.length > 0);
    assert.equal(report.summary.intended_exit_code, 2);
  }
});

test("a throwing reason getter is runner integrity, never an ordinary failed result (ETM-003)", async () => {
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "a" }],
    runCells: async (_ctx, cells) => {
      const poisoned = { cellId: cells[0].cell_id, status: "failed" as const };
      Object.defineProperty(poisoned, "reason", {
        get() {
          throw new Error("hostile getter");
        },
        enumerable: true,
      });
      return [poisoned as ScenarioCellOutcome];
    },
  });
  const report = await executeSelectedCells(await optionsFor([matrix]));
  assert.equal(report.results[0].status, "missing");
  assert.notEqual(report.results[0].status, "failed");
  assert.ok(report.summary.integrity_errors.length > 0);
  assert.equal(report.summary.intended_exit_code, 2);
});

test("a malformed reason value preserves the aggregate as integrity exit 2 (ETM-003)", async () => {
  for (const badReason of [
    null,
    "oops",
    42,
    { code: "not_a_known_code", message: "x" },
    { code: "scenario_failure" },
  ]) {
    const matrix = fakeMatrix({
      id: "M",
      cells: [{ child: "a" }],
      runCells: async (_ctx, cells) => [
        { cellId: cells[0].cell_id, status: "failed", reason: badReason } as unknown as ScenarioCellOutcome,
      ],
    });
    const report = await executeSelectedCells(await optionsFor([matrix]));
    assert.equal(report.results[0].status, "missing", `for reason ${JSON.stringify(badReason)}`);
    assert.equal(report.summary.intended_exit_code, 2);
    // The aggregate survived — sanitization did not crash on the bad reason.
    assert.equal(report.schema_version, 3);
  }
});

test("nested reason accessors are read exactly once before their values are persisted (ETM-003)", async () => {
  let codeReads = 0;
  let messageReads = 0;
  const reason = {
    get code(): unknown {
      codeReads += 1;
      return codeReads === 1 ? "scenario_failure" : "evil_code";
    },
    get message(): unknown {
      messageReads += 1;
      return messageReads === 1 ? "captured failure" : 42;
    },
  };
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "a" }],
    runCells: async (_ctx, cells) => [
      { cellId: cells[0].cell_id, status: "failed", reason } as unknown as ScenarioCellOutcome,
    ],
  });

  const report = await executeSelectedCells(await optionsFor([matrix]));
  assert.equal(codeReads, 1);
  assert.equal(messageReads, 1);
  assert.equal(report.results[0].status, "failed");
  assert.deepEqual(report.results[0].reason, {
    code: "scenario_failure",
    message: "captured failure",
  });
  assert.equal(report.summary.integrity_errors.length, 0);
  assert.equal(report.summary.intended_exit_code, 1);
});

test("a poisoned outcome iterator is runner integrity, not a collector failure (ETM-003)", async () => {
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "a" }],
    runCells: async () => {
      const hostile: ScenarioCellOutcome[] = [];
      Object.defineProperty(hostile, Symbol.iterator, {
        value() {
          throw new Error("hostile iterator");
        },
      });
      return hostile;
    },
  });
  const report = await executeSelectedCells(await optionsFor([matrix]));
  assert.equal(report.results[0].status, "missing");
  assert.ok(report.summary.integrity_errors.length > 0);
  assert.equal(report.summary.intended_exit_code, 2);
});

test("a collector mutating ctx.agents cannot alter the persisted invocation inputs", async () => {
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "a" }],
    runCells: async (ctx, cells) => {
      (ctx.agents as string[]).push("injected-agent");
      return cells.map((cell) => ({ cellId: cell.cell_id, status: "green" as const }));
    },
  });
  const report = await executeSelectedCells(
    await optionsFor([matrix], {
      inputs: { targetLane: "local", desktop: "web", agents: ["claude"], scenarios: "all" },
    }),
  );
  assert.deepEqual(report.inputs.agents, ["claude"]);
});

test("the executor threads the path-bearing candidate build map into ctx.candidateBuildMap (BRIEF §7a)", async () => {
  const sentinelMap = { source_sha: "s".repeat(40), artifacts: [] } as unknown as CandidateBuildMapV1;
  let seen: unknown = "unset";
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "a" }],
    runCells: async (ctx, cells) => {
      seen = ctx.candidateBuildMap;
      return cells.map((cell) => ({ cellId: cell.cell_id, status: "green" as const }));
    },
  });
  await executeSelectedCells(await optionsFor([matrix], { candidateBuildMap: sentinelMap }));
  assert.equal(seen, sentinelMap);
});

test("ctx.candidateBuildMap defaults to null when no map is supplied (BRIEF §7a)", async () => {
  let seen: unknown = "unset";
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "a" }],
    runCells: async (ctx, cells) => {
      seen = ctx.candidateBuildMap;
      return cells.map((cell) => ({ cellId: cell.cell_id, status: "green" as const }));
    },
  });
  await executeSelectedCells(await optionsFor([matrix]));
  assert.equal(seen, null);
});

test("a matrix outcome's evidence rides into the result; a cell without evidence defaults to null (BRIEF §7b)", async () => {
  const attached = { kind: "local_workspace_turn", harness: "claude" } as unknown as CellEvidenceV1;
  const matrix = fakeMatrix({
    id: "M",
    cells: [{ child: "a" }, { child: "b" }],
    runCells: async (_ctx, cells) =>
      cells.map((cell, index) =>
        index === 0
          ? { cellId: cell.cell_id, status: "green" as const, evidence: attached }
          : { cellId: cell.cell_id, status: "green" as const },
      ),
  });
  const report = await executeSelectedCells(await optionsFor([matrix]));
  const results = report.results as Array<{ dimensions: Record<string, string>; evidence?: unknown }>;
  const a = results.find((result) => result.dimensions.child === "a");
  const b = results.find((result) => result.dimensions.child === "b");
  assert.equal(a?.evidence, attached);
  assert.equal(b?.evidence, null);
});
