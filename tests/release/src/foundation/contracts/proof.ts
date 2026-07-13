/**
 * Machine-enforced proof contracts.
 *
 * A collector cannot become green by returning: green exists only when the
 * ENGINE derives a proof receipt from assertions the collector recorded
 * through the scoped proof recorder during execution, and that receipt
 * matches the trusted proof requirement carried in the planned cell.
 *
 * The requirement is typed and exact: a nonempty set of stable assertion ids
 * plus a stable collected-test id, hashed together with the cell key into a
 * canonical contract hash. The receipt binds each passed assertion to the
 * canonical digest of the evidence event that recorded it.
 */

import { createHash } from "node:crypto";

import { canonicalJson } from "./hashing.js";
import type { CellIdentity } from "./identity.js";
import { cellKey as computeCellKey } from "./identity.js";

/** The trusted requirement, derived from the collector definition at plan time. */
export interface CellProofRequirement {
  /** Stable executable-test id, e.g. "tests/release:t2-auth-1". */
  readonly collectedTestId: string;
  /** Exact, nonempty, sorted-unique stable assertion ids that must each pass exactly once. */
  readonly assertionIds: readonly string[];
  /** Canonical hash binding cellKey + collectedTestId + assertionIds. */
  readonly contractHash: string;
}

/** One recorded assertion pass, bound to the evidence event that persisted it. */
export interface ProofEventRef {
  readonly assertionId: string;
  /** Canonical sha256 digest of the appended evidence event envelope. */
  readonly eventDigest: string;
}

/** The engine-derived receipt stored on a green CellAttempt. */
export interface CellProofReceipt {
  readonly contractHash: string;
  readonly collectedTestId: string;
  readonly cellKey: string;
  readonly attemptId: string;
  /** One entry per required assertion, in requirement order. */
  readonly passed: readonly ProofEventRef[];
}

