/**
 * Regression tests for the cross-shard aggregate — each case is a reproduced
 * false-green or forgery vector from the pre-hardening foundation:
 *  - an empty shard could claim full qualification;
 *  - shards evaluated independently with no cross-shard identity checks;
 *  - trust was anchored to the first shard document instead of caller-trusted
 *    expected identities;
 *  - non-canonical shard identity / out-of-assignment finals were accepted;
 *  - attempt history, final/cell-key agreement, supersession, cleanup
 *    counters, and world readiness were never validated;
 *  - a release plan with no manifest binding or zero required cells could
 *    qualify "full".
 */

import { strict as assert } from "node:assert";
import test from "node:test";

import { evaluateAggregate, type ExpectedRunIdentity } from "./aggregate.js";
import type { RunEvidence, WorldEvidence } from "./evidence.js";
import type { SelectedCellPlan } from "./plan.js";
import { shardOwnedCellKeys } from "./plan.js";
import type { CellIdentity, RunIdentity, ShardIdentity } from "./identity.js";
import { cellKey } from "./identity.js";
import type { CellAttempt, FinalCellResult } from "./results.js";
import { buildProofRequirement, proofEventDigest } from "./proof.js";

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

function expected(overrides: Partial<ExpectedRunIdentity> = {}): ExpectedRunIdentity {
  return {
    runId: "run-1",
    sourceSha: "deadbeef",
    candidateManifestHash: HASH,
    retainedManifestHash: null,
    shardCount: 1,
    ...overrides,
  };
}

function shard(index: number, count: number): ShardIdentity {
  return { runId: "run-1", shardId: `shard-${index}-of-${count}`, shardIndex: index, shardCount: count };
}

function cell(id: string): CellIdentity {
  return { scenarioId: id, world: "tier-2", productHost: null, dimensions: {} };
}

function attempt(c: CellIdentity, n: number, status: CellAttempt["status"], superseded: boolean): CellAttempt {
  return {
    attemptId: `a${n}-${c.scenarioId}`,
    attemptNumber: n,
    cellKey: cellKey(c),
    cell: c,
    status,
    detail: status,
    correlationIds: [],
    startedAt: `2026-07-13T00:0${n}:00.000Z`,
    finishedAt: `2026-07-13T00:0${n}:30.000Z`,
    superseded,
  proof: null,
  };
}

function green(c: CellIdentity): FinalCellResult {
  const a = attempt(c, 1, "green", false);
  return {
    cellKey: cellKey(c),
    cell: c,
    status: "green",
    attempts: [{ ...a, proof: fixtureReceipt(c, a.attemptId) }],
  };
}

function okWorld(world: string): WorldEvidence {
  return {
    world,
    readiness: [
      { check: "server-health", ok: true, detail: "200", observedAt: "2026-07-13T00:00:00.000Z" },
    ],
    observedArtifacts: { "server-image": "sha256:abc" },
  };
}

const FIXTURE_TEST_ID = "fixture://aggregate-test";
const FIXTURE_ASSERTION = "fixture-assertion";

function fixtureRequirement(c: CellIdentity) {
  return buildProofRequirement(c, FIXTURE_TEST_ID, [FIXTURE_ASSERTION]);
}

/** Receipt matching fixtureRequirement, bound to the green attempt id. */
function fixtureReceipt(c: CellIdentity, attemptId: string) {
  const requirement = fixtureRequirement(c);
  return {
    contractHash: requirement.contractHash,
    collectedTestId: requirement.collectedTestId,
    cellKey: cellKey(c),
    attemptId,
    passed: [
      {
        assertionId: FIXTURE_ASSERTION,
        eventId: "evt-1",
        sequence: 1,
        eventDigest: proofEventDigest({ event: "proof-assertion-pass", assertionId: FIXTURE_ASSERTION }),
      },
    ],
  };
}

