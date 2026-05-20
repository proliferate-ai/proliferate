import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { WorkspaceRenderSurface } from "@/lib/domain/workspaces/tabs/shell-activation";
import {
  isDocumentVisibleAndFocused,
  useDocumentFocusVisibilityNonce,
} from "@/hooks/ui/use-document-focus-visibility";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useActiveSessionActivityAcknowledgement(
  renderSurface: WorkspaceRenderSurface,
  options: { enabled?: boolean } = {},
): void {
  const focusVisibilityNonce = useDocumentFocusVisibilityNonce();
  const enabled = options.enabled ?? true;
  const activeSessionId = sessionIdFromRenderSurface(renderSurface);
  const {
    markSessionViewedAt,
    sessionLastInteracted,
    sessionLastViewedAt,
  } = useWorkspaceUiStore(useShallow((state) => ({
    markSessionViewedAt: state.markSessionViewedAt,
    sessionLastInteracted: state.sessionLastInteracted,
    sessionLastViewedAt: state.sessionLastViewedAt,
  })));
  const latestActivityAt = activeSessionId
    ? sessionLastInteracted[activeSessionId] ?? null
    : null;
  const latestViewedAt = activeSessionId
    ? sessionLastViewedAt[activeSessionId] ?? null
    : null;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (!activeSessionId || !latestActivityAt || !isDocumentVisibleAndFocused()) {
      return;
    }
    if (
      latestViewedAt
      && new Date(latestViewedAt).getTime() >= new Date(latestActivityAt).getTime()
    ) {
      return;
    }

    markSessionViewedAt(activeSessionId, latestActivityAt);
  }, [
    activeSessionId,
    enabled,
    focusVisibilityNonce,
    latestActivityAt,
    latestViewedAt,
    markSessionViewedAt,
  ]);
}

function sessionIdFromRenderSurface(
  renderSurface: WorkspaceRenderSurface,
): string | null {
  switch (renderSurface.kind) {
    case "chat-session":
    case "chat-session-pending":
      return renderSurface.sessionId;
    default:
      return null;
  }
}
