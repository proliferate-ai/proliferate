import { useShortcutHandler } from "@/hooks/shortcuts/use-shortcut-handler";
import type { AppCommandActions } from "@/hooks/app/use-app-command-actions";
import { useSidebarShortcutTargets } from "@/hooks/workspaces/use-sidebar-shortcut-targets";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/use-workspace-navigation-workflow";
import { resolveSidebarShortcutDigitTarget } from "@/lib/domain/workspaces/sidebar/sidebar-shortcut-targets";
import {
  runRedoCommand,
  runSelectAllCommand,
  runUndoCommand,
} from "@/lib/infra/dom/dom-select-all";

export function useAppShortcuts(actions: AppCommandActions): void {
  const sidebarShortcutTargetIds = useSidebarShortcutTargets();
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();

  useShortcutHandler("app.open-settings", () => {
    actions.openSettings.execute("shortcut");
  });

  useShortcutHandler("app.go-home", () => {
    actions.goHome.execute("shortcut");
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

    const targetId = resolveSidebarShortcutDigitTarget(sidebarShortcutTargetIds, digit);
    if (targetId) {
      selectWorkspaceFromSurface(targetId, "shortcut");
    }
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
}
