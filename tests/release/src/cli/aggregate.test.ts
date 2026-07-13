import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runAggregateCli } from "./aggregate.js";
import { cellKey, type CellIdentity } from "../foundation/contracts/identity.js";
import { buildProofRequirement, proofEventDigest } from "../foundation/contracts/proof.js";
import type { RunEvidence } from "../foundation/contracts/evidence.js";
import type { PlannedCell, SelectedCellPlan } from "../foundation/contracts/plan.js";
import type { CellStatus, FinalCellResult } from "../foundation/contracts/results.js";

const CELL_A: CellIdentity = { scenarioId: "T2-AUTH-1", world: "tier-2", productHost: null, dimensions: {} };
const CELL_B: CellIdentity = { scenarioId: "T2-INV-1", world: "tier-2", productHost: null, dimensions: {} };
const KEY_A = cellKey(CELL_A);
const KEY_B = cellKey(CELL_B);
const MANIFEST_HASH = "a".repeat(64);

const FIXTURE_TEST_ID = "fixture://aggregate-cli-test";
const FIXTURE_ASSERTION = "fixture-assertion";

function fixtureRequirement(cell: CellIdentity) {
  return buildProofRequirement(cell, FIXTURE_TEST_ID, [FIXTURE_ASSERTION]);
}

function planned(cell: CellIdentity): PlannedCell {
  return {
    cell,
    cellKey: cellKey(cell),
    disposition: "required",
    legacy: false,
    proofRequirement: fixtureRequirement(cell),
  };
}

function final(cell: CellIdentity, status: CellStatus): FinalCellResult {
  const key = cellKey(cell);
  const requirement = fixtureRequirement(cell);
  const attemptId = `att-${key}`;
  const proof =
    status === "green"
      ? {
          contractHash: requirement.contractHash,
          collectedTestId: requirement.collectedTestId,
          cellKey: key,
          attemptId,
          passed: [
            {
              assertionId: FIXTURE_ASSERTION,
              eventId: "evt-1",
              sequence: 1,
              eventDigest: proofEventDigest({ event: "proof-assertion-pass", assertionId: FIXTURE_ASSERTION }),
            },
          ],
        }
      : null;
  return {
    cellKey: key,
    cell,
    status,
    attempts: [
      {
        attemptId,
        attemptNumber: 1,
        cellKey: key,
        cell,
        status,
        detail: "",
        correlationIds: [],
        startedAt: "2026-07-13T00:00:00.000Z",
        finishedAt: "2026-07-13T00:00:01.000Z",
        superseded: false,
        proof,
      },
    ],
  };
}

function shardPlan(cells: PlannedCell[]): SelectedCellPlan {
  return {
    selector: "explicit",
    behavior: "strict",
    worlds: [...new Set(cells.map((c) => c.cell.world))],
    cells,
    deferredScenarioIds: [],
    scenarioManifestHash: MANIFEST_HASH,
  };
}

function shardEvidence(opts: {
  shardIndex: number;
  shardCount: number;
  cells: PlannedCell[];
  finals: FinalCellResult[];
}): RunEvidence {
  return {
    schemaVersion: 1,
    run: {
      runId: "run-1",
      sourceSha: "deadbeef",
      candidateManifestHash: "cand-hash",
      retainedManifestHash: null,
      executionHost: "github-actions",
      origin: "gh:test",
      createdAt: "2026-07-13T00:00:00.000Z",
    },
    shard: {
      runId: "run-1",
      shardId: `shard-${opts.shardIndex}-of-${opts.shardCount}`,
      shardIndex: opts.shardIndex,
      shardCount: opts.shardCount,
    },
    behavior: "strict",
    qualifying: false,
    dryRun: false,
    plan: shardPlan(opts.cells),
    preflight: { results: [], blockedCellKeys: [], complete: true },
    worlds: [...new Set(opts.finals.map((f) => f.cell.world))].map((world) => ({
      world,
      readiness: [{ check: "server-health", ok: true, detail: "200", observedAt: "2026-07-13T00:00:00.000Z" }],
      observedArtifacts: { "server-image": "sha256:test" },
    })),
    finals: opts.finals,
    cleanup: { attempted: 0, cleaned: 0, alreadyAbsent: 0, failed: [], complete: true },
    evaluation: {
      behavior: "strict",
      verdict: { qualifying: false, reasons: ["shard input"] },
      missingCellKeys: [],
      duplicateCellKeys: [],
      nonGreenCellKeys: [],
      newlyBlockedCellKeys: [],
    },
    emittedAt: "2026-07-13T00:00:02.000Z",
  };
}

