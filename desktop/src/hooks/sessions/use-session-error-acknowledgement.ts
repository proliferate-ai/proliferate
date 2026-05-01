import { useEffect, useState } from "react";
import { resolveSessionErrorAttentionKey } from "@/lib/domain/sessions/activity";
import { parseWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/workspace-ui-key";
import { resolveWithWorkspaceFallback } from "@/lib/domain/workspaces/workspace-keyed-preferences";

function isDocumentVisibleAndFocused(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }
  return document.visibilityState === "visible" && document.hasFocus();
}

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
  const [focusVisibilityNonce, setFocusVisibilityNonce] = useState(0);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const bumpFocusVisibilityNonce = () => {
      setFocusVisibilityNonce((value) => value + 1);
    };

    document.addEventListener("visibilitychange", bumpFocusVisibilityNonce);
    window.addEventListener("focus", bumpFocusVisibilityNonce);
    window.addEventListener("blur", bumpFocusVisibilityNonce);

    return () => {
      document.removeEventListener("visibilitychange", bumpFocusVisibilityNonce);
      window.removeEventListener("focus", bumpFocusVisibilityNonce);
      window.removeEventListener("blur", bumpFocusVisibilityNonce);
    };
  }, []);

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
