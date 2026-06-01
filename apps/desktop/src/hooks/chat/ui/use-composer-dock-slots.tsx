import { useMemo, type ReactNode } from "react";
import { resolveComposerDockSlots } from "@proliferate/product-domain/chats/composer/resolve-dock-slots";
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
} from "@/hooks/chat/derived/use-active-pending-session-interactions";
import { useDelegatedWorkComposer } from "@/hooks/chat/facade/use-delegated-work-composer";
import { useActiveTodoTracker } from "@/hooks/chat/derived/use-active-todo-tracker";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/facade/use-selected-cloud-runtime-state";
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
  const hasCloudRuntimePanel = !!selectedCloudRuntime.state
    && selectedCloudRuntime.state.phase !== "ready";
  const dockSlotResolution = useMemo(() => resolveComposerDockSlots({
    suppressSessionSlots,
    suppressWorkspaceStatusPanels,
    pendingPromptCount: pendingPrompts.length,
    primaryPendingInteractionKind: primaryPendingInteraction?.kind ?? null,
    hasActiveTodoTracker: !!activeTodoTracker,
    hasDelegatedWork: !!delegatedWorkComposer,
    hasWorkspaceStatusPanel: !!workspaceStatusPanel,
    hasCloudRuntimePanel,
  }), [
    activeTodoTracker,
    delegatedWorkComposer,
    hasCloudRuntimePanel,
    pendingPrompts.length,
    primaryPendingInteraction?.kind,
    suppressSessionSlots,
    suppressWorkspaceStatusPanels,
    workspaceStatusPanel,
  ]);

  const interactionPanel = useMemo<ReactNode | null>(() => (
    dockSlotResolution.activeSlot?.kind === "permission"
      ? <ConnectedApprovalCard />
      : dockSlotResolution.activeSlot?.kind === "user_input"
        ? <ConnectedUserInputCard />
        : dockSlotResolution.activeSlot?.kind === "mcp_elicitation"
          ? <ConnectedMcpElicitationCard />
          : null
  ), [dockSlotResolution.activeSlot?.kind]);

  const ambientContextSlot = useMemo<ReactNode | null>(() => (
    dockSlotResolution.attachedSlot?.ambientSlot?.kind === "workspace_status"
      ? <WorkspaceArrivalAttachedPanel />
      : dockSlotResolution.attachedSlot?.ambientSlot?.kind === "cloud_runtime"
        ? <CloudRuntimeAttachedPanel />
        : null
  ), [dockSlotResolution.attachedSlot?.ambientSlot?.kind]);
  const activeAgentSlot = useMemo<ReactNode | null>(() => (
    interactionPanel || (dockSlotResolution.activeSlot?.kind === "todo_tracker" && activeTodoTracker
      ? <TodoTrackerPanel entries={activeTodoTracker.entries} />
      : null)
  ), [activeTodoTracker, dockSlotResolution.activeSlot?.kind, interactionPanel]);
  const delegatedWorkSlot = useMemo<ReactNode | null>(() => (
    dockSlotResolution.attachedSlot?.delegatedWork && delegatedWorkComposer
      ? (
      <DelegatedWorkComposerPanel>
        <DelegatedWorkComposerControl viewModel={delegatedWorkComposer} />
      </DelegatedWorkComposerPanel>
      )
      : null
  ), [delegatedWorkComposer, dockSlotResolution.attachedSlot?.delegatedWork]);
  const attachedSlot = useMemo<ReactNode | null>(() => (
    ambientContextSlot || delegatedWorkSlot
      ? (
      <>
        {ambientContextSlot}
        {delegatedWorkSlot}
      </>
      )
      : null
  ), [ambientContextSlot, delegatedWorkSlot]);

  return useMemo(() => ({
    outboundSlot: dockSlotResolution.outboundSlot
      ? <ConnectedPendingPromptList />
      : null,
    activeSlot: activeAgentSlot,
    attachedSlot,
  }), [
    activeAgentSlot,
    attachedSlot,
    dockSlotResolution.outboundSlot,
  ]);
}
