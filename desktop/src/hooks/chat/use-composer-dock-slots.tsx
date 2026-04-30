import type { ReactNode } from "react";
import { CloudRuntimeAttachedPanel } from "@/components/workspace/chat/surface/CloudRuntimeAttachedPanel";
import { WorkspaceArrivalAttachedPanel } from "@/components/workspace/chat/surface/WorkspaceArrivalAttachedPanel";
import { TodoTrackerPanel } from "@/components/workspace/chat/input/TodoTrackerPanel";
import { ConnectedApprovalCard } from "@/components/workspace/chat/input/ApprovalCard";
import { ConnectedMcpElicitationCard } from "@/components/workspace/chat/input/McpElicitationCard";
import { ConnectedPendingPromptList } from "@/components/workspace/chat/input/PendingPromptList";
import { ConnectedSubagentComposerStrip } from "@/components/workspace/chat/input/SubagentComposerStrip";
import { ConnectedUserInputCard } from "@/components/workspace/chat/input/UserInputCard";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useActiveTodoTracker } from "@/hooks/chat/use-active-todo-tracker";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaceStatusPanelState } from "@/hooks/workspaces/use-workspace-status-panel-state";

export interface ComposerDockSlots {
  upperSlot: ReactNode | null;
  subagentSlot: ReactNode | null;
  queueSlot: ReactNode | null;
}

export function useComposerDockSlots(): ComposerDockSlots {
  const { primaryPendingInteraction, pendingPrompts } = useActiveChatSessionState();
  const activeTodoTracker = useActiveTodoTracker();
  const workspaceStatusPanel = useWorkspaceStatusPanelState();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();

  const interactionPanel: ReactNode | null = primaryPendingInteraction?.kind === "permission"
    ? <ConnectedApprovalCard />
    : primaryPendingInteraction?.kind === "user_input"
      ? <ConnectedUserInputCard />
      : primaryPendingInteraction?.kind === "mcp_elicitation"
        ? <ConnectedMcpElicitationCard />
        : null;

  const upperSlot: ReactNode | null = interactionPanel
    ? interactionPanel
    : activeTodoTracker
      ? <TodoTrackerPanel entries={activeTodoTracker.entries} />
      : workspaceStatusPanel
        ? <WorkspaceArrivalAttachedPanel />
        : selectedCloudRuntime.state && selectedCloudRuntime.state.phase !== "ready"
          ? <CloudRuntimeAttachedPanel />
          : null;

  return {
    upperSlot,
    subagentSlot: <ConnectedSubagentComposerStrip />,
    queueSlot: pendingPrompts.length > 0 ? <ConnectedPendingPromptList /> : null,
  };
}
