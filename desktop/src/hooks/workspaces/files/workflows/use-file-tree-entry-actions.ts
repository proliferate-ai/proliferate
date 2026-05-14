import { useCallback } from "react";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import {
  useDeleteWorkspaceEntryMutation,
  useRenameWorkspaceEntryMutation,
  useWorkspaceFilesQuery,
} from "@anyharness/sdk-react";
import {
  parseViewerTargetKey,
  pathIsWithinWorkspaceEntry,
  remapViewerTargetPathWithinWorkspaceEntry,
  viewerTargetEditablePath,
  viewerTargetKey,
  type ViewerTarget,
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import { useFileTreeNativeContextMenu } from "@/hooks/editor/ui/use-file-tree-native-context-menu";
import { useTauriShellActions, type OpenTarget } from "@/hooks/access/tauri/use-shell-actions";
import { useWorkspaceFileContext } from "@/hooks/workspaces/files/derived/use-workspace-file-context";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceFileTreeUiStore } from "@/stores/editor/workspace-file-tree-ui-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";

interface UseFileTreeEntryActionsInput {
  entry: WorkspaceFileEntry;
  targets: OpenTarget[];
}

export function useFileTreeEntryActions({
  entry,
  targets,
}: UseFileTreeEntryActionsInput) {
  const fileContext = useWorkspaceFileContext();
  const { materializedWorkspaceId, treeStateKey, workspaceUiKey } = fileContext;
  const activeTargetKey = useWorkspaceViewerTabsStore((s) => s.activeTargetKey);
  const renamePathReferences = useWorkspaceViewerTabsStore((s) => s.renamePathReferences);
  const closePathReferences = useWorkspaceViewerTabsStore((s) => s.closePathReferences);
  const setSelectedDirectory = useWorkspaceFileTreeUiStore((state) => state.setSelectedDirectory);
  const startCreateDraft = useWorkspaceFileTreeUiStore((state) => state.startCreateDraft);
  const expandDirectory = useWorkspaceFileTreeUiStore((state) => state.expandDirectory);
  const isExpanded = useWorkspaceFileTreeUiStore((state) => (
    treeStateKey
      ? Boolean(state.expandedDirectoriesByTreeKey[treeStateKey]?.[entry.path])
      : false
  ));
  const { toggleDirectory, openFile } = useWorkspaceFileActions(fileContext);
  const { activateChatShell, activateViewerTarget } = useWorkspaceShellActivation();
  const renameBufferPathPrefix = useWorkspaceFileBuffersStore((state) => state.renamePathPrefix);
  const clearBufferPathPrefix = useWorkspaceFileBuffersStore((state) => state.clearPathPrefix);
  const { openTarget: execOpenTarget } = useTauriShellActions();
  const showToast = useToastStore((state) => state.show);
  const renameMutation = useRenameWorkspaceEntryMutation({
    workspaceId: materializedWorkspaceId,
  });
  const deleteMutation = useDeleteWorkspaceEntryMutation({
    workspaceId: materializedWorkspaceId,
  });

  const isDir = entry.kind === "directory";
  const childQuery = useWorkspaceFilesQuery({
    workspaceId: materializedWorkspaceId,
    path: entry.path,
    enabled: isDir && isExpanded && !!materializedWorkspaceId,
  });
  const activeTarget = activeTargetKey ? parseViewerTargetKey(activeTargetKey) : null;
  const isActive = activeTarget?.kind === "file" && activeTarget.path === entry.path;
  const createParentPath = isDir ? entry.path : parentDirectoryPath(entry.path);

  const handleClick = useCallback(() => {
    if (isDir) {
      if (treeStateKey) {
        setSelectedDirectory(treeStateKey, entry.path);
      }
      toggleDirectory(entry.path);
      return;
    }

    if (treeStateKey) {
      const parent = parentDirectoryPath(entry.path);
      setSelectedDirectory(treeStateKey, parent);
    }
    openFile(entry.path);
  }, [
    entry.path,
    isDir,
    openFile,
    setSelectedDirectory,
    toggleDirectory,
    treeStateKey,
  ]);

  const handleOpenTarget = useCallback((targetId: string) => {
    void execOpenTarget(targetId, entry.path);
  }, [entry.path, execOpenTarget]);

  const startCreate = useCallback((kind: "file" | "directory") => {
    if (!treeStateKey) {
      return;
    }
    if (createParentPath) {
      expandDirectory(treeStateKey, createParentPath);
    }
    startCreateDraft(treeStateKey, { kind, parentPath: createParentPath });
  }, [createParentPath, expandDirectory, startCreateDraft, treeStateKey]);

  const handleRename = useCallback(async () => {
    const nextName = window.prompt(`Rename ${entry.name}`, entry.name);
    if (nextName === null) {
      return;
    }
    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === entry.name) {
      return;
    }
    if (trimmedName.includes("/")) {
      showToast("Use a name, not a path, when renaming from the file tree.");
      return;
    }
    const parent = parentDirectoryPath(entry.path);
    const newPath = parent ? `${parent}/${trimmedName}` : trimmedName;
    const dirtyPaths = affectedDirtyBufferPaths(entry.path);
    if (dirtyPaths.length > 0) {
      showToast(`Save or close unsaved files before renaming ${entry.name}.`);
      return;
    }
    const previousViewerState = useWorkspaceViewerTabsStore.getState();
    try {
      const result = await renameMutation.mutateAsync({
        path: entry.path,
        newPath,
      });
      const renamePlan = buildRenameViewerTargetPlan(
        previousViewerState.openTargets,
        entry.path,
        result.entry.path,
      );
      renamePathReferences(entry.path, result.entry.path);
      renameBufferPathPrefix(entry.path, result.entry.path);
      applyRenamedViewerKeys(workspaceUiKey, materializedWorkspaceId, renamePlan.keyMap);
      const nextActiveTarget = previousViewerState.activeTargetKey
        ? renamePlan.targetByOldKey.get(previousViewerState.activeTargetKey)
        : null;
      if (nextActiveTarget && materializedWorkspaceId) {
        activateViewerTarget({
          workspaceId: materializedWorkspaceId,
          shellWorkspaceId: workspaceUiKey,
          target: nextActiveTarget,
          mode: "focus-existing",
        });
      }
      if (isDir && treeStateKey && isExpanded) {
        expandDirectory(treeStateKey, result.entry.path);
      }
      if (!isDir && renamePlan.keyMap.size === 0) {
        openFile(result.entry.path);
      }
      showToast(`Renamed ${entry.name}`, "info");
    } catch (error) {
      showToast(error instanceof Error ? error.message : `Failed to rename ${entry.name}`);
    }
  }, [
    activateViewerTarget,
    entry.name,
    entry.path,
    expandDirectory,
    isDir,
    isExpanded,
    materializedWorkspaceId,
    openFile,
    renameBufferPathPrefix,
    renameMutation,
    renamePathReferences,
    showToast,
    treeStateKey,
    workspaceUiKey,
  ]);

  const handleDelete = useCallback(async () => {
    const dirtyPaths = affectedDirtyBufferPaths(entry.path);
    if (dirtyPaths.length > 0) {
      showToast(`Save or close unsaved files before deleting ${entry.name}.`);
      return;
    }
    const label = isDir
      ? `Delete folder "${entry.name}" and all of its contents?`
      : `Delete file "${entry.name}"?`;
    if (!window.confirm(label)) {
      return;
    }
    const previousViewerState = useWorkspaceViewerTabsStore.getState();
    const closingTargetKeys = affectedViewerTargetKeys(
      previousViewerState.openTargets,
      entry.path,
    );
    try {
      await deleteMutation.mutateAsync({ path: entry.path });
      closePathReferences(entry.path);
      clearBufferPathPrefix(entry.path);
      removeViewerKeys(workspaceUiKey, materializedWorkspaceId, closingTargetKeys);
      if (previousViewerState.activeTargetKey && closingTargetKeys.has(previousViewerState.activeTargetKey)) {
        const nextViewerState = useWorkspaceViewerTabsStore.getState();
        const nextActiveTarget = nextViewerState.activeTargetKey
          ? nextViewerState.openTargets.find((target) =>
            viewerTargetKey(target) === nextViewerState.activeTargetKey
          ) ?? null
          : null;
        if (nextActiveTarget && materializedWorkspaceId) {
          activateViewerTarget({
            workspaceId: materializedWorkspaceId,
            shellWorkspaceId: workspaceUiKey,
            target: nextActiveTarget,
            mode: "focus-existing",
          });
        } else if (materializedWorkspaceId) {
          activateChatShell({
            workspaceId: materializedWorkspaceId,
            shellWorkspaceId: workspaceUiKey,
            reason: "delete_file_tree_entry",
          });
        }
      }
      showToast(`Deleted ${entry.name}`, "info");
    } catch (error) {
      showToast(error instanceof Error ? error.message : `Failed to delete ${entry.name}`);
    }
  }, [
    activateChatShell,
    activateViewerTarget,
    clearBufferPathPrefix,
    closePathReferences,
    deleteMutation,
    entry.name,
    entry.path,
    isDir,
    materializedWorkspaceId,
    showToast,
    workspaceUiKey,
  ]);

  const { onContextMenuCapture } = useFileTreeNativeContextMenu({
    targets,
    onOpenInProliferate: handleClick,
    onOpenTarget: handleOpenTarget,
    onNewFile: () => startCreate("file"),
    onNewFolder: () => startCreate("directory"),
    onRename: () => {
      void handleRename();
    },
    onDelete: () => {
      void handleDelete();
    },
  });

  return {
    isDir,
    isExpanded,
    isActive,
    childEntries: childQuery.data?.entries,
    isChildLoading: childQuery.isLoading,
    isChildError: childQuery.isError,
    handleClick,
    handleOpenTarget,
    handleDelete,
    handleRename,
    onContextMenuCapture,
    startCreate,
  };
}

