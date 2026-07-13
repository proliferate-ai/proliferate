import assert from "node:assert/strict";
import { test } from "node:test";

import { cellKey, type CellIdentity } from "../../contracts/identity.js";
import type { RunEvidence } from "../../contracts/evidence.js";
import { runCell } from "./cell-runner.js";

const CELL: CellIdentity = { scenarioId: "T2-TEST-1", world: "tier-2", productHost: "desktop-web", dimensions: {} };

function memoryEvidenceSink() {
  const events: Record<string, unknown>[] = [];
  return {
    events,
    async append(event: Readonly<Record<string, unknown>>) {
      events.push(event);
    },
    async finalize(_evidence: RunEvidence) {
      throw new Error("not used in this test");
    },
  };
}

test("runCell: a resolving green outcome produces exactly one attempt and one final result", async () => {
  const sink = memoryEvidenceSink();
  const result = await runCell(CELL, sink, async () => ({ status: "green", detail: "ok" }));
  assert.equal(result.status, "green");
  assert.equal(result.cellKey, cellKey(CELL));
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].attemptNumber, 1);
  assert.equal(result.attempts[0].status, "green");
  assert.equal(result.attempts[0].superseded, false);
  // Evidence-bound: exactly one attempt was appended to the sink.
  assert.equal(sink.events.length, 1);
});

test("runCell: a thrown error is mapped to a failed outcome, never silently swallowed", async () => {
  const sink = memoryEvidenceSink();
  const result = await runCell(CELL, sink, async () => {
    throw new Error("boom");
  });
  assert.equal(result.status, "failed");
  assert.equal(result.attempts.length, 1);
  assert.match(result.attempts[0].detail, /boom/);
});

test("runCell: an explicit blocked outcome is preserved verbatim, not upgraded or downgraded", async () => {
  const sink = memoryEvidenceSink();
  const result = await runCell(CELL, sink, async () => ({ status: "blocked", detail: "credential missing" }));
  assert.equal(result.status, "blocked");
  assert.equal(result.attempts[0].detail, "credential missing");
});

test("runCell: cellKey is deterministic regardless of dimension key order", () => {
  const a: CellIdentity = { scenarioId: "X", world: "tier-2", productHost: null, dimensions: { b: "2", a: "1" } };
  const b: CellIdentity = { scenarioId: "X", world: "tier-2", productHost: null, dimensions: { a: "1", b: "2" } };
  assert.equal(cellKey(a), cellKey(b));
});
