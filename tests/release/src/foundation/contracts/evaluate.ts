/**
 * Diagnostic and strict result evaluation — the one place the pass/fail rule
 * lives. World adapters and CI consume the verdict; they never reimplement it.
 */

import type { EvaluationInput, FinalCellResult, RunEvaluation } from "./results.js";

export function evaluateRun(input: EvaluationInput): RunEvaluation {
  const { plan, finals, cleanup, dryRun } = input;
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
  if (missingCellKeys.length > 0) reasons.push(`missing final results: ${missingCellKeys.join(", ")}`);
  if (duplicateCellKeys.length > 0) reasons.push(`duplicate final results: ${duplicateCellKeys.join(", ")}`);
  if (nonGreenCellKeys.length > 0) reasons.push(`non-green required cells: ${nonGreenCellKeys.join(", ")}`);
  if (unknownFinalKeys.length > 0) reasons.push(`results for unselected cells: ${unknownFinalKeys.join(", ")}`);
  if (!input.preflight.complete && behavior === "strict") {
    reasons.push("strict preflight incomplete: missing credentials can never produce green strict evidence");
  }
  if (!cleanup.complete) reasons.push("cleanup reconciliation incomplete");
  const qualifiedLegacy = [...requiredKeys].filter((k) => legacyKeys.has(k));
  if (qualifiedLegacy.length > 0) {
    reasons.push(`legacy collectors selected as required (diagnostic-only): ${qualifiedLegacy.join(", ")}`);
  }

  const base = { missingCellKeys, duplicateCellKeys, nonGreenCellKeys, newlyBlockedCellKeys };
  if (reasons.length > 0) {
    return { behavior: behavior, verdict: { qualifying: false, reasons }, ...base };
  }
  const label = plan.deferredScenarioIds.length > 0 ? "partial" : "full";
  return { behavior: behavior, verdict: { qualifying: true, label }, ...base };
}
