/**
 * Cross-shard aggregate — the ONLY path to qualifying evidence.
 *
 * Shard outputs are nonqualifying inputs (an empty or partial shard must
 * never claim qualification). The aggregate:
 *  - anchors trust to CALLER-SUPPLIED expected identities (run, SHA,
 *    manifests), never to the first shard document it happens to see;
 *  - requires every shard present exactly once with canonical one-based
 *    identity and exact deterministic shard-plan ownership of its finals;
 *  - requires exactly one final per required cell with a valid, ordered,
 *    unique attempt history whose supersession never buries a product
 *    assertion failure under a green retry;
 *  - requires world evidence with all-ok readiness for every world a shard
 *    ran required cells in;
 *  - recomputes cleanup health from the counters instead of trusting
 *    `complete: true`.
 *
 * The verdict is persisted as a SEPARATE durable artifact
 * (`AggregateArtifact`); a shard evidence document never carries an
 * aggregate qualification claim.
 */

import type { RunEvidence } from "./evidence.js";
import type { SelectedCellPlan } from "./plan.js";
import { shardOwnedCellKeys } from "./plan.js";
import type { CellAttempt, FinalCellResult, RunEvaluation } from "./results.js";
import { cellKey as computeCellKey } from "./identity.js";
import { evaluateCells } from "./evaluate.js";
import { validateProofReceipt } from "./proof.js";

/** Trusted identities the caller resolved independently of any shard. */
export interface ExpectedRunIdentity {
  readonly runId: string;
  readonly sourceSha: string;
  readonly candidateManifestHash: string;
  readonly retainedManifestHash: string | null;
  readonly shardCount: number;
}

export interface AggregateInput {
  /** The one plan the run was resolved from (identical across shards). */
  readonly plan: SelectedCellPlan;
  /** Caller-trusted identities; shards are validated AGAINST these. */
  readonly expected: ExpectedRunIdentity;
  /** Final evidence document of every shard in the run, in any order. */
  readonly shards: readonly RunEvidence[];
}

export interface AggregateEvaluation extends RunEvaluation {
  /** Identity/coverage defects that void the aggregate regardless of cell results. */
  readonly aggregateDefects: readonly string[];
  /** Union of final results the aggregate evaluated, one entry per cell. */
  readonly finals: readonly FinalCellResult[];
}

/**
 * The separate durable aggregate verdict document. Persist this beside (not
 * inside) the shard evidence; production promotion consumes this artifact.
 */
export interface AggregateArtifact {
  readonly schemaVersion: 1;
  readonly kind: "aggregate-verdict";
  readonly expected: ExpectedRunIdentity;
  readonly scenarioManifestHash: string | null;
  readonly selector: string;
  readonly behavior: string;
  readonly shardIds: readonly string[];
  readonly evaluation: AggregateEvaluation;
  readonly emittedAt: string;
}

