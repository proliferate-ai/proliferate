/**
 * The T4-RUNTIME-1 ownership boundary, as a pure evaluator.
 *
 * This encodes the INTENDED Worker/Supervisor/AnyHarness contract from
 * specs/developing/testing/tier-4-scenario-contract.md ("Managed-Cloud Sandbox
 * N-1 To N") and the worker/supervisor structure docs:
 *
 *   - Worker observes desired N on its heartbeat and writes exactly ONE durable
 *     update request (the Supervisor mailbox). It does NOT download, swap,
 *     kill, restart, or roll back the runtime itself.
 *   - Supervisor consumes the request, verifies the staged artifact against the
 *     candidate manifest (version/size/checksum/digest — never a `stable`
 *     fallback), activates in dependency order, health-gates N, and rolls back
 *     on failure.
 *   - AnyHarness N reconciles installed native CLIs + ACP agent processes from
 *     its bundled inputs with zero per-agent failures; state stays preserved and
 *     the event sequence stays monotonic; a post-update turn completes.
 *
 * The evaluator is deliberately separate from any live wiring so the exact
 * pass/fail rule is unit-tested and the failing evidence against the CURRENT
 * direct-Worker-activation product is reproducible without provisioning E2B.
 */

/** Observations collected from a real upgrade attempt (all product-sourced). */
export interface UpgradeObservation {
  /** Desired AnyHarness version the heartbeat reports for THIS target after the flip. */
  readonly heartbeatDesiredAnyharness: string;
  /** The exact candidate-N version the run is converging to. */
  readonly candidateAnyharnessVersion: string;
  /** Desired versions reported to unrelated targets (must stay N-1). */
  readonly unrelatedTargetDesiredAnyharness: string;
  readonly retainedAnyharnessVersion: string;

  /** How many durable Supervisor update requests the Worker wrote for the divergence. */
  readonly durableUpdateRequestCount: number;
  /** True if the Worker downloaded/swapped/killed/restarted the runtime itself. */
  readonly workerPerformedDirectActivation: boolean;
  /** True if the Supervisor consumed the mailbox request. */
  readonly supervisorConsumedRequest: boolean;
  /** True if the staged artifact identity matched the candidate manifest exactly. */
  readonly supervisorStagedArtifactMatchesManifest: boolean;
  /** True if a `stable`/rolling artifact was accepted (forbidden). */
  readonly acceptedRollingArtifact: boolean;
  /** True if the Supervisor activated and health-gated the new runtime. */
  readonly supervisorHealthGatedActivation: boolean;

  /** The version AnyHarness reports for itself after activation. */
  readonly anyharnessReportedVersion: string;
  /** True if the Worker reconnected with its durable identity/revisions/cursor. */
  readonly workerReconnectedDurableIdentity: boolean;
  /** True if the existing session transcript's event sequence stayed monotonic. */
  readonly eventSequenceMonotonic: boolean;
  /** Per-agent reconcile failures (native CLI + ACP). Must be zero. */
  readonly perAgentReconcileFailures: number;
  /** True if a bounded post-update turn completed in the existing session. */
  readonly postUpdateTurnCompleted: boolean;
  /** True if the sandbox stayed on its immutable N-1 E2B image. */
  readonly sandboxStayedOnRetainedImage: boolean;
}

export interface OwnershipViolation {
  /** Stable slug of the violated rule, e.g. "worker-direct-activation". */
  readonly rule: string;
  /** One-line description of what the contract requires and what was observed. */
  readonly detail: string;
}

export type OwnershipVerdict =
  | { readonly satisfied: true }
  | { readonly satisfied: false; readonly violations: readonly OwnershipViolation[] };

/**
 * Evaluate the observed upgrade against the intended ownership boundary. Pure:
 * same input always yields the same verdict. Returns every violation (not just
 * the first) so evidence enumerates the full gap.
 */
