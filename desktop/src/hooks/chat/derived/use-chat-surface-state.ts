import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/derived/use-selected-cloud-runtime-state";
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
    hasSlot,
    transcriptHydrated,
    isEmpty,
    isRunning,
    streamConnectionState,
  } = useActiveSessionSurfaceSnapshot();

  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const selectedCloudWorkspace =
    workspaceCollections?.cloudWorkspaces.find((workspace) => workspace.id === selectedCloudWorkspaceId)
    ?? null;
  const selectedLocalWorkspace = selectedWorkspaceId
    ? workspaceCollections?.localWorkspaces?.find((w) => w.id === selectedWorkspaceId)
    : null;

  return {
    mode: resolveChatSurfaceState({
      selectedWorkspaceId,
      hasPendingWorkspaceEntry: pendingWorkspaceEntry !== null,
      activeLaunchIntentId: activeLaunchIntent?.id ?? null,
      launchIntentSessionId: activeLaunchIntent?.materializedSessionId ?? null,
      selectedLocalWorkspace: selectedLocalWorkspace ?? null,
      isArrivalWorkspace: workspaceArrivalEvent?.workspaceId === selectedWorkspaceId,
      shouldShowSelectedCloudWorkspaceStatus: selectedCloudWorkspace
        ? shouldShowCloudWorkspaceStatusScreen(selectedCloudWorkspace)
        : false,
      shouldPreserveVisibleCloudContent: selectedCloudRuntime.state?.preserveVisibleContent === true,
      shellRenderScope: shellRenderSurface
        ? shellRenderSurface.kind === "chat-session-pending"
          ? { kind: "chat-session-pending", sessionId: shellRenderSurface.sessionId }
          : { kind: shellRenderSurface.kind === "chat-shell" ? "chat-shell" : "other" }
        : null,
      activeSessionId,
      hasContent,
      hasSlot,
      transcriptHydrated,
      isEmpty,
      isRunning,
      streamConnectionState,
    }),
    selectedWorkspaceId,
  };
}
