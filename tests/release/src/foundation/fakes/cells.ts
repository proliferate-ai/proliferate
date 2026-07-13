/**
 * Fake CellRunners for engine tests: green, failing, blocked, expected-fail, and
 * a runner that registers a resource in the ledger during execution.
 */

import type { CellIdentity } from "../contracts/identity.js";
import { cellKey } from "../contracts/identity.js";
import { CleanupRunner } from "../ledger/reconcile.js";
import {
  CellBlockedError,
  CellExpectedFailError,
  type CellExecutionContext,
  type CellRunner,
} from "../runner/cell.js";
import { buildProofRequirement } from "../contracts/proof.js";

/** The assertion id every fake green runner proves; pair with fakeProofRequirement(cell). */
export const FAKE_ASSERTION_ID = "fixture-assertion";
export const FAKE_COLLECTED_TEST_ID = "fixture://fake-runner";

/** The trusted requirement matching greenRunner's recorded proof. */
export function fakeProofRequirement(cell: CellIdentity) {
  return buildProofRequirement(cell, FAKE_COLLECTED_TEST_ID, [FAKE_ASSERTION_ID]);
}

export function greenRunner(cell: CellIdentity, opts: { legacy?: boolean; correlationIds?: readonly string[] } = {}): CellRunner {
  return {
    cell,
    cellKey: cellKey(cell),
    legacy: opts.legacy,
    async run(ctx: CellExecutionContext) {
      // Fakes prove their fixture assertion honestly — the engine derives the
      // receipt; a fake that skipped this would (correctly) fail, not green.
      await ctx.proof.pass(FAKE_ASSERTION_ID, "fake runner fixture assertion");
      return { correlationIds: opts.correlationIds ?? [] };
    },
  };
}

export function failingRunner(cell: CellIdentity, message = "assertion failed: expected 200"): CellRunner {
  return {
    cell,
    cellKey: cellKey(cell),
    async run() {
      throw new Error(message);
    },
  };
}

export function blockedRunner(cell: CellIdentity, reason = "optional dependency unavailable"): CellRunner {
  return {
    cell,
    cellKey: cellKey(cell),
    async run() {
      throw new CellBlockedError(reason);
    },
  };
}

export function expectedFailRunner(cell: CellIdentity, diagnosis = "known product bug #123"): CellRunner {
  return {
    cell,
    cellKey: cellKey(cell),
    async run() {
      throw new CellExpectedFailError(diagnosis);
    },
  };
}

/** Registers a run-scoped resource during execution, proving ledger use flows through cells too. */
export function resourceRegisteringRunner(
  cell: CellIdentity,
  resource: { provider: string; resourceType: string; resourceId: string },
  cleanup: () => Promise<void>,
): CellRunner {
  return {
    cell,
    cellKey: cellKey(cell),
    async run(ctx: CellExecutionContext) {
      const runner = ctx.ledger as CleanupRunner;
      await runner.registerResource(
        {
          runId: ctx.attempt.runId,
          shardId: ctx.attempt.shardId,
          provider: resource.provider,
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
          owningWorld: ctx.cell.world,
        },
        cleanup,
      );
      return { correlationIds: [] };
    },
  };
}
