import { useMemo } from "react";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  resolveChatInputAvailability,
  type ChatInputAvailability,
} from "@/lib/domain/chat/chat-input";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useConfiguredLaunchReadiness } from "./use-configured-launch-readiness";
import { useActiveReviewRun } from "@/hooks/reviews/use-active-review-run";

export interface ChatAvailabilityState extends ChatInputAvailability {
  selectedWorkspaceKind: "cloud" | "local";
}

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
  }), [
    activeSessionId,
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
      return {
        isDisabled: false,
        disabledReason: null,
        areRuntimeControlsDisabled: false,
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
      selectedWorkspaceKind: pendingWorkspaceEntry.source === "cloud-created" ? "cloud" : "local",
    };
  }

  if (mobility.handoffActive) {
    return {
      isDisabled: true,
      disabledReason: mobility.status.description ?? "Workspace mobility is in progress.",
      areRuntimeControlsDisabled: true,
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
      selectedWorkspaceKind: selectedCloudWorkspaceId !== null ? "cloud" : "local",
    };
  }

  return {
    ...availability,
    selectedWorkspaceKind: selectedCloudWorkspaceId !== null ? "cloud" : "local",
  };
}
