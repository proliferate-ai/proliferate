import { resetWorkspaceEditorState } from "#product/stores/editor/workspace-editor-state";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";
import { useChatPlanAttachmentStore } from "#product/stores/chat/chat-plan-attachment-store";
import {
  detachAndCloseSessionStreams,
  type FlushAwareSessionStreamHandle,
  type SessionStreamDetachDeps,
} from "#product/lib/workflows/sessions/session-runtime";
import {
  findClientSessionIdByMaterializedSessionId,
  getMaterializedSessionId,
  getWorkspaceSessionRecords,
  patchSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import {
  closeSessionStreamHandle,
  getSessionStreamHandle,
} from "#product/lib/access/anyharness/session-stream-handles";
import { clearWorkspaceBootstrappedInSession } from "#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import { useFileTreeStore } from "#product/stores/editor/file-tree-store";
import type { WorkspaceSelectionDeps } from "#product/hooks/workspaces/workflows/selection/types";

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
  // Materialized-workspace disposal: one synchronous transaction drops this
  // workspace's first tree-state-key claim together with all of its expansion
  // scopes, leaving every other live workspace's session state intact.
  useFileTreeStore.getState().pruneFileTreeSessionState(workspaceId);

  if (options?.clearSelection && selectedWorkspaceId === workspaceId) {
    // Scoped to one workspace, so it deselects without touching the other
    // attempts in the pending registry (PRO-230).
    deps.clearSelection({ preservePendingWorkspaces: true });
    resetWorkspaceEditorState();
  }
}
