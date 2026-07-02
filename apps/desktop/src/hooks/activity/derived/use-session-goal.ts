import {
  deriveGoalBarState,
  type GoalCapabilities,
  type GoalWire,
} from "@proliferate/product-domain/activity/goal";
import { resolveGoalFixture } from "@/lib/domain/chat/__fixtures__/playground/goal-fixtures";
import { goalResultDismissKey, useGoalBarStore } from "@/stores/activity/goal-bar-store";

export interface SessionGoalState {
  goal: GoalWire | null;
  capabilities: GoalCapabilities;
}

/**
 * STUB — fixture-backed until the goals mirror is live.
 *
 * Live wiring (integration pass): read the active session's mirrored goal +
 * goal capability flags from the AnyHarness SDK session view
 * (SessionView.activity.goal / SessionActionCapabilities.supports_goals with
 * the pause flag from the harness capability advertisement) via an access
 * hook, keyed by the active session id. Until then this returns null in
 * production; in dev builds `VITE_PROLIFERATE_GOAL_FIXTURE=<key>` renders a
 * fixture goal (keys in lib/domain/chat/__fixtures__/playground/goal-fixtures.ts).
 */
export function useSessionGoal(): SessionGoalState | null {
  if (!import.meta.env.DEV) {
    return null;
  }
  const fixture = resolveGoalFixture(import.meta.env.VITE_PROLIFERATE_GOAL_FIXTURE);
  return fixture ?? null;
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
  const sessionGoal = useSessionGoal();
  const composing = useGoalBarStore((state) => state.composing);
  const dismissedResultKey = useGoalBarStore((state) => state.dismissedResultKey);
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
    && dismissedResultKey === goalResultDismissKey(goal.status, goal.updatedAtMs)
  ) {
    return null;
  }
  return { goal, capabilities, composing };
}