export function evaluateAggregate(input: AggregateInput): AggregateEvaluation {
  const { plan, expected, shards } = input;
  const defects: string[] = [];

  if (shards.length === 0) {
    defects.push("aggregate received zero shard evidence documents");
  }
  if (!Number.isInteger(expected.shardCount) || expected.shardCount < 1) {
    defects.push(`expected.shardCount must be a positive integer, got ${expected.shardCount}`);
  }

  // ── Identity: every shard validates against the TRUSTED expectation. ──
  for (const s of shards) {
    const id = s.shard.shardId;
    if (s.run.runId !== expected.runId) {
      defects.push(`shard ${id} has runId ${s.run.runId} != expected ${expected.runId}`);
    }
    if (s.shard.runId !== expected.runId) {
      defects.push(`shard ${id} shard.runId ${s.shard.runId} != expected ${expected.runId}`);
    }
    if (s.run.sourceSha !== expected.sourceSha) {
      defects.push(`shard ${id} sourceSha ${s.run.sourceSha} != expected ${expected.sourceSha}`);
    }
    if (s.run.candidateManifestHash !== expected.candidateManifestHash) {
      defects.push(`shard ${id} candidateManifestHash diverges from expected`);
    }
    if (s.run.retainedManifestHash !== expected.retainedManifestHash) {
      defects.push(`shard ${id} retainedManifestHash diverges from expected`);
    }
    if (s.behavior !== plan.behavior) {
      defects.push(`shard ${id} behavior ${s.behavior} != plan behavior ${plan.behavior}`);
    }
    if (s.plan.scenarioManifestHash !== plan.scenarioManifestHash) {
      defects.push(`shard ${id} scenarioManifestHash diverges from the aggregate plan`);
    }
    if (s.dryRun) {
      defects.push(`shard ${id} is a dry-run document and cannot enter an aggregate`);
    }
  }

  // ── Canonical shard identity: one-based, exact shardId, exact count. ──
  const seen = new Map<number, number>();
  for (const s of shards) {
    const { shardIndex, shardCount, shardId } = s.shard;
    if (shardCount !== expected.shardCount) {
      defects.push(`shard ${shardId} declares shardCount ${shardCount} != expected ${expected.shardCount}`);
    }
    if (!Number.isInteger(shardIndex) || shardIndex < 1 || shardIndex > expected.shardCount) {
      defects.push(`shard ${shardId} has non-canonical shardIndex ${shardIndex} (must be 1..${expected.shardCount})`);
    }
    const canonicalId = `shard-${shardIndex}-of-${shardCount}`;
    if (shardId !== canonicalId) {
      defects.push(`shard id "${shardId}" is not the canonical "${canonicalId}"`);
    }
    seen.set(shardIndex, (seen.get(shardIndex) ?? 0) + 1);
  }
  for (const [index, n] of seen) {
    if (n > 1) defects.push(`shard index ${index} appears ${n} times in the aggregate`);
  }
  for (let i = 1; i <= expected.shardCount; i += 1) {
    if (!seen.has(i)) defects.push(`shard index ${i} of ${expected.shardCount} is missing from the aggregate`);
  }
  if (shards.length !== expected.shardCount) {
    defects.push(`aggregate has ${shards.length} shard documents for expected shardCount ${expected.shardCount}`);
  }

  // ── Deterministic shard-plan ownership: a shard may only report finals
  // for cells the deterministic assignment gave it. ──
  for (const s of shards) {
    if (defects.some((d) => d.includes("non-canonical shardIndex"))) break;
    let owned: ReadonlySet<string>;
    try {
      owned = shardOwnedCellKeys(plan, s.shard);
    } catch {
      continue; // shard-count defects already recorded above
    }
    for (const final of s.finals) {
      if (!owned.has(final.cellKey)) {
        defects.push(`shard ${s.shard.shardId} reports a final for ${final.cellKey} it does not own`);
      }
    }
  }

  // ── World evidence: every world a shard ran required cells in must have
  // an evidence entry whose readiness observations are all ok. ──
  for (const s of shards) {
    const worldsWithFinals = new Set(s.finals.map((f) => f.cell.world));
    for (const world of worldsWithFinals) {
      const ranReal = s.finals.some(
        (f) => f.cell.world === world && (f.status === "green" || f.status === "failed"),
      );
      if (!ranReal) continue; // blocked/readiness_failed cells legitimately have no ready world
      const we = s.worlds.find((w) => w.world === world);
      if (!we) {
        defects.push(`shard ${s.shard.shardId} has executed finals for world ${world} but no world evidence`);
        continue;
      }
      const failedChecks = we.readiness.filter((o) => !o.ok).map((o) => o.check);
      if (failedChecks.length > 0) {
        defects.push(
          `shard ${s.shard.shardId} world ${world} has failed readiness observations: ${failedChecks.join(", ")}`,
        );
      }
      if (we.readiness.length === 0) {
        defects.push(`shard ${s.shard.shardId} world ${world} has zero readiness observations`);
      }
      for (const [slot, digest] of Object.entries(we.observedArtifacts)) {
        if (typeof digest !== "string" || digest.length === 0) {
          defects.push(`shard ${s.shard.shardId} world ${world} observed artifact "${slot}" has an empty receipt`);
        }
      }
    }
  }

  // ── Final/attempt integrity. ──
  const finals: FinalCellResult[] = shards.flatMap((s) => [...s.finals]);
  for (const final of finals) {
    defects.push(...validateFinal(final));
  }

  // ── Proof receipts: every GREEN final must carry a receipt matching the
  // TRUSTED plan's proof requirement for that cell — validated here
  // independently; the aggregate never assumes the engine checked it.
  // (Journal-ref existence validation is the trusted fan-in turn's scope.) ──
  const plannedByKey = new Map(plan.cells.map((c) => [c.cellKey, c]));
  for (const final of finals) {
    if (final.status !== "green") continue;
    const planned = plannedByKey.get(final.cellKey);
    if (!planned) continue; // unknown-final defect already reported by evaluateCells
    if (!planned.proofRequirement) {
      defects.push(
        `green final ${final.cellKey} has no trusted proof requirement in the plan; a bare placeholder cell can never be green`,
      );
      continue;
    }
    const active = final.attempts.filter((a) => !a.superseded);
    const greenAttempt = active.length === 1 ? active[0] : final.attempts[final.attempts.length - 1];
    const problems = validateProofReceipt(planned.proofRequirement, greenAttempt?.proof, final.cellKey);
    for (const problem of problems) {
      defects.push(`green final ${final.cellKey} proof: ${problem}`);
    }
    if (greenAttempt && greenAttempt.proof && greenAttempt.proof.attemptId !== greenAttempt.attemptId) {
      defects.push(
        `green final ${final.cellKey} proof receipt is bound to attempt ${greenAttempt.proof.attemptId}, not the green attempt ${greenAttempt.attemptId}`,
      );
    }
  }

  // ── Cleanup: recompute health from counters; never trust complete=true. ──
  for (const s of shards) {
    const c = s.cleanup;
    if (c.failed.length > 0) {
      defects.push(`shard ${s.shard.shardId} cleanup has ${c.failed.length} failed entries`);
    }
    if (c.attempted !== c.cleaned + c.alreadyAbsent + c.failed.length) {
      defects.push(
        `shard ${s.shard.shardId} cleanup counters do not reconcile: attempted=${c.attempted} != cleaned=${c.cleaned} + absent=${c.alreadyAbsent} + failed=${c.failed.length}`,
      );
    }
    if (!c.complete) {
      defects.push(`shard ${s.shard.shardId} cleanup reconciliation incomplete`);
    }
    for (const entry of c.failed) {
      if (entry.runId !== expected.runId) {
        defects.push(`shard ${s.shard.shardId} cleanup ledger entry bound to foreign run ${entry.runId}`);
      }
    }
  }

  const cellEval = evaluateCells({
    plan,
    finals,
    preflightComplete: shards.length > 0 && shards.every((s) => s.preflight.complete),
    cleanupComplete:
      shards.length > 0 &&
      shards.every(
        (s) =>
          s.cleanup.complete &&
          s.cleanup.failed.length === 0 &&
          s.cleanup.attempted === s.cleanup.cleaned + s.cleanup.alreadyAbsent + s.cleanup.failed.length,
      ),
    dryRun: shards.some((s) => s.dryRun),
    previousBlockedCellKeys: [],
  });

  if (defects.length > 0 || cellEval.verdict.qualifying === false) {
    const reasons = [
      ...defects,
      ...(cellEval.verdict.qualifying === false ? cellEval.verdict.reasons : []),
    ];
    return {
      ...cellEval,
      verdict: { qualifying: false, reasons },
      aggregateDefects: defects,
      finals,
    };
  }
  return { ...cellEval, aggregateDefects: defects, finals };
}

