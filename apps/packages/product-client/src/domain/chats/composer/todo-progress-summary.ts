import type { PlanEntry } from "@anyharness/sdk";

export interface TodoProgressSummary {
  completedCount: number;
  total: number;
  /** 1-based index of the step currently being worked (or the last step once everything is done). */
  currentStepNumber: number;
  /** "Step N/Total" — the pill's label copy. */
  label: string;
}

/**
 * Reduces a plan's entries to the pill's "Step N/Total" summary. Returns
 * `null` for an empty plan (mirrors `deriveActiveTodoTracker`, which never
 * hands back a tracker with zero entries).
 */
export function summarizeTodoProgress(entries: PlanEntry[]): TodoProgressSummary | null {
  const total = entries.length;
  if (total === 0) {
    return null;
  }

  const completedCount = entries.filter((entry) => entry.status === "completed").length;
  const currentStepNumber = Math.min(completedCount + 1, total);

  return {
    completedCount,
    total,
    currentStepNumber,
    label: `Step ${currentStepNumber}/${total}`,
  };
}

/**
 * The pill only appears on a step *advancing* — never on a tracker's first
 * appearance (matches the design's "nothing is shown by default"). A
 * `previous` of `null` therefore never counts as an advance.
 */
export function hasTodoStepAdvanced(
  previous: TodoProgressSummary | null,
  next: TodoProgressSummary | null,
): boolean {
  if (!previous || !next) {
    return false;
  }
  return next.currentStepNumber !== previous.currentStepNumber || next.total !== previous.total;
}
