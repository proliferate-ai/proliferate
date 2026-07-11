import { useMemo, type ReactNode } from "react";
import { resolveComposerDockSlots } from "@proliferate/product-domain/chats/composer/resolve-dock-slots";
import { CloudRuntimeAttachedPanel } from "@/components/workspace/chat/surface/CloudRuntimeAttachedPanel";
import { WorkspaceArrivalAttachedPanel } from "@/components/workspace/chat/surface/WorkspaceArrivalAttachedPanel";
import { TodoTrackerPanel, TodoTrackerStrip } from "@/components/workspace/chat/input/TodoTrackerPanel";
import { ConnectedApprovalCard } from "@/components/workspace/chat/input/ApprovalCard";
import { ConnectedMcpElicitationCard } from "@/components/workspace/chat/input/McpElicitationCard";
import { DelegatedWorkComposerPanel } from "@/components/workspace/chat/input/DelegatedWorkComposerPanel";
import { DelegatedWorkComposerControl } from "@/components/workspace/chat/input/delegated-work/DelegatedWorkComposerControl";
import { ConnectedUserInputCard } from "@/components/workspace/chat/input/UserInputCard";
import { ConnectedPromptRecoveryPanel } from "@/components/workspace/chat/input/PromptRecoveryPanel";
import { SessionActivityBar } from "@/components/workspace/activity/SessionActivityBar";
import { useSessionGoalBarModel } from "@/hooks/activity/derived/use-session-goal";
import { useSessionActivityChips } from "@/hooks/activity/derived/use-session-activity-chips";
import {
  useActivePendingInteractionState,
  useActivePendingPrompts,
} from "@/hooks/chat/derived/use-active-pending-session-interactions";
import { useDelegatedWorkComposer } from "@/hooks/chat/facade/use-delegated-work-composer";
import { useActiveTodoTracker } from "@/hooks/chat/derived/use-active-todo-tracker";
import { useComposerDockCardPresence } from "@/hooks/chat/ui/use-composer-dock-card-presence";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { useWorkspaceStatusPanelState } from "@/hooks/workspaces/derived/use-workspace-status-panel-state";
import { useChatPromptRecoveries } from "@/hooks/chat/derived/use-chat-prompt-recoveries";

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
  const promptRecoveries = useChatPromptRecoveries().recoveries;
  const activeTodoTracker = useActiveTodoTracker();
  const delegatedWorkComposer = useDelegatedWorkComposer();
  const sessionGoalBarModel = useSessionGoalBarModel();
  const sessionActivityChips = useSessionActivityChips();
  const workspaceStatusPanel = useWorkspaceStatusPanelState();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const hasCloudRuntimePanel = !!selectedCloudRuntime.state
    && selectedCloudRuntime.state.phase !== "ready";
  const dockSlotResolution = useMemo(() => resolveComposerDockSlots({
    suppressSessionSlots,
    suppressWorkspaceStatusPanels,
    pendingPromptCount: pendingPrompts.length,
    recoveredPromptCount: promptRecoveries.length,
    primaryPendingInteractionKind: primaryPendingInteraction?.kind ?? null,
    hasActiveTodoTracker: !!activeTodoTracker,
    hasDelegatedWork: !!delegatedWorkComposer,
    hasSessionGoal: !!sessionGoalBarModel,
    hasSessionActivity: sessionActivityChips.length > 0,
    hasWorkspaceStatusPanel: !!workspaceStatusPanel,
    hasCloudRuntimePanel,
  }), [
    activeTodoTracker,
    delegatedWorkComposer,
    hasCloudRuntimePanel,
    pendingPrompts.length,
    promptRecoveries.length,
    primaryPendingInteraction?.kind,
    sessionActivityChips.length,
    sessionGoalBarModel,
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
  // While an interaction holds the slot, plan progress collapses to a slim
  // one-line strip directly below the card instead of being evicted.
  const todoStrip = useMemo<ReactNode | null>(() => (
    dockSlotResolution.activeSlotCompanion?.kind === "todo_strip" && activeTodoTracker
      ? <TodoTrackerStrip entries={activeTodoTracker.entries} />
      : null
  ), [activeTodoTracker, dockSlotResolution.activeSlotCompanion?.kind]);
  const activeSlotContent = useMemo<ReactNode | null>(() => {
    if (interactionPanel) {
      return (
        <>
          {interactionPanel}
          {todoStrip}
        </>
      );
    }
    return dockSlotResolution.activeSlot?.kind === "todo_tracker" && activeTodoTracker
      ? <TodoTrackerPanel entries={activeTodoTracker.entries} />
      : null;
  }, [activeTodoTracker, dockSlotResolution.activeSlot?.kind, interactionPanel, todoStrip]);
  // Identity key for the active-slot presence animation: a new interaction
  // (or the todo tracker taking the slot back) replays the entrance, while
  // resolving the last card fades the slot out before unmount.
  const activeSlotKind = dockSlotResolution.activeSlot?.kind ?? null;
  const activeSlotKey = activeSlotKind === "todo_tracker"
    ? "todo_tracker"
    : activeSlotKind && primaryPendingInteraction
      ? `${primaryPendingInteraction.kind}:${primaryPendingInteraction.requestId}`
      : null;
  const activeAgentSlot = useComposerDockCardPresence(activeSlotKey, activeSlotContent);
  const delegatedWorkSlot = useMemo<ReactNode | null>(() => (
    dockSlotResolution.attachedSlot?.delegatedWork && delegatedWorkComposer
      ? (
      <DelegatedWorkComposerPanel>
        <DelegatedWorkComposerControl viewModel={delegatedWorkComposer} />
      </DelegatedWorkComposerPanel>
      )
      : null
  ), [delegatedWorkComposer, dockSlotResolution.attachedSlot?.delegatedWork]);
  // The activity bar (goal + chips) renders last so it docks directly
  // against the composer surface — it is the ever-present element while
  // goal or activity state is live.
  const sessionActivitySlot = useMemo<ReactNode | null>(() => (
    dockSlotResolution.attachedSlot?.sessionGoal || dockSlotResolution.attachedSlot?.sessionActivity
      ? <SessionActivityBar />
      : null
  ), [dockSlotResolution.attachedSlot?.sessionGoal, dockSlotResolution.attachedSlot?.sessionActivity]);
  const attachedSlot = useMemo<ReactNode | null>(() => (
    ambientContextSlot || delegatedWorkSlot || sessionActivitySlot
      ? (
      <>
        {ambientContextSlot}
        {delegatedWorkSlot}
        {sessionActivitySlot}
      </>
      )
      : null
  ), [ambientContextSlot, delegatedWorkSlot, sessionActivitySlot]);

  return useMemo(() => ({
    // Ordinary queued prompts render in the transcript. A rollback recovery is
    // workspace-scoped rather than session-scoped, so it owns the dock's
    // outbound slot until the user retries or dismisses it.
    outboundSlot: dockSlotResolution.outboundSlot?.kind === "prompt_recoveries"
      ? <ConnectedPromptRecoveryPanel />
      : null,
    activeSlot: activeAgentSlot,
    attachedSlot,
  }), [
    activeAgentSlot,
    attachedSlot,
    dockSlotResolution.outboundSlot?.kind,
  ]);
}