function parentDirectoryPath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function affectedDirtyBufferPaths(entryPath: string): string[] {
  return Object.values(useWorkspaceFileBuffersStore.getState().buffersByPath)
    .filter((buffer) => buffer.isDirty && pathIsWithinWorkspaceEntry(buffer.path, entryPath))
    .map((buffer) => buffer.path);
}

function affectedViewerTargetKeys(
  targets: readonly ViewerTarget[],
  entryPath: string,
): Set<ViewerTargetKey> {
  return new Set(targets
    .filter((target) => {
      const editablePath = viewerTargetEditablePath(target);
      return !!editablePath && pathIsWithinWorkspaceEntry(editablePath, entryPath);
    })
    .map(viewerTargetKey));
}

function buildRenameViewerTargetPlan(
  targets: readonly ViewerTarget[],
  fromPath: string,
  toPath: string,
): {
  keyMap: Map<ViewerTargetKey, ViewerTargetKey>;
  targetByOldKey: Map<ViewerTargetKey, ViewerTarget>;
} {
  const keyMap = new Map<ViewerTargetKey, ViewerTargetKey>();
  const targetByOldKey = new Map<ViewerTargetKey, ViewerTarget>();
  for (const target of targets) {
    const nextTarget = remapViewerTargetPathWithinWorkspaceEntry(target, fromPath, toPath);
    const oldKey = viewerTargetKey(target);
    const nextKey = viewerTargetKey(nextTarget);
    if (oldKey !== nextKey) {
      keyMap.set(oldKey, nextKey);
      targetByOldKey.set(oldKey, nextTarget);
    }
  }
  return { keyMap, targetByOldKey };
}

