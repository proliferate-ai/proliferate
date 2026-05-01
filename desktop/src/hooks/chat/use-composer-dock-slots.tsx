import type { ReactNode } from "react";
import { CloudRuntimeAttachedPanel } from "@/components/workspace/chat/surface/CloudRuntimeAttachedPanel";
import { WorkspaceArrivalAttachedPanel } from "@/components/workspace/chat/surface/WorkspaceArrivalAttachedPanel";
import { TodoTrackerPanel } from "@/components/workspace/chat/input/TodoTrackerPanel";
import { ConnectedApprovalCard } from "@/components/workspace/chat/input/ApprovalCard";
import { ConnectedMcpElicitationCard } from "@/components/workspace/chat/input/McpElicitationCard";
import { ConnectedPendingPromptList } from "@/components/workspace/chat/input/PendingPromptList";
import { CoworkComposerControl } from "@/components/workspace/chat/input/CoworkComposerStrip";
import { ConnectedComposerReviewRunControl } from "@/components/workspace/chat/input/ComposerReviewRunPanel";
import { DelegatedWorkComposerPanel } from "@/components/workspace/chat/input/DelegatedWorkComposerPanel";
import { SubagentComposerControl } from "@/components/workspace/chat/input/SubagentComposerStrip";
import { ConnectedUserInputCard } from "@/components/workspace/chat/input/UserInputCard";
import { useCoworkComposerStrip } from "@/hooks/cowork/use-cowork-composer-strip";
import {
  useActivePendingInteractionState,
  useActivePendingPrompts,
} from "@/hooks/chat/use-active-chat-session-selectors";
import { useActiveTodoTracker } from "@/hooks/chat/use-active-todo-tracker";
import { useActiveReviewRun } from "@/hooks/reviews/use-active-review-run";
import { useSubagentComposerStrip } from "@/hooks/chat/subagents/use-subagent-composer-strip";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaceStatusPanelState } from "@/hooks/workspaces/use-workspace-status-panel-state";

export interface ComposerDockSlots {
  contextSlot: ReactNode | null;
  queueSlot: ReactNode | null;
  interactionSlot: ReactNode | null;
  delegationSlot: ReactNode | null;
}

export function useComposerDockSlots(options?: {
  suppressSessionSlots?: boolean;
}): ComposerDockSlots {
  const suppressSessionSlots = options?.suppressSessionSlots ?? false;
  const { primaryPendingInteraction } = useActivePendingInteractionState();
  const pendingPrompts = useActivePendingPrompts();
  const activeTodoTracker = useActiveTodoTracker();
  const activeReviewRun = useActiveReviewRun();
  const subagentComposerStrip = useSubagentComposerStrip();
  const coworkComposerStrip = useCoworkComposerStrip();
  const reviewComposerStrip = activeReviewRun.run || activeReviewRun.startingReview
    ? <ConnectedComposerReviewRunControl />
    : null;
  const workspaceStatusPanel = useWorkspaceStatusPanelState();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();

  const interactionPanel: ReactNode | null = primaryPendingInteraction?.kind === "permission"
    ? <ConnectedApprovalCard />
    : primaryPendingInteraction?.kind === "user_input"
      ? <ConnectedUserInputCard />
      : primaryPendingInteraction?.kind === "mcp_elicitation"
        ? <ConnectedMcpElicitationCard />
        : null;

  const contextSlot: ReactNode | null = workspaceStatusPanel
    ? <WorkspaceArrivalAttachedPanel />
    : selectedCloudRuntime.state && selectedCloudRuntime.state.phase !== "ready"
      ? <CloudRuntimeAttachedPanel />
      : !suppressSessionSlots && activeTodoTracker
        ? <TodoTrackerPanel entries={activeTodoTracker.entries} />
        : null;
  const delegatedWorkSlot: ReactNode | null = reviewComposerStrip || subagentComposerStrip || coworkComposerStrip
    ? (
      <DelegatedWorkComposerPanel>
        {reviewComposerStrip}
        {coworkComposerStrip && (
          <CoworkComposerControl
            rows={coworkComposerStrip.rows}
            summary={coworkComposerStrip.summary}
            onOpenWorkspace={coworkComposerStrip.openWorkspace}
            onOpenSession={coworkComposerStrip.openSession}
          />
        )}
        {subagentComposerStrip && (
          <SubagentComposerControl
            rows={subagentComposerStrip.rows}
            parent={subagentComposerStrip.parent}
            summary={subagentComposerStrip.summary}
            onOpenSubagent={subagentComposerStrip.openSubagent}
            onOpenParent={subagentComposerStrip.openParent}
          />
        )}
      </DelegatedWorkComposerPanel>
    )
    : null;

  return {
    contextSlot,
    queueSlot: !suppressSessionSlots && pendingPrompts.length > 0
      ? <ConnectedPendingPromptList />
      : null,
    interactionSlot: suppressSessionSlots ? null : interactionPanel,
    delegationSlot: suppressSessionSlots ? null : delegatedWorkSlot,
  };
}
