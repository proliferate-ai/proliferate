/**
 * Regression tests for the cross-shard aggregate — each case below is a
 * reproduced false-green from the pre-hardening foundation:
 *  - an empty shard could claim full qualification;
 *  - shards evaluated independently with no cross-shard identity checks;
 *  - a missing shard silently shrank the required set;
 *  - a release plan with no manifest binding or zero required cells could
 *    qualify "full".
 */

import { strict as assert } from "node:assert";
import test from "node:test";

import { evaluateAggregate } from "./aggregate.js";
import type { RunEvidence } from "./evidence.js";
import type { SelectedCellPlan } from "./plan.js";
import type { CellIdentity, RunIdentity, ShardIdentity } from "./identity.js";
import { cellKey } from "./identity.js";
import type { FinalCellResult } from "./results.js";

const HASH = "a".repeat(64);

function run(overrides: Partial<RunIdentity> = {}): RunIdentity {
  return {
    runId: "run-1",
    sourceSha: "deadbeef",
    candidateManifestHash: HASH,
    retainedManifestHash: null,
    executionHost: "local",
    origin: "local:test",
    createdAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

function shard(index: number, count: number): ShardIdentity {
  return { runId: "run-1", shardId: `shard-${index}-of-${count}`, shardIndex: index, shardCount: count };
}

function cell(id: string): CellIdentity {
  return { scenarioId: id, world: "tier-2", productHost: null, dimensions: {} };
}

function green(c: CellIdentity): FinalCellResult {
  const key = cellKey(c);
  return {
    cellKey: key,
    cell: c,
    status: "green",
    attempts: [
      {
        attemptId: "a1",
        attemptNumber: 1,
        cellKey: key,
        cell: c,
        status: "green",
        detail: "ok",
        correlationIds: [],
        startedAt: "2026-07-13T00:00:00.000Z",
        finishedAt: "2026-07-13T00:00:01.000Z",
        superseded: false,
      },
    ],
  };
}

function plan(cells: CellIdentity[], overrides: Partial<SelectedCellPlan> = {}): SelectedCellPlan {
  return {
    selector: "release",
    behavior: "strict",
    worlds: ["tier-2"],
    cells: cells.map((c) => ({ cell: c, cellKey: cellKey(c), disposition: "required" as const, legacy: false })),
    deferredScenarioIds: [],
    scenarioManifestHash: HASH,
    ...overrides,
  };
}

function shardEvidence(
  p: SelectedCellPlan,
  s: ShardIdentity,
  finals: FinalCellResult[],
  overrides: Partial<RunEvidence> = {},
): RunEvidence {
  return {
    schemaVersion: 1,
    run: run(),
    shard: s,
    behavior: p.behavior,
    qualifying: false,
    dryRun: false,
    plan: p,
    preflight: { results: [], blockedCellKeys: [], complete: true },
    worlds: [],
    finals,
    cleanup: { attempted: 0, cleaned: 0, alreadyAbsent: 0, failed: [], complete: true },
    evaluation: {
      behavior: p.behavior,
      verdict: { qualifying: false, reasons: ["shard input"] },
      missingCellKeys: [],
      duplicateCellKeys: [],
      nonGreenCellKeys: [],
      newlyBlockedCellKeys: [],
    },
    emittedAt: "2026-07-13T00:00:02.000Z",
    ...overrides,
  };
}

test("REGRESSION: an empty shard set can never qualify", () => {
  const p = plan([cell("T2-AUTH-1")]);
  const agg = evaluateAggregate({ plan: p, shards: [] });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("zero shard evidence")));
});

test("REGRESSION: an empty plan (zero required cells) can never qualify, even all-green", () => {
  const p = plan([]);
  const agg = evaluateAggregate({ plan: p, shards: [shardEvidence(p, shard(1, 1), [])] });
  assert.equal(agg.verdict.qualifying, false);
  if (agg.verdict.qualifying === false) {
    assert.ok(agg.verdict.reasons.some((r) => r.includes("empty selection cannot qualify")));
  }
});

test("REGRESSION: a missing shard voids the aggregate even when present shards are green", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a]);
  // shard 1 of 2 green; shard 2 of 2 absent
  const agg = evaluateAggregate({ plan: p, shards: [shardEvidence(p, shard(1, 2), [green(a)])] });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("shardCount 2")));
});

test("REGRESSION: duplicate shard documents void the aggregate", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a]);
  const doc = shardEvidence(p, shard(1, 1), [green(a)]);
  const agg = evaluateAggregate({ plan: p, shards: [doc, doc] });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("appears 2 times")));
});

test("REGRESSION: divergent run/manifest identity across shards voids the aggregate", () => {
  const a = cell("T2-AUTH-1");
  const b = cell("T2-INV-1");
  const p = plan([a, b]);
  const s1 = shardEvidence(p, shard(1, 2), [green(a)]);
  const s2 = shardEvidence(p, shard(2, 2), [green(b)], {
    run: run({ candidateManifestHash: "b".repeat(64) }),
  });
  const agg = evaluateAggregate({ plan: p, shards: [s1, s2] });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("candidateManifestHash diverges")));
});

test("REGRESSION: incomplete cleanup on any shard voids the aggregate", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a]);
  const doc = shardEvidence(p, shard(1, 1), [green(a)], {
    cleanup: { attempted: 1, cleaned: 0, alreadyAbsent: 0, failed: [], complete: false },
  });
  const agg = evaluateAggregate({ plan: p, shards: [doc] });
  assert.equal(agg.verdict.qualifying, false);
});

test("REGRESSION: a final with no attempt history voids the aggregate", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a]);
  const bare = { ...green(a), attempts: [] };
  const agg = evaluateAggregate({ plan: p, shards: [shardEvidence(p, shard(1, 1), [bare])] });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("no attempt history")));
});

test("REGRESSION: a dry-run shard document cannot enter an aggregate", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a]);
  const doc = shardEvidence(p, shard(1, 1), [green(a)], { dryRun: true });
  const agg = evaluateAggregate({ plan: p, shards: [doc] });
  assert.equal(agg.verdict.qualifying, false);
});

test("REGRESSION: a release plan without scenario-manifest binding cannot qualify", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a], { scenarioManifestHash: null });
  const agg = evaluateAggregate({ plan: p, shards: [shardEvidence(p, shard(1, 1), [green(a)])] });
  assert.equal(agg.verdict.qualifying, false);
  if (agg.verdict.qualifying === false) {
    assert.ok(agg.verdict.reasons.some((r) => r.includes("scenario manifest hash")));
  }
});

test("a complete two-shard green aggregate with coherent identity qualifies", () => {
  const a = cell("T2-AUTH-1");
  const b = cell("T2-INV-1");
  const p = plan([a, b]);
  const agg = evaluateAggregate({
    plan: p,
    shards: [shardEvidence(p, shard(1, 2), [green(a)]), shardEvidence(p, shard(2, 2), [green(b)])],
  });
  assert.equal(agg.verdict.qualifying, true);
  assert.equal(agg.verdict.qualifying && agg.verdict.label, "full");
  assert.equal(agg.finals.length, 2);
});

test("duplicate finals for one cell across shards void the aggregate", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a]);
  const agg = evaluateAggregate({
    plan: p,
    shards: [
      shardEvidence(p, shard(1, 2), [green(a)]),
      shardEvidence(p, shard(2, 2), [green(a)]),
    ],
  });
  assert.equal(agg.verdict.qualifying, false);
  if (agg.verdict.qualifying === false) {
    assert.ok(agg.verdict.reasons.some((r) => r.includes("duplicate final results")));
  }
});
