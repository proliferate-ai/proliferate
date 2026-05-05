import type { ReactNode } from "react";
import { CloudRuntimeAttachedPanel } from "@/components/workspace/chat/surface/CloudRuntimeAttachedPanel";
import { WorkspaceArrivalAttachedPanel } from "@/components/workspace/chat/surface/WorkspaceArrivalAttachedPanel";
import { TodoTrackerPanel } from "@/components/workspace/chat/input/TodoTrackerPanel";
import { ConnectedApprovalCard } from "@/components/workspace/chat/input/ApprovalCard";
import { ConnectedMcpElicitationCard } from "@/components/workspace/chat/input/McpElicitationCard";
import { ConnectedPendingPromptList } from "@/components/workspace/chat/input/PendingPromptList";
import { DelegatedWorkComposerPanel } from "@/components/workspace/chat/input/DelegatedWorkComposerPanel";
import { DelegatedWorkComposerControl } from "@/components/workspace/chat/input/delegated-work/DelegatedWorkComposerControl";
import { ConnectedUserInputCard } from "@/components/workspace/chat/input/UserInputCard";
import {
  useActivePendingInteractionState,
  useActivePendingPrompts,
} from "@/hooks/chat/use-active-chat-session-selectors";
import { useDebugValueChange } from "@/hooks/ui/use-debug-value-change";
import { useDelegatedWorkComposer } from "@/hooks/chat/use-delegated-work-composer";
import { useActiveTodoTracker } from "@/hooks/chat/use-active-todo-tracker";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaceStatusPanelState } from "@/hooks/workspaces/use-workspace-status-panel-state";

export interface ComposerDockSlots {
  outboundSlot: ReactNode | null;
  activeSlot: ReactNode | null;
  attachedSlot: ReactNode | null;
}

export function useComposerDockSlots(options?: {
  suppressSessionSlots?: boolean;
}): ComposerDockSlots {
  const suppressSessionSlots = options?.suppressSessionSlots ?? false;
  const { primaryPendingInteraction } = useActivePendingInteractionState();
  const pendingPrompts = useActivePendingPrompts();
  const activeTodoTracker = useActiveTodoTracker();
  const delegatedWorkComposer = useDelegatedWorkComposer();
  const workspaceStatusPanel = useWorkspaceStatusPanelState();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();

  useDebugValueChange("composer_slots.inputs", "active_session_refs", {
    suppressSessionSlots,
    primaryPendingInteraction,
    pendingPrompts,
    activeTodoTracker,
    delegatedWorkComposer,
    workspaceStatusPanel,
    selectedCloudRuntimeState: selectedCloudRuntime.state,
  });

  const interactionPanel: ReactNode | null = primaryPendingInteraction?.kind === "permission"
    ? <ConnectedApprovalCard />
    : primaryPendingInteraction?.kind === "user_input"
      ? <ConnectedUserInputCard />
      : primaryPendingInteraction?.kind === "mcp_elicitation"
        ? <ConnectedMcpElicitationCard />
        : null;

  const ambientContextSlot: ReactNode | null = workspaceStatusPanel
    ? <WorkspaceArrivalAttachedPanel />
    : selectedCloudRuntime.state && selectedCloudRuntime.state.phase !== "ready"
      ? <CloudRuntimeAttachedPanel />
      : null;
  const activeAgentSlot: ReactNode | null = suppressSessionSlots
    ? null
    : interactionPanel || (activeTodoTracker
      ? <TodoTrackerPanel entries={activeTodoTracker.entries} />
      : null);
  const delegatedWorkSlot: ReactNode | null = delegatedWorkComposer
    ? (
      <DelegatedWorkComposerPanel>
        <DelegatedWorkComposerControl viewModel={delegatedWorkComposer} />
      </DelegatedWorkComposerPanel>
    )
    : null;
  const attachedDelegatedWorkSlot = suppressSessionSlots ? null : delegatedWorkSlot;
  const attachedSlot: ReactNode | null = ambientContextSlot || attachedDelegatedWorkSlot
    ? (
      <>
        {ambientContextSlot}
        {attachedDelegatedWorkSlot}
      </>
    )
    : null;

  return {
    outboundSlot: !suppressSessionSlots && pendingPrompts.length > 0
      ? <ConnectedPendingPromptList />
      : null,
    activeSlot: activeAgentSlot,
    attachedSlot,
  };
}
