/**
 * Collector definitions — the ONE canonical, executable inverse of the
 * scenario manifest.
 *
 * A definition is a list of INDIVISIBLE cell definitions: each declared cell
 * identity is bound to its executable function in the same object, and the
 * metadata views (cells, cellKeys) plus the engine CellRunners are DERIVED
 * from that binding. There is no way to author metadata and execution
 * separately, so a mismatched or no-op factory cannot green declared cells.
 *
 * Coverage is a claim about the MANIFEST ROW, not about the collector's own
 * health:
 *  - `core`               — the collector's code/test mapping covers the row's
 *                           complete required validation under run-scoped
 *                           isolation, so it may satisfy a collected/enforced
 *                           row. NO current collector qualifies (see below).
 *  - `foundation-partial` — an honest vertical slice: real, evidence-bound,
 *                           diagnostic-valuable, but narrower than the row,
 *                           testing superseded semantics, or dependent on
 *                           reused/dirty world state. It can never satisfy a
 *                           collected/enforced row and never promotes the
 *                           guarantee.
 */

import { cellKey, type CellIdentity, type RunIdentity, type ShardIdentity, type WorldId } from "../contracts/identity.js";
import type { CandidateManifest, RetainedProductionManifest } from "../contracts/artifacts.js";
import type { WorldContext } from "../contracts/world.js";
import type { LocalRuntimeWorldHandle } from "../contracts/world.js";
import { CellBlockedError, CellExpectedFailError, type CellExecutionContext, type CellOutcome, type CellRunner } from "../runner/cell.js";
import type { FinalCellResult } from "../contracts/results.js";
import { T2_AUTH_1_CELL, runT2Auth1Cell } from "../worlds/tier2/cells/t2-auth-1.js";
import { T2_BILL_1_CELL, runT2Bill1Cell } from "../worlds/tier2/cells/t2-bill-1.js";
import type { InternalTier2WorldHandle } from "../worlds/tier2/provisioner.js";
import { local2CellIdentity, runLocal2Cell } from "../worlds/local-runtime/local-2.js";

export type CollectorCoverage = "core" | "foundation-partial";

/**
 * Wiring the CLI supplies when materializing executable runners: the trusted
 * identities and artifact receipts of the run being executed.
 */
export interface RunnerWiring {
  readonly run: RunIdentity;
  readonly shard: ShardIdentity;
  readonly candidate: CandidateManifest;
  readonly retained: RetainedProductionManifest | null;
}

/**
 * One indivisible executable cell: the declared identity and the function
 * that proves it live in the same object. Everything else is derived.
 */
export interface CellDefinition {
  readonly cell: CellIdentity;
  /**
   * Executes the cell against the ready world. Returns the outcome for a
   * green cell; throws CellBlockedError / CellExpectedFailError / Error for
   * the non-green statuses. It never fabricates identity: the engine records
   * the attempt under the DECLARED cell above.
   */
  execute(ctx: CellExecutionContext, wiring: RunnerWiring): Promise<CellOutcome | void>;
}

export interface CollectorDefinitionInput {
  readonly scenarioId: string;
  readonly collectorRef: string;
  readonly coverage: CollectorCoverage;
  readonly gate: "merge" | "release";
  readonly evidence: string;
  readonly cellDefinitions: readonly CellDefinition[];
}

export interface CollectorDefinition extends CollectorDefinitionInput {
  /** DERIVED views — never independently authored. */
  readonly cells: readonly CellIdentity[];
  readonly cellKeys: readonly string[];
  readonly world: WorldId;
  /** Derives engine CellRunners from the indivisible cell definitions. */
  createRunners(wiring: RunnerWiring): CellRunner[];
}

/** Back-compat alias: audit/selectors take the same definitions. */
export type CollectorRegistryEntry = CollectorDefinition;

/**
 * Builds a CollectorDefinition from indivisible cell definitions, validating
 * identity and cardinality BEFORE any provisioning can happen:
 *  - every declared cell belongs to this scenario;
 *  - no duplicate cell keys within the definition;
 *  - at least one executable cell (a metadata-only definition is invalid);
 *  - exactly one world across the definition's cells.
 * The runner list is derived 1:1 from the cell definitions — a missing,
 * extra, or identity-mismatched runner is unrepresentable.
 */
