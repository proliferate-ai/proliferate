import { useWorkspaceChangeReviewStore } from "@/stores/editor/workspace-change-review-store";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";

export function resetWorkspaceEditorState(): void {
  useWorkspaceViewerTabsStore.getState().reset();
  useWorkspaceFileBuffersStore.getState().reset();
  useWorkspaceChangeReviewStore.getState().reset();
}