/**
 * Attempt-history integrity for one final result:
 *  - final.cellKey must be the deterministic key of final.cell;
 *  - attempts exist, belong to the cell, have unique ids, contiguous
 *    one-based ordering, and exactly one non-superseded attempt;
 *  - the non-superseded attempt is the LAST one and its status equals the
 *    final status;
 *  - supersession never buries a product assertion failure: a superseded
 *    `failed` attempt cannot be followed by a green final (infrastructure
 *    statuses — blocked/readiness_failed/cancelled — may be retried).
 */
function validateFinal(final: FinalCellResult): string[] {
  const defects: string[] = [];
  const key = final.cellKey;

  if (computeCellKey(final.cell) !== key) {
    defects.push(`final ${key} carries a cell identity that hashes to a different cell key`);
  }
  if (final.attempts.length === 0) {
    defects.push(`final for ${key} carries no attempt history`);
    return defects;
  }

  const ids = new Set<string>();
  let previous: CellAttempt | null = null;
  for (const [i, attempt] of final.attempts.entries()) {
    if (attempt.cellKey !== key) {
      defects.push(`final ${key} attempt ${attempt.attemptId} belongs to a different cell (${attempt.cellKey})`);
    }
    if (ids.has(attempt.attemptId)) {
      defects.push(`final ${key} has duplicate attemptId ${attempt.attemptId}`);
    }
    ids.add(attempt.attemptId);
    if (attempt.attemptNumber !== i + 1) {
      defects.push(`final ${key} attempt order broken: position ${i + 1} has attemptNumber ${attempt.attemptNumber}`);
    }
    if (previous && previous.finishedAt > attempt.startedAt) {
      defects.push(`final ${key} attempts overlap in time (${previous.attemptId} -> ${attempt.attemptId})`);
    }
    previous = attempt;
  }

  const active = final.attempts.filter((a) => !a.superseded);
  if (active.length !== 1) {
    defects.push(`final ${key} must have exactly one non-superseded attempt, found ${active.length}`);
  } else {
    const last = final.attempts[final.attempts.length - 1];
    if (active[0] !== last) {
      defects.push(`final ${key}: the non-superseded attempt must be the last attempt`);
    }
    if (active[0].status !== final.status) {
      defects.push(
        `final ${key} status ${final.status} disagrees with its active attempt status ${active[0].status}`,
      );
    }
  }

  if (final.status === "green") {
    const buriedProductFailure = final.attempts.some((a) => a.superseded && a.status === "failed");
    if (buriedProductFailure) {
      defects.push(
        `final ${key} is green but supersedes a product assertion failure; a failed attempt requires triage, not a green retry`,
      );
    }
  }

  return defects;
}