function plan(cells: CellIdentity[], overrides: Partial<SelectedCellPlan> = {}): SelectedCellPlan {
  return {
    selector: "release",
    behavior: "strict",
    worlds: ["tier-2"],
    cells: cells.map((c) => ({
      cell: c,
      cellKey: cellKey(c),
      disposition: "required" as const,
      legacy: false,
      proofRequirement: fixtureRequirement(c),
    })),
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
  const worlds = [...new Set(finals.map((f) => f.cell.world))].map(okWorld);
  return {
    schemaVersion: 1,
    run: run(),
    shard: s,
    behavior: p.behavior,
    qualifying: false,
    dryRun: false,
    plan: p,
    preflight: { results: [], blockedCellKeys: [], complete: true },
    worlds,
    finals,
    cleanup: {
      attempted: finals.length,
      cleaned: finals.length,
      alreadyAbsent: 0,
      failed: [],
      complete: true,
    },
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

/**
 * Builds green shard docs whose finals follow the REAL deterministic shard
 * assignment, so ownership validation passes for honest inputs.
 */
function honestShards(p: SelectedCellPlan, count: number): RunEvidence[] {
  const docs: RunEvidence[] = [];
  for (let i = 1; i <= count; i += 1) {
    const s = shard(i, count);
    const owned = shardOwnedCellKeys(p, s);
    const finals = p.cells.filter((c) => owned.has(c.cellKey)).map((c) => green(c.cell));
    docs.push(shardEvidence(p, s, finals));
  }
  return docs;
}

test("REGRESSION: an empty shard set can never qualify", () => {
  const p = plan([cell("T2-AUTH-1")]);
  const agg = evaluateAggregate({ plan: p, expected: expected(), shards: [] });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("zero shard evidence")));
});

test("REGRESSION: an empty plan (zero required cells) can never qualify, even all-green", () => {
  const p = plan([]);
  const agg = evaluateAggregate({ plan: p, expected: expected(), shards: honestShards(p, 1) });
  assert.equal(agg.verdict.qualifying, false);
  if (agg.verdict.qualifying === false) {
    assert.ok(agg.verdict.reasons.some((r) => r.includes("empty selection cannot qualify")));
  }
});

test("REGRESSION: trust anchors to expected identities, not the first shard — a coherent-but-wrong shard set is rejected", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a]);
  // Both shards agree with EACH OTHER on a forged runId/SHA, which the old
  // first-shard-anchored aggregate would have accepted.
  const forgedRun = run({ runId: "forged-run", sourceSha: "forgedsha" });
  const docs = honestShards(p, 1).map((d) => ({
    ...d,
    run: forgedRun,
    shard: { ...d.shard, runId: "forged-run" },
  }));
  const agg = evaluateAggregate({ plan: p, expected: expected(), shards: docs });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("!= expected run-1")));
  assert.ok(agg.aggregateDefects.some((d) => d.includes("sourceSha")));
});

test("REGRESSION: a missing shard voids the aggregate even when present shards are green", () => {
  const cells = [cell("T2-AUTH-1"), cell("T2-INV-1"), cell("T2-ORG-1")];
  const p = plan(cells);
  const docs = honestShards(p, 2);
  const agg = evaluateAggregate({ plan: p, expected: expected({ shardCount: 2 }), shards: [docs[0]] });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("missing from the aggregate")));
});

test("REGRESSION: duplicate shard documents void the aggregate", () => {
  const p = plan([cell("T2-AUTH-1")]);
  const [doc] = honestShards(p, 1);
  const agg = evaluateAggregate({ plan: p, expected: expected(), shards: [doc, doc] });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("appears 2 times")));
});

test("REGRESSION: non-canonical shard identity (zero-based index / wrong shardId) is rejected", () => {
  const p = plan([cell("T2-AUTH-1")]);
  const [doc] = honestShards(p, 1);
  const zeroBased = { ...doc, shard: { ...doc.shard, shardIndex: 0, shardId: "shard-0-of-1" } };
  const agg = evaluateAggregate({ plan: p, expected: expected(), shards: [zeroBased] });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("non-canonical shardIndex")));

  const wrongId = { ...doc, shard: { ...doc.shard, shardId: "my-shard" } };
  const agg2 = evaluateAggregate({ plan: p, expected: expected(), shards: [wrongId] });
  assert.ok(agg2.aggregateDefects.some((d) => d.includes('not the canonical')));
});

