/**
 * Collector definitions — the ONE canonical, executable inverse of the
 * scenario manifest.
 *
 * Each definition carries the exact cell identities its collector emits
 * (imported from the collector module, never hand-copied), a truthful
 * coverage classification, the gate that selects it, its evidence contract,
 * and the executable CellRunner binding the production CLI registers. The
 * audit (audit.ts) and the selectors (selectors.ts) consume THESE definitions;
 * there is no second metadata-only list to drift.
 *
 * Coverage is a claim about the MANIFEST ROW, not about the collector's own
 * health:
 *  - `core`               — the collector's code/test mapping covers the row's
 *                           complete required validation, so it may satisfy a
 *                           collected/enforced row.
 *  - `foundation-partial` — an honest vertical slice: real, evidence-bound,
 *                           diagnostic-valuable, but NARROWER than the row (or
 *                           testing superseded semantics). It can never satisfy
 *                           a collected/enforced row and never promotes the
 *                           guarantee (core-release-validation.md: presence is
 *                           not coverage; the ratchet stays honest).
 */

import { cellKey, type CellIdentity, type RunIdentity, type ShardIdentity, type WorldId } from "../contracts/identity.js";
import type { CandidateManifest, RetainedProductionManifest } from "../contracts/artifacts.js";
import type { WorldContext } from "../contracts/world.js";
import { CellBlockedError, CellExpectedFailError, type CellRunner } from "../runner/cell.js";
import { T2_AUTH_1_CELL, runT2Auth1Cell } from "../worlds/tier2/cells/t2-auth-1.js";
import { T2_BILL_1_CELL, runT2Bill1Cell } from "../worlds/tier2/cells/t2-bill-1.js";
import type { InternalTier2WorldHandle } from "../worlds/tier2/provisioner.js";
import { local2CellIdentity, runLocal2Cell } from "../worlds/local-runtime/local-2.js";
import type { LocalRuntimeWorldHandle } from "../contracts/world.js";

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

export interface CollectorDefinition {
  /** Manifest guarantee/journey id the collector proves (must exist in the manifest). */
  readonly scenarioId: string;
  /** The exact executable cell identities this collector emits finals for. */
  readonly cells: readonly CellIdentity[];
  /** Every cell key this collector produces a final result for. */
  readonly cellKeys: readonly string[];
  /** Repo-relative path to the collector source, for triage. */
  readonly collectorRef: string;
  /** Truthful row-coverage claim — see module docs. */
  readonly coverage: CollectorCoverage;
  /** Gate whose selector reaches this collector. */
  readonly gate: "merge" | "release";
  /** What the collector's evidence binds (human contract line, no secrets). */
  readonly evidence: string;
  readonly world: WorldId;
  /** Executable binding used by the real CLI runner registration. */
  createRunners(wiring: RunnerWiring): CellRunner[];
}

/** Back-compat alias: audit/selectors take the same definitions. */
export type CollectorRegistryEntry = CollectorDefinition;

function define(def: Omit<CollectorDefinition, "cellKeys">): CollectorDefinition {
  for (const cell of def.cells) {
    if (cell.scenarioId !== def.scenarioId) {
      throw new Error(
        `collector registry wiring bug: entry "${def.scenarioId}" contains a cell for "${cell.scenarioId}"`,
      );
    }
  }
  return { ...def, cellKeys: def.cells.map(cellKey) };
}

/**
 * The collectors implemented on this branch. World adapters append their own
 * definitions as they land; the audit fails the build if this diverges from
 * the manifest.
 */
