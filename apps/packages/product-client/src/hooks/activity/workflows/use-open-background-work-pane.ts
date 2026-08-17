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
 *
 * The returned callback optionally accepts a native subagent id (Delivery
 * Spec — Background Work Slice 1, rung R4 fix-forward: a native subagent's
 * transcript block — `TranscriptAgentGroupBlock` — must click-open its
 * `BackgroundWorkPane` detail). When given, it deep-opens straight to that
 * subagent's `BackgroundSubagentView` by writing a one-shot pending
 * selection into the same right-panel-model store this hook already owns
 * (`pendingBackgroundSubagentSelectionByWorkspace`, consumed and cleared by
 * `BackgroundWorkPane` on its next render) — no new global, no parallel
 * mechanism. Existing zero-arg call sites (`BackgroundWorkTranscriptRow`'s
 * `onOpen`) are unaffected: the argument is optional.
 */
export function useOpenBackgroundWorkPane(): (subagentId?: string) => void {
  const { workspaceUiKey, materializedWorkspaceId } = useWorkspaceFileContext();
  const setRightPanelMaterializedForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelMaterializedForWorkspace,
  );
  const setRightPanelOpenForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelOpenForWorkspace,
  );
  const setPendingBackgroundSubagentSelectionForWorkspace = useWorkspaceUiStore(
    (state) => state.setPendingBackgroundSubagentSelectionForWorkspace,
  );

  return useCallback((subagentId?: string) => {
    if (!materializedWorkspaceId || !workspaceUiKey) {
      return;
    }

    if (subagentId) {
      setPendingBackgroundSubagentSelectionForWorkspace(materializedWorkspaceId, subagentId);
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
    setPendingBackgroundSubagentSelectionForWorkspace,
    setRightPanelMaterializedForWorkspace,
    setRightPanelOpenForWorkspace,
    workspaceUiKey,
  ]);
}
