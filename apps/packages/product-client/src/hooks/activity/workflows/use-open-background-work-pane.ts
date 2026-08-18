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
 * The returned callback optionally accepts a native subagent id plus the
 * session it belongs to (Delivery Spec — Background Work Slice 1, rung R4
 * fix-forward: a native subagent's transcript block —
 * `TranscriptAgentGroupBlock` — must click-open its `BackgroundWorkPane`
 * detail). When given, it deep-opens straight to that subagent's
 * `BackgroundSubagentView` by writing a one-shot pending selection into the
 * same right-panel-model store this hook already owns
 * (`pendingBackgroundSubagentSelectionByWorkspace`, consumed and cleared by
 * `BackgroundWorkPane` on its next render) — no new global, no parallel
 * mechanism. The `sessionId` travels with the selection (review round 2) so
 * the pane can discard it if the active session has since changed, rather
 * than applying a different session's subagent id to its own roster.
 * Existing zero-arg call sites (`BackgroundWorkTranscriptRow`'s `onOpen`)
 * are unaffected: both arguments are optional and only take effect together.
 */
interface BackgroundWorkPaneOpener {
  /** The workspace a pending selection must be keyed under, or null when none is active. */
  materializedWorkspaceId: string | null;
  /** Materialize the `background` tool entry and open the right panel. No-op with no active workspace. */
  openPane: () => void;
}

function useBackgroundWorkPaneOpener(): BackgroundWorkPaneOpener {
  const { workspaceUiKey, materializedWorkspaceId } = useWorkspaceFileContext();
  const setRightPanelMaterializedForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelMaterializedForWorkspace,
  );
  const setRightPanelOpenForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelOpenForWorkspace,
  );

  const openPane = useCallback(() => {
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

  return { materializedWorkspaceId, openPane };
}

export function useOpenBackgroundWorkPane(): (subagentId?: string, sessionId?: string) => void {
  const { materializedWorkspaceId, openPane } = useBackgroundWorkPaneOpener();
  const setPendingBackgroundSubagentSelectionForWorkspace = useWorkspaceUiStore(
    (state) => state.setPendingBackgroundSubagentSelectionForWorkspace,
  );

  return useCallback((subagentId?: string, sessionId?: string) => {
    if (materializedWorkspaceId && subagentId && sessionId) {
      setPendingBackgroundSubagentSelectionForWorkspace(materializedWorkspaceId, {
        subagentId,
        sessionId,
      });
    }
    openPane();
  }, [materializedWorkspaceId, openPane, setPendingBackgroundSubagentSelectionForWorkspace]);
}

/**
 * Terminal counterpart of `useOpenBackgroundWorkPane` (bgwork r6): deep-opens
 * the Background work pane straight to one process's `BackgroundTerminalView`.
 * A background terminal's completion receipt (`BackgroundCompletionReceipt`)
 * wires its command button here. Same one-shot, session-scoped selection
 * mechanism as the subagent path — the pane consumes and clears it on its next
 * render, discarding a cross-session entry. The `processId`/`sessionId` pair
 * only takes effect together; a bare call just opens the pane on its roster.
 */
export function useOpenBackgroundTerminalDetail(): (processId?: string, sessionId?: string) => void {
  const { materializedWorkspaceId, openPane } = useBackgroundWorkPaneOpener();
  const setPendingBackgroundProcessSelectionForWorkspace = useWorkspaceUiStore(
    (state) => state.setPendingBackgroundProcessSelectionForWorkspace,
  );

  return useCallback((processId?: string, sessionId?: string) => {
    if (materializedWorkspaceId && processId && sessionId) {
      setPendingBackgroundProcessSelectionForWorkspace(materializedWorkspaceId, {
        processId,
        sessionId,
      });
    }
    openPane();
  }, [materializedWorkspaceId, openPane, setPendingBackgroundProcessSelectionForWorkspace]);
}
