import { resetWorkspaceEditorState } from "@/stores/editor/workspace-editor-state";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useChatPlanAttachmentStore } from "@/stores/chat/chat-plan-attachment-store";
import { detachAndCloseSessionStreams } from "@/lib/workflows/sessions/session-runtime";
import { getWorkspaceSessionRecords } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { clearWorkspaceBootstrappedInSession } from "../workspace-bootstrap-memory";
import type { WorkspaceSelectionDeps } from "./types";

export function clearWorkspaceRuntimeState(
  deps: Pick<WorkspaceSelectionDeps, "removeWorkspaceSlots" | "clearSelection">,
  workspaceId: string,
  options?: { clearSelection?: boolean; clearDraftUiKey?: string | null },
): void {
  const selectedWorkspaceId = useSessionSelectionStore.getState().selectedWorkspaceId;
  const workspaceSlots = getWorkspaceSessionRecords(workspaceId);

  detachAndCloseSessionStreams(Object.keys(workspaceSlots));
  deps.removeWorkspaceSlots(workspaceId);
  if (options?.clearDraftUiKey) {
    useChatInputStore.getState().clearDraft(options.clearDraftUiKey);
    useChatPlanAttachmentStore.getState().clearPlanAttachments(options.clearDraftUiKey);
  }
  clearWorkspaceBootstrappedInSession(workspaceId);

  if (options?.clearSelection && selectedWorkspaceId === workspaceId) {
    deps.clearSelection();
    resetWorkspaceEditorState();
  }
}
