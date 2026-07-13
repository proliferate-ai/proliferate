/**
 * Diagnostic and strict result evaluation — the one place the pass/fail rule
 * lives. World adapters and CI consume the verdict; they never reimplement it.
 *
 * Two scopes:
 *  - `evaluateRun` evaluates ONE shard's own view. Shard evidence is a
 *    nonqualifying aggregate input by contract: even a perfect single shard
 *    cannot claim qualification — the cross-shard aggregate
 *    (contracts/aggregate.ts `evaluateAggregate`) is the only qualifying path,
 *    including for one-shard runs, which aggregate their single document.
 *  - `evaluateCells` is the shared cell-set core both scopes use.
 */

import type { EvaluationInput, FinalCellResult, RunEvaluation } from "./results.js";
import type { SelectedCellPlan } from "./plan.js";

export interface CellEvaluationInput {
  readonly plan: SelectedCellPlan;
  readonly finals: readonly FinalCellResult[];
  readonly preflightComplete: boolean;
  readonly cleanupComplete: boolean;
  readonly dryRun: boolean;
  readonly previousBlockedCellKeys?: readonly string[];
}

export function evaluateCells(input: CellEvaluationInput): RunEvaluation {
  const { plan, finals, dryRun } = input;
  const behavior = plan.behavior;
  const required = plan.cells.filter((c) => c.disposition === "required");
  const requiredKeys = new Set(required.map((c) => c.cellKey));
  const legacyKeys = new Set(plan.cells.filter((c) => c.legacy).map((c) => c.cellKey));

  const finalsByKey = new Map<string, FinalCellResult[]>();
  for (const final of finals) {
    const list = finalsByKey.get(final.cellKey) ?? [];
    list.push(final);
    finalsByKey.set(final.cellKey, list);
  }

  const missingCellKeys: string[] = [];
  const duplicateCellKeys: string[] = [];
  const nonGreenCellKeys: string[] = [];
  for (const key of requiredKeys) {
    const results = finalsByKey.get(key) ?? [];
    if (results.length === 0) {
      missingCellKeys.push(key);
    } else if (results.length > 1) {
      duplicateCellKeys.push(key);
    } else if (results[0].status !== "green") {
      nonGreenCellKeys.push(key);
    }
  }

  // A final result for a cell that was never selected is a collector bug.
  const unknownFinalKeys = [...finalsByKey.keys()].filter(
    (key) => !plan.cells.some((c) => c.cellKey === key),
  );

  const blockedNow = new Set(
    finals.filter((f) => f.status === "blocked").map((f) => f.cellKey),
  );
  const previousBlocked = new Set(input.previousBlockedCellKeys ?? []);
  const newlyBlockedCellKeys = [...blockedNow].filter((k) => !previousBlocked.has(k));

  const reasons: string[] = [];
  if (dryRun) reasons.push("dry-run/planning cannot emit green product evidence");
  if (behavior === "diagnostic") reasons.push("diagnostic evidence is always nonqualifying");
  if (required.length === 0) {
    // An empty selection can never qualify: a plan that requires nothing has
    // proved nothing, whatever selector produced it.
    reasons.push("plan selects zero required cells; an empty selection cannot qualify");
  }
  if (plan.scenarioManifestHash === null && (plan.selector === "release" || plan.selector === "merge")) {
    reasons.push(
      `selector "${plan.selector}" requires binding to the scenario manifest hash; none was resolved`,
    );
  }
  if (missingCellKeys.length > 0) reasons.push(`missing final results: ${missingCellKeys.join(", ")}`);
  if (duplicateCellKeys.length > 0) reasons.push(`duplicate final results: ${duplicateCellKeys.join(", ")}`);
  if (nonGreenCellKeys.length > 0) reasons.push(`non-green required cells: ${nonGreenCellKeys.join(", ")}`);
  if (unknownFinalKeys.length > 0) reasons.push(`results for unselected cells: ${unknownFinalKeys.join(", ")}`);
  if (!input.preflightComplete && behavior === "strict") {
    reasons.push("strict preflight incomplete: missing credentials can never produce green strict evidence");
  }
  if (!input.cleanupComplete) reasons.push("cleanup reconciliation incomplete");
  const qualifiedLegacy = [...requiredKeys].filter((k) => legacyKeys.has(k));
  if (qualifiedLegacy.length > 0) {
    reasons.push(`legacy collectors selected as required (diagnostic-only): ${qualifiedLegacy.join(", ")}`);
  }

  const base = { missingCellKeys, duplicateCellKeys, nonGreenCellKeys, newlyBlockedCellKeys };
  if (reasons.length > 0) {
    return { behavior, verdict: { qualifying: false, reasons }, ...base };
  }
  // "full" is reserved for full core-release qualification: the release
  // selector with no deferred Tier 3 guarantees. Any explicit/subset selector
  // is a foundation baseline and stays "partial" no matter how green it is.
  const label =
    plan.selector === "release" && plan.deferredScenarioIds.length === 0 ? "full" : "partial";
  return { behavior, verdict: { qualifying: true, label }, ...base };
}

/**
 * Shard-scope evaluation. Never qualifying: a shard document is an input to
 * the aggregate, not a qualification claim. A would-be-green shard reports
 * its cell health through the reason string so diagnostics stay readable.
 */
/**
 * The one intentional nonqualifying reason a healthy shard carries. Strict
 * shard exit codes ignore exactly this marker and fail on everything else.
 */
export const SHARD_SCOPE_NONQUALIFYING_REASON =
  "shard-scope evaluation is a nonqualifying aggregate input; qualification requires the cross-shard aggregate (all shards green: this shard contributes green finals)";

export function evaluateRun(input: EvaluationInput): RunEvaluation {
  const cellEval = evaluateCells({
    plan: input.plan,
    finals: input.finals,
    preflightComplete: input.preflight.complete,
    cleanupComplete: input.cleanup.complete,
    dryRun: input.dryRun,
    previousBlockedCellKeys: input.previousBlockedCellKeys,
  });
  if (cellEval.verdict.qualifying === false) return cellEval;
  return {
    ...cellEval,
    verdict: {
      qualifying: false,
      reasons: [SHARD_SCOPE_NONQUALIFYING_REASON],
    },
  };
}
