import { useMemo } from "react";
import { deriveActivityChips } from "#product/domain/activity/chips";
import {
  deriveBackgroundWorkRowCounts,
  type BackgroundWorkRowCounts,
} from "#product/domain/activity/background-work-row";
import { useSessionActivity } from "#product/hooks/activity/derived/use-session-activity";

/**
 * `BackgroundWorkTranscriptRow`'s live counts for the active session: running
 * processes + running native subagents, and processes that finished but
 * remain roster-inspectable. Reads the same roster `useSessionActivity`
 * feeds `SessionActivityBar` (armed loops are descoped for this row — see
 * `deriveBackgroundWorkRowCounts`).
 */
export function useBackgroundWorkRowCounts(): BackgroundWorkRowCounts {
  const activity = useSessionActivity();
  return useMemo(() => deriveBackgroundWorkRowCounts(deriveActivityChips({
    loops: activity.loops,
    processes: activity.processes,
    agents: activity.agents,
  })), [activity.loops, activity.processes, activity.agents]);
}
