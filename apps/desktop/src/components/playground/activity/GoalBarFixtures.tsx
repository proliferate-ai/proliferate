import type { ReactNode } from "react";
import { GoalBar } from "@proliferate/product-ui/activity/GoalBar";
import type { ScenarioKey } from "@/config/playground";
import {
  GOAL_ACTIVE_LONG,
  GOAL_ACTIVE_SHORT,
  GOAL_BLOCKED,
  GOAL_CAPABILITIES_NO_PAUSE,
  GOAL_CAPABILITIES_PAUSABLE,
  GOAL_FAILED_BUDGET,
  GOAL_MET,
  GOAL_PAUSED,
} from "@/lib/domain/chat/__fixtures__/playground/goal-fixtures";

const NOOP = () => {};

/**
 * Every goal bar state from static fixtures: live pursuing (short/long
 * objective, pause enabled/disabled), paused, in-place editing, empty-state
 * composing, the three sticky results, and the dismissed/empty state
 * (`goal-empty` renders no bar by design).
 */
export function renderGoalBarSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "goal-active-short":
      return (
        <PlaygroundGoalBar goal={GOAL_ACTIVE_SHORT} pausable />
      );
    case "goal-active-long":
      return (
        <PlaygroundGoalBar goal={GOAL_ACTIVE_LONG} pausable />
      );
    case "goal-active-pause-disabled":
      return (
        <PlaygroundGoalBar goal={GOAL_ACTIVE_SHORT} pausable={false} />
      );
    case "goal-paused":
      return (
        <PlaygroundGoalBar goal={GOAL_PAUSED} pausable />
      );
    case "goal-editing":
      return (
        <PlaygroundGoalBar goal={GOAL_ACTIVE_SHORT} pausable defaultEditing />
      );
    case "goal-composing":
      return (
        <PlaygroundGoalBar goal={null} pausable composing />
      );
    case "goal-met-sticky":
      return (
        <PlaygroundGoalBar goal={GOAL_MET} pausable={false} />
      );
    case "goal-blocked-sticky":
      return (
        <PlaygroundGoalBar goal={GOAL_BLOCKED} pausable />
      );
    case "goal-failed-budget":
      return (
        <PlaygroundGoalBar goal={GOAL_FAILED_BUDGET} pausable />
      );
    case "goal-empty":
      return null;
    default:
      return null;
  }
}

function PlaygroundGoalBar({
  goal,
  pausable,
  composing = false,
  defaultEditing = false,
}: {
  goal: Parameters<typeof GoalBar>[0]["goal"];
  pausable: boolean;
  composing?: boolean;
  defaultEditing?: boolean;
}) {
  return (
    <GoalBar
      goal={goal}
      capabilities={pausable ? GOAL_CAPABILITIES_PAUSABLE : GOAL_CAPABILITIES_NO_PAUSE}
      composing={composing}
      defaultEditing={defaultEditing}
      onEdit={NOOP}
      onPause={NOOP}
      onResume={NOOP}
      onClear={NOOP}
      onDismiss={NOOP}
      onCancelCompose={NOOP}
    />
  );
}
