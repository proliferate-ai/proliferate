import { useMemo } from "react";
import { deriveActivityChips, type ActivityChipDescriptor } from "@proliferate/product-domain/activity/chips";
import { useSessionActivity } from "./use-session-activity";

/**
 * The active session's activity chip descriptors — used by dock-slot
 * visibility resolution so the composer-docked bar mounts for live activity
 * even with no goal set. `SessionActivityBar` recomputes the same chips from
 * `useSessionActivity` for rendering; this hook exists so visibility
 * resolution doesn't need the full roster payload.
 */
export function useSessionActivityChips(): ActivityChipDescriptor[] {
  const activity = useSessionActivity();
  return useMemo(() => deriveActivityChips({
    loops: activity.loops,
    processes: activity.processes,
    agents: activity.agents,
  }), [activity.loops, activity.processes, activity.agents]);
}
