import { resetWorkspaceEditorState } from "@/stores/editor/workspace-editor-state";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useChatPlanAttachmentStore } from "@/stores/chat/chat-plan-attachment-store";
import {
  detachAndCloseSessionStreams,
  type FlushAwareSessionStreamHandle,
  type SessionStreamDetachDeps,
} from "@/lib/workflows/sessions/session-runtime";
import {
  findClientSessionIdByMaterializedSessionId,
  getMaterializedSessionId,
  getWorkspaceSessionRecords,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import {
  closeSessionStreamHandle,
  getSessionStreamHandle,
} from "@/lib/access/anyharness/session-stream-handles";
import { clearWorkspaceBootstrappedInSession } from "@/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import type { WorkspaceSelectionDeps } from "./types";

const sessionStreamDetachDeps: SessionStreamDetachDeps = {
  getMaterializedSessionId,
  getSessionStreamHandle: (sessionId: string) =>
    getSessionStreamHandle(sessionId) as FlushAwareSessionStreamHandle | null,
  closeSessionStreamHandle: (
    sessionId: string,
    handle: FlushAwareSessionStreamHandle,
  ) => {
    closeSessionStreamHandle(sessionId, handle);
  },
  findClientSessionIdByMaterializedSessionId,
  patchSessionStreamConnectionState: (
    clientSessionId: string,
    streamConnectionState,
  ) => {
    patchSessionRecord(clientSessionId, { streamConnectionState });
  },
};

export function clearWorkspaceRuntimeState(
  deps: Pick<WorkspaceSelectionDeps, "removeWorkspaceSlots" | "clearSelection">,
  workspaceId: string,
  options?: { clearSelection?: boolean; clearDraftUiKey?: string | null },
): void {
  const selectedWorkspaceId = useSessionSelectionStore.getState().selectedWorkspaceId;
  const workspaceSlots = getWorkspaceSessionRecords(workspaceId);

  detachAndCloseSessionStreams(Object.keys(workspaceSlots), sessionStreamDetachDeps);
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
