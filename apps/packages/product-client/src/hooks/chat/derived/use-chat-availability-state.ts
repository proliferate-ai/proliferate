import { useMemo } from "react";
import { selectPrimaryPendingInteraction } from "@anyharness/sdk";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { resolveCloudWorkspaceStatus } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";
import {
  resolveChatInputAvailability,
  type ChatInputAvailabilityState,
} from "#product/lib/domain/chat/composer/chat-input";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useConfiguredLaunchReadiness } from "#product/hooks/chat/derived/use-configured-launch-readiness";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

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
  const primaryPendingInteractionKind = useSessionTranscriptStore((state) => {
    const transcript = activeSessionId
      ? state.entriesById[activeSessionId]?.transcript ?? null
      : null;
    return transcript ? selectPrimaryPendingInteraction(transcript)?.kind ?? null : null;
  });
  const { data: workspaceCollections } = useWorkspaces();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const configuredLaunch = useConfiguredLaunchReadiness();

  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const selectedCloudWorkspace =
    workspaceCollections?.cloudWorkspaces.find((workspace) => workspace.id === selectedCloudWorkspaceId)
    ?? null;
  const selectedCloudWorkspaceStatus = resolveCloudWorkspaceStatus(selectedCloudWorkspace);

  const availability = useMemo(() => resolveChatInputAvailability({
    selectedWorkspaceId,
    isCloudWorkspaceSelected: selectedCloudWorkspaceId !== null,
    connectionState,
    selectedCloudWorkspaceStatus,
    selectedCloudWorkspaceActionBlockReason: selectedCloudWorkspace?.actionBlockReason ?? null,
    selectedCloudRuntimePhase: selectedCloudRuntime.state?.phase ?? null,
    selectedCloudRuntimeActionBlockReason: selectedCloudRuntime.state?.actionBlockReason ?? null,
    activeSessionId,
    isConfiguredLaunchLoading: configuredLaunch.isLoading,
    hasReadyConfiguredLaunch: configuredLaunch.isReady,
    configuredLaunchDisabledReason: configuredLaunch.disabledReason,
    pendingWorkspaceEntry,
    pendingInteractionKind: primaryPendingInteractionKind,
  }), [
    activeSessionId,
    connectionState,
    configuredLaunch.disabledReason,
    configuredLaunch.isLoading,
    configuredLaunch.isReady,
    pendingWorkspaceEntry,
    primaryPendingInteractionKind,
    selectedCloudRuntime.state?.actionBlockReason,
    selectedCloudRuntime.state?.phase,
    selectedCloudWorkspace?.actionBlockReason,
    selectedCloudWorkspaceStatus,
    selectedWorkspaceId,
    selectedCloudWorkspaceId,
  ]);
  return availability;
}
