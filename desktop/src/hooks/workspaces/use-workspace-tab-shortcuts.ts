import { useEffect } from "react";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { SHORTCUTS } from "@/config/shortcuts";
import { getFocusZone } from "@/hooks/ui/use-focus-zone";
import { listenForCurrentWindowCloseActiveTabRequested } from "@/platform/tauri/window";
import type { WorkspaceTabActions } from "@/hooks/workspaces/use-workspace-tab-actions";

function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }

  return element.tagName === "INPUT"
    || element.tagName === "TEXTAREA"
    || element.isContentEditable;
}

interface WorkspaceTabShortcutActions extends Pick<
  WorkspaceTabActions,
  | "activateRelativeTab"
  | "activateTabByShortcutIndex"
  | "closeActiveWorkspaceTab"
  | "openNewSessionTab"
  | "restoreLastDismissedTab"
> {
  /** When provided, Cmd+T in terminal focus creates a terminal tab instead of a session tab. */
  createNewTerminalTab?: () => void;
}

export function useWorkspaceTabShortcuts(actions: WorkspaceTabShortcutActions): void {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const {
    activateRelativeTab,
    activateTabByShortcutIndex,
    closeActiveWorkspaceTab,
    openNewSessionTab,
    restoreLastDismissedTab,
    createNewTerminalTab,
  } = actions;

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return undefined;
    }

    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }

      const textEntryTarget = isTextEntryTarget(event.target);

      if (event.shiftKey && event.key === SHORTCUTS.previousTab.key) {
        if (textEntryTarget) {
          return;
        }
        if (activateRelativeTab(-1)) {
          event.preventDefault();
        }
        return;
      }

      if (event.shiftKey && event.key === SHORTCUTS.nextTab.key) {
        if (textEntryTarget) {
          return;
        }
        if (activateRelativeTab(1)) {
          event.preventDefault();
        }
        return;
      }

      if (event.shiftKey && event.key.toLowerCase() === SHORTCUTS.restoreTab.key) {
        if (restoreLastDismissedTab()) {
          event.preventDefault();
        }
        return;
      }

      if (event.shiftKey) {
        return;
      }

      if (activateTabByShortcutIndex(event.key)) {
        event.preventDefault();
        return;
      }

      switch (event.key.toLowerCase()) {
        case SHORTCUTS.newSessionTab.key:
          if (createNewTerminalTab && getFocusZone() === "terminal") {
            event.preventDefault();
            createNewTerminalTab();
          } else if (openNewSessionTab()) {
            event.preventDefault();
          }
          break;
        case SHORTCUTS.closeTab.key:
          if (closeActiveWorkspaceTab() !== "noop") {
            event.preventDefault();
          }
          break;
      }
    };

    window.addEventListener("keydown", handler, { capture: true });

    let disposed = false;
    let unlistenCloseTab = () => {};
    void listenForCurrentWindowCloseActiveTabRequested(() => {
      closeActiveWorkspaceTab();
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlistenCloseTab = dispose;
    });

    return () => {
      disposed = true;
      unlistenCloseTab();
      window.removeEventListener("keydown", handler, { capture: true });
    };
  }, [
    activateRelativeTab,
    activateTabByShortcutIndex,
    closeActiveWorkspaceTab,
    createNewTerminalTab,
    openNewSessionTab,
    restoreLastDismissedTab,
    selectedWorkspaceId,
  ]);
}
