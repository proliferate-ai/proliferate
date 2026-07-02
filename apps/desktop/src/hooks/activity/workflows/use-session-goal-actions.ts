import { useCallback, useMemo } from "react";
import type { GoalWire } from "@proliferate/product-domain/activity/goal";
import { goalResultDismissKey, useGoalBarStore } from "@/stores/activity/goal-bar-store";

export interface SessionGoalActions {
  editGoal: (objective: string) => void;
  pauseGoal: () => void;
  resumeGoal: () => void;
  clearGoal: () => void;
  dismissResult: () => void;
  beginComposing: () => void;
  cancelComposing: () => void;
}

/**
 * STUB — goal mutations are not wired yet. Goals are strict mirrors of
 * native harness state: every mutation below must go through the AnyHarness
 * goal ops (`_anyharness/goal/set|clear` via the runtime), and the bar only
 * reflects the change when the native GoalUpdated/GoalMet/GoalCleared
 * notification round-trips — no optimistic saved-state. The integration
 * pass replaces the no-op bodies with those runtime calls (plus a
 * pending-write flag threaded into GoalBar).
 *
 * Dismissal and compose-mode are client-only UI state and are fully wired.
 */
export function useSessionGoalActions(goal: GoalWire | null): SessionGoalActions {
  const beginComposing = useGoalBarStore((state) => state.beginComposing);
  const endComposing = useGoalBarStore((state) => state.endComposing);
  const dismissResultInStore = useGoalBarStore((state) => state.dismissResult);

  const editGoal = useCallback((_objective: string) => {
    endComposing();
  }, [endComposing]);

  const pauseGoal = useCallback(() => {}, []);

  const resumeGoal = useCallback(() => {}, []);

  const clearGoal = useCallback(() => {}, []);

  const dismissResult = useCallback(() => {
    if (!goal) {
      return;
    }
    dismissResultInStore(goalResultDismissKey(goal.status, goal.updatedAtMs));
  }, [dismissResultInStore, goal]);

  return useMemo(() => ({
    editGoal,
    pauseGoal,
    resumeGoal,
    clearGoal,
    dismissResult,
    beginComposing,
    cancelComposing: endComposing,
  }), [
    beginComposing,
    clearGoal,
    dismissResult,
    editGoal,
    endComposing,
    pauseGoal,
    resumeGoal,
  ]);
}
