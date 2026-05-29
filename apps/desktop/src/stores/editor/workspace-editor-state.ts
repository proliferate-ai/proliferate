// Local editor-state facade. This may coordinate synchronous resets across
// editor stores, but must not own async work, remote access, navigation, or
// query cache behavior.
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";

export function resetWorkspaceEditorState(): void {
  useWorkspaceViewerTabsStore.getState().reset();
  useWorkspaceFileBuffersStore.getState().reset();
}
