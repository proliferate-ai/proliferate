import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { SHORTCUTS } from "@/config/shortcuts";
import { useWorkspaceFileActions } from "@/hooks/editor/use-workspace-file-actions";
import { useWorkspaceCommandPaletteFileSearch } from "@/hooks/workspaces/use-workspace-command-palette-file-search";
import { useWorkspaceCommandPaletteOpenFiles } from "@/hooks/workspaces/use-workspace-command-palette-open-files";
import { useWorkspaceCommandPaletteTabs } from "@/hooks/workspaces/use-workspace-command-palette-tabs";
import { useAppCommandActionsContext } from "@/providers/AppCommandActionsProvider";
import {
  commandPaletteCommandValue,
  commandPaletteFileValue,
  filterCommandPaletteEntries,
  groupCommandPaletteEntries,
  splitFilePath,
  type CommandPaletteEntry,
} from "@/lib/domain/command-palette/entries";
import { focusChatInput } from "@/lib/domain/focus-zone";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import { runShortcutHandler } from "@/lib/domain/shortcuts/registry";

interface RunCommandState {
  onRun: () => void;
  canRun: boolean;
  disabledReason: string | null;
  isLaunching: boolean;
}

interface UseWorkspaceCommandPaletteArgs {
  open: boolean;
  query: string;
  hasWorkspaceShell: boolean;
  selectedWorkspaceId: string | null;
  hasRuntimeReadyWorkspace: boolean;
  runtimeBlockedReason: string | null;
  repoSettingsHref: string | null;
  canOpenRepositorySettings: boolean;
  repositorySettingsDisabledReason: string | null;
  runCommand: RunCommandState;
  openTerminalPanel: () => boolean;
  onToggleLeftSidebar: () => void;
  onToggleRightPanel: () => void;
}

