import { useEffect, useRef } from "react";

import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import type { AppCommandActions } from "#product/hooks/app/workflows/app-command-action-types";
import { useSidebarShortcutTargets } from "#product/hooks/workspaces/derived/use-sidebar-shortcut-targets";
import { useWorkspaceNavigationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import {
  focusChatInput,
  getFocusZone,
  isRightPanelFocusZone,
} from "#product/lib/domain/focus-zone";
import { resolveSidebarShortcutDigitTarget } from "#product/lib/domain/workspaces/sidebar/sidebar-shortcut-targets";
import {
  createWorkspaceSwitchCursorController,
  type WorkspaceSwitchCursorController,
} from "#product/lib/domain/workspaces/sidebar/workspace-switch-cursor-controller";
import { requestRightPanelTabByIndex } from "#product/lib/workflows/workspaces/right-panel-shortcut-requests";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSidebarSwitchCursorStore } from "#product/stores/workspaces/sidebar-switch-cursor-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { stepWindowZoomId } from "#product/lib/domain/preferences/appearance";
import {
  runRedoCommand,
  runSelectAllCommand,
  runUndoCommand,
} from "#product/lib/infra/dom/dom-select-all";

// Owns global app shortcut registration. App command behavior stays in the
// workflow actions passed by the caller.
export function useAppShortcuts(actions: AppCommandActions): void {
  const sidebarShortcutTargetIds = useSidebarShortcutTargets();
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();

  // Held-key workspace traversal (Cmd+Opt+Arrow) previews a lightweight cursor
  // through the sidebar and commits the one expensive selection only once
  // movement settles. The controller owns the throttle/settle/coalescing state
  // machine; refs keep the once-created controller reading current values
  // without re-subscribing the whole hook to selection changes.
  const targetIdsRef = useRef(sidebarShortcutTargetIds);
  targetIdsRef.current = sidebarShortcutTargetIds;
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

  useShortcutHandler("app.open-settings", () => {
    actions.openSettings.execute("shortcut");
  });

  useShortcutHandler("app.go-home", () => {
    actions.goHome.execute("shortcut");
  });

  // Unregistered rather than bound to a no-op while the workflows_v2 gate is
  // off, same as the support shortcut below: no entry point may reach the
  // dark gen-2 surface.
  useShortcutHandler(
    "app.go-automations",
    () => {
      actions.goWorkflows.execute("shortcut");
    },
    { enabled: !actions.goWorkflows.hidden },
  );

  useShortcutHandler("app.open-web", () => {
    actions.openWebApp.execute("shortcut");
  });

  // Mirrors the sidebar/palette hiding the support action under
  // `support.kind === "none"`: the shortcut is unregistered entirely rather
  // than bound to a no-op, so Cmd+S is inert when nothing is configured.
  useShortcutHandler(
    "app.open-support",
    () => {
      actions.openSupport.execute("shortcut");
    },
    { enabled: !actions.openSupport.hidden },
  );

  useShortcutHandler("app.show-keyboard-shortcuts", () => {
    actions.showKeyboardShortcuts.execute("shortcut");
  });

  useShortcutHandler("app.increase-window-zoom", () => {
    stepWindowZoomPreference(1);
  });

  useShortcutHandler("app.decrease-window-zoom", () => {
    stepWindowZoomPreference(-1);
  });

  useShortcutHandler("app.select-all", () => {
    return runSelectAllCommand();
  });

  useShortcutHandler("app.undo", () => {
    return runUndoCommand();
  });

  useShortcutHandler("app.redo", () => {
    return runRedoCommand();
  });

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

    const targetId = resolveSidebarShortcutDigitTarget(sidebarShortcutTargetIds, digit);
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

  useShortcutHandler("workspace.toggle-cowork-threads", () => {
    const store = useWorkspaceUiStore.getState();
    store.setThreadsCollapsed(!store.threadsCollapsed);
  });

  useShortcutHandler("workspace.new-default", () => {
    actions.goHome.execute("shortcut");
    window.setTimeout(() => {
      focusChatInput();
    }, 0);
  });

  useShortcutHandler("workspace.new-local", () => {
    actions.newLocalWorkspace.execute("shortcut");
  });

  useShortcutHandler("workspace.new-worktree", () => {
    actions.newWorktreeWorkspace.execute("shortcut");
  });

  useShortcutHandler("workspace.add-repository", () => {
    actions.addRepository.execute("shortcut");
  });

  useShortcutHandler("workspace.copy-path", () => {
    actions.copyWorkspacePath.execute("shortcut");
  });

  useShortcutHandler("workspace.copy-branch", () => {
    actions.copyBranchName.execute("shortcut");
  });
}

function stepWindowZoomPreference(delta: -1 | 1): void {
  const preferences = useUserPreferencesStore.getState();
  preferences.set("windowZoomId", stepWindowZoomId(preferences.windowZoomId, delta));
}
