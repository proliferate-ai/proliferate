import { useCallback, useMemo } from "react";
import type { LoopArmInput } from "@proliferate/product-ui/activity/LoopsPanel";

export interface SessionLoopActions {
  armLoop: (input: LoopArmInput) => void;
  deleteLoop: (loopId: string) => void;
  /** A loop mutation is in flight awaiting the native round-trip. */
  pendingWrite: boolean;
}

/**
 * STUB — loop mutations are not wired yet (no `_anyharness/loop/set|clear`
 * write path on the runtime side in this PR; see goals-b/02-runtime). Loops
 * are strict mirrors where native (Claude session crons) and
 * runtime-emulated where not (Codex, `native: false`) — every mutation below
 * must eventually go through the AnyHarness loop ops, and the panel only
 * reflects a change once the matching `loop_upserted`/`loop_removed`
 * notification round-trips, no optimistic state. The integration pass
 * replaces the no-op bodies with those runtime calls (plus a pending-write
 * flag threaded into `LoopsPanel`, same shape as `useSessionGoalActions`).
 */
export function useSessionLoopActions(): SessionLoopActions {
  const armLoop = useCallback((_input: LoopArmInput) => {}, []);
  const deleteLoop = useCallback((_loopId: string) => {}, []);

  return useMemo(() => ({
    armLoop,
    deleteLoop,
    pendingWrite: false,
  }), [armLoop, deleteLoop]);
}
