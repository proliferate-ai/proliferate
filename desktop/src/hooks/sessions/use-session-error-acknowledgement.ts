import { useEffect } from "react";
import { resolveSessionErrorAttentionKey } from "@/lib/domain/sessions/activity";
import { parseWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/workspace-ui-key";
import { resolveWithWorkspaceFallback } from "@/lib/domain/workspaces/workspace-keyed-preferences";
import {
  isDocumentVisibleAndFocused,
  useDocumentFocusVisibilityNonce,
} from "@/hooks/ui/use-document-focus-visibility";

export function useSessionErrorAcknowledgement(): void {
  const activeSessionId = useHarnessStore((state) => state.activeSessionId);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { workspaceUiKey, materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const errorAttentionKey = useHarnessStore((state) => {
    const sessionId = state.activeSessionId;
    const slot = sessionId ? state.sessionSlots[sessionId] ?? null : null;
    return resolveSessionErrorAttentionKey(slot);
  });
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
