import assert from "node:assert/strict";
import { test } from "node:test";

import type { LeafScenarioDefinition, MatrixScenarioDefinition, ScenarioCellSpec } from "../scenarios/types.js";
import { buildPlannedCells, SelectionError } from "./plan.js";

function leaf(id: string, lanes: Array<"local" | "sandbox"> = ["local"]): LeafScenarioDefinition {
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
  lanes: Array<"local" | "sandbox"> = ["local"],
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
