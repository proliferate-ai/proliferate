import { useMemo, type ReactNode } from "react";
import { resolveComposerDockSlots } from "#product/domain/chats/composer/resolve-dock-slots";
import { CloudRuntimeAttachedPanel } from "#product/components/workspace/chat/surface/CloudRuntimeAttachedPanel";
import { WorkspaceArrivalAttachedPanel } from "#product/components/workspace/chat/surface/WorkspaceArrivalAttachedPanel";
import { ConnectedApprovalCard } from "#product/components/workspace/chat/input/ApprovalCard";
import { ConnectedMcpElicitationCard } from "#product/components/workspace/chat/input/McpElicitationCard";
import { ConnectedPendingPromptList } from "#product/components/workspace/chat/input/PendingPromptList";
import { DelegatedWorkComposerPanel } from "#product/components/workspace/chat/input/DelegatedWorkComposerPanel";
import { DelegatedWorkComposerControl } from "#product/components/workspace/chat/input/delegated-work/DelegatedWorkComposerControl";
import { ConnectedUserInputCard } from "#product/components/workspace/chat/input/UserInputCard";
import { ConnectedPromptRecoveryPanel } from "#product/components/workspace/chat/input/PromptRecoveryPanel";
import { SessionActivityBar } from "#product/components/workspace/activity/SessionActivityBar";
import { useSessionGoalBarModel } from "#product/hooks/activity/derived/use-session-goal";
import { useSessionActivityChips } from "#product/hooks/activity/derived/use-session-activity-chips";
import {
  useActivePendingInteractionState,
  useActivePendingPrompts,
} from "#product/hooks/chat/derived/use-active-pending-session-interactions";
import { useDelegatedWorkComposer } from "#product/hooks/chat/facade/use-delegated-work-composer";
import { useComposerDockCardPresence } from "#product/hooks/chat/ui/use-composer-dock-card-presence";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { useWorkspaceStatusPanelState } from "#product/hooks/workspaces/derived/use-workspace-status-panel-state";
import { useChatPromptRecoveries } from "#product/hooks/chat/derived/use-chat-prompt-recoveries";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

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
  const delegatedWorkComposer = useDelegatedWorkComposer();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
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
    hasDelegatedWork: !!delegatedWorkComposer,
    hasWorkspaceActivity: !!selectedWorkspaceId,
    hasSessionGoal: !!sessionGoalBarModel,
    hasSessionActivity: sessionActivityChips.length > 0,
    hasWorkspaceStatusPanel: !!workspaceStatusPanel,
    hasCloudRuntimePanel,
  }), [
    delegatedWorkComposer,
    hasCloudRuntimePanel,
    pendingPrompts.length,
    promptRecoveries.length,
    primaryPendingInteraction?.kind,
    sessionActivityChips.length,
    sessionGoalBarModel,
    suppressSessionSlots,
    suppressWorkspaceStatusPanels,
    selectedWorkspaceId,
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
  // Identity key for the active-slot presence animation: a new interaction
  // replays the entrance, while resolving the last card fades the slot out
  // before unmount.
  const activeSlotKind = dockSlotResolution.activeSlot?.kind ?? null;
  const activeSlotKey = activeSlotKind && primaryPendingInteraction
    ? `${primaryPendingInteraction.kind}:${primaryPendingInteraction.requestId}`
    : null;
  const activeAgentSlot = useComposerDockCardPresence(activeSlotKey, interactionPanel);
  const delegatedWorkSlot = useMemo<ReactNode | null>(() => (
    dockSlotResolution.attachedSlot?.delegatedWork && delegatedWorkComposer
      ? (
      <DelegatedWorkComposerPanel>
        <DelegatedWorkComposerControl viewModel={delegatedWorkComposer} />
      </DelegatedWorkComposerPanel>
      )
      : null
  ), [delegatedWorkComposer, dockSlotResolution.attachedSlot?.delegatedWork]);
  // The workspace-activity cap retired into the workspace-status card (the
  // trailing-cluster trigger in ChatInputControlRow) — ambient git/PR state
  // no longer paints on the composer itself.
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

  // Queue-placed prompts have one owner: the dock's outbound list. A rollback
  // recovery is workspace-scoped rather than session-scoped and outranks the
  // queue (resolver priority), owning the slot until retried or dismissed.
  const outboundSlot = useMemo<ReactNode | null>(() => (
    dockSlotResolution.outboundSlot?.kind === "prompt_recoveries"
      ? <ConnectedPromptRecoveryPanel />
      : dockSlotResolution.outboundSlot?.kind === "pending_prompts"
        ? <ConnectedPendingPromptList />
        : null
  ), [dockSlotResolution.outboundSlot?.kind]);

  return useMemo(() => ({
    outboundSlot,
    activeSlot: activeAgentSlot,
    attachedSlot,
  }), [
    outboundSlot,
    activeAgentSlot,
    attachedSlot,
  ]);
}
