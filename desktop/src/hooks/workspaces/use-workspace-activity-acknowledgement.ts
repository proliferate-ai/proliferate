import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  findLogicalWorkspace,
  latestLogicalWorkspaceTimestamp,
} from "@/lib/domain/workspaces/logical-workspaces";
import {
  isDocumentVisibleAndFocused,
  useDocumentFocusVisibilityNonce,
} from "@/hooks/ui/use-document-focus-visibility";
import { useLogicalWorkspaces } from "@/hooks/workspaces/use-logical-workspaces";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

export function useWorkspaceActivityAcknowledgement(): void {
  const focusVisibilityNonce = useDocumentFocusVisibilityNonce();
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const {
    lastViewedAt,
    markWorkspaceViewedAt,
    workspaceLastInteracted,
  } = useWorkspaceUiStore(useShallow((state) => ({
    lastViewedAt: state.lastViewedAt,
    markWorkspaceViewedAt: state.markWorkspaceViewedAt,
    workspaceLastInteracted: state.workspaceLastInteracted,
  })));
  const selectedLogicalWorkspace = useMemo(() => (
    findLogicalWorkspace(logicalWorkspaces, selectedLogicalWorkspaceId)
  ), [logicalWorkspaces, selectedLogicalWorkspaceId]);
  const latestActivityAt = selectedLogicalWorkspace
    ? latestLogicalWorkspaceTimestamp(workspaceLastInteracted, selectedLogicalWorkspace)
    : null;
  const latestViewedAt = selectedLogicalWorkspace
    ? latestLogicalWorkspaceTimestamp(lastViewedAt, selectedLogicalWorkspace)
    : null;

  useEffect(() => {
    if (!selectedLogicalWorkspace || !latestActivityAt || !isDocumentVisibleAndFocused()) {
      return;
    }
    if (
      latestViewedAt
      && new Date(latestViewedAt).getTime() >= new Date(latestActivityAt).getTime()
    ) {
      return;
    }

    markWorkspaceViewedAt(selectedLogicalWorkspace.id, latestActivityAt);
  }, [
    focusVisibilityNonce,
    latestActivityAt,
    latestViewedAt,
    markWorkspaceViewedAt,
    selectedLogicalWorkspace,
  ]);
}
