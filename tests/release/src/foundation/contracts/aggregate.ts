/**
 * Cross-shard aggregate — the ONLY path to qualifying evidence.
 *
 * Shard outputs are nonqualifying inputs (an empty or partial shard must
 * never claim qualification). The aggregate requires every shard of the run
 * to be present exactly once with coherent run/manifest/artifact identity,
 * exactly one final result per required cell across the union, every attempt
 * preserved, and every shard's cleanup reconciliation complete. A one-shard
 * run still aggregates its single shard; there is no shard-local shortcut.
 */

import type { RunEvidence } from "./evidence.js";
import type { SelectedCellPlan } from "./plan.js";
import type { FinalCellResult, RunEvaluation } from "./results.js";
import { evaluateCells } from "./evaluate.js";

export interface AggregateInput {
  /** The one plan the run was resolved from (identical across shards). */
  readonly plan: SelectedCellPlan;
  /** Final evidence document of every shard in the run, in any order. */
  readonly shards: readonly RunEvidence[];
}

export interface AggregateEvaluation extends RunEvaluation {
  /** Identity/coverage defects that void the aggregate regardless of cell results. */
  readonly aggregateDefects: readonly string[];
  /** Union of final results the aggregate evaluated, one entry per cell. */
  readonly finals: readonly FinalCellResult[];
}

export function evaluateAggregate(input: AggregateInput): AggregateEvaluation {
  const { plan, shards } = input;
  const defects: string[] = [];

  if (shards.length === 0) {
    defects.push("aggregate received zero shard evidence documents");
  }

  // ── Identity coherence: one run, one manifest set, one behavior. ──
  const first = shards[0];
  for (const s of shards) {
    if (first && s.run.runId !== first.run.runId) {
      defects.push(`shard ${s.shard.shardId} has runId ${s.run.runId} != ${first.run.runId}`);
    }
    if (first && s.run.candidateManifestHash !== first.run.candidateManifestHash) {
      defects.push(`shard ${s.shard.shardId} candidateManifestHash diverges`);
    }
    if (first && s.run.retainedManifestHash !== first.run.retainedManifestHash) {
      defects.push(`shard ${s.shard.shardId} retainedManifestHash diverges`);
    }
    if (first && s.run.sourceSha !== first.run.sourceSha) {
      defects.push(`shard ${s.shard.shardId} sourceSha diverges`);
    }
    if (s.behavior !== plan.behavior) {
      defects.push(`shard ${s.shard.shardId} behavior ${s.behavior} != plan behavior ${plan.behavior}`);
    }
    if (s.plan.scenarioManifestHash !== plan.scenarioManifestHash) {
      defects.push(`shard ${s.shard.shardId} scenarioManifestHash diverges from the aggregate plan`);
    }
    if (s.dryRun) {
      defects.push(`shard ${s.shard.shardId} is a dry-run document and cannot enter an aggregate`);
    }
  }

  // ── Shard coverage: every shard exactly once, counts agree. ──
  const declaredCount = first?.shard.shardCount ?? 0;
  const seen = new Map<number, number>();
  for (const s of shards) {
    if (s.shard.shardCount !== declaredCount) {
      defects.push(`shard ${s.shard.shardId} declares shardCount ${s.shard.shardCount} != ${declaredCount}`);
    }
    seen.set(s.shard.shardIndex, (seen.get(s.shard.shardIndex) ?? 0) + 1);
  }
  for (const [index, n] of seen) {
    if (n > 1) defects.push(`shard index ${index} appears ${n} times in the aggregate`);
  }
  if (declaredCount > 0 && seen.size !== declaredCount) {
    // Indices must form one contiguous run covering the declared count
    // (either 0- or 1-based); any gap means a shard document is missing.
    defects.push(
      `aggregate covers ${seen.size} distinct shard indices for shardCount ${declaredCount}`,
    );
  } else if (declaredCount > 0) {
    const min = Math.min(...seen.keys());
    const max = Math.max(...seen.keys());
    if (max - min + 1 !== declaredCount || (min !== 0 && min !== 1)) {
      defects.push(
        `shard indices [${[...seen.keys()].sort((a, b) => a - b).join(",")}] are not a contiguous cover of shardCount ${declaredCount}`,
      );
    }
  }
  if (shards.length !== declaredCount && declaredCount > 0) {
    defects.push(`aggregate has ${shards.length} shard documents for shardCount ${declaredCount}`);
  }

  // ── Cleanup: every shard's reconciliation must be complete. ──
  for (const s of shards) {
    if (!s.cleanup.complete) {
      defects.push(`shard ${s.shard.shardId} cleanup reconciliation incomplete`);
    }
  }

  // ── Union of finals; duplicate finals across shards surface naturally
  // through evaluateCells' duplicate detection. Attempts must be preserved. ──
  const finals: FinalCellResult[] = shards.flatMap((s) => [...s.finals]);
  for (const final of finals) {
    if (final.attempts.length === 0) {
      defects.push(`final for ${final.cellKey} carries no attempt history`);
    }
  }

  const cellEval = evaluateCells({
    plan,
    finals,
    preflightComplete: shards.length > 0 && shards.every((s) => s.preflight.complete),
    cleanupComplete: shards.length > 0 && shards.every((s) => s.cleanup.complete),
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
