import { test } from "node:test";
import { buildProofRequirement } from "../contracts/proof.js";
import assert from "node:assert/strict";

import { buildPlan, shardScopedPlan, isLegacyScenarioId } from "./plan-builder.js";
import { assignShards } from "../contracts/plan.js";
import { createShardIdentity } from "./identity.js";

test("buildPlan marks legacy scenario ids and derives the world set", () => {
  const plan = buildPlan({
    selector: "explicit",
    behavior: "diagnostic",
    cells: [
      { scenarioId: "T2-AUTH-1", world: "tier-2" },
      { scenarioId: "T3-GW-1", world: "local-runtime" },
    ],
  });
  assert.deepEqual([...plan.worlds].sort(), ["local-runtime", "tier-2"]);
  const legacy = plan.cells.find((c) => c.cell.scenarioId === "T3-GW-1");
  assert.equal(legacy?.legacy, true, "T3-GW-1 is a known legacy collector");
  const modern = plan.cells.find((c) => c.cell.scenarioId === "T2-AUTH-1");
  assert.equal(modern?.legacy, false);
  assert.equal(isLegacyScenarioId("T4-CLOUD-1"), true);
});

test("buildPlan rejects duplicate cells", () => {
  assert.throws(
    () =>
      buildPlan({
        selector: "explicit",
        behavior: "strict",
        cells: [
          { scenarioId: "T2-AUTH-1", world: "tier-2" },
          { scenarioId: "T2-AUTH-1", world: "tier-2" },
        ],
      }),
    /duplicate cell/,
  );
});

test("cell->shard assignment is deterministic across processes and covers the full plan", () => {
  const cells = Array.from({ length: 20 }, (_, i) => ({ scenarioId: `T2-X-${i}`, world: "tier-2" as const }));
  const plan = buildPlan({ selector: "explicit", behavior: "strict", cells });

  const a = assignShards(plan.cells, 4);
  const b = assignShards(plan.cells, 4);
  assert.deepEqual(a.assignments, b.assignments, "same plan + count => same assignment");

  // Every cell lands on exactly one shard, and the shards partition the plan.
  const shardIds = new Set<number>();
  for (const cell of plan.cells) {
    const s = a.assignments[cell.cellKey];
    assert.ok(s >= 0 && s < 4);
    shardIds.add(s);
  }
  const total = [1, 2, 3, 4]
    .map((i) => shardScopedPlan(plan, createShardIdentity({ runId: "r", shardIndex: i, shardCount: 4 })).cells.length)
    .reduce((x, y) => x + y, 0);
  assert.equal(total, plan.cells.length, "sharded subsets partition the plan exactly");
});

test("shardScopedPlan selects only this shard's cells and recomputes the world set", () => {
  const plan = buildPlan({
    selector: "explicit",
    behavior: "strict",
    cells: [
      { scenarioId: "A", world: "tier-2" },
      { scenarioId: "B", world: "local-runtime" },
      { scenarioId: "C", world: "managed-cloud" },
    ],
  });
  const assign = assignShards(plan.cells, 3);
  for (let i = 1; i <= 3; i += 1) {
    const shard = createShardIdentity({ runId: "r", shardIndex: i, shardCount: 3 });
    const scoped = shardScopedPlan(plan, shard);
    for (const cell of scoped.cells) {
      assert.equal(assign.assignments[cell.cellKey], i - 1, "cell belongs to this shard (1-based -> 0-based)");
    }
    // worlds set only contains worlds of cells present on this shard
    const worldsFromCells = new Set(scoped.cells.map((c) => c.cell.world));
    assert.deepEqual([...scoped.worlds].sort(), [...worldsFromCells].sort());
  }
});

// ── Proof requirement immutability + validation at plan construction ──

test("REGRESSION: buildPlan validates and FREEZES the requirement; post-plan mutation of the source cannot alter the plan", () => {
  const cell = { scenarioId: "T2-AUTH-1", world: "tier-2" as const, productHost: null, dimensions: {} };
  // A mutable source object (attacker-controlled after plan construction).
  const source = buildProofRequirement(cell, "fixture://test", ["a1", "a2"]);
  const mutableCopy = {
    collectedTestId: source.collectedTestId,
    assertionIds: [...source.assertionIds],
    contractHash: source.contractHash,
  };
  const plan = buildPlan({
    selector: "explicit",
    behavior: "strict",
    cells: [{ scenarioId: "T2-AUTH-1", world: "tier-2", proofRequirement: mutableCopy }],
  });
  // Mutate the source AFTER the plan was built.
  mutableCopy.assertionIds.length = 0;
  mutableCopy.contractHash = "f".repeat(64);
  const planned = plan.cells[0];
  assert.ok(planned.proofRequirement);
  assert.deepEqual([...planned.proofRequirement.assertionIds], ["a1", "a2"], "plan owns an immutable clone");
  assert.equal(planned.proofRequirement.contractHash, source.contractHash);
  // And the plan's copy is itself frozen.
  assert.throws(() => {
    (planned.proofRequirement!.assertionIds as string[]).push("x");
  }, TypeError);
});

test("REGRESSION: buildPlan rejects a forged requirement (hash does not recompute)", () => {
  assert.throws(
    () =>
      buildPlan({
        selector: "explicit",
        behavior: "strict",
        cells: [
          {
            scenarioId: "T2-AUTH-1",
            world: "tier-2",
            proofRequirement: { collectedTestId: "fixture://test", assertionIds: ["a1"], contractHash: "f".repeat(64) },
          },
        ],
      }),
    /invalid proof requirement/,
  );
});

test("REGRESSION: buildPlan rejects an empty-assertion requirement", () => {
  assert.throws(
    () =>
      buildPlan({
        selector: "explicit",
        behavior: "strict",
        cells: [
          {
            scenarioId: "T2-AUTH-1",
            world: "tier-2",
            proofRequirement: { collectedTestId: "fixture://test", assertionIds: [], contractHash: "f".repeat(64) },
          },
        ],
      }),
    /invalid proof requirement/,
  );
});

test("ADVERSARIAL: the trusted plan is deeply frozen — slot replacement and identity edits throw and never alter hashes", () => {
  const cell = { scenarioId: "T2-AUTH-1", world: "tier-2" as const, productHost: "desktop-web" as const, dimensions: { k: "v" } };
  const requirement = buildProofRequirement(cell, "fixture://test", ["a1"]);
  const plan = buildPlan({
    selector: "explicit",
    behavior: "strict",
    cells: [
      {
        scenarioId: "T2-AUTH-1",
        world: "tier-2",
        productHost: "desktop-web",
        dimensions: { k: "v" },
        proofRequirement: requirement,
      },
    ],
  });
  const planned = plan.cells[0];
  const originalHash = planned.proofRequirement!.contractHash;
  // Slot replacement throws.
  assert.throws(() => {
    (planned as { proofRequirement: unknown }).proofRequirement = null;
  }, TypeError);
  // Cell identity/dimensions edits throw.
  assert.throws(() => {
    (planned.cell as { scenarioId: string }).scenarioId = "FORGED";
  }, TypeError);
  assert.throws(() => {
    (planned.cell.dimensions as Record<string, string>).k = "forged";
  }, TypeError);
  // Plan-level arrays are frozen.
  assert.throws(() => {
    (plan.cells as unknown[]).push({});
  }, TypeError);
  assert.throws(() => {
    (plan.deferredScenarioIds as string[]).push("X");
  }, TypeError);
  // Nothing moved.
  assert.equal(planned.proofRequirement!.contractHash, originalHash);
  assert.equal(planned.cell.scenarioId, "T2-AUTH-1");
});