export function defineCollector(input: CollectorDefinitionInput): CollectorDefinition {
  if (input.cellDefinitions.length === 0) {
    throw new Error(
      `collector "${input.scenarioId}" declares zero executable cells; a metadata-only definition is invalid`,
    );
  }
  const seen = new Set<string>();
  for (const def of input.cellDefinitions) {
    if (def.cell.scenarioId !== input.scenarioId) {
      throw new Error(
        `collector "${input.scenarioId}" contains a cell for "${def.cell.scenarioId}"`,
      );
    }
    const key = cellKey(def.cell);
    if (seen.has(key)) {
      throw new Error(`collector "${input.scenarioId}" declares duplicate cell "${key}"`);
    }
    seen.add(key);
    if (typeof def.execute !== "function") {
      throw new Error(`collector "${input.scenarioId}" cell "${key}" has no executable function`);
    }
  }
  const worlds = new Set(input.cellDefinitions.map((d) => d.cell.world));
  if (worlds.size !== 1) {
    throw new Error(
      `collector "${input.scenarioId}" spans worlds [${[...worlds].join(", ")}]; one definition owns one world`,
    );
  }

  const cells = input.cellDefinitions.map((d) => d.cell);
  const cellKeys = cells.map(cellKey);
  return {
    ...input,
    cells,
    cellKeys,
    world: cells[0].world,
    createRunners(wiring: RunnerWiring): CellRunner[] {
      return input.cellDefinitions.map((def) => ({
        cellKey: cellKey(def.cell),
        cell: def.cell,
        run: (ctx: CellExecutionContext) => def.execute(ctx, wiring),
      }));
    },
  };
}

/**
 * Adapts a collector that still returns a FinalCellResult to the engine's
 * outcome contract, VALIDATING full result coherence before translating:
 * the final's identity must match the declared cell exactly, its attempts
 * must be present, terminal, and agree with the final status. Any incoherence
 * is a failed cell, never a green. (Interim adapter — engine-native executors
 * remove it; retained per instruction with full validation.)
 */
