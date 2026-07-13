/**
 * Adversarial tests for the machine-enforced proof contract: a collector
 * cannot green by returning, and a forged/incomplete/mismatched receipt is
 * rejected by both requirement validation and (via engine tests) execution.
 */

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  buildProofRequirement,
  validateProofRequirement,
  validateProofReceipt,
  proofEventDigest,
  ProofContractError,
  type CellProofReceipt,
} from "./proof.js";
import { cellKey, type CellIdentity } from "./identity.js";

const CELL: CellIdentity = { scenarioId: "S-1", world: "tier-2", productHost: "desktop-web", dimensions: {} };
const KEY = cellKey(CELL);

function req(assertions: string[] = ["a1", "a2"]) {
  return buildProofRequirement(CELL, "fixture://test", assertions);
}

let refSeq = 0;
function ref(assertionId: string) {
  refSeq += 1;
  return {
    assertionId,
    eventId: `evt-${refSeq}`,
    sequence: refSeq,
    eventDigest: proofEventDigest({ event: "proof-assertion-pass", assertionId }),
  };
}

function receipt(overrides: Partial<CellProofReceipt> = {}): CellProofReceipt {
  const r = req();
  return {
    contractHash: r.contractHash,
    collectedTestId: r.collectedTestId,
    cellKey: KEY,
    attemptId: "att-1",
    passed: [ref("a1"), ref("a2")],
    ...overrides,
  };
}

test("ADVERSARIAL: zero assertion ids is an invalid contract (a no-op collector is unrepresentable)", () => {
  assert.throws(() => buildProofRequirement(CELL, "fixture://test", []), ProofContractError);
});

test("ADVERSARIAL: duplicate/blank assertion ids are invalid contracts", () => {
  assert.throws(() => buildProofRequirement(CELL, "fixture://test", ["a1", "a1"]), ProofContractError);
  assert.throws(() => buildProofRequirement(CELL, "fixture://test", [" "]), /nonempty/);
  assert.throws(() => buildProofRequirement(CELL, "", ["a1"]), /collectedTestId/);
});

test("contract hash binds cellKey + collectedTestId + assertion ids", () => {
  const a = buildProofRequirement(CELL, "fixture://test", ["a1"]);
  const b = buildProofRequirement(CELL, "fixture://other", ["a1"]);
  const c = buildProofRequirement({ ...CELL, dimensions: { k: "v" } }, "fixture://test", ["a1"]);
  const d = buildProofRequirement(CELL, "fixture://test", ["a2"]);
  assert.notEqual(a.contractHash, b.contractHash);
  assert.notEqual(a.contractHash, c.contractHash);
  assert.notEqual(a.contractHash, d.contractHash);
});

test("ADVERSARIAL: missing receipt never validates", () => {
  const problems = validateProofReceipt(req(), null, KEY);
  assert.ok(problems.some((p) => p.includes("no proof receipt")));
});

test("ADVERSARIAL: missing required assertion is rejected", () => {
  const problems = validateProofReceipt(req(), receipt({ passed: [ref("a1")] }), KEY);
  assert.ok(problems.some((p) => p.includes('"a2" was never recorded')));
});

test("ADVERSARIAL: duplicate assertion pass is rejected (exactly once)", () => {
  const problems = validateProofReceipt(req(), receipt({ passed: [ref("a1"), ref("a1"), ref("a2")] }), KEY);
  assert.ok(problems.some((p) => p.includes("recorded 2 times")));
});

test("ADVERSARIAL: unknown assertion id is rejected", () => {
  const problems = validateProofReceipt(req(), receipt({ passed: [ref("a1"), ref("a2"), ref("ghost")] }), KEY);
  assert.ok(problems.some((p) => p.includes('unknown assertion "ghost"')));
});

test("ADVERSARIAL: wrong contract hash / test id / cell key are each rejected", () => {
  assert.ok(validateProofReceipt(req(), receipt({ contractHash: "f".repeat(64) }), KEY).length > 0);
  assert.ok(validateProofReceipt(req(), receipt({ collectedTestId: "fixture://forged" }), KEY).length > 0);
  assert.ok(validateProofReceipt(req(), receipt(), "tier-2/OTHER/-/-").length > 0);
});

test("ADVERSARIAL: malformed event digest is rejected", () => {
  const problems = validateProofReceipt(
    req(),
    receipt({ passed: [{ assertionId: "a1", eventId: "evt-x", sequence: 1, eventDigest: "nothex" }, { ...ref("a2"), sequence: 2 }] }),
    KEY,
  );
  assert.ok(problems.some((p) => p.includes("malformed event digest")));
});

test("a complete, exact receipt validates cleanly", () => {
  assert.deepEqual(validateProofReceipt(req(), receipt(), KEY), []);
});

// ── validateProofRequirement: independent requirement validation ──

test("ADVERSARIAL: a forged EMPTY requirement + empty receipt can never validate", () => {
  const forged = { collectedTestId: "fixture://test", assertionIds: [] as string[], contractHash: "f".repeat(64) };
  // Requirement itself is invalid — regardless of what receipt accompanies it.
  const problems = validateProofRequirement(KEY, forged);
  assert.ok(problems.some((p) => p.includes("zero assertion ids")));
  // Even if a caller skipped requirement validation, an empty receipt against
  // the real validator still catches the transplanted hash.
  const emptyReceipt: CellProofReceipt = {
    contractHash: forged.contractHash,
    collectedTestId: forged.collectedTestId,
    cellKey: KEY,
    attemptId: "att-1",
    passed: [],
  };
  // validateProofReceipt is SELF-DEFENDING: it re-validates the requirement
  // internally, so the forged empty requirement + trivially matching empty
  // receipt fails even when the caller forgets validateProofRequirement.
  const receiptProblems = validateProofReceipt(forged, emptyReceipt, KEY);
  assert.ok(receiptProblems.some((p) => p.includes("requirement invalid")));
});

test("ADVERSARIAL: a mutated requirement (edited ids) fails hash recomputation", () => {
  const real = req(["a1", "a2"]);
  const mutated = { ...real, assertionIds: ["a1"] };
  const problems = validateProofRequirement(KEY, mutated);
  assert.ok(problems.some((p) => p.includes("does not recompute")));
});

test("ADVERSARIAL: unsorted assertion ids are non-canonical and rejected", () => {
  const real = req(["a1", "a2"]);
  const unsorted = { ...real, assertionIds: ["a2", "a1"] };
  const problems = validateProofRequirement(KEY, unsorted);
  assert.ok(problems.some((p) => p.includes("canonical sorted order")));
});

test("a genuine requirement validates cleanly against its cell key and fails against another", () => {
  const real = req();
  assert.deepEqual(validateProofRequirement(KEY, real), []);
  const other = validateProofRequirement("tier-2/OTHER/-/-", real);
  assert.ok(other.some((p) => p.includes("does not recompute")));
});

test("built requirements are frozen: assertion ids and the object reject mutation", () => {
  const real = req();
  assert.throws(() => {
    (real.assertionIds as string[]).push("injected");
  }, TypeError);
  assert.throws(() => {
    (real as { contractHash: string }).contractHash = "f".repeat(64);
  }, TypeError);
});
