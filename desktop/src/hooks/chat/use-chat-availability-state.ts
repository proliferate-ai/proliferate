import { useMemo } from "react";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  resolveChatInputAvailability,
  type ChatInputAvailability,
} from "@/lib/domain/chat/chat-input";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useConfiguredLaunchReadiness } from "./use-configured-launch-readiness";
import { useChatLaunchProjection } from "./use-chat-launch-projection";
import { useActiveReviewRun } from "@/hooks/reviews/use-active-review-run";

export interface ChatAvailabilityState extends ChatInputAvailability {
  selectedWorkspaceKind: "cloud" | "local";
}

export function useChatAvailabilityState(options?: {
  activeSessionId?: string | null;
}): ChatAvailabilityState {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const connectionState = useHarnessStore((state) => state.connectionState);
  const storedActiveSessionId = useHarnessStore((state) => state.activeSessionId);
  const activeSessionId = options && "activeSessionId" in options
    ? options.activeSessionId ?? null
    : storedActiveSessionId;
  const activeSessionHydrated = useHarnessStore((state) =>
    activeSessionId
      ? (state.sessionSlots[activeSessionId]?.transcriptHydrated ?? false)
      : true
  );
  const { data: workspaceCollections } = useWorkspaces();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const mobility = useWorkspaceMobilityState();
  const configuredLaunch = useConfiguredLaunchReadiness();
  const launchProjection = useChatLaunchProjection();
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
    activeSessionHydrated,
    isConfiguredLaunchLoading: configuredLaunch.isLoading,
    hasReadyConfiguredLaunch: configuredLaunch.isReady,
    configuredLaunchDisabledReason: configuredLaunch.disabledReason,
  }), [
    activeSessionId,
    activeSessionHydrated,
    connectionState,
    configuredLaunch.disabledReason,
    configuredLaunch.isLoading,
    configuredLaunch.isReady,
    selectedCloudRuntime.state?.actionBlockReason,
    selectedCloudRuntime.state?.phase,
    selectedCloudWorkspace?.actionBlockReason,
    selectedCloudWorkspace?.status,
    selectedWorkspaceId,
    selectedCloudWorkspaceId,
  ]);

  if (pendingWorkspaceEntry) {
    if (pendingWorkspaceEntry.stage !== "failed") {
      if (!launchProjection) {
        return {
          isDisabled: true,
          disabledReason: "Preparing launch options...",
          areRuntimeControlsDisabled: true,
          areLaunchControlsDisabled: true,
          areUtilityActionsDisabled: true,
          areLiveSessionControlsDisabled: true,
          selectedWorkspaceKind: pendingWorkspaceEntry.source === "cloud-created" ? "cloud" : "local",
        };
      }

      return {
        isDisabled: false,
        disabledReason: null,
        areRuntimeControlsDisabled: false,
        areLaunchControlsDisabled: false,
        areUtilityActionsDisabled: true,
        areLiveSessionControlsDisabled: true,
        selectedWorkspaceKind: pendingWorkspaceEntry.source === "cloud-created" ? "cloud" : "local",
      };
    }

    const disabledReason = pendingWorkspaceEntry.stage === "failed"
      ? "Resolve workspace setup before starting chat."
      : pendingWorkspaceEntry.stage === "awaiting-cloud-ready"
        ? "Cloud workspace is still preparing."
        : pendingWorkspaceEntry.source === "worktree-created"
          ? "Creating worktree..."
          : pendingWorkspaceEntry.source === "cloud-created"
            ? "Creating cloud workspace..."
            : pendingWorkspaceEntry.source === "cowork-created"
              ? "Starting cowork thread..."
              : "Creating workspace...";

    return {
      isDisabled: true,
      disabledReason,
      areRuntimeControlsDisabled: true,
      areLaunchControlsDisabled: true,
      areUtilityActionsDisabled: true,
      areLiveSessionControlsDisabled: true,
      selectedWorkspaceKind: pendingWorkspaceEntry.source === "cloud-created" ? "cloud" : "local",
    };
  }

  if (mobility.handoffActive) {
    return {
      isDisabled: true,
      disabledReason: mobility.status.description ?? "Workspace mobility is in progress.",
      areRuntimeControlsDisabled: true,
      areLaunchControlsDisabled: true,
      areUtilityActionsDisabled: true,
      areLiveSessionControlsDisabled: true,
      selectedWorkspaceKind: mobility.selectedLogicalWorkspace?.effectiveOwner === "cloud"
        ? "cloud"
        : "local",
    };
  }

  if (activeReviewRun.hasBusyReview) {
    return {
      isDisabled: true,
      disabledReason: "Review automation is running.",
      areRuntimeControlsDisabled: true,
      areLaunchControlsDisabled: true,
      areUtilityActionsDisabled: true,
      areLiveSessionControlsDisabled: true,
      selectedWorkspaceKind: selectedCloudWorkspaceId !== null ? "cloud" : "local",
    };
  }

  return {
    ...availability,
    selectedWorkspaceKind: selectedCloudWorkspaceId !== null ? "cloud" : "local",
  };
}
