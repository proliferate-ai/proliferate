import { useEffect, useRef } from "react";
import { useTerminalWorkspaceConnection } from "#product/hooks/terminals/workflows/use-terminal-workspace-connection";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

// Q16 — hoist the gateway token refresh out of the lazy pane-attach path and
// into workspace selection/bootstrap. Once a workspace is selected and its
// runtime is no longer blocked, we fire-and-forget a single connection
// resolution: `resolveTerminalWorkspaceConnection` mints a fresh gateway
// access token. Pane activation then consumes a pre-warmed connection instead
// of paying that cost on the critical path.
//
// The pre-warm is best-effort and silent. A failure never surfaces a new error
// state; the ref is reset so a later attach (or re-selection) resolves the
// connection again through the exact lazy path that exists today. This adds no
// UI and asserts no "connected" state — it only warms the underlying token and
// tunnel caches ahead of time.
export function useTerminalConnectionPrewarm(): void {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const { getWorkspaceRuntimeBlockReason, resolveTerminalWorkspaceConnection } =
    useTerminalWorkspaceConnection();
  const prewarmedWorkspaceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      prewarmedWorkspaceIdRef.current = null;
      return;
    }
    // Runtime not reachable yet (e.g. cloud runtime still reconnecting). The
    // block-reason accessor's identity changes when that state resolves, which
    // re-runs this effect so the pre-warm fires as soon as the runtime is ready.
    if (getWorkspaceRuntimeBlockReason(selectedWorkspaceId)) {
      return;
    }
    if (prewarmedWorkspaceIdRef.current === selectedWorkspaceId) {
      return;
    }
    prewarmedWorkspaceIdRef.current = selectedWorkspaceId;
    void resolveTerminalWorkspaceConnection(selectedWorkspaceId).catch(() => {
      // Silent degrade: clear the marker so the lazy attach path (or a later
      // re-selection) can retry. No error surface is introduced.
      if (prewarmedWorkspaceIdRef.current === selectedWorkspaceId) {
        prewarmedWorkspaceIdRef.current = null;
      }
    });
  }, [
    selectedWorkspaceId,
    getWorkspaceRuntimeBlockReason,
    resolveTerminalWorkspaceConnection,
  ]);
}
