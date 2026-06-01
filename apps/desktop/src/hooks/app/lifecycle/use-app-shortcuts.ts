import { useShortcutHandler } from "@/hooks/shortcuts/lifecycle/use-shortcut-handler";
import type { AppCommandActions } from "@/hooks/app/workflows/app-command-action-types";
import { useSidebarShortcutTargets } from "@/hooks/workspaces/derived/use-sidebar-shortcut-targets";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { getFocusZone, isRightPanelFocusZone } from "@/lib/domain/focus-zone";
import {
  resolveAdjacentSidebarShortcutTarget,
  resolveSidebarShortcutDigitTarget,
} from "@/lib/domain/workspaces/sidebar/sidebar-shortcut-targets";
import { requestRightPanelTabByIndex } from "@/lib/workflows/workspaces/right-panel-shortcut-requests";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { stepAppearanceFontSizes } from "@/lib/domain/preferences/appearance";
import {
  runRedoCommand,
  runSelectAllCommand,
  runUndoCommand,
} from "@/lib/infra/dom/dom-select-all";

// Owns global app shortcut registration. App command behavior stays in the
// workflow actions passed by the caller.
export function useAppShortcuts(actions: AppCommandActions): void {
  const sidebarShortcutTargetIds = useSidebarShortcutTargets();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();

  useShortcutHandler("app.open-settings", () => {
    actions.openSettings.execute("shortcut");
  });

  useShortcutHandler("app.go-home", () => {
    actions.goHome.execute("shortcut");
  });

  useShortcutHandler("app.go-plugins", () => {
    actions.goPlugins.execute("shortcut");
  });

  useShortcutHandler("app.go-automations", () => {
    actions.goAutomations.execute("shortcut");
  });

  useShortcutHandler("app.open-web", () => {
    actions.openWebApp.execute("shortcut");
  });

  useShortcutHandler("app.open-support", () => {
    actions.openSupport.execute("shortcut");
  });

  useShortcutHandler("app.show-keyboard-shortcuts", () => {
    actions.showKeyboardShortcuts.execute("shortcut");
  });

  useShortcutHandler("app.increase-text-size", () => {
    stepTextSizePreference(1);
  });

  useShortcutHandler("app.decrease-text-size", () => {
    stepTextSizePreference(-1);
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
    const targetId = resolveAdjacentSidebarShortcutTarget(
      sidebarShortcutTargetIds,
      selectedLogicalWorkspaceId ?? selectedWorkspaceId,
      -1,
    );
    if (targetId) {
      selectWorkspaceFromSurface(targetId, "shortcut");
    }
  });

  useShortcutHandler("workspace.next-workspace", () => {
    const targetId = resolveAdjacentSidebarShortcutTarget(
      sidebarShortcutTargetIds,
      selectedLogicalWorkspaceId ?? selectedWorkspaceId,
      1,
    );
    if (targetId) {
      selectWorkspaceFromSurface(targetId, "shortcut");
    }
  });

  useShortcutHandler("workspace.toggle-cowork-threads", () => {
    const store = useWorkspaceUiStore.getState();
    store.setThreadsCollapsed(!store.threadsCollapsed);
  });

  useShortcutHandler("workspace.new-local", () => {
    actions.newLocalWorkspace.execute("shortcut");
  });

  useShortcutHandler("workspace.new-worktree", () => {
    actions.newWorktreeWorkspace.execute("shortcut");
  });

  useShortcutHandler("workspace.new-cloud", () => {
    actions.newCloudWorkspace.execute("shortcut");
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

function stepTextSizePreference(delta: -1 | 1): void {
  const preferences = useUserPreferencesStore.getState();
  preferences.setMultiple(stepAppearanceFontSizes({
    uiFontSizeId: preferences.uiFontSizeId,
    readableCodeFontSizeId: preferences.readableCodeFontSizeId,
  }, delta));
}
