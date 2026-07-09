import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  deriveGoalBarState,
  type GoalCapabilities,
  type GoalWire,
} from "@proliferate/product-domain/activity/goal";
import { resolveGoalFixture } from "@/lib/domain/chat/__fixtures__/playground/goal-fixtures";
import {
  goalCapabilitiesForSession,
  goalWireFromMirror,
} from "@/lib/domain/sessions/goal-mirror";
import { useActiveSessionId } from "@/hooks/chat/derived/use-active-session-identity";
import {
  goalResultDismissKey,
  selectComposing,
  selectDismissedResultKey,
  selectPendingGoal,
  useGoalBarStore,
  type PendingGoalEntry,
} from "@/stores/activity/goal-bar-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

export interface SessionGoalState {
  goal: GoalWire | null;
  capabilities: GoalCapabilities;
}

/**
 * The active session's mirrored goal + goal capability flags, read from the
 * session directory slot (seeded by session summaries, transitioned by the
 * runtime's goal_updated/goal_met/goal_cleared stream events — confirmed
 * native state only, never optimistic). In dev builds
 * `VITE_PROLIFERATE_GOAL_FIXTURE=<key>` overrides with a fixture goal (keys
 * in lib/domain/chat/__fixtures__/playground/goal-fixtures.ts).
 */
export function useSessionGoal(): SessionGoalState | null {
  const activeSessionId = useActiveSessionId();
  const slot = useSessionDirectoryStore(useShallow((state) => {
    const entry = activeSessionId ? state.entriesById[activeSessionId] ?? null : null;
    if (!entry) {
      return null;
    }
    return {
      activeGoal: entry.activeGoal,
      actionCapabilities: entry.actionCapabilities,
      agentKind: entry.agentKind,
    };
  }));

  return useMemo(() => {
    if (import.meta.env.DEV) {
      const fixture = resolveGoalFixture(import.meta.env.VITE_PROLIFERATE_GOAL_FIXTURE);
      if (fixture) {
        return fixture;
      }
    }
    if (!slot) {
      return null;
    }
    return {
      goal: slot.activeGoal ? goalWireFromMirror(slot.activeGoal) : null,
      capabilities: goalCapabilitiesForSession(slot.actionCapabilities, slot.agentKind),
    };
  }, [slot]);
}

export interface SessionGoalBarModel {
  goal: GoalWire | null;
  capabilities: GoalCapabilities;
  composing: boolean;
  /**
   * The goal is a client-side provisional pending entry (submitted but not yet
   * confirmed by the native mirror). The bar renders the live row with the
   * pendingWrite treatment (dimmed, pointer-events-none) until the stream
   * confirms.
   */
  provisional: boolean;
}

/**
 * Synthesize a provisional `GoalWire` from a pending entry. This is the
 * client-side stand-in that keeps the bar visible between the HTTP submit and
 * the stream's `goal_updated` event confirming the mirror.
 */
function provisionalGoalFromPending(entry: PendingGoalEntry): GoalWire {
  return {
    objective: entry.objective,
    status: "active",
    nativeStatus: "pending_injection",
    tokenBudget: null,
    tokensUsed: null,
    timeUsedSeconds: null,
    metReason: null,
    iterations: null,
    native: true,
    updatedAtMs: entry.submittedAtMs,
  };
}

/**
 * UI-ready model for the composer-docked goal bar: null whenever the bar has
 * nothing to show (no goal support, no live state, dismissed sticky result)
 * so the dock resolver and the bar renderer share one visibility answer.
 *
 * Pending-layer lifecycle (lazy-ignore strategy):
 * - SET: immediately on submit in `editGoal` (before mutation fires).
 * - IGNORE: whenever the mirror has a live goal (`barState.kind === "live"`),
 *   the pending entry is simply ignored — the real thing wins. The stale
 *   pending entry is overwritten on the next submit; no explicit clear needed.
 * - CLEAR: on mutation failure (`.catch` in `editGoal`).
 *
 * This avoids clearing during render (which would violate React rules) and
 * avoids a race between `.then()` and the stream event. A stale pending entry
 * that is never cleared is harmless: it's always superseded by a live mirror
 * goal and overwritten on the next submit.
 */
export function useSessionGoalBarModel(): SessionGoalBarModel | null {
  const activeSessionId = useActiveSessionId();
  const sessionGoal = useSessionGoal();
  const composing = useGoalBarStore((state) => selectComposing(state, activeSessionId));
  const dismissedResultKey = useGoalBarStore((state) =>
    selectDismissedResultKey(state, activeSessionId),
  );
  const pendingGoal = useGoalBarStore((state) => selectPendingGoal(state, activeSessionId));

  if (!sessionGoal || !sessionGoal.capabilities.supported) {
    return null;
  }
  const { goal, capabilities } = sessionGoal;
  const barState = deriveGoalBarState(goal);

  // Mirror has a live goal — it always wins over any pending entry.
  if (barState.kind === "live") {
    return { goal, capabilities, composing, provisional: false };
  }

  // No live mirror goal, but a pending entry exists — render provisional.
  if (barState.kind === "hidden" && !composing && pendingGoal) {
    return {
      goal: provisionalGoalFromPending(pendingGoal),
      capabilities,
      composing: false,
      provisional: true,
    };
  }

  if (barState.kind === "hidden" && !composing) {
    return null;
  }
  if (
    barState.kind === "result"
    && goal
    && !composing
    && dismissedResultKey === goalResultDismissKey(goal.status, goal.updatedAtMs)
  ) {
    // Dismissed result but pending entry exists — show provisional instead of null.
    if (pendingGoal) {
      return {
        goal: provisionalGoalFromPending(pendingGoal),
        capabilities,
        composing: false,
        provisional: true,
      };
    }
    return null;
  }
  return { goal, capabilities, composing, provisional: false };
}
