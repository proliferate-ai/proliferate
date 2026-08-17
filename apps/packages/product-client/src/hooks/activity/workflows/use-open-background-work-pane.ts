import { useCallback } from "react";
import { useWorkspaceFileContext } from "#product/hooks/workspaces/derived/files/use-workspace-file-context";
import { rightPanelToolHeaderKey } from "#product/lib/domain/workspaces/shell/right-panel-model";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

/**
 * Opens the right panel on the `background` tool (`BackgroundWorkPane`) —
 * the action `BackgroundWorkTranscriptRow`'s `onOpen` wires into (Delivery
 * Spec — Background Work Slice 1, rung R2; the row itself shipped in R1
 * with a no-op seam).
 *
 * Mirrors `openGitReviewPane`'s mechanism
 * (`hooks/workspaces/workflows/files/use-workspace-file-target-actions.ts`):
 * materialize the tool's header entry for the active workspace (appending it
 * to the header order if it isn't there yet), then open the panel.
 */
export function useOpenBackgroundWorkPane(): () => void {
  const { workspaceUiKey, materializedWorkspaceId } = useWorkspaceFileContext();
  const setRightPanelMaterializedForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelMaterializedForWorkspace,
  );
  const setRightPanelOpenForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelOpenForWorkspace,
  );

  return useCallback(() => {
    if (!materializedWorkspaceId || !workspaceUiKey) {
      return;
    }

    const backgroundEntryKey = rightPanelToolHeaderKey("background");
    setRightPanelMaterializedForWorkspace(materializedWorkspaceId, (previous) => ({
      ...previous,
      activeEntryKey: backgroundEntryKey,
      headerOrder: previous.headerOrder.includes(backgroundEntryKey)
        ? previous.headerOrder
        : [...previous.headerOrder, backgroundEntryKey],
    }));
    setRightPanelOpenForWorkspace(workspaceUiKey, true);
  }, [
    materializedWorkspaceId,
    setRightPanelMaterializedForWorkspace,
    setRightPanelOpenForWorkspace,
    workspaceUiKey,
  ]);
}
