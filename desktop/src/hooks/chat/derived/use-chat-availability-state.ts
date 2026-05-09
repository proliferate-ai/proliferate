import { useMemo } from "react";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  resolveChatInputAvailability,
  type ChatInputAvailabilityState,
} from "@/lib/domain/chat/composer/chat-input";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useConfiguredLaunchReadiness } from "@/hooks/chat/derived/use-configured-launch-readiness";
import { useActiveReviewRun } from "@/hooks/reviews/facade/use-active-review-run";

export type ChatAvailabilityState = ChatInputAvailabilityState;

// Owns read-only composer availability state. All disabling rules live in the
// pure chat-input resolver; this hook only gathers React state.
export function useChatAvailabilityState(options?: {
  activeSessionId?: string | null;
}): ChatAvailabilityState {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const storedActiveSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const activeSessionId = options && "activeSessionId" in options
    ? options.activeSessionId ?? null
    : storedActiveSessionId;
  const { data: workspaceCollections } = useWorkspaces();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const mobility = useWorkspaceMobilityState();
  const configuredLaunch = useConfiguredLaunchReadiness();
  const activeReviewRun = useActiveReviewRun();

  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const selectedCloudWorkspace =
    workspaceCollections?.cloudWorkspaces.find((workspace) => workspace.id === selectedCloudWorkspaceId)
    ?? null;

  const availability = useMemo(() => resolveChatInputAvailability({
    selectedWorkspaceId,
    isCloudWorkspaceSelected: selectedCloudWorkspaceId !== null,
    connectionState,
    selectedCloudWorkspaceStatus: selectedCloudWorkspace?.status ?? null,
    selectedCloudWorkspaceActionBlockReason: selectedCloudWorkspace?.actionBlockReason ?? null,
    selectedCloudRuntimePhase: selectedCloudRuntime.state?.phase ?? null,
    selectedCloudRuntimeActionBlockReason: selectedCloudRuntime.state?.actionBlockReason ?? null,
    activeSessionId,
    isConfiguredLaunchLoading: configuredLaunch.isLoading,
    hasReadyConfiguredLaunch: configuredLaunch.isReady,
    configuredLaunchDisabledReason: configuredLaunch.disabledReason,
    pendingWorkspaceEntry,
    mobility: {
      handoffActive: mobility.handoffActive,
      statusDescription: mobility.status.description ?? null,
      selectedEffectiveOwner: mobility.selectedLogicalWorkspace?.effectiveOwner ?? null,
    },
    hasBusyReview: activeReviewRun.hasBusyReview,
  }), [
    activeSessionId,
    activeReviewRun.hasBusyReview,
    connectionState,
    configuredLaunch.disabledReason,
    configuredLaunch.isLoading,
    configuredLaunch.isReady,
    mobility.handoffActive,
    mobility.selectedLogicalWorkspace?.effectiveOwner,
    mobility.status.description,
    pendingWorkspaceEntry,
    selectedCloudRuntime.state?.actionBlockReason,
    selectedCloudRuntime.state?.phase,
    selectedCloudWorkspace?.actionBlockReason,
    selectedCloudWorkspace?.status,
    selectedWorkspaceId,
    selectedCloudWorkspaceId,
  ]);
  return availability;
}
