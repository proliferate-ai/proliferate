import { useMemo } from "react";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import {
  resolveChatSurfaceState,
  type ChatSurfaceState,
} from "#product/lib/domain/chat/surface/chat-surface";
import { resolveLaunchIntentScope } from "#product/lib/domain/chat/launch/launch-intent";
import { shouldShowCloudWorkspaceStatusScreen } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { useShellLaunchIntent } from "#product/hooks/chat/derived/use-shell-launch-intent";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useAttendedPendingWorkspaceEntry } from "#product/hooks/workspaces/derived/use-pending-workspace-entries";
import { useActiveSessionSurfaceSnapshot } from "#product/hooks/chat/derived/use-active-session-transcript-state";
import type { WorkspaceRenderSurface } from "#product/lib/domain/workspaces/tabs/shell-activation";
import { measureDebugComputation } from "#product/lib/infra/measurement/measurement-port";

export type { ChatSurfaceState };

// Owns read-only chat surface mode composition. The product transition rules
// live in lib/domain/chat/surface; this hook only gathers React state.
export function useChatSurfaceState(shellRenderSurface?: WorkspaceRenderSurface | null): {
  mode: ChatSurfaceState;
  selectedWorkspaceId: string | null;
} {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const pendingWorkspaceEntry = useAttendedPendingWorkspaceEntry();
  const workspaceArrivalEvent = useSessionSelectionStore((state) => state.workspaceArrivalEvent);
  const activeLaunchIntent = useShellLaunchIntent();
  const { data: workspaceCollections } = useWorkspaces();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const {
    activeSessionId,
    hasContent,
    hasTranscriptEntry,
    hasSlot,
    transcriptHydrated,
    isEmpty,
    isRunning,
    streamConnectionState,
  } = useActiveSessionSurfaceSnapshot();

  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const selectedCloudWorkspace = useMemo(() => (
    workspaceCollections?.cloudWorkspaces.find((workspace) =>
      workspace.id === selectedCloudWorkspaceId
    ) ?? null
  ), [selectedCloudWorkspaceId, workspaceCollections?.cloudWorkspaces]);
  const selectedLocalWorkspace = useMemo(() => (
    selectedWorkspaceId
      ? workspaceCollections?.localWorkspaces?.find((workspace) =>
          workspace.id === selectedWorkspaceId
        ) ?? null
      : null
  ), [selectedWorkspaceId, workspaceCollections?.localWorkspaces]);
  const shellRenderScope = useMemo(() => {
    if (!shellRenderSurface) {
      return null;
    }
    if (shellRenderSurface.kind === "chat-session-pending") {
      return { kind: "chat-session-pending" as const, sessionId: shellRenderSurface.sessionId };
    }
    if (shellRenderSurface.kind === "chat-session") {
      return {
        kind: "chat-session" as const,
        sessionId: shellRenderSurface.sessionId,
      };
    }
    return { kind: shellRenderSurface.kind === "chat-shell" ? "chat-shell" as const : "other" as const };
  }, [shellRenderSurface]);
  const mode = useMemo(() => measureDebugComputation({
    category: "chat_surface_state.derive",
    label: "resolve_mode",
    keys: [
      "selectedWorkspaceId",
      "pendingWorkspaceEntry",
      "activeLaunchIntent",
      "selectedLocalWorkspace",
      "selectedCloudWorkspace",
      "selectedCloudRuntime",
      "shellRenderScope",
      "activeSessionSnapshot",
    ],
    count: (value) => (value.kind ? 1 : 0),
  }, () => resolveChatSurfaceState({
    selectedWorkspaceId,
    hasPendingWorkspaceEntry: pendingWorkspaceEntry !== null,
    activeLaunchIntentId: activeLaunchIntent?.id ?? null,
    launchIntentScope: activeLaunchIntent ? resolveLaunchIntentScope(activeLaunchIntent) : null,
    launchIntentInFlight: activeLaunchIntent ? activeLaunchIntent.failure === null : false,
    launchIntentSessionId:
      activeLaunchIntent?.materializedSessionId
      ?? activeLaunchIntent?.clientSessionId
      ?? null,
    shellLogicalWorkspaceId: selectedLogicalWorkspaceId,
    shellWorkspaceId: selectedWorkspaceId,
    selectedLocalWorkspace,
    isArrivalWorkspace: workspaceArrivalEvent?.workspaceId === selectedWorkspaceId,
    shouldShowSelectedCloudWorkspaceStatus: selectedCloudWorkspace
      ? shouldShowCloudWorkspaceStatusScreen(selectedCloudWorkspace)
      : false,
    shouldPreserveVisibleCloudContent: selectedCloudRuntime.state?.preserveVisibleContent === true,
    shellRenderScope,
    activeSessionId,
    hasContent,
    hasTranscriptEntry,
    hasSlot,
    transcriptHydrated,
    isEmpty,
    isRunning,
    streamConnectionState,
  })), [
    activeLaunchIntent?.attemptId,
    activeLaunchIntent?.clientSessionId,
    activeLaunchIntent?.failure,
    activeLaunchIntent?.id,
    activeLaunchIntent?.materializedSessionId,
    activeLaunchIntent?.materializedWorkspaceId,
    activeLaunchIntent?.targetWorkspaceId,
    activeSessionId,
    hasContent,
    hasTranscriptEntry,
    hasSlot,
    isEmpty,
    isRunning,
    pendingWorkspaceEntry,
    selectedCloudRuntime.state?.preserveVisibleContent,
    selectedCloudWorkspace,
    selectedLocalWorkspace,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    shellRenderScope,
    streamConnectionState,
    transcriptHydrated,
    workspaceArrivalEvent?.workspaceId,
  ]);

  return useMemo(() => ({ mode, selectedWorkspaceId }), [mode, selectedWorkspaceId]);
}
