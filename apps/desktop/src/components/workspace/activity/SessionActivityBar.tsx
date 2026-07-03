import { useCallback, useMemo } from "react";
import { GoalBar } from "@proliferate/product-ui/activity/GoalBar";
import { ActivityChips } from "@proliferate/product-ui/activity/ActivityChips";
import { LoopsPanel } from "@proliferate/product-ui/activity/LoopsPanel";
import { TerminalsRosterPanel } from "@proliferate/product-ui/activity/TerminalsRosterPanel";
import { AgentsRosterPanel } from "@proliferate/product-ui/activity/AgentsRosterPanel";
import { deriveActivityChips } from "@proliferate/product-domain/activity/chips";
import type { GoalCapabilities } from "@proliferate/product-domain/activity/goal";
import { useSessionGoalBarModel } from "@/hooks/activity/derived/use-session-goal";
import { useSessionGoalActions } from "@/hooks/activity/workflows/use-session-goal-actions";
import { useSessionActivity } from "@/hooks/activity/derived/use-session-activity";
import { useActivityNowMs } from "@/hooks/activity/derived/use-activity-now-ms";
import { useSessionLoopActions } from "@/hooks/activity/workflows/use-session-loop-actions";

const NO_GOAL_CAPABILITIES: GoalCapabilities = { supported: false, native: false, pause: false };

/**
 * Connected activity bar for the composer dock: the goal bar (Phase A,
 * live-wired) plus the compact activity chips (`⟳ loops · ▸ terminals ·
 * ⑂ agents`) that stack on the same bar row
 * (session-activity-architecture §Locked decisions #5). Replaces a bare
 * `SessionGoalBar` mount as the dock's attached-slot inhabitant so the bar
 * shows for live activity even with no goal set. Rosters are fixture-backed
 * behind `useSessionActivity` until the runtime mirror lands — see that
 * hook's doc comment.
 */
export function SessionActivityBar() {
  const goalModel = useSessionGoalBarModel();
  const goalActions = useSessionGoalActions(goalModel?.goal ?? null);
  const activity = useSessionActivity();
  const nowMs = useActivityNowMs();
  const loopActions = useSessionLoopActions();

  const chips = useMemo(() => deriveActivityChips({
    loops: activity.loops,
    processes: activity.processes,
    agents: activity.agents,
  }), [activity.loops, activity.processes, activity.agents]);

  // TODO(activity-integration): both handlers below are the chips'
  // documented integration seam — see
  // codex/session-activity-architecture.md "Product UI". `▸` should route
  // into the existing terminals pane (features/terminals.md) once its
  // FeedRef bytes are wired through TerminalViewport; `⑂` should route into
  // the existing delegated-work surfaces (features/delegated-work.md) once
  // this roster is merged into DelegatedWorkComposerViewModel as a new
  // `subagent` source. Until then each chip's popover is a fully-functional,
  // self-contained read-only roster (per session-activity-architecture's
  // "each chip is the click-in to its own panel").
  const handleOpenTerminal = useCallback((_processId: string) => {}, []);
  const handleOpenAgent = useCallback((_subagentId: string) => {}, []);

  if (!goalModel && chips.length === 0) {
    return null;
  }

  return (
    <GoalBar
      goal={goalModel?.goal ?? null}
      capabilities={goalModel?.capabilities ?? NO_GOAL_CAPABILITIES}
      composing={goalModel?.composing ?? false}
      pendingWrite={goalActions.pendingWrite}
      onEdit={goalActions.editGoal}
      onPause={goalActions.pauseGoal}
      onResume={goalActions.resumeGoal}
      onClear={goalActions.clearGoal}
      onDismiss={goalActions.dismissResult}
      onCancelCompose={goalActions.cancelComposing}
      chips={chips.length > 0 ? (
        <ActivityChips
          chips={chips}
          panels={{
            loops: (
              <LoopsPanel
                loops={activity.loops}
                capabilities={activity.loopCapabilities}
                nowMs={nowMs}
                onArm={loopActions.armLoop}
                onDelete={loopActions.deleteLoop}
                pendingWrite={loopActions.pendingWrite}
              />
            ),
            terminals: (
              <TerminalsRosterPanel
                processes={activity.processes}
                nowMs={nowMs}
                onOpen={handleOpenTerminal}
              />
            ),
            agents: (
              <AgentsRosterPanel
                agents={activity.agents}
                nowMs={nowMs}
                onOpen={handleOpenAgent}
              />
            ),
          }}
        />
      ) : undefined}
    />
  );
}
