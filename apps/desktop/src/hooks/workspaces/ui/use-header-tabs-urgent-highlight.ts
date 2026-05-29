import {
  useCallback,
  useEffect,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";
import type { WorkspaceShellTab } from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useHeaderTabsUrgentHighlight({
  workspaceUiKey,
  activeShellTab,
  onActivateChatSession,
}: {
  workspaceUiKey: string | null;
  activeShellTab: WorkspaceShellTab | null;
  onActivateChatSession: (sessionId: string) => void;
}) {
  const urgentHighlightedChatSessionId = useWorkspaceUiStore((state) =>
    workspaceUiKey
      ? state.urgentHighlightedChatSessionByWorkspace[workspaceUiKey] ?? null
      : null
  );
  const setUrgentHighlightedChatSessionForWorkspace = useWorkspaceUiStore(
    (state) => state.setUrgentHighlightedChatSessionForWorkspace,
  );
  const clearUrgentHighlightedChatSessionForWorkspace = useWorkspaceUiStore(
    (state) => state.clearUrgentHighlightedChatSessionForWorkspace,
  );
  const urgentChatActivationAttemptRef = useRef(0);
  const cancelUrgentChatActivationRef = useRef<(() => void) | null>(null);
  const urgentHighlightTimeoutRef = useRef<number | null>(null);

  const clearUrgentChatHighlight = useCallback(() => {
    urgentChatActivationAttemptRef.current += 1;
    cancelUrgentChatActivationRef.current?.();
    cancelUrgentChatActivationRef.current = null;
    if (urgentHighlightTimeoutRef.current !== null) {
      window.clearTimeout(urgentHighlightTimeoutRef.current);
      urgentHighlightTimeoutRef.current = null;
    }
    if (workspaceUiKey) {
      clearUrgentHighlightedChatSessionForWorkspace(workspaceUiKey);
    }
  }, [clearUrgentHighlightedChatSessionForWorkspace, workspaceUiKey]);

  const setUrgentHighlightWithTimeout = useCallback((
    sessionId: string,
    timeoutMs: number,
  ) => {
    if (!workspaceUiKey) {
      return null;
    }
    const attempt = urgentChatActivationAttemptRef.current + 1;
    urgentChatActivationAttemptRef.current = attempt;
    cancelUrgentChatActivationRef.current?.();
    cancelUrgentChatActivationRef.current = null;
    if (urgentHighlightTimeoutRef.current !== null) {
      window.clearTimeout(urgentHighlightTimeoutRef.current);
      urgentHighlightTimeoutRef.current = null;
    }

    flushSync(() => {
      setUrgentHighlightedChatSessionForWorkspace(workspaceUiKey, sessionId);
    });
    urgentHighlightTimeoutRef.current = window.setTimeout(() => {
      if (urgentChatActivationAttemptRef.current !== attempt) {
        return;
      }
      urgentHighlightTimeoutRef.current = null;
      clearUrgentHighlightedChatSessionForWorkspace(workspaceUiKey, sessionId);
    }, timeoutMs);

    return attempt;
  }, [
    clearUrgentHighlightedChatSessionForWorkspace,
    setUrgentHighlightedChatSessionForWorkspace,
    workspaceUiKey,
  ]);

  const previewHeaderChatTab = useCallback((sessionId: string) => {
    setUrgentHighlightWithTimeout(sessionId, 700);
  }, [setUrgentHighlightWithTimeout]);

  const activateHeaderChatTab = useCallback((sessionId: string) => {
    const attempt = setUrgentHighlightWithTimeout(sessionId, 1500);
    if (attempt === null) {
      return;
    }

    cancelUrgentChatActivationRef.current = scheduleAfterNextPaint(() => {
      if (urgentChatActivationAttemptRef.current !== attempt) {
        return;
      }
      cancelUrgentChatActivationRef.current = null;
      onActivateChatSession(sessionId);
    });
  }, [onActivateChatSession, setUrgentHighlightWithTimeout]);

  useEffect(() => () => {
    cancelUrgentChatActivationRef.current?.();
    if (urgentHighlightTimeoutRef.current !== null) {
      window.clearTimeout(urgentHighlightTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!urgentHighlightedChatSessionId) {
      return;
    }
    if (
      activeShellTab?.kind === "chat"
      && activeShellTab.sessionId === urgentHighlightedChatSessionId
    ) {
      if (urgentHighlightTimeoutRef.current !== null) {
        window.clearTimeout(urgentHighlightTimeoutRef.current);
        urgentHighlightTimeoutRef.current = null;
      }
      if (workspaceUiKey) {
        clearUrgentHighlightedChatSessionForWorkspace(
          workspaceUiKey,
          urgentHighlightedChatSessionId,
        );
      }
    }
  }, [
    activeShellTab,
    clearUrgentHighlightedChatSessionForWorkspace,
    urgentHighlightedChatSessionId,
    workspaceUiKey,
  ]);

  return {
    urgentHighlightedChatSessionId,
    clearUrgentChatHighlight,
    previewHeaderChatTab,
    activateHeaderChatTab,
  };
}