test("REGRESSION: a shard reporting a final it does not own under the deterministic assignment is rejected", () => {
  const cells = [cell("T2-AUTH-1"), cell("T2-INV-1"), cell("T2-ORG-1"), cell("T2-SEC-1")];
  const p = plan(cells);
  const docs = honestShards(p, 2);
  // Move one of shard 2's finals into shard 1's document.
  const stolen = docs[1].finals[0];
  assert.ok(stolen, "test setup: shard 2 must own at least one cell");
  const tampered = [
    { ...docs[0], finals: [...docs[0].finals, stolen] },
    { ...docs[1], finals: docs[1].finals.slice(1) },
  ];
  const agg = evaluateAggregate({ plan: p, expected: expected({ shardCount: 2 }), shards: tampered });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("it does not own")));
});

test("REGRESSION: final.cellKey must be the deterministic hash of final.cell", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a]);
  const [doc] = honestShards(p, 1);
  const forged = {
    ...doc,
    finals: [{ ...doc.finals[0], cell: cell("T2-TOTALLY-DIFFERENT") }],
  };
  const agg = evaluateAggregate({ plan: p, expected: expected(), shards: [forged] });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("hashes to a different cell key")));
});

test("REGRESSION: attempt identity/order/uniqueness/terminal-status are validated", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a]);
  const base = honestShards(p, 1)[0];

  // no attempts
  let agg = evaluateAggregate({
    plan: p, expected: expected(),
    shards: [{ ...base, finals: [{ ...base.finals[0], attempts: [] }] }],
  });
  assert.ok(agg.aggregateDefects.some((d) => d.includes("no attempt history")));

  // duplicate attempt ids + broken order
  const a1 = attempt(a, 1, "green", true);
  const dup = { ...attempt(a, 1, "green", false), attemptId: a1.attemptId, attemptNumber: 3 };
  agg = evaluateAggregate({
    plan: p, expected: expected(),
    shards: [{ ...base, finals: [{ ...base.finals[0], attempts: [a1, dup] }] }],
  });
  assert.ok(agg.aggregateDefects.some((d) => d.includes("duplicate attemptId")));
  assert.ok(agg.aggregateDefects.some((d) => d.includes("attempt order broken")));

  // final status disagrees with the active attempt
  agg = evaluateAggregate({
    plan: p, expected: expected(),
    shards: [{
      ...base,
      finals: [{ ...base.finals[0], status: "green" as const, attempts: [attempt(a, 1, "failed", false)] }],
    }],
  });
  assert.ok(agg.aggregateDefects.some((d) => d.includes("disagrees with its active attempt")));

  // two non-superseded attempts
  agg = evaluateAggregate({
    plan: p, expected: expected(),
    shards: [{
      ...base,
      finals: [{ ...base.finals[0], attempts: [attempt(a, 1, "green", false), attempt(a, 2, "green", false)] }],
    }],
  });
  assert.ok(agg.aggregateDefects.some((d) => d.includes("exactly one non-superseded attempt")));
});

test("REGRESSION: a green final may not supersede a product assertion failure", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a]);
  const base = honestShards(p, 1)[0];
  const buried: FinalCellResult = {
    ...base.finals[0],
    status: "green",
    attempts: [attempt(a, 1, "failed", true), attempt(a, 2, "green", false)],
  };
  const agg = evaluateAggregate({ plan: p, expected: expected(), shards: [{ ...base, finals: [buried] }] });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("supersedes a product assertion failure")));

  // Infrastructure retry (blocked -> green) is allowed.
  const retryGreen = attempt(a, 2, "green", false);
  const retried: FinalCellResult = {
    ...base.finals[0],
    status: "green",
    attempts: [
      attempt(a, 1, "blocked", true),
      { ...retryGreen, proof: fixtureReceipt(a, retryGreen.attemptId) },
    ],
  };
  const ok = evaluateAggregate({ plan: p, expected: expected(), shards: [{ ...base, finals: [retried] }] });
  assert.equal(ok.verdict.qualifying, true);
});