function writeShards(shards: RunEvidence[]): { dir: string; paths: string[] } {
  const dir = mkdtempSync(path.join(tmpdir(), "aggregate-cli-"));
  const paths = shards.map((s, i) => {
    const p = path.join(dir, `evidence-${i}.json`);
    writeFileSync(p, JSON.stringify(s));
    return p;
  });
  return { dir, paths };
}

test("aggregate qualifies a complete, green, multi-shard strict run and exits 0", () => {
  const shards = [
    shardEvidence({ shardIndex: 1, shardCount: 2, cells: [planned(CELL_A)], finals: [final(CELL_A, "green")] }),
    shardEvidence({ shardIndex: 2, shardCount: 2, cells: [planned(CELL_B)], finals: [final(CELL_B, "green")] }),
  ];
  const { dir, paths } = writeShards(shards);
  try {
    const result = runAggregateCli(paths);
    assert.equal(result.exitCode, 0, result.message);
    assert.match(result.message, /QUALIFYING \(partial\)/);
    assert.match(result.message, /required=2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregate fails a run with a missing shard (coverage defect) and exits 1", () => {
  // Only shard 0 of 2 is provided — the aggregate must not qualify.
  const shards = [
    shardEvidence({ shardIndex: 1, shardCount: 2, cells: [planned(CELL_A)], finals: [final(CELL_A, "green")] }),
  ];
  const { dir, paths } = writeShards(shards);
  try {
    const result = runAggregateCli(paths);
    assert.equal(result.exitCode, 1, result.message);
    assert.match(result.message, /NON-QUALIFYING/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregate fails when a required cell is non-green and exits 1", () => {
  const shards = [
    shardEvidence({ shardIndex: 1, shardCount: 2, cells: [planned(CELL_A)], finals: [final(CELL_A, "green")] }),
    shardEvidence({ shardIndex: 2, shardCount: 2, cells: [planned(CELL_B)], finals: [final(CELL_B, "failed")] }),
  ];
  const { dir, paths } = writeShards(shards);
  try {
    const result = runAggregateCli(paths);
    assert.equal(result.exitCode, 1);
    assert.match(result.message, new RegExp(`non-green required cells: ${KEY_B.replace(/[/]/g, "\\/")}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregate reconstructs the union of shard cells for a single-shard run", () => {
  const shards = [
    shardEvidence({
      shardIndex: 1,
      shardCount: 1,
      cells: [planned(CELL_A), planned(CELL_B)],
      finals: [final(CELL_A, "green"), final(CELL_B, "green")],
    }),
  ];
  const { dir, paths } = writeShards(shards);
  try {
    const result = runAggregateCli(paths);
    assert.equal(result.exitCode, 0, result.message);
    assert.match(result.message, /required=2/);
    assert.match(result.message, /shards=1/);
    assert.ok(KEY_A && KEY_B);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregate errors (exit 2) with no files or a non-evidence file", () => {
  assert.equal(runAggregateCli([]).exitCode, 2);
  const dir = mkdtempSync(path.join(tmpdir(), "aggregate-cli-"));
  try {
    const p = path.join(dir, "junk.json");
    writeFileSync(p, JSON.stringify({ not: "evidence" }));
    const result = runAggregateCli([p]);
    assert.equal(result.exitCode, 2);
    assert.match(result.message, /not a v1 run evidence document/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
