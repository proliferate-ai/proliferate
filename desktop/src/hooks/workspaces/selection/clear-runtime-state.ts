import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { detachAndCloseSessionSlotStreams } from "@/lib/integrations/anyharness/session-runtime";
import { clearWorkspaceBootstrappedInSession } from "../workspace-bootstrap-memory";
import type { WorkspaceSelectionDeps } from "./types";

export function clearWorkspaceRuntimeState(
  deps: Pick<WorkspaceSelectionDeps, "removeWorkspaceSlots" | "clearSelection">,
  workspaceId: string,
  options?: { clearSelection?: boolean },
): void {
  const { sessionSlots, selectedWorkspaceId } = useHarnessStore.getState();
  const workspaceSlots = Object.fromEntries(
    Object.entries(sessionSlots).filter(([, slot]) => slot.workspaceId === workspaceId),
  );

  detachAndCloseSessionSlotStreams(Object.keys(workspaceSlots));
  deps.removeWorkspaceSlots(workspaceId);
  useChatInputStore.getState().clearDraft(workspaceId);
  clearWorkspaceBootstrappedInSession(workspaceId);

  if (options?.clearSelection && selectedWorkspaceId === workspaceId) {
    deps.clearSelection();
    useWorkspaceFilesStore.getState().reset();
  }
}
