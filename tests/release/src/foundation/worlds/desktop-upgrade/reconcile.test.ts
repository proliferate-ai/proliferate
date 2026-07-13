import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluateReconcile,
  assertIdempotentReconcile,
  evaluateTranscriptContinuity,
  withDeadline,
  DeadlineExceededError,
  type PerAgentReconcileOutcome,
} from "./reconcile.js";

function outcome(overrides: Partial<PerAgentReconcileOutcome> = {}): PerAgentReconcileOutcome {
  return {
    agent: "claude",
    kind: "native-cli",
    terminalState: "completed",
    pinBefore: "1.0.0",
    pinAfter: "1.0.0",
    expectedPin: "1.0.0",
    verifiedSource: true,
    ...overrides,
  };
}

test("evaluateReconcile: exact-set match with an evidenced no-op passes", () => {
  const v = evaluateReconcile([outcome()], ["claude"]);
  assert.equal(v.ok, true);
  assert.deepEqual(v.noopAgents, ["claude"]);
  assert.deepEqual(v.updatedAgents, []);
});

test("evaluateReconcile: a naturally changed pin is a real update", () => {
  const v = evaluateReconcile(
    [outcome({ pinBefore: "1.0.0", pinAfter: "2.0.0", expectedPin: "2.0.0" })],
    ["claude"],
  );
  assert.equal(v.ok, true);
  assert.deepEqual(v.updatedAgents, ["claude"]);
});

test("evaluateReconcile: missing / unexpected / duplicate agents all fail", () => {
  assert.equal(evaluateReconcile([], ["claude"]).ok, false);
  assert.equal(evaluateReconcile([outcome({ agent: "codex" })], ["claude"]).ok, false);
  assert.equal(evaluateReconcile([outcome(), outcome()], ["claude"]).ok, false);
});

test("evaluateReconcile: non-terminal, pin mismatch, and unverified source all fail", () => {
  assert.equal(evaluateReconcile([outcome({ terminalState: "running" })], ["claude"]).ok, false);
  assert.equal(evaluateReconcile([outcome({ terminalState: "failed" })], ["claude"]).ok, false);
  assert.equal(
    evaluateReconcile([outcome({ pinAfter: "9.9.9", expectedPin: "1.0.0" })], ["claude"]).ok,
    false,
  );
  assert.equal(evaluateReconcile([outcome({ verifiedSource: false })], ["claude"]).ok, false);
});

test("evaluateReconcile: an unchanged pin that was mutated fails (no silent byte churn)", () => {
  const v = evaluateReconcile(
    [outcome({ pinBefore: "1.0.0", pinAfter: "1.0.1", expectedPin: "1.0.0" })],
    ["claude"],
  );
  assert.equal(v.ok, false);
});

test("assertIdempotentReconcile: a second reconcile must be a pure no-op", () => {
  assert.equal(assertIdempotentReconcile([outcome()]).ok, true);
  assert.equal(
    assertIdempotentReconcile([outcome({ pinBefore: "1.0.0", pinAfter: "1.0.1" })]).ok,
    false,
  );
  assert.equal(assertIdempotentReconcile([outcome({ terminalState: "pending" })]).ok, false);
});

test("evaluateTranscriptContinuity: duplicate ids and non-monotonic sequence fail", () => {
  assert.equal(
    evaluateTranscriptContinuity([
      { id: "a", sequence: 1 },
      { id: "b", sequence: 2 },
    ]).ok,
    true,
  );
  assert.equal(
    evaluateTranscriptContinuity([
      { id: "a", sequence: 1 },
      { id: "a", sequence: 2 },
    ]).ok,
    false,
  );
  assert.equal(
    evaluateTranscriptContinuity([
      { id: "a", sequence: 2 },
      { id: "b", sequence: 1 },
    ]).ok,
    false,
  );
});

test("withDeadline resolves under budget and rejects when exceeded", async () => {
  const { value, elapsedMs } = await withDeadline("t", 1000, async () => 42);
  assert.equal(value, 42);
  assert.ok(elapsedMs >= 0);
  await assert.rejects(
    () => withDeadline("t", 10, () => new Promise((r) => setTimeout(r, 200))),
    DeadlineExceededError,
  );
});