export const COLLECTOR_DEFINITIONS: readonly CollectorDefinition[] = [
  define({
    scenarioId: "T2-AUTH-1",
    cells: [T2_AUTH_1_CELL],
    collectorRef: "src/foundation/worlds/tier2/cells/t2-auth-1.ts",
    // Code/test mapping vs the T2-AUTH-1 row ("Fresh /setup claim, password
    // login, logout, relogin, wrong-password rejection, and permanent
    // second-claim rejection"): tests/intent/specs/auth.spec.ts "T2-AUTH-1"
    // describe covers claim + already-claimed revisit, permanent second-claim
    // rejection, password login, wrong-password rejection, and logout +
    // re-login. Every clause of the row maps to an executed assertion, so the
    // collector itself is core. The MANIFEST row stays `planned` until the
    // status flip is made deliberately; the audit reports this visibly as a
    // planned-core collector rather than hiding it behind "OK".
    coverage: "core",
    gate: "merge",
    evidence: "Playwright JSON report of the T2-AUTH-1 spec against the booted tier-2 world; per-spec pass/fail bound to the cell attempt",
    world: "tier-2",
    createRunners: () => [
      {
        cellKey: cellKey(T2_AUTH_1_CELL),
        cell: T2_AUTH_1_CELL,
        async run(ctx) {
          const final = await runT2Auth1Cell(ctx.world as InternalTier2WorldHandle, ctx.evidence);
          return finalToOutcome(final);
        },
      },
    ],
  }),
  define({
    scenarioId: "T2-BILL-1",
    cells: [T2_BILL_1_CELL],
    collectorRef: "src/foundation/worlds/tier2/cells/t2-bill-1.ts",
    // Explicitly narrower than the T2-BILL-1 row (checkout-to-grant slice
    // only; no consumption/cutoff/top-up/recovery) AND currently exercising
    // the superseded pro_period/hours grant semantics rather than the settled
    // $2 free / $5+$15 Core policy. It can never satisfy the core row.
    coverage: "foundation-partial",
    gate: "merge",
    evidence: "Real Stripe test-mode subscription + invoice.paid webhook to grant, ledger-bound; blocked without an sk_test_ credential",
    world: "tier-2",
    createRunners: () => [
      {
        cellKey: cellKey(T2_BILL_1_CELL),
        cell: T2_BILL_1_CELL,
        async run(ctx) {
          const handle = ctx.world as InternalTier2WorldHandle;
          const final = await runT2Bill1Cell(handle, ctx.evidence, ctx.ledger);
          return finalToOutcome(final);
        },
      },
    ],
  }),
  define({
    scenarioId: "LOCAL-2",
    cells: [local2CellIdentity("claude")],
    collectorRef: "src/foundation/worlds/local-runtime/local-2.ts",
    // One harness (claude) of LOCAL-2's every-supported-harness matrix — a
    // real managed-gateway turn with LiteLLM spend correlation, but one cell
    // of the journey's required matrix, so foundation-partial.
    coverage: "foundation-partial",
    gate: "release",
    evidence: "Managed-gateway turn with LiteLLM spend-log correlation under token_id, product usage event + balance reconcile, run-scoped cleanup",
    world: "local-runtime",
    createRunners: (wiring) => [
      {
        cellKey: cellKey(local2CellIdentity("claude")),
        cell: local2CellIdentity("claude"),
        async run(ctx) {
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
          return finalToOutcome(final);
        },
      },
    ],
  }),
];

/** @deprecated import COLLECTOR_DEFINITIONS; kept so existing imports keep working. */
export const COLLECTOR_REGISTRY: readonly CollectorDefinition[] = COLLECTOR_DEFINITIONS;

/**
 * Adapts a collector's FinalCellResult to the engine CellRunner outcome
 * contract: green returns, blocked/expected_fail/failed re-throw so the engine
 * records the correct non-green attempt status.
 */
function finalToOutcome(final: {
  readonly status: string;
  readonly attempts: readonly { readonly detail: string; readonly correlationIds: readonly string[] }[];
}): { correlationIds: readonly string[] } {
  const last = final.attempts[final.attempts.length - 1];
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
 * Materializes the executable CellRunners for every definition whose cells
 * intersect the selected plan. This is the production CLI's default runner
 * registry — the CLI is never left empty when canonical executable
 * definitions exist.
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
