import { resetWorkspaceEditorState } from "@/stores/editor/workspace-editor-state";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useChatPlanAttachmentStore } from "@/stores/chat/chat-plan-attachment-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { detachAndCloseSessionSlotStreams } from "@/lib/integrations/anyharness/session-runtime";
import { clearWorkspaceBootstrappedInSession } from "../workspace-bootstrap-memory";
import type { WorkspaceSelectionDeps } from "./types";

export function clearWorkspaceRuntimeState(
  deps: Pick<WorkspaceSelectionDeps, "removeWorkspaceSlots" | "clearSelection">,
  workspaceId: string,
  options?: { clearSelection?: boolean; clearDraftUiKey?: string | null },
): void {
  const { sessionSlots, selectedWorkspaceId } = useHarnessStore.getState();
  const workspaceSlots = Object.fromEntries(
    Object.entries(sessionSlots).filter(([, slot]) => slot.workspaceId === workspaceId),
  );

  detachAndCloseSessionSlotStreams(Object.keys(workspaceSlots));
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
