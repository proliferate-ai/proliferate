import { useMemo } from "react";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  resolveChatInputAvailability,
  type ChatInputAvailability,
} from "@/lib/domain/chat/chat-input";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useConfiguredLaunchReadiness } from "./use-configured-launch-readiness";

export interface ChatAvailabilityState extends ChatInputAvailability {
  selectedWorkspaceKind: "cloud" | "local";
}

export function useChatAvailabilityState(): ChatAvailabilityState {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const connectionState = useHarnessStore((state) => state.connectionState);
  const activeSessionId = useHarnessStore((state) => state.activeSessionId);
  const activeSessionHydrated = useHarnessStore((state) =>
    state.activeSessionId
      ? (state.sessionSlots[state.activeSessionId]?.transcriptHydrated ?? false)
      : true
  );
  const { data: workspaceCollections } = useWorkspaces();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const configuredLaunch = useConfiguredLaunchReadiness();

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
    const disabledReason = pendingWorkspaceEntry.stage === "failed"
      ? "Resolve workspace setup before starting chat."
      : pendingWorkspaceEntry.stage === "awaiting-cloud-ready"
        ? "Cloud workspace is still preparing."
        : pendingWorkspaceEntry.source === "worktree-created"
            ? "Creating worktree..."
            : pendingWorkspaceEntry.source === "cloud-created"
              ? "Creating cloud workspace..."
              : "Creating workspace...";

    return {
      isDisabled: true,
      disabledReason,
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind: pendingWorkspaceEntry.source === "cloud-created" ? "cloud" : "local",
    };
  }

  return {
    ...availability,
    selectedWorkspaceKind: selectedCloudWorkspaceId !== null ? "cloud" : "local",
  };
}