export class ProofContractError extends Error {
  readonly problems: readonly string[];
  constructor(context: string, problems: readonly string[]) {
    super(`${context}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ProofContractError";
    this.problems = problems;
  }
}

/** Derives the trusted requirement from a declared cell + its assertion ids. */
export function buildProofRequirement(
  cell: CellIdentity,
  collectedTestId: string,
  assertionIds: readonly string[],
): CellProofRequirement {
  const problems: string[] = [];
  if (!collectedTestId || collectedTestId.trim().length === 0) {
    problems.push("collectedTestId must be a nonempty stable id");
  }
  if (assertionIds.length === 0) {
    problems.push("assertionIds must be nonempty: a cell with zero assertions proves nothing");
  }
  const unique = new Set(assertionIds);
  if (unique.size !== assertionIds.length) {
    problems.push("assertionIds must be unique");
  }
  for (const id of assertionIds) {
    if (!id || id.trim().length === 0) problems.push("assertion ids must be nonempty");
  }
  if (problems.length > 0) {
    throw new ProofContractError(`invalid proof contract for ${computeCellKey(cell)}`, problems);
  }
  const sorted = Object.freeze([...assertionIds].sort());
  const key = computeCellKey(cell);
  const contractHash = createHash("sha256")
    .update(canonicalJson({ cellKey: key, collectedTestId, assertionIds: sorted }), "utf8")
    .digest("hex");
  return Object.freeze({ collectedTestId, assertionIds: sorted, contractHash });
}

/**
 * Independently validates a requirement AGAINST the cell it claims to govern:
 * nonempty/unique/nonblank assertion ids, stable test id, sorted canonical
 * set, and — critically — the contractHash recomputed from
 * cellKey + collectedTestId + assertionIds must match. A forged requirement
 * (edited ids, emptied set, transplanted hash) fails here regardless of any
 * receipt presented with it. Returns problems; empty means valid.
 */
export function validateProofRequirement(
  expectedCellKey: string,
  requirement: CellProofRequirement | null | undefined,
): string[] {
  if (!requirement) return ["cell has no proof requirement"];
  const problems: string[] = [];
  if (!requirement.collectedTestId || requirement.collectedTestId.trim().length === 0) {
    problems.push("requirement collectedTestId is blank");
  }
  if (requirement.assertionIds.length === 0) {
    problems.push("requirement has zero assertion ids; an empty contract proves nothing");
  }
  const unique = new Set(requirement.assertionIds);
  if (unique.size !== requirement.assertionIds.length) {
    problems.push("requirement assertion ids are not unique");
  }
  for (const id of requirement.assertionIds) {
    if (!id || id.trim().length === 0) problems.push("requirement contains a blank assertion id");
  }
  const sorted = [...requirement.assertionIds].sort();
  if (JSON.stringify(sorted) !== JSON.stringify([...requirement.assertionIds])) {
    problems.push("requirement assertion ids are not in canonical sorted order");
  }
  if (problems.length > 0) return problems;
  const recomputed = createHash("sha256")
    .update(
      canonicalJson({
        cellKey: expectedCellKey,
        collectedTestId: requirement.collectedTestId,
        assertionIds: sorted,
      }),
      "utf8",
    )
    .digest("hex");
  if (recomputed !== requirement.contractHash) {
    problems.push(
      `requirement contractHash ${requirement.contractHash.slice(0, 12)}… does not recompute from cellKey+testId+assertionIds (${recomputed.slice(0, 12)}…)`,
    );
  }
  return problems;
}

/** Canonical digest of an evidence event envelope (what ProofEventRef binds). */
export function proofEventDigest(envelope: object): string {
  return createHash("sha256").update(canonicalJson(envelope), "utf8").digest("hex");
}

/**
 * Validates a receipt against the trusted requirement. Every required
 * assertion exactly once, no unknowns, no duplicates, matching contract
 * hash/test id/cell key, and a well-formed event digest per pass.
 */
export function validateProofReceipt(
  requirement: CellProofRequirement,
  receipt: CellProofReceipt | null | undefined,
  expectedCellKey: string,
): string[] {
  if (!receipt) {
    return [`green result carries no proof receipt (requirement ${requirement.contractHash.slice(0, 12)}…)`];
  }
  const problems: string[] = [];
  if (receipt.contractHash !== requirement.contractHash) {
    problems.push(`receipt contractHash ${receipt.contractHash.slice(0, 12)}… != requirement ${requirement.contractHash.slice(0, 12)}…`);
  }
  if (receipt.collectedTestId !== requirement.collectedTestId) {
    problems.push(`receipt collectedTestId "${receipt.collectedTestId}" != requirement "${requirement.collectedTestId}"`);
  }
  if (receipt.cellKey !== expectedCellKey) {
    problems.push(`receipt cellKey ${receipt.cellKey} != expected ${expectedCellKey}`);
  }
  const seen = new Map<string, number>();
  for (const ref of receipt.passed) {
    seen.set(ref.assertionId, (seen.get(ref.assertionId) ?? 0) + 1);
    if (!/^[0-9a-f]{64}$/.test(ref.eventDigest)) {
      problems.push(`assertion "${ref.assertionId}" has a malformed event digest`);
    }
  }
  for (const id of requirement.assertionIds) {
    const n = seen.get(id) ?? 0;
    if (n === 0) problems.push(`required assertion "${id}" was never recorded`);
    if (n > 1) problems.push(`assertion "${id}" recorded ${n} times (must be exactly once)`);
  }
  for (const id of seen.keys()) {
    if (!requirement.assertionIds.includes(id)) {
      problems.push(`unknown assertion "${id}" is not in the proof contract`);
    }
  }
  if (receipt.passed.length !== requirement.assertionIds.length && problems.length === 0) {
    problems.push(
      `receipt has ${receipt.passed.length} passes for ${requirement.assertionIds.length} required assertions`,
    );
  }
  return problems;
}
