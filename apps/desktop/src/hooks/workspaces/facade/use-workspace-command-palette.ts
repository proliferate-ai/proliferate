import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceFileActions } from "@/hooks/workspaces/facade/files/use-workspace-file-actions";
import { useWorkspaceFileSearch } from "@/hooks/workspaces/ui/files/use-workspace-file-search";
import { useWorkspaceCommandPaletteOpenFiles } from "@/hooks/workspaces/derived/use-workspace-command-palette-open-files";
import { useWorkspaceCommandPaletteTabs } from "@/hooks/workspaces/workflows/use-workspace-command-palette-tabs";
import { useAppCommandActionsContext } from "@/providers/AppCommandActionsProvider";
import {
  commandPaletteFileValue,
  filterCommandPaletteEntries,
  groupCommandPaletteEntries,
  splitFilePath,
  type CommandPaletteEntry,
} from "@/lib/domain/command-palette/entries";
import {
  buildWorkspaceCommandPaletteEntries,
  type RunCommandState,
  type WorkspaceRemoteAccessActionState,
  type WorkspaceWebActionState,
} from "@/hooks/workspaces/facade/workspace-command-palette-entries";

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
  workspaceWebActions: WorkspaceWebActionState;
  workspaceRemoteAccessActions: WorkspaceRemoteAccessActionState;
  openTerminalPanel: () => boolean;
  onToggleLeftSidebar: () => void;
  onToggleRightPanel: () => void;
}

// Owns the command palette view-model for the workspace shell.
// Search mechanics, open-file state, and tab actions live in narrower hooks.
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
  workspaceWebActions,
  workspaceRemoteAccessActions,
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
  const fileSearch = useWorkspaceFileSearch({
    open,
    workspaceId: selectedWorkspaceId,
    runtimeReady: hasRuntimeReadyWorkspace,
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

  const commandEntries = useMemo<CommandPaletteEntry[]>(() =>
    buildWorkspaceCommandPaletteEntries({
      activeSessionId,
      appActions,
      canActivateRelativeTab,
      canOpenNewSessionTab,
      canOpenRepositorySettings,
      hasWorkspaceShell,
      navigate,
      newSessionDisabledReason,
      onToggleLeftSidebar,
      onToggleRightPanel,
      openNewSessionTab,
      openTerminalPanel,
      activateRelativeTab,
      relativeTabDisabledReason,
      repoSettingsHref,
      repositorySettingsDisabledReason,
      restoreLastDismissedTab,
      restoreTabDisabledReason,
      runCommand,
      selectedWorkspaceId,
      workspaceRemoteAccessActions,
      workspaceWebActions,
    }), [
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
    workspaceRemoteAccessActions.syncToWeb,
    workspaceRemoteAccessActions.syncToWebDisabledReason,
    workspaceWebActions.disabledReason,
    workspaceWebActions.openCurrentWorkspaceInWeb,
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
