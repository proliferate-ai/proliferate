/**
 * Adversarial tests for the indivisible CollectorDefinition design: metadata
 * and executable are one object, derived views cannot drift, and an
 * incoherent collector result can never green a declared cell.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  defineCollector,
  adaptFinalResult,
  runnersForPlan,
  COLLECTOR_DEFINITIONS,
  type RunnerWiring,
} from "./registry.js";
import { cellKey, type CellIdentity } from "../contracts/identity.js";
import { CellBlockedError } from "../runner/cell.js";
import type { FinalCellResult, CellAttempt } from "../contracts/results.js";

const CELL_A: CellIdentity = { scenarioId: "S-1", world: "tier-2", productHost: "desktop-web", dimensions: { k: "a" } };
const CELL_B: CellIdentity = { scenarioId: "S-1", world: "tier-2", productHost: "desktop-web", dimensions: { k: "b" } };

const WIRING = {} as RunnerWiring; // never dereferenced by these fixtures

function attempt(cell: CellIdentity, status: CellAttempt["status"]): CellAttempt {
  return {
    attemptId: "a1",
    attemptNumber: 1,
    cellKey: cellKey(cell),
    cell,
    status,
    detail: status,
    correlationIds: ["corr-1"],
    startedAt: "2026-07-13T00:00:00.000Z",
    finishedAt: "2026-07-13T00:00:01.000Z",
    superseded: false,
  };
}

function finalFor(cell: CellIdentity, status: FinalCellResult["status"]): FinalCellResult {
  return { cellKey: cellKey(cell), cell, status, attempts: [attempt(cell, status)] };
}

// ── defineCollector: identity/cardinality validated before any provisioning ──

test("ADVERSARIAL: a cell declared for another scenario is rejected at definition time", () => {
  assert.throws(
    () =>
      defineCollector({
        scenarioId: "S-1",
        collectorRef: "x",
        coverage: "foundation-partial",
        gate: "merge",
        evidence: "x",
        cellDefinitions: [
          { cell: { ...CELL_A, scenarioId: "S-OTHER" }, execute: async () => undefined },
        ],
      }),
    /contains a cell for "S-OTHER"/,
  );
});

test("ADVERSARIAL: duplicate declared cells are rejected at definition time", () => {
  assert.throws(
    () =>
      defineCollector({
        scenarioId: "S-1",
        collectorRef: "x",
        coverage: "foundation-partial",
        gate: "merge",
        evidence: "x",
        cellDefinitions: [
          { cell: CELL_A, execute: async () => undefined },
          { cell: CELL_A, execute: async () => undefined },
        ],
      }),
    /duplicate cell/,
  );
});

test("ADVERSARIAL: a metadata-only definition (zero executable cells) is invalid", () => {
  assert.throws(
    () =>
      defineCollector({
        scenarioId: "S-1",
        collectorRef: "x",
        coverage: "foundation-partial",
        gate: "merge",
        evidence: "x",
        cellDefinitions: [],
      }),
    /zero executable cells/,
  );
});

test("ADVERSARIAL: a definition spanning two worlds is rejected", () => {
  assert.throws(
    () =>
      defineCollector({
        scenarioId: "S-1",
        collectorRef: "x",
        coverage: "foundation-partial",
        gate: "merge",
        evidence: "x",
        cellDefinitions: [
          { cell: CELL_A, execute: async () => undefined },
          { cell: { ...CELL_B, world: "local-runtime" }, execute: async () => undefined },
        ],
      }),
    /spans worlds/,
  );
});

test("runner identity/cardinality is DERIVED 1:1 from cell definitions — a missing or extra runner is unrepresentable", () => {
  const def = defineCollector({
    scenarioId: "S-1",
    collectorRef: "x",
    coverage: "foundation-partial",
    gate: "merge",
    evidence: "x",
    cellDefinitions: [
      { cell: CELL_A, execute: async () => undefined },
      { cell: CELL_B, execute: async () => undefined },
    ],
  });
  assert.deepEqual(def.cellKeys, [cellKey(CELL_A), cellKey(CELL_B)]);
  const runners = def.createRunners(WIRING);
  assert.equal(runners.length, def.cells.length);
  assert.deepEqual(
    runners.map((r) => r.cellKey).sort(),
    [...def.cellKeys].sort(),
    "every declared cell has exactly its own runner",
  );
});

test("the separate-runner bypass is impossible: runnersForPlan is the only runner source and filters by selected keys", () => {
  const def = defineCollector({
    scenarioId: "S-1",
    collectorRef: "x",
    coverage: "foundation-partial",
    gate: "merge",
    evidence: "x",
    cellDefinitions: [
      { cell: CELL_A, execute: async () => undefined },
      { cell: CELL_B, execute: async () => undefined },
    ],
  });
  const onlyA = runnersForPlan(new Set([cellKey(CELL_A)]), WIRING, [def]);
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0].cellKey, cellKey(CELL_A));
  const none = runnersForPlan(new Set(["unrelated/KEY/-/-"]), WIRING, [def]);
  assert.equal(none.length, 0);
});

// ── adaptFinalResult: incoherent finals can never green ──

test("ADVERSARIAL: a final for the WRONG cell identity throws (failed), never green", () => {
  assert.throws(() => adaptFinalResult(CELL_A, finalFor(CELL_B, "green")), /incoherent final result/);
});

test("ADVERSARIAL: a final with no attempt history throws, never green", () => {
  const bare = { ...finalFor(CELL_A, "green"), attempts: [] };
  assert.throws(() => adaptFinalResult(CELL_A, bare), /no attempt history/);
});

test("ADVERSARIAL: last-attempt/final status disagreement throws, never green", () => {
  const lying: FinalCellResult = {
    ...finalFor(CELL_A, "green"),
    attempts: [attempt(CELL_A, "failed")],
  };
  assert.throws(() => adaptFinalResult(CELL_A, lying), /last attempt status failed != final status green/);
});

test("a coherent blocked final surfaces as CellBlockedError (diagnostic-blocked, strict non-green)", () => {
  assert.throws(() => adaptFinalResult(CELL_A, finalFor(CELL_A, "blocked")), CellBlockedError);
});

test("a coherent failed final throws a plain error (failed status)", () => {
  assert.throws(() => adaptFinalResult(CELL_A, finalFor(CELL_A, "failed")), /failed/);
});

test("a coherent green final returns its correlation ids", () => {
  const outcome = adaptFinalResult(CELL_A, finalFor(CELL_A, "green"));
  assert.deepEqual(outcome.correlationIds, ["corr-1"]);
});

// ── the shipped registry itself ──

test("every shipped definition is foundation-partial today (T2-AUTH-1 skips fresh-claim on a reused DB)", () => {
  for (const def of COLLECTOR_DEFINITIONS) {
    assert.equal(
      def.coverage,
      "foundation-partial",
      `${def.scenarioId} must remain foundation-partial until qualification-safe`,
    );
  }
});
