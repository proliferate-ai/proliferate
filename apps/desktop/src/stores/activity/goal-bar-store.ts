import { create } from "zustand";

export interface PendingGoalEntry {
  objective: string;
  submittedAtMs: number;
}

interface GoalBarState {
  /**
   * Per-session compose flag: the composer's "Set a goal" affordance opened
   * the empty-state editor for that session. Keyed by client session id so
   * opening compose on one session tab never leaks the editor onto another.
   */
  composingBySessionId: Record<string, boolean>;
  /**
   * Per-session identity of the sticky met/blocked/failed result the user
   * dismissed. A new goal (new updatedAtMs) produces a new key, so the bar
   * returns. Keyed by client session id so a dismissal on one session cannot
   * suppress another session's result.
   */
  dismissedResultKeyBySessionId: Record<string, string | null>;
  /**
   * Per-session provisional pending goal: set immediately on submit (before
   * the native round-trip) so the bar can render a provisional live row while
   * the mirror is still null. Cleared when the mirror's live goal arrives
   * (lazy-ignore in the bar model) or on mutation failure. This is client-only
   * UI state — it never writes to the session directory slot / mirror stores.
   */
  pendingGoalBySessionId: Record<string, PendingGoalEntry | null>;
  beginComposing: (sessionId: string) => void;
  endComposing: (sessionId: string) => void;
  dismissResult: (sessionId: string, key: string) => void;
  setPendingGoal: (sessionId: string, objective: string) => void;
  clearPendingGoal: (sessionId: string) => void;
}

export const useGoalBarStore = create<GoalBarState>((set) => ({
  composingBySessionId: {},
  dismissedResultKeyBySessionId: {},
  pendingGoalBySessionId: {},

  beginComposing: (sessionId) =>
    set((state) => ({
      composingBySessionId: { ...state.composingBySessionId, [sessionId]: true },
    })),

  endComposing: (sessionId) =>
    set((state) => ({
      composingBySessionId: { ...state.composingBySessionId, [sessionId]: false },
    })),

  dismissResult: (sessionId, key) =>
    set((state) => ({
      dismissedResultKeyBySessionId: {
        ...state.dismissedResultKeyBySessionId,
        [sessionId]: key,
      },
    })),

  setPendingGoal: (sessionId, objective) =>
    set((state) => ({
      pendingGoalBySessionId: {
        ...state.pendingGoalBySessionId,
        [sessionId]: { objective, submittedAtMs: Date.now() },
      },
    })),

  clearPendingGoal: (sessionId) =>
    set((state) => ({
      pendingGoalBySessionId: {
        ...state.pendingGoalBySessionId,
        [sessionId]: null,
      },
    })),
}));

/** Whether the given session's empty-state goal editor is open. */
export function selectComposing(state: GoalBarState, sessionId: string | null): boolean {
  return sessionId ? state.composingBySessionId[sessionId] ?? false : false;
}

/** The dismissed sticky-result key for the given session, if any. */
export function selectDismissedResultKey(
  state: GoalBarState,
  sessionId: string | null,
): string | null {
  return sessionId ? state.dismissedResultKeyBySessionId[sessionId] ?? null : null;
}

export function goalResultDismissKey(status: string, updatedAtMs: number): string {
  return `${status}:${updatedAtMs}`;
}

/** The pending provisional goal for the given session, if any. */
export function selectPendingGoal(
  state: GoalBarState,
  sessionId: string | null,
): PendingGoalEntry | null {
  return sessionId ? state.pendingGoalBySessionId[sessionId] ?? null : null;
}
