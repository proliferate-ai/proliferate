import assert from "node:assert/strict";
import { test } from "node:test";

import type { LeafScenarioDefinition, MatrixScenarioDefinition, ScenarioCellSpec } from "../scenarios/types.js";
import { buildPlannedCells, SelectionError } from "./plan.js";

type TestLane = "local" | "sandbox" | "selfhost";

function leaf(id: string, lanes: TestLane[] = ["local"]): LeafScenarioDefinition {
  return {
    id,
    title: id,
    registryFlowRef: `specs#${id}`,
    lanes,
    requiredEnv: ["SCENARIO_VAR"],
    plan: () => [],
    run: async () => undefined,
  };
}

function matrix(
  id: string,
  specs: ScenarioCellSpec[],
  lanes: TestLane[] = ["local"],
): MatrixScenarioDefinition {
  return {
    id,
    title: id,
    registryFlowRef: `specs#${id}`,
    lanes,
    requiredEnv: ["SCENARIO_VAR"],
    kind: "matrix",
    expandCells: () => specs,
    planCell: () => [],
    runCells: async () => [],
  };
}

const INPUTS = { desktop: "web" as const, agents: ["all"] };

test("leaf scenarios retain one unchanged scenario/lane cell", async () => {
  const cells = await buildPlannedCells([leaf("T3-BILL-1", ["local", "sandbox"])], INPUTS);
  assert.deepEqual(
    cells.map((cell) => cell.cell_id),
    ["T3-BILL-1/local", "T3-BILL-1/sandbox"],
  );
  assert.deepEqual(cells[0].dimensions, {});
  assert.deepEqual(cells[0].required_env, ["SCENARIO_VAR"]);
});

test("--lane local plans only local-runtime cells for a both-lane scenario (decision #5)", async () => {
  // Run-1 executed T3-CHAT-1/sandbox and T3-WT-1/sandbox under --lane local
  // because the planner expanded every declared lane regardless of target lane.
  const cells = await buildPlannedCells([leaf("T3-WT-1", ["local", "sandbox"])], {
    ...INPUTS,
    targetLane: "local",
  });
  assert.deepEqual(
    cells.map((cell) => cell.cell_id),
    ["T3-WT-1/local"],
  );
});

test("--lane local filters sandbox cells out of matrix scenarios too", async () => {
  const cells = await buildPlannedCells(
    [matrix("T3-CHAT-1", [{ dimensions: { harness: "claude" } }], ["local", "sandbox"])],
    { ...INPUTS, targetLane: "local" },
  );
  assert.deepEqual(
    cells.map((cell) => cell.cell_id),
    ["T3-CHAT-1/local/harness=claude"],
  );
});

test("--lane staging keeps every declared runtime lane (legacy behavior untouched)", async () => {
  const cells = await buildPlannedCells([leaf("T3-WT-1", ["local", "sandbox"])], {
    ...INPUTS,
    targetLane: "staging",
  });
  assert.deepEqual(
    cells.map((cell) => cell.cell_id),
    ["T3-WT-1/local", "T3-WT-1/sandbox"],
  );
});

// ── --lane selfhost: the shipped qualification-selfhost entrypoint (PR7-CONTROL-001) ──

test("--lane selfhost plans the selfhost cells of a selfhost scenario (PR7-CONTROL-001)", async () => {
  // The shipped `qualification-selfhost` Make target passes `--lane selfhost`.
  // Every PR 7 scenario declares lanes:["selfhost"]; before the fix the target
  // passed `--lane local`, which admitted only local cells → "Selection
  // expanded to zero cells" and the shipped target never ran end to end.
  const cells = await buildPlannedCells(
    [matrix("SELFHOST-QUAL-1", [{ dimensions: { cell: "SH-GATEWAY", harness: "claude" } }], ["selfhost"])],
    { ...INPUTS, targetLane: "selfhost" },
  );
  assert.deepEqual(
    cells.map((cell) => cell.cell_id),
    ["SELFHOST-QUAL-1/selfhost/cell=SH-GATEWAY,harness=claude"],
  );
});

test("--lane local admits NO selfhost cells (keeps the ubuntu local sweep clean)", async () => {
  // The `--scenarios all --lane local` ubuntu CI job must never drag an
  // EC2-provisioning selfhost scenario onto the runner. A selection of ONLY a
  // selfhost scenario under --lane local therefore expands to zero cells.
  await assert.rejects(
    buildPlannedCells([leaf("SELFHOST-INSTALL-1", ["selfhost"])], { ...INPUTS, targetLane: "local" }),
    SelectionError,
  );
});

