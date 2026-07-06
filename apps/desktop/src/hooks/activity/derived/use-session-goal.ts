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
  useGoalBarStore,
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
}

/**
 * UI-ready model for the composer-docked goal bar: null whenever the bar has
 * nothing to show (no goal support, no live state, dismissed sticky result)
 * so the dock resolver and the bar renderer share one visibility answer.
 */
export function useSessionGoalBarModel(): SessionGoalBarModel | null {
  const activeSessionId = useActiveSessionId();
  const sessionGoal = useSessionGoal();
  const composing = useGoalBarStore((state) => selectComposing(state, activeSessionId));
  const dismissedResultKey = useGoalBarStore((state) =>
    selectDismissedResultKey(state, activeSessionId),
  );
  if (!sessionGoal || !sessionGoal.capabilities.supported) {
    return null;
  }
  const { goal, capabilities } = sessionGoal;
  const barState = deriveGoalBarState(goal);
  if (barState.kind === "hidden" && !composing) {
    return null;
  }
  if (
    barState.kind === "result"
    && goal
    && !composing
    && dismissedResultKey === goalResultDismissKey(goal.status, goal.updatedAtMs)
  ) {
    return null;
  }
  return { goal, capabilities, composing };
}
