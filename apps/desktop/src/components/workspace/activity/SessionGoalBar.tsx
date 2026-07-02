import { GoalBar } from "@proliferate/product-ui/activity/GoalBar";
import { useSessionGoalBarModel } from "@/hooks/activity/derived/use-session-goal";
import { useSessionGoalActions } from "@/hooks/activity/workflows/use-session-goal-actions";

/**
 * Connected goal bar for the composer dock: the mirrored session goal from
 * `useSessionGoalBarModel` (fixture-backed stub until the goals mirror is
 * live) rendered through the shared `GoalBar`. Mounted by
 * `useComposerDockSlots` as the last attached-slot inhabitant so it docks
 * directly against the composer surface.
 */
export function SessionGoalBar() {
  const model = useSessionGoalBarModel();
  const actions = useSessionGoalActions(model?.goal ?? null);
  if (!model) {
    return null;
  }
  return (
    <GoalBar
      goal={model.goal}
      capabilities={model.capabilities}
      composing={model.composing}
      onEdit={actions.editGoal}
      onPause={actions.pauseGoal}
      onResume={actions.resumeGoal}
      onClear={actions.clearGoal}
      onDismiss={actions.dismissResult}
      onCancelCompose={actions.cancelComposing}
    />
  );
}
