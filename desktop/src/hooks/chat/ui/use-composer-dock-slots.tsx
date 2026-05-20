import { useMemo, type ReactNode } from "react";
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
} from "@/hooks/chat/derived/use-active-chat-session-selectors";
import { useDelegatedWorkComposer } from "@/hooks/chat/use-delegated-work-composer";
import { useActiveTodoTracker } from "@/hooks/chat/derived/use-active-todo-tracker";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaceStatusPanelState } from "@/hooks/workspaces/derived/use-workspace-status-panel-state";

export interface ComposerDockSlots {
  outboundSlot: ReactNode | null;
  activeSlot: ReactNode | null;
  attachedSlot: ReactNode | null;
}

export function useComposerDockSlots(options?: {
  suppressSessionSlots?: boolean;
  suppressWorkspaceStatusPanels?: boolean;
}): ComposerDockSlots {
  const suppressSessionSlots = options?.suppressSessionSlots ?? false;
  const suppressWorkspaceStatusPanels = options?.suppressWorkspaceStatusPanels ?? false;
  const { primaryPendingInteraction } = useActivePendingInteractionState();
  const pendingPrompts = useActivePendingPrompts();
  const activeTodoTracker = useActiveTodoTracker();
  const delegatedWorkComposer = useDelegatedWorkComposer();
  const workspaceStatusPanel = useWorkspaceStatusPanelState();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();

  const interactionPanel = useMemo<ReactNode | null>(() => (
    primaryPendingInteraction?.kind === "permission"
      ? <ConnectedApprovalCard />
      : primaryPendingInteraction?.kind === "user_input"
        ? <ConnectedUserInputCard />
        : primaryPendingInteraction?.kind === "mcp_elicitation"
          ? <ConnectedMcpElicitationCard />
          : null
  ), [primaryPendingInteraction?.kind]);

  const ambientContextSlot = useMemo<ReactNode | null>(() => (
    suppressWorkspaceStatusPanels
      ? null
      : workspaceStatusPanel
      ? <WorkspaceArrivalAttachedPanel />
      : selectedCloudRuntime.state && selectedCloudRuntime.state.phase !== "ready"
        ? <CloudRuntimeAttachedPanel />
        : null
  ), [selectedCloudRuntime.state, suppressWorkspaceStatusPanels, workspaceStatusPanel]);
  const activeAgentSlot = useMemo<ReactNode | null>(() => (
    suppressSessionSlots
      ? null
      : interactionPanel || (activeTodoTracker
        ? <TodoTrackerPanel entries={activeTodoTracker.entries} />
        : null)
  ), [activeTodoTracker, interactionPanel, suppressSessionSlots]);
  const delegatedWorkSlot = useMemo<ReactNode | null>(() => (
    delegatedWorkComposer
      ? (
      <DelegatedWorkComposerPanel>
        <DelegatedWorkComposerControl viewModel={delegatedWorkComposer} />
      </DelegatedWorkComposerPanel>
      )
      : null
  ), [delegatedWorkComposer]);
  const attachedDelegatedWorkSlot = suppressSessionSlots ? null : delegatedWorkSlot;
  const attachedSlot = useMemo<ReactNode | null>(() => (
    ambientContextSlot || attachedDelegatedWorkSlot
      ? (
      <>
        {ambientContextSlot}
        {attachedDelegatedWorkSlot}
      </>
      )
      : null
  ), [ambientContextSlot, attachedDelegatedWorkSlot]);

  return useMemo(() => ({
    outboundSlot: !suppressSessionSlots && pendingPrompts.length > 0
      ? <ConnectedPendingPromptList />
      : null,
    activeSlot: activeAgentSlot,
    attachedSlot,
  }), [
    activeAgentSlot,
    attachedSlot,
    pendingPrompts.length,
    suppressSessionSlots,
  ]);
}