function applyRenamedViewerKeys(
  workspaceUiKey: string | null,
  materializedWorkspaceId: string | null,
  keyMap: ReadonlyMap<ViewerTargetKey, ViewerTargetKey>,
): void {
  if (keyMap.size === 0) {
    return;
  }
  const ui = useWorkspaceUiStore.getState();
  if (workspaceUiKey) {
    const currentOrder = ui.shellTabOrderByWorkspace[workspaceUiKey];
    if (currentOrder) {
      ui.setShellTabOrderForWorkspace(
        workspaceUiKey,
        currentOrder.map((key) => keyMap.get(key as ViewerTargetKey) ?? key),
      );
    }
    const activeKey = ui.activeShellTabKeyByWorkspace[workspaceUiKey];
    const nextActiveKey = activeKey ? keyMap.get(activeKey as ViewerTargetKey) : null;
    if (nextActiveKey) {
      ui.setActiveShellTabKeyForWorkspace(workspaceUiKey, nextActiveKey);
    }
  }
  if (materializedWorkspaceId) {
    const currentPanel = ui.rightPanelMaterializedByWorkspace[materializedWorkspaceId];
    if (!currentPanel) {
      return;
    }
    const nextActiveEntryKey = keyMap.get(currentPanel.activeEntryKey as ViewerTargetKey)
      ?? currentPanel.activeEntryKey;
    ui.setRightPanelMaterializedForWorkspace(materializedWorkspaceId, {
      ...currentPanel,
      activeEntryKey: nextActiveEntryKey,
      headerOrder: currentPanel.headerOrder.map((key) =>
        keyMap.get(key as ViewerTargetKey) ?? key
      ),
    });
  }
}

function removeViewerKeys(
  workspaceUiKey: string | null,
  materializedWorkspaceId: string | null,
  keys: ReadonlySet<ViewerTargetKey>,
): void {
  if (keys.size === 0) {
    return;
  }
  const ui = useWorkspaceUiStore.getState();
  if (workspaceUiKey) {
    const currentOrder = ui.shellTabOrderByWorkspace[workspaceUiKey];
    if (currentOrder) {
      ui.setShellTabOrderForWorkspace(
        workspaceUiKey,
        currentOrder.filter((key) => !keys.has(key as ViewerTargetKey)),
      );
    }
  }
  if (materializedWorkspaceId) {
    const currentPanel = ui.rightPanelMaterializedByWorkspace[materializedWorkspaceId];
    if (!currentPanel) {
      return;
    }
    const headerOrder = currentPanel.headerOrder.filter((key) =>
      !keys.has(key as ViewerTargetKey)
    );
    ui.setRightPanelMaterializedForWorkspace(materializedWorkspaceId, {
      ...currentPanel,
      activeEntryKey: keys.has(currentPanel.activeEntryKey as ViewerTargetKey)
        ? "tool:files"
        : currentPanel.activeEntryKey,
      headerOrder,
    });
  }
}
