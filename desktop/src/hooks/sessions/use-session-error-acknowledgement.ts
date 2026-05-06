import { useEffect } from "react";
import { parseWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/workspace-ui-key";
import { resolveWithWorkspaceFallback } from "@/lib/domain/workspaces/workspace-keyed-preferences";
import {
  isDocumentVisibleAndFocused,
  useDocumentFocusVisibilityNonce,
} from "@/hooks/ui/use-document-focus-visibility";

export function useSessionErrorAcknowledgement(): void {
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { workspaceUiKey, materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const activeDirectoryEntry = useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId] ?? null : null
  );
  const errorAttentionKey = activeDirectoryEntry?.activity.errorAttentionKey ?? null;
  const activeShellTabKeyByWorkspace = useWorkspaceUiStore(
    (state) => state.activeShellTabKeyByWorkspace,
  );
  const activeShellTabKey = resolveWithWorkspaceFallback(
    activeShellTabKeyByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  ).value ?? null;
  const activeShellTab = activeShellTabKey
    ? parseWorkspaceShellTabKey(activeShellTabKey)
    : null;
  const isChatActiveShellTab = activeShellTab?.kind === "chat";
  const markSessionErrorViewed = useWorkspaceUiStore(
    (state) => state.markSessionErrorViewed,
  );
  const focusVisibilityNonce = useDocumentFocusVisibilityNonce();

  useEffect(() => {
    if (!activeSessionId || !isChatActiveShellTab || !errorAttentionKey) {
      return;
    }
    if (!isDocumentVisibleAndFocused()) {
      return;
    }

    markSessionErrorViewed(activeSessionId, errorAttentionKey);
  }, [
    activeSessionId,
    errorAttentionKey,
    focusVisibilityNonce,
    isChatActiveShellTab,
    markSessionErrorViewed,
  ]);
}
