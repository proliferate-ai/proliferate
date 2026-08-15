import type {
  PlanEntry,
  PlanItem,
  TranscriptState,
} from "@anyharness/sdk";

export interface ActiveTodoTracker {
  entries: PlanEntry[];
}

/**
 * The live todo list the progress pill tracks: the latest in-progress `plan`
 * item with entries, from any agent.
 *
 * Deliberately NOT `deriveCanonicalPlan`: that derivation feeds the formal
 * plan UI and excludes Claude's TodoWrite items as internal task tracking.
 * Internal task tracking is exactly what the pill surfaces, so it reads the
 * plan items directly — a Claude session's TodoWrite progress counts the same
 * as a structured plan from any other agent.
 */
export function deriveActiveTodoTracker(
  transcript: TranscriptState,
): ActiveTodoTracker | null {
  let latest: PlanItem | null = null;
  for (const item of Object.values(transcript.itemsById)) {
    if (item.kind !== "plan" || item.entries.length === 0) {
      continue;
    }
    if (
      !latest
      || item.startedSeq > latest.startedSeq
      || (item.startedSeq === latest.startedSeq && item.lastUpdatedSeq > latest.lastUpdatedSeq)
    ) {
      latest = item;
    }
  }

  if (!latest || latest.status !== "in_progress") {
    return null;
  }

  return { entries: latest.entries };
}