test("--lane selfhost admits NO local/sandbox cells (single-infrastructure target)", async () => {
  const cells = await buildPlannedCells(
    [leaf("MIXED", ["local", "sandbox", "selfhost"])],
    { ...INPUTS, targetLane: "selfhost" },
  );
  assert.deepEqual(
    cells.map((cell) => cell.cell_id),
    ["MIXED/selfhost"],
  );
});

test("matrix cell ids are deterministic regardless of declaration order", async () => {
  const declared = [{ dimensions: { harness: "codex" } }, { dimensions: { harness: "claude" } }];
  const reversed = [...declared].reverse();
  const first = await buildPlannedCells([matrix("M", declared)], INPUTS);
  const second = await buildPlannedCells([matrix("M", reversed)], INPUTS);
  assert.deepEqual(
    first.map((cell) => cell.cell_id),
    second.map((cell) => cell.cell_id),
  );
  assert.deepEqual(
    first.map((cell) => cell.cell_id),
    ["M/local/harness=claude", "M/local/harness=codex"],
  );
});

test("multi-dimension cell ids sort dimension keys lexicographically", async () => {
  const cells = await buildPlannedCells(
    [matrix("M", [{ dimensions: { route: "gateway", harness: "claude" } }])],
    INPUTS,
  );
  assert.equal(cells[0].cell_id, "M/local/harness=claude,route=gateway");
  assert.deepEqual(Object.keys(cells[0].dimensions), ["harness", "route"]);
});

test("dimension values are safely encoded into the cell id", async () => {
  const cells = await buildPlannedCells(
    [matrix("M", [{ dimensions: { model: "anthropic/claude haiku" } }])],
    INPUTS,
  );
  assert.equal(cells[0].cell_id, "M/local/model=anthropic%2Fclaude%20haiku");
  assert.equal(cells[0].dimensions.model, "anthropic/claude haiku");
});

test("the final planned list is sorted by cell_id across scenarios and lanes", async () => {
  const cells = await buildPlannedCells(
    [leaf("Z-LEAF"), matrix("A-MATRIX", [{ dimensions: { child: "b" } }, { dimensions: { child: "a" } }])],
    INPUTS,
  );
  const ids = cells.map((cell) => cell.cell_id);
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(ids, ["A-MATRIX/local/child=a", "A-MATRIX/local/child=b", "Z-LEAF/local"]);
});

test("cell required_env is the union of scenario and cell requirements", async () => {
  const cells = await buildPlannedCells(
    [matrix("M", [{ dimensions: { child: "a" }, requiredEnv: ["CELL_VAR", "SCENARIO_VAR"] }])],
    INPUTS,
  );
  assert.deepEqual(cells[0].required_env, ["SCENARIO_VAR", "CELL_VAR"]);
});

test("empty matrix expansion rejects before setup", async () => {
  await assert.rejects(buildPlannedCells([matrix("M", [])], INPUTS), SelectionError);
});

test("zero total cells reject", async () => {
  await assert.rejects(buildPlannedCells([], INPUTS), SelectionError);
});

test("duplicate expanded cell ids reject", async () => {
  await assert.rejects(
    buildPlannedCells(
      [matrix("M", [{ dimensions: { child: "a" } }, { dimensions: { child: "a" } }])],
      INPUTS,
    ),
    SelectionError,
  );
});

test("duplicate scenario ids reject even with disjoint lanes", async () => {
  await assert.rejects(
    buildPlannedCells([leaf("A", ["local"]), leaf("A", ["sandbox"])], INPUTS),
    SelectionError,
  );
});

test("invalid dimension keys, empty values, and dimensionless matrix cells reject", async () => {
  await assert.rejects(
    buildPlannedCells([matrix("M", [{ dimensions: { "Bad Key": "x" } }])], INPUTS),
    SelectionError,
  );
  await assert.rejects(
    buildPlannedCells([matrix("M", [{ dimensions: { harness: "" } }])], INPUTS),
    SelectionError,
  );
  await assert.rejects(
    buildPlannedCells([matrix("M", [{ dimensions: { harness: "x".repeat(200) } }])], INPUTS),
    SelectionError,
  );
  await assert.rejects(buildPlannedCells([matrix("M", [{ dimensions: {} }])], INPUTS), SelectionError);
});

test("a throwing expandCells propagates as a planning failure", async () => {
  const broken: MatrixScenarioDefinition = {
    ...matrix("M", []),
    expandCells: () => {
      throw new Error("expansion bug");
    },
  };
  await assert.rejects(buildPlannedCells([broken], INPUTS), /expansion bug/);
});
