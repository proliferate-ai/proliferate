import { GoalBar } from "#product/components/workspace/activity/GoalBar";
import { useSessionGoalBarModel } from "#product/hooks/activity/derived/use-session-goal";
import { useSessionGoalActions } from "#product/hooks/activity/workflows/use-session-goal-actions";

/**
 * Connected activity bar for the composer dock: the goal bar (Phase A,
 * live-wired). Replaces a bare `SessionGoalBar` mount as the dock's
 * attached-slot inhabitant.
 *
 * The compact activity chips (`⟳ loops · ▸ terminals · ⑂ agents`) this bar
 * used to stack on the same row are retired (HANDOFF-background-work.md —
 * the docked chips go; the goal bar stays, but only when a goal is live).
 * Their roster data now feeds `BackgroundWorkTranscriptRow`'s transcript-tail
 * counts instead (`deriveActivityChips` in `domain/activity/chips.ts`), and
 * the loop/terminal/subagent rosters this bar used to host move to the
 * future `BackgroundWorkPane` (delivery spec rung R2) — this component no
 * longer subscribes to `useSessionActivity` or hosts their popovers at all.
 */
export function SessionActivityBar() {
  const goalModel = useSessionGoalBarModel();
  const goalActions = useSessionGoalActions(goalModel?.goal ?? null);

  if (!goalModel) {
    return null;
  }

  return (
    <GoalBar
      goal={goalModel.goal}
      capabilities={goalModel.capabilities}
      composing={goalModel.composing}
      pendingWrite={goalActions.pendingWrite || goalModel.provisional}
      onEdit={goalActions.editGoal}
      onPause={goalActions.pauseGoal}
      onResume={goalActions.resumeGoal}
      onClear={goalActions.clearGoal}
      onDismiss={goalActions.dismissResult}
      onCancelCompose={goalActions.cancelComposing}
      onSetNewGoal={goalActions.beginComposing}
    />
  );
}
