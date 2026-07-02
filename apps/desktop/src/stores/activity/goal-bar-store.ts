import { create } from "zustand";

interface GoalBarState {
  /** The composer's "Set a goal" affordance opened the empty-state editor. */
  composing: boolean;
  /**
   * Identity of the sticky met/blocked/failed result the user dismissed.
   * A new goal (new updatedAtMs) produces a new key, so the bar returns.
   */
  dismissedResultKey: string | null;
  beginComposing: () => void;
  endComposing: () => void;
  dismissResult: (key: string) => void;
}

export const useGoalBarStore = create<GoalBarState>((set) => ({
  composing: false,
  dismissedResultKey: null,

  beginComposing: () => set({ composing: true }),

  endComposing: () => set({ composing: false }),

  dismissResult: (key) => set({ dismissedResultKey: key }),
}));

export function goalResultDismissKey(status: string, updatedAtMs: number): string {
  return `${status}:${updatedAtMs}`;
}
