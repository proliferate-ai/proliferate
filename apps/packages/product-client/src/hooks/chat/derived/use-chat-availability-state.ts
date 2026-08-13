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
import { isWorkspaceDirectoryMissing } from "#product/lib/domain/workspaces/availability";
import { pendingWorkspaceEntryOwnsSelection } from "#product/lib/domain/workspaces/creation/pending-entry";
import { missingCheckoutCopy } from "#product/copy/workspaces/workspace-availability-copy";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useConfiguredLaunchReadiness } from "#product/hooks/chat/derived/use-configured-launch-readiness";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import {
  resolveWorkspaceSessionRecoverySendBlockedReason,
} from "#product/lib/domain/workspaces/selection/session-recovery";
import type { ModelSelectorSelection } from "#product/lib/domain/chat/models/model-selector-types";

export type ChatAvailabilityState = ChatInputAvailabilityState;

// Owns read-only composer availability state. All disabling rules live in the
// pure chat-input resolver; this hook only gathers React state.
export function useChatAvailabilityState(options?: {
  activeSessionId?: string | null;
  activeLaunchSelection?: ModelSelectorSelection | null;
  launchReadiness?: {
    isLoading: boolean;
    isReady: boolean;
    disabledReason: string | null;
  };
}): ChatAvailabilityState {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const storedActiveSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const workspaceSessionRecovery = useSessionSelectionStore(
    (state) => state.workspaceSessionRecovery,
  );
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
  const configuredLaunch = useConfiguredLaunchReadiness(options?.activeLaunchSelection ?? null);
  const launchReadiness = options?.launchReadiness ?? configuredLaunch;

  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const selectedLocalWorkspace = selectedCloudWorkspaceId === null
    ? workspaceCollections?.workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
      ?? null
    : null;
  const selectedCloudWorkspace =
    workspaceCollections?.cloudWorkspaces.find((workspace) => workspace.id === selectedCloudWorkspaceId)
    ?? null;
  const selectedCloudWorkspaceStatus = resolveCloudWorkspaceStatus(selectedCloudWorkspace);
  // A pending creation surviving in the background must not gate another
  // selected workspace's composer.
  const ownedPendingWorkspaceEntry =
    pendingWorkspaceEntry
    && pendingWorkspaceEntryOwnsSelection(pendingWorkspaceEntry, selectedWorkspaceId)
      ? pendingWorkspaceEntry
      : null;

  const availability = useMemo(() => resolveChatInputAvailability({
    selectedWorkspaceId,
    isCloudWorkspaceSelected: selectedCloudWorkspaceId !== null,
    workspaceDirectoryMissingSendReason:
      selectedLocalWorkspace && isWorkspaceDirectoryMissing(selectedLocalWorkspace)
        ? missingCheckoutCopy(selectedLocalWorkspace.kind).sendBlockedReason
        : null,
    connectionState,
    selectedCloudWorkspaceStatus,
    selectedCloudRuntimePhase: selectedCloudRuntime.state?.phase ?? null,
    selectedCloudRuntimeActionBlockReason: selectedCloudRuntime.state?.actionBlockReason ?? null,
    activeSessionId,
    isConfiguredLaunchLoading: launchReadiness.isLoading,
    hasReadyConfiguredLaunch: launchReadiness.isReady,
    configuredLaunchDisabledReason: launchReadiness.disabledReason,
    sessionRecoverySendReason:
      workspaceSessionRecovery?.sessionId === activeSessionId
        ? resolveWorkspaceSessionRecoverySendBlockedReason(
          workspaceSessionRecovery.reason,
        )
        : null,
    pendingWorkspaceEntry: ownedPendingWorkspaceEntry,
    pendingInteractionKind: primaryPendingInteractionKind,
  }), [
    activeSessionId,
    connectionState,
    launchReadiness.disabledReason,
    launchReadiness.isLoading,
    launchReadiness.isReady,
    ownedPendingWorkspaceEntry,
    primaryPendingInteractionKind,
    selectedCloudRuntime.state?.actionBlockReason,
    selectedCloudRuntime.state?.phase,
    selectedCloudWorkspaceStatus,
    selectedLocalWorkspace,
    selectedWorkspaceId,
    selectedCloudWorkspaceId,
    workspaceSessionRecovery?.sessionId,
    workspaceSessionRecovery?.reason,
  ]);
  return availability;
}