export function evaluateOwnership(o: UpgradeObservation): OwnershipVerdict {
  const v: OwnershipViolation[] = [];

  if (o.heartbeatDesiredAnyharness !== o.candidateAnyharnessVersion) {
    v.push({
      rule: "heartbeat-desired-flip",
      detail: `heartbeat desired AnyHarness for this target is ${o.heartbeatDesiredAnyharness}, expected exact candidate N ${o.candidateAnyharnessVersion}`,
    });
  }
  if (o.unrelatedTargetDesiredAnyharness !== o.retainedAnyharnessVersion) {
    v.push({
      rule: "unrelated-target-unchanged",
      detail: `an unrelated target's desired AnyHarness changed to ${o.unrelatedTargetDesiredAnyharness}; only this run/target may change (expected N-1 ${o.retainedAnyharnessVersion})`,
    });
  }
  if (o.durableUpdateRequestCount !== 1) {
    v.push({
      rule: "one-durable-request",
      detail: `Worker wrote ${o.durableUpdateRequestCount} durable Supervisor update requests for the divergence; exactly one is required (replayed heartbeats must not duplicate)`,
    });
  }
  if (o.workerPerformedDirectActivation) {
    v.push({
      rule: "worker-direct-activation",
      detail: "Worker downloaded/swapped/restarted the runtime itself; the Worker must only write the durable request and leave activation to the Supervisor",
    });
  }
  if (!o.supervisorConsumedRequest) {
    v.push({
      rule: "supervisor-consume",
      detail: "Supervisor did not consume the Worker's durable update request",
    });
  }
  if (o.acceptedRollingArtifact) {
    v.push({
      rule: "no-rolling-fallback",
      detail: "a rolling/`stable` artifact was accepted; only the immutable candidate-manifest-bound artifact may activate",
    });
  }
  if (!o.supervisorStagedArtifactMatchesManifest) {
    v.push({
      rule: "staged-matches-manifest",
      detail: "the Supervisor-staged artifact version/size/checksum/digest did not match the candidate manifest",
    });
  }
  if (!o.supervisorHealthGatedActivation) {
    v.push({
      rule: "supervisor-health-gate",
      detail: "Supervisor did not activate + health-gate the new runtime in dependency order (with rollback on failure)",
    });
  }
  if (o.anyharnessReportedVersion !== o.candidateAnyharnessVersion) {
    v.push({
      rule: "anyharness-reports-n",
      detail: `AnyHarness reports ${o.anyharnessReportedVersion} after activation, expected exact candidate ${o.candidateAnyharnessVersion} (see #1089: unstamped 0.1.0 version identity)`,
    });
  }
  if (!o.workerReconnectedDurableIdentity) {
    v.push({
      rule: "worker-durable-reconnect",
      detail: "Worker did not reconnect with its durable identity/applied-revisions/cursor/pending-result state",
    });
  }
  if (!o.eventSequenceMonotonic) {
    v.push({
      rule: "monotonic-events",
      detail: "the existing session's event sequence was not monotonic across the restart",
    });
  }
  if (o.perAgentReconcileFailures !== 0) {
    v.push({
      rule: "agent-reconcile",
      detail: `${o.perAgentReconcileFailures} per-agent reconcile failures; N reconciliation must reach terminal completion with zero failed native CLI/ACP outcomes`,
    });
  }
  if (!o.postUpdateTurnCompleted) {
    v.push({
      rule: "post-update-turn",
      detail: "a bounded post-update turn did not complete in the existing session",
    });
  }
  if (!o.sandboxStayedOnRetainedImage) {
    v.push({
      rule: "immutable-n1-image",
      detail: "the sandbox no longer reports its immutable N-1 E2B image; only in-place components may converge",
    });
  }

  return v.length === 0 ? { satisfied: true } : { satisfied: false, violations: v };
}

/**
 * The ownership shape the CURRENT product exhibits (direct-Worker activation,
 * no Supervisor parent). Used to prove — deterministically, without E2B — that
 * the intended assertion fails exactly where the tier-4 contract says it must,
 * so the scenario's expected-fail diagnosis is anchored to real code behavior.
 */
export function currentProductOwnershipViolations(
  retainedVersion: string,
  candidateVersion: string,
): readonly OwnershipViolation[] {
  const verdict = evaluateOwnership({
    heartbeatDesiredAnyharness: candidateVersion,
    candidateAnyharnessVersion: candidateVersion,
    unrelatedTargetDesiredAnyharness: retainedVersion,
    retainedAnyharnessVersion: retainedVersion,
    // KNOWN REALITY: Worker directly downloads/swaps/reexecs itself and
    // AnyHarness (anyharness/crates/proliferate-worker/src/self_update.rs +
    // anyharness_update.rs). It writes no Supervisor mailbox request, and the
    // Supervisor is not the active parent that consumes/activates/health-gates.
    durableUpdateRequestCount: 0,
    workerPerformedDirectActivation: true,
    supervisorConsumedRequest: false,
    supervisorStagedArtifactMatchesManifest: false,
    acceptedRollingArtifact: false,
    supervisorHealthGatedActivation: false,
    // #1089: the released binary reports CARGO_PKG_VERSION 0.1.0, never the pin.
    anyharnessReportedVersion: "0.1.0",
    workerReconnectedDurableIdentity: true,
    eventSequenceMonotonic: true,
    perAgentReconcileFailures: 0,
    postUpdateTurnCompleted: false,
    sandboxStayedOnRetainedImage: true,
  });
  return verdict.satisfied ? [] : verdict.violations;
}
