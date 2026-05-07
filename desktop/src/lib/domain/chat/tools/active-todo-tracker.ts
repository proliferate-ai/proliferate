import {
  deriveCanonicalPlan,
  type PlanEntry,
  type TranscriptState,
} from "@anyharness/sdk";

export interface ActiveTodoTracker {
  entries: PlanEntry[];
}

export function deriveActiveTodoTracker(
  transcript: TranscriptState,
): ActiveTodoTracker | null {
  const canonicalPlan = deriveCanonicalPlan(transcript);
  if (!canonicalPlan || !canonicalPlan.isActive) {
    return null;
  }

  if (canonicalPlan.sourceKind !== "structured_plan") {
    return null;
  }

  if (canonicalPlan.entries.length === 0) {
    return null;
  }

  return {
    entries: canonicalPlan.entries,
  };
}
