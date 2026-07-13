/**
 * Immutable run evidence.
 *
 * Evidence is emitted on every terminal path: success, blocked preflight,
 * assertion failure, readiness failure, and cleanup failure. It binds source
 * identity, manifest hashes, world identity, artifact digests, per-cell final
 * results, and the cleanup result. Diagnostic evidence is marked nonqualifying
 * at write time and can never be consumed by promotion.
 */

import type { RunIdentity, ShardIdentity, ResultBehavior } from "./identity.js";
import type { FinalCellResult, RunEvaluation } from "./results.js";
import type { PreflightReport } from "./preflight.js";
import type { CleanupReconciliation } from "./cleanup.js";
import type { ReadinessObservation } from "./world.js";
import type { SelectedCellPlan } from "./plan.js";

export interface WorldEvidence {
  readonly world: string;
  readonly readiness: readonly ReadinessObservation[];
  /** Artifact digests/template ids actually observed in the world. */
  readonly observedArtifacts: Readonly<Record<string, string>>;
}

export interface RunEvidence {
  readonly schemaVersion: 1;
  readonly run: RunIdentity;
  readonly shard: ShardIdentity;
  readonly behavior: ResultBehavior;
  /** Hard nonqualification marker: true only for a strict, non-dry-run pass. */
  readonly qualifying: boolean;
  readonly dryRun: boolean;
  readonly plan: SelectedCellPlan;
  readonly preflight: PreflightReport;
  readonly worlds: readonly WorldEvidence[];
  readonly finals: readonly FinalCellResult[];
  readonly cleanup: CleanupReconciliation;
  readonly evaluation: RunEvaluation;
  readonly emittedAt: string;
}

/**
 * Append-only sink. Implementations persist durably (local JSONL file or
 * Actions artifact staging dir) and must reject any payload containing a key
 * matched by the redaction policy.
 */
export interface EvidenceSink {
  /** Record an intermediate observation (readiness, attempt, ledger event). */
  append(event: Readonly<Record<string, unknown>>): Promise<void>;
  /** Write the single immutable final evidence document. Exactly once per run. */
  finalize(evidence: RunEvidence): Promise<void>;
}
