import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import {
  resolveChatSurfaceState,
  type ChatSurfaceState,
} from "@/lib/domain/chat/chat-surface";
import { shouldShowCloudWorkspaceStatusScreen } from "@/lib/domain/workspaces/cloud-workspace-status";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { useSelectedWorkspace } from "@/hooks/workspaces/use-selected-workspace";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useAppSurfaceStore } from "@/stores/ui/app-surface-store";
import { hasWorkspaceBootstrappedInSession } from "@/hooks/workspaces/workspace-bootstrap-memory";
import { useActiveChatSessionState } from "./use-active-chat-session-state";
export type { ChatSurfaceState } from "@/lib/domain/chat/chat-surface";

export function useChatSurfaceState(): {
  mode: ChatSurfaceState;
  selectedWorkspaceId: string | null;
} {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const workspaceArrivalEvent = useHarnessStore((state) => state.workspaceArrivalEvent);
  const pendingCoworkThread = useAppSurfaceStore((state) => state.pendingCoworkThread);
  const { data: workspaceCollections } = useWorkspaces();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const { selectedWorkspace } = useSelectedWorkspace();
  const {
    activeSessionId,
    hasContent,
    hasSlot,
    transcriptHydrated,
    isEmpty,
    isRunning,
  } = useActiveChatSessionState();
  const streamConnectionState = useHarnessStore((state) =>
    state.activeSessionId
      ? state.sessionSlots[state.activeSessionId]?.streamConnectionState ?? null
      : null,
  );

  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const selectedCloudWorkspace =
    workspaceCollections?.cloudWorkspaces.find((workspace) => workspace.id === selectedCloudWorkspaceId)
    ?? null;

  const isArrivalWorkspace = workspaceArrivalEvent?.workspaceId === selectedWorkspaceId;
  const shouldShowCloudStatus = selectedCloudWorkspace
    && shouldShowCloudWorkspaceStatusScreen(selectedCloudWorkspace);

  const shouldPreserveTranscript = selectedCloudRuntime.state?.preserveVisibleContent && hasContent;
  const mode = resolveChatSurfaceState({
    selectedWorkspaceId,
    selectedWorkspace,
    hasPendingWorkspaceEntry: pendingWorkspaceEntry !== null,
    hasPendingCoworkThread: pendingCoworkThread !== null,
    shouldShowCloudStatus: Boolean(shouldShowCloudStatus),
    isArrivalWorkspaceWithoutContent: Boolean(isArrivalWorkspace && !hasContent),
    activeSessionId,
    hasWorkspaceBootstrappedInSession:
      selectedWorkspaceId !== null && hasWorkspaceBootstrappedInSession(selectedWorkspaceId),
    hasSlot,
    transcriptHydrated,
    isEmpty,
    isRunning,
    streamConnectionState,
    shouldPreserveTranscript: Boolean(shouldPreserveTranscript),
  });

  return { mode, selectedWorkspaceId };
}
