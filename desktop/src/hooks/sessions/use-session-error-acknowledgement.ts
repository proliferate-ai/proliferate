import { useEffect, useState } from "react";
import { resolveSessionErrorAttentionKey } from "@/lib/domain/sessions/activity";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";

function isDocumentVisibleAndFocused(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }
  return document.visibilityState === "visible" && document.hasFocus();
}

export function useSessionErrorAcknowledgement(): void {
  const activeSessionId = useHarnessStore((state) => state.activeSessionId);
  const errorAttentionKey = useHarnessStore((state) => {
    const sessionId = state.activeSessionId;
    const slot = sessionId ? state.sessionSlots[sessionId] ?? null : null;
    return resolveSessionErrorAttentionKey(slot);
  });
  const isChatActiveMainTab = useWorkspaceFilesStore(
    (state) => state.activeMainTab.kind === "chat",
  );
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
    if (!activeSessionId || !isChatActiveMainTab || !errorAttentionKey) {
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
    isChatActiveMainTab,
    markSessionErrorViewed,
  ]);
}