export function useWorkspaceCommandPalette({
  open,
  query,
  hasWorkspaceShell,
  selectedWorkspaceId,
  hasRuntimeReadyWorkspace,
  runtimeBlockedReason,
  repoSettingsHref,
  canOpenRepositorySettings,
  repositorySettingsDisabledReason,
  runCommand,
  openTerminalPanel,
  onToggleLeftSidebar,
  onToggleRightPanel,
}: UseWorkspaceCommandPaletteArgs) {
  const navigate = useNavigate();
  const appActions = useAppCommandActionsContext();
  const { openFile } = useWorkspaceFileActions();
  const {
    activeSessionId,
    activateRelativeTab,
    canActivateRelativeTab,
    canOpenNewSessionTab,
    newSessionDisabledReason,
    openNewSessionTab,
    relativeTabDisabledReason,
    restoreLastDismissedTab,
    restoreTabDisabledReason,
  } = useWorkspaceCommandPaletteTabs();
  const fileSearch = useWorkspaceCommandPaletteFileSearch({
    open,
    selectedWorkspaceId,
    hasRuntimeReadyWorkspace,
    query,
  });
  const openFiles = useWorkspaceCommandPaletteOpenFiles(selectedWorkspaceId);
  const trimmedQuery = query.trim();
  const fileDisabledReason = selectedWorkspaceId
    ? hasRuntimeReadyWorkspace
      ? null
      : runtimeBlockedReason ?? "Workspace runtime is not ready yet."
    : "Workspace is still opening.";

  const fileEntries = useMemo<CommandPaletteEntry[]>(() => {
    if (trimmedQuery.length > 0) {
      return fileSearch.results.map((result, index) => {
        const display = splitFilePath(result.path);
        return {
          id: `file-search:${index}`,
          value: commandPaletteFileValue(index),
          group: "files",
          label: result.name || display.name,
          detail: display.parent,
          keywords: [result.path],
          disabledReason: fileDisabledReason,
          execute: () => {
            void openFile(result.path);
          },
        };
      });
    }

    return openFiles.map((file, index) => ({
      id: `open-file:${index}`,
      value: commandPaletteFileValue(index),
      group: "files",
      label: file.name,
      detail: file.isActive ? `${file.parent || "Open file"} • Active` : file.parent,
      keywords: [file.path],
      disabledReason: fileDisabledReason,
      execute: () => {
        void openFile(file.path);
      },
    }));
  }, [fileDisabledReason, fileSearch.results, openFile, openFiles, trimmedQuery.length]);

  const commandEntries = useMemo<CommandPaletteEntry[]>(() => [
    {
      id: "workspace.focus-chat",
      value: commandPaletteCommandValue("workspace.focus-chat"),
      group: "workspace",
      label: "Focus Chat",
      icon: "chat",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.focusChat),
      disabledReason: hasWorkspaceShell ? null : "Workspace is still opening.",
      execute: () => {
        focusChatInput();
      },
    },
    {
      id: "workspace.open-terminal",
      value: commandPaletteCommandValue("workspace.open-terminal"),
      group: "workspace",
      label: "Show Terminal",
      icon: "panel-bottom",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.openTerminal),
      disabledReason: selectedWorkspaceId ? null : "Workspace is still opening.",
      execute: () => {
        openTerminalPanel();
      },
    },
    {
      id: "workspace.toggle-left-sidebar",
      value: commandPaletteCommandValue("workspace.toggle-left-sidebar"),
      group: "workspace",
      label: "Toggle Left Sidebar",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.toggleLeftSidebar),
      disabledReason: hasWorkspaceShell ? null : "Workspace is still opening.",
      execute: onToggleLeftSidebar,
    },
    {
      id: "workspace.toggle-right-panel",
      value: commandPaletteCommandValue("workspace.toggle-right-panel"),
      group: "workspace",
      label: "Toggle Right Panel",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.toggleRightPanel),
      disabledReason: hasWorkspaceShell ? null : "Workspace is still opening.",
      execute: onToggleRightPanel,
    },
    {
      id: "workspace.run-command",
      value: commandPaletteCommandValue("workspace.run-command"),
      group: "workspace",
      label: "Run Workspace Command",
      icon: "play",
      detail: runCommand.isLaunching ? "Launching..." : null,
      keywords: ["show run", "terminal"],
      disabledReason: runCommand.disabledReason,
      execute: runCommand.onRun,
    },
    {
      id: "workspace.repository-settings",
      value: commandPaletteCommandValue("workspace.repository-settings"),
      group: "workspace",
      label: "Repository Settings",
      icon: "settings",
      keywords: ["repo settings"],
      disabledReason: canOpenRepositorySettings
        ? null
        : repositorySettingsDisabledReason,
      execute: () => {
        if (repoSettingsHref) {
          navigate(repoSettingsHref);
        }
      },
    },
    {
      id: "workspace.new-session-tab",
      value: commandPaletteCommandValue("workspace.new-session-tab"),
      group: "tabs",
      label: "New Chat Tab",
      icon: "chat-plus",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.newSessionTab),
      disabledReason: canOpenNewSessionTab ? null : newSessionDisabledReason,
      execute: () => {
        openNewSessionTab();
      },
    },
    {
      id: "workspace.previous-tab",
      value: commandPaletteCommandValue("workspace.previous-tab"),
      group: "tabs",
      label: "Previous Tab",
      icon: "arrow-left",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.previousTab),
      disabledReason: canActivateRelativeTab ? null : relativeTabDisabledReason,
      execute: () => {
        activateRelativeTab(-1);
      },
    },
    {
      id: "workspace.next-tab",
      value: commandPaletteCommandValue("workspace.next-tab"),
      group: "tabs",
      label: "Next Tab",
      icon: "arrow-right",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.nextTab),
      disabledReason: canActivateRelativeTab ? null : relativeTabDisabledReason,
      execute: () => {
        activateRelativeTab(1);
      },
    },
    {
      id: "workspace.restore-tab",
      value: commandPaletteCommandValue("workspace.restore-tab"),
      group: "tabs",
      label: "Restore Closed Tab",
      icon: "rotate-ccw",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.restoreTab),
      disabledReason: restoreTabDisabledReason,
      execute: () => {
        restoreLastDismissedTab();
      },
    },
    {
      id: "session.rename",
      value: commandPaletteCommandValue("session.rename"),
      group: "tabs",
      label: "Rename Current Chat",
      icon: "pencil",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.renameSession),
      disabledReason: activeSessionId ? null : "No active chat tab.",
      execute: () => {
        runShortcutHandler("session.rename", { source: "palette" });
      },
    },
    {
      id: "app.open-settings",
      value: commandPaletteCommandValue("app.open-settings"),
      group: "app",
      label: "Open Settings",
      icon: "settings",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.openSettings),
      disabledReason: appActions.openSettings.disabledReason,
      execute: () => appActions.openSettings.execute("palette"),
    },
    {
      id: "workspace.add-repository",
      value: commandPaletteCommandValue("workspace.add-repository"),
      group: "app",
      label: "Add Repository",
      icon: "folder-plus",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.addRepository),
      disabledReason: appActions.addRepository.disabledReason,
      execute: () => appActions.addRepository.execute("palette"),
    },
    {
      id: "workspace.new-local",
      value: commandPaletteCommandValue("workspace.new-local"),
      group: "app",
      label: "New Local Workspace",
      icon: "folder-plus",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.newLocal),
      disabledReason: appActions.newLocalWorkspace.disabledReason,
      execute: () => appActions.newLocalWorkspace.execute("palette"),
    },
    {
      id: "workspace.new-worktree",
      value: commandPaletteCommandValue("workspace.new-worktree"),
      group: "app",
      label: "New Worktree Workspace",
      icon: "git-branch",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.newWorktree),
      disabledReason: appActions.newWorktreeWorkspace.disabledReason,
      execute: () => appActions.newWorktreeWorkspace.execute("palette"),
    },
    {
      id: "workspace.new-cloud",
      value: commandPaletteCommandValue("workspace.new-cloud"),
      group: "app",
      label: "New Cloud Workspace",
      icon: "cloud-plus",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.newCloud),
      disabledReason: appActions.newCloudWorkspace.disabledReason,
      execute: () => appActions.newCloudWorkspace.execute("palette"),
    },
  ], [
    appActions,
    activeSessionId,
    activateRelativeTab,
    canOpenRepositorySettings,
    canActivateRelativeTab,
    canOpenNewSessionTab,
    hasWorkspaceShell,
    navigate,
    newSessionDisabledReason,
    onToggleLeftSidebar,
    onToggleRightPanel,
    openTerminalPanel,
    openNewSessionTab,
    repoSettingsHref,
    repositorySettingsDisabledReason,
    relativeTabDisabledReason,
    restoreLastDismissedTab,
    restoreTabDisabledReason,
    runCommand.disabledReason,
    runCommand.isLaunching,
    runCommand.onRun,
    selectedWorkspaceId,
  ]);

  const visibleCommandEntries = useMemo(
    () => filterCommandPaletteEntries(commandEntries, trimmedQuery),
    [commandEntries, trimmedQuery],
  );
  const groups = useMemo(
    () => groupCommandPaletteEntries([...fileEntries, ...visibleCommandEntries]),
    [fileEntries, visibleCommandEntries],
  );

  return {
    groups,
    isSearchingFiles: fileSearch.isLoading,
    fileSearchError: fileSearch.isError,
    hasEntries: groups.some((group) => group.entries.length > 0),
  };
}
