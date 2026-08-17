import { useEffect, useRef } from "react";

import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { useSidebarShortcutTargets } from "#product/hooks/workspaces/derived/use-sidebar-shortcut-targets";
import { useWorkspaceNavigationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { getFocusZone, isRightPanelFocusZone } from "#product/lib/domain/focus-zone";
import { resolveSidebarShortcutDigitTarget } from "#product/lib/domain/workspaces/sidebar/sidebar-shortcut-targets";
import {
  createWorkspaceSwitchCursorController,
  type WorkspaceSwitchCursorController,
} from "#product/lib/domain/workspaces/sidebar/workspace-switch-cursor-controller";
import { requestRightPanelTabByIndex } from "#product/lib/workflows/workspaces/right-panel-shortcut-requests";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSidebarSwitchCursorStore } from "#product/stores/workspaces/sidebar-switch-cursor-store";

// Split out of use-app-shortcuts.ts (login runtime-budget fix). These three
// handlers (Cmd+1..9 by sidebar position, Cmd+Opt+Arrow traversal) are the
// only shortcuts that need useWorkspaceNavigationWorkflow's
// selectWorkspaceFromSurface, which pulls in workspace selection, the agent
// catalog, and session-creation machinery -- none of it relevant before a
// workspace exists, i.e. before auth. Pre-auth these shortcuts were already
// no-ops (no sidebar targets to select, no committed workspace to step from);
// mounting this hook only once authenticated (see
// AuthenticatedWorkspaceSwitchShortcuts / ProductLifecycleRoot.tsx) changes
// only when the handlers are registered, never what they do.
export function useWorkspaceSwitchShortcuts(): void {
  const { digitTargetIds, traversalTargetIds } = useSidebarShortcutTargets();
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();

  // Held-key workspace traversal (Cmd+Opt+Arrow) previews a lightweight cursor
  // through the sidebar and commits the one expensive selection only once
  // movement settles. The controller owns the throttle/settle/coalescing state
  // machine; refs keep the once-created controller reading current values
  // without re-subscribing the whole hook to selection changes.
  const targetIdsRef = useRef(traversalTargetIds);
  targetIdsRef.current = traversalTargetIds;
  const selectWorkspaceFromSurfaceRef = useRef(selectWorkspaceFromSurface);
  selectWorkspaceFromSurfaceRef.current = selectWorkspaceFromSurface;

  const switchCursorControllerRef = useRef<WorkspaceSwitchCursorController | null>(null);
  if (switchCursorControllerRef.current === null) {
    switchCursorControllerRef.current = createWorkspaceSwitchCursorController({
      now: () => performance.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (handle) => window.clearTimeout(handle),
      getTargetIds: () => targetIdsRef.current,
      getCommittedId: () => {
        const selection = useSessionSelectionStore.getState();
        return selection.selectedLogicalWorkspaceId ?? selection.selectedWorkspaceId;
      },
      getCursorId: () => useSidebarSwitchCursorStore.getState().cursorId,
      setCursorId: (cursorId) => useSidebarSwitchCursorStore.getState().setCursor(cursorId),
      commitSelection: (workspaceId) =>
        selectWorkspaceFromSurfaceRef.current(workspaceId, "shortcut"),
    });
  }

  useEffect(() => {
    const controller = switchCursorControllerRef.current;
    if (controller === null) {
      return undefined;
    }
    const readCommitted = (state: {
      selectedLogicalWorkspaceId: string | null;
      selectedWorkspaceId: string | null;
    }) => state.selectedLogicalWorkspaceId ?? state.selectedWorkspaceId;
    let lastCommitted = readCommitted(useSessionSelectionStore.getState());
    const unsubscribe = useSessionSelectionStore.subscribe((state) => {
      const committed = readCommitted(state);
      if (committed === lastCommitted) {
        return;
      }
      lastCommitted = committed;
      controller.onCommittedChange(committed);
    });
    // Escape cancels an uncommitted preview. Capture-phase and side-effect free
    // (no preventDefault) so any other Escape handling still runs, and it only
    // acts while a cursor is actually pending.
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        useSidebarSwitchCursorStore.getState().cursorId !== null
      ) {
        controller.cancel();
      }
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, []);

  useShortcutHandler("workspace.by-index", ({ digit }) => {
    if (!digit) {
      return false;
    }

    if (isRightPanelFocusZone(getFocusZone())) {
      const handled = requestRightPanelTabByIndex(digit);
      if (handled) {
        return true;
      }
    }

    const targetId = resolveSidebarShortcutDigitTarget(digitTargetIds, digit);
    if (targetId) {
      selectWorkspaceFromSurface(targetId, "shortcut");
    }
  });

  useShortcutHandler("workspace.previous-workspace", () => {
    switchCursorControllerRef.current?.step(-1);
  });

  useShortcutHandler("workspace.next-workspace", () => {
    switchCursorControllerRef.current?.step(1);
  });
}