export function adaptFinalResult(declared: CellIdentity, final: FinalCellResult): CellOutcome {
  const declaredKey = cellKey(declared);
  const problems: string[] = [];
  if (final.cellKey !== declaredKey) {
    problems.push(`final.cellKey ${final.cellKey} != declared ${declaredKey}`);
  }
  if (cellKey(final.cell) !== declaredKey) {
    problems.push(`final.cell identity ${cellKey(final.cell)} != declared ${declaredKey}`);
  }
  if (final.attempts.length === 0) {
    problems.push("final carries no attempt history");
  }
  const last = final.attempts[final.attempts.length - 1];
  if (last && last.status !== final.status) {
    problems.push(`last attempt status ${last.status} != final status ${final.status}`);
  }
  for (const attempt of final.attempts) {
    if (attempt.cellKey !== declaredKey) {
      problems.push(`attempt ${attempt.attemptId} cellKey ${attempt.cellKey} != declared ${declaredKey}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`collector returned an incoherent final result: ${problems.join("; ")}`);
  }

  const detail = last?.detail ?? "";
  const correlationIds = last?.correlationIds ?? [];
  if (final.status === "green") return { correlationIds };
  if (final.status === "blocked") throw new CellBlockedError(detail || "blocked", correlationIds);
  if (final.status === "expected_fail") {
    throw new CellExpectedFailError(detail || "expected_fail", correlationIds);
  }
  throw new Error(detail || final.status);
}

/**
 * The collectors implemented on this branch. World adapters append their own
 * definitions as they land; the audit fails the build if this diverges from
 * the manifest.
 *
 * ALL THREE are foundation-partial today:
 *  - T2-AUTH-1: the spec covers the row's clauses BUT auth.spec.ts skips the
 *    fresh /setup claim when the reused profile DB is already claimed
 *    (conditional skip, shared tf-tier2 profile, no teardown reset). Until a
 *    run/shard-scoped fresh DB makes readiness require setup-open and the
 *    spec FAILS rather than skips, it is not qualification-safe.
 *  - T2-BILL-1: checkout-to-grant slice only, on superseded pro_period
 *    semantics.
 *  - LOCAL-2: one harness (claude) of the required matrix.
 */
export const COLLECTOR_DEFINITIONS: readonly CollectorDefinition[] = [
  defineCollector({
    scenarioId: "T2-AUTH-1",
    collectorRef: "src/foundation/worlds/tier2/cells/t2-auth-1.ts",
    coverage: "foundation-partial",
    gate: "merge",
    evidence:
      "Playwright JSON report of the T2-AUTH-1 spec against the booted tier-2 world; per-spec pass/fail bound to the cell attempt. NOT core: fresh-claim assertions conditionally skip on a reused/claimed profile DB",
    cellDefinitions: [
      {
        cell: T2_AUTH_1_CELL,
        async execute(ctx) {
          const final = await runT2Auth1Cell(ctx.world as InternalTier2WorldHandle, ctx.evidence);
          return adaptFinalResult(T2_AUTH_1_CELL, final);
        },
      },
    ],
  }),
  defineCollector({
    scenarioId: "T2-BILL-1",
    collectorRef: "src/foundation/worlds/tier2/cells/t2-bill-1.ts",
    coverage: "foundation-partial",
    gate: "merge",
    evidence:
      "Real Stripe test-mode subscription + invoice.paid webhook to grant, ledger-bound; blocked without an sk_test_ credential. NOT core: checkout-to-grant slice only, superseded pro_period semantics",
    cellDefinitions: [
      {
        cell: T2_BILL_1_CELL,
        async execute(ctx) {
          const handle = ctx.world as InternalTier2WorldHandle;
          const final = await runT2Bill1Cell(handle, ctx.evidence, ctx.ledger);
          return adaptFinalResult(T2_BILL_1_CELL, final);
        },
      },
    ],
  }),
  defineCollector({
    scenarioId: "LOCAL-2",
    collectorRef: "src/foundation/worlds/local-runtime/local-2.ts",
    coverage: "foundation-partial",
    gate: "release",
    evidence:
      "Managed-gateway turn with LiteLLM spend-log correlation under token_id, product usage event + balance reconcile, run-scoped cleanup. NOT core: one harness (claude) of the required matrix",
    cellDefinitions: [
      {
        cell: local2CellIdentity("claude"),
        async execute(ctx, wiring) {
          const worldCtx: WorldContext = {
            run: wiring.run,
            shard: wiring.shard,
            candidate: wiring.candidate,
            retained: wiring.retained,
            ledger: ctx.ledger,
            evidence: ctx.evidence,
          };
          const final = await runLocal2Cell(ctx.world as LocalRuntimeWorldHandle, worldCtx, {
            harness: "claude",
          });
          return adaptFinalResult(local2CellIdentity("claude"), final);
        },
      },
    ],
  }),
];

/** @deprecated import COLLECTOR_DEFINITIONS; kept so existing imports keep working. */
export const COLLECTOR_REGISTRY: readonly CollectorDefinition[] = COLLECTOR_DEFINITIONS;

/**
 * Materializes the executable CellRunners for every definition whose cells
 * intersect the selected plan. This is the production CLI's ONLY runner
 * source — runners and metadata always come from the same definitions.
 */
export function runnersForPlan(
  selectedCellKeys: ReadonlySet<string>,
  wiring: RunnerWiring,
  definitions: readonly CollectorDefinition[] = COLLECTOR_DEFINITIONS,
): CellRunner[] {
  const runners: CellRunner[] = [];
  for (const def of definitions) {
    if (!def.cellKeys.some((k) => selectedCellKeys.has(k))) continue;
    for (const runner of def.createRunners(wiring)) {
      if (selectedCellKeys.has(runner.cellKey)) runners.push(runner);
    }
  }
  return runners;
}
