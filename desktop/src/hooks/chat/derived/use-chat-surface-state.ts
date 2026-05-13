import { useMemo } from "react";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import {
  resolveChatSurfaceState,
  type ChatSurfaceState,
} from "@/lib/domain/chat/surface/chat-surface";
import { shouldShowCloudWorkspaceStatusScreen } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useActiveSessionSurfaceSnapshot } from "@/hooks/chat/derived/use-active-chat-session-selectors";
import type { WorkspaceRenderSurface } from "@/lib/domain/workspaces/tabs/shell-activation";
import { useDebugValueChange } from "@/hooks/ui/use-debug-value-change";
import { measureDebugComputation } from "@/lib/infra/measurement/debug-measurement";

export type { ChatSurfaceState };

// Owns read-only chat surface mode composition. The product transition rules
// live in lib/domain/chat/surface; this hook only gathers React state.
export function useChatSurfaceState(shellRenderSurface?: WorkspaceRenderSurface | null): {
  mode: ChatSurfaceState;
  selectedWorkspaceId: string | null;
} {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const workspaceArrivalEvent = useSessionSelectionStore((state) => state.workspaceArrivalEvent);
  const activeLaunchIntent = useChatLaunchIntentStore((state) => state.activeIntent);
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
  useDebugValueChange("chat_surface_state.inputs", "resolve_inputs", {
    selectedWorkspaceId,
    pendingWorkspaceEntry,
    workspaceArrivalEvent,
    activeLaunchIntent,
    selectedCloudWorkspace,
    selectedLocalWorkspace,
    selectedCloudRuntimeState: selectedCloudRuntime.state,
    shellRenderScope,
    activeSessionId,
    hasContent,
    hasTranscriptEntry,
    hasSlot,
    transcriptHydrated,
    isEmpty,
    isRunning,
    streamConnectionState,
  });
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
    launchIntentSessionId:
      activeLaunchIntent?.materializedSessionId
      ?? activeLaunchIntent?.clientSessionId
      ?? null,
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
    activeLaunchIntent?.clientSessionId,
    activeLaunchIntent?.id,
    activeLaunchIntent?.materializedSessionId,
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
    selectedWorkspaceId,
    shellRenderScope,
    streamConnectionState,
    transcriptHydrated,
    workspaceArrivalEvent?.workspaceId,
  ]);

  return useMemo(() => ({ mode, selectedWorkspaceId }), [mode, selectedWorkspaceId]);
}
