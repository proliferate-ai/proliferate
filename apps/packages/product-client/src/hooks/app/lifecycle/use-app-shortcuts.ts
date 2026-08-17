import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import type { AppCommandActions } from "#product/hooks/app/workflows/app-command-action-types";
import { focusChatInput } from "#product/lib/domain/focus-zone";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { stepWindowZoomId } from "#product/lib/domain/preferences/appearance";
import {
  runRedoCommand,
  runSelectAllCommand,
  runUndoCommand,
} from "#product/lib/infra/dom/dom-select-all";

// Owns global app shortcut registration. App command behavior stays in the
// workflow actions passed by the caller. The workspace-switch shortcuts
// (Cmd+1..9, Cmd+Opt+Arrow) live in useWorkspaceSwitchShortcuts instead of
// here (login runtime-budget fix): they are the only shortcuts that need
// useWorkspaceNavigationWorkflow's selectWorkspaceFromSurface, which pulls in
// the workspace-selection / agent-catalog / session-creation graph, and that
// hook is mounted authenticated-only so the /login first-load chunk never
// parses it. See AuthenticatedWorkspaceSwitchShortcuts /
// ProductLifecycleRoot.tsx for the mount point.
export function useAppShortcuts(actions: AppCommandActions): void {
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