test("REGRESSION: cleanup counters are recomputed; complete=true alone is not trusted", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a]);
  const base = honestShards(p, 1)[0];
  const lying = {
    ...base,
    cleanup: { attempted: 3, cleaned: 1, alreadyAbsent: 0, failed: [], complete: true },
  };
  const agg = evaluateAggregate({ plan: p, expected: expected(), shards: [lying] });
  assert.equal(agg.verdict.qualifying, false);
  assert.ok(agg.aggregateDefects.some((d) => d.includes("counters do not reconcile")));
});

test("REGRESSION: executed finals require world evidence with all-ok, non-empty readiness", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a]);
  const base = honestShards(p, 1)[0];

  const noWorld = { ...base, worlds: [] };
  let agg = evaluateAggregate({ plan: p, expected: expected(), shards: [noWorld] });
  assert.ok(agg.aggregateDefects.some((d) => d.includes("no world evidence")));

  const failedReadiness = {
    ...base,
    worlds: [{
      world: "tier-2",
      readiness: [{ check: "server-health", ok: false, detail: "503", observedAt: "t" }],
      observedArtifacts: {},
    }],
  };
  agg = evaluateAggregate({ plan: p, expected: expected(), shards: [failedReadiness] });
  assert.ok(agg.aggregateDefects.some((d) => d.includes("failed readiness observations")));
});

test("REGRESSION: a dry-run shard document cannot enter an aggregate", () => {
  const p = plan([cell("T2-AUTH-1")]);
  const [doc] = honestShards(p, 1);
  const agg = evaluateAggregate({ plan: p, expected: expected(), shards: [{ ...doc, dryRun: true }] });
  assert.equal(agg.verdict.qualifying, false);
});

test("REGRESSION: a release plan without scenario-manifest binding cannot qualify", () => {
  const a = cell("T2-AUTH-1");
  const p = plan([a], { scenarioManifestHash: null });
  const agg = evaluateAggregate({ plan: p, expected: expected(), shards: honestShards(p, 1) });
  assert.equal(agg.verdict.qualifying, false);
  if (agg.verdict.qualifying === false) {
    assert.ok(agg.verdict.reasons.some((r) => r.includes("scenario manifest hash")));
  }
});

test("a complete honest multi-shard green aggregate with coherent identity qualifies", () => {
  const cells = [cell("T2-AUTH-1"), cell("T2-INV-1"), cell("T2-ORG-1"), cell("T2-SEC-1")];
  const p = plan(cells);
  const agg = evaluateAggregate({
    plan: p,
    expected: expected({ shardCount: 2 }),
    shards: honestShards(p, 2),
  });
  assert.equal(agg.verdict.qualifying, true);
  assert.equal(agg.verdict.qualifying && agg.verdict.label, "full");
  assert.equal(agg.finals.length, cells.length);
});

test("duplicate finals for one cell across shards void the aggregate", () => {
  const cells = [cell("T2-AUTH-1"), cell("T2-INV-1")];
  const p = plan(cells);
  const docs = honestShards(p, 2);
  // Shard 1 duplicates one of its OWN finals (ownership stays valid) — the
  // duplicate-final detection must still fire.
  assert.ok(docs[0].finals.length > 0);
  const dup = [{ ...docs[0], finals: [...docs[0].finals, docs[0].finals[0]] }, docs[1]];
  const agg = evaluateAggregate({ plan: p, expected: expected({ shardCount: 2 }), shards: dup });
  assert.equal(agg.verdict.qualifying, false);
  if (agg.verdict.qualifying === false) {
    assert.ok(agg.verdict.reasons.some((r) => r.includes("duplicate final results")));
  }
});
