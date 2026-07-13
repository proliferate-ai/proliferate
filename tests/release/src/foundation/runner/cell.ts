/**
 * Cell execution surface.
 *
 * A CellRunner is the executable code that proves one cell against a ready-world
 * handle. It receives a typed handle, the cleanup ledger, the evidence sink, and
 * its attempt identity — never a loose env map. Success => green. A runner that
 * cannot honestly complete signals `blocked`/`expected_fail` by throwing the
 * corresponding error; strict evaluation treats both as non-green, so they can
 * never produce a passing aggregate. Any other throw => failed.
 */

import type { AttemptIdentity, CellIdentity, ResultBehavior } from "../contracts/identity.js";
import type { ReadyWorldHandle } from "../contracts/world.js";
import type { CleanupLedger } from "../contracts/cleanup.js";
import type { EvidenceSink } from "../contracts/evidence.js";

export interface CellExecutionContext {
  readonly cell: CellIdentity;
  readonly cellKey: string;
  readonly attempt: AttemptIdentity;
  readonly world: ReadyWorldHandle;
  readonly ledger: CleanupLedger;
  readonly evidence: EvidenceSink;
  readonly behavior: ResultBehavior;
  readonly dryRun: boolean;
}

/** Optional structured result; correlation ids are surfaced into the attempt. */
export interface CellOutcome {
  readonly correlationIds?: readonly string[];
}

export interface CellRunner {
  readonly cellKey: string;
  readonly cell: CellIdentity;
  /** Whether this collector is a legacy port — legacy collectors cannot qualify. */
  readonly legacy?: boolean;
  run(ctx: CellExecutionContext): Promise<CellOutcome | void>;
}

/**
 * Diagnostic-only outcome: the environment cannot exercise this cell (a missing
 * optional dependency, an intentionally omitted local credential). Strict
 * evaluation rejects it — there is no blocked budget under strict.
 */
export class CellBlockedError extends Error {
  readonly reason: string;
  readonly correlationIds: readonly string[];
  constructor(reason: string, correlationIds: readonly string[] = []) {
    super(reason);
    this.name = "CellBlockedError";
    this.reason = reason;
    this.correlationIds = correlationIds;
  }
}

/**
 * Diagnostic-only outcome: a known, diagnosed failure being tracked. Never green.
 */
export class CellExpectedFailError extends Error {
  readonly diagnosis: string;
  readonly correlationIds: readonly string[];
  constructor(diagnosis: string, correlationIds: readonly string[] = []) {
    super(diagnosis);
    this.name = "CellExpectedFailError";
    this.diagnosis = diagnosis;
    this.correlationIds = correlationIds;
  }
}
