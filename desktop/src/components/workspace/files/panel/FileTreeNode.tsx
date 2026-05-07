import { memo } from "react";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { useWorkspaceFileTreeUiStore } from "@/stores/editor/workspace-file-tree-ui-store";
import {
  useDeleteWorkspaceEntryMutation,
  useRenameWorkspaceEntryMutation,
  useWorkspaceFilesQuery,
} from "@anyharness/sdk-react";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useFileTreeNativeContextMenu } from "@/hooks/editor/use-file-tree-native-context-menu";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import { ChevronRight, FilePlus, FolderPlus, Pencil, Trash } from "@/components/ui/icons";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import {
  parseViewerTargetKey,
  pathIsWithinWorkspaceEntry,
  remapViewerTargetPathWithinWorkspaceEntry,
  viewerTargetEditablePath,
  viewerTargetKey,
  type ViewerTarget,
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { TargetIcon } from "@/components/workspace/open-target/OpenTargetMenu";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  openTarget as execOpenTarget,
  type OpenTarget,
} from "@/platform/tauri/shell";

interface FileTreeNodeProps {
  entry: WorkspaceFileEntry;
  level: number;
  targets: OpenTarget[];
}

function FileTreeNodeInner({ entry, level, targets }: FileTreeNodeProps) {
  const treeStateKey = useWorkspaceViewerTabsStore((s) => s.treeStateKey);
  const workspaceUiKey = useWorkspaceViewerTabsStore((s) => s.workspaceUiKey);
  const activeTargetKey = useWorkspaceViewerTabsStore((s) => s.activeTargetKey);
  const materializedWorkspaceId = useWorkspaceViewerTabsStore((s) => s.materializedWorkspaceId);
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
  const { toggleDirectory, openFile } = useWorkspaceFileActions();
  const { activateChatShell, activateViewerTarget } = useWorkspaceShellActivation();
  const renameBufferPathPrefix = useWorkspaceFileBuffersStore((state) => state.renamePathPrefix);
  const clearBufferPathPrefix = useWorkspaceFileBuffersStore((state) => state.clearPathPrefix);
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
  const children = childQuery.data?.entries;

  const handleClick = () => {
    if (isDir) {
      if (treeStateKey) {
        setSelectedDirectory(treeStateKey, entry.path);
      }
      toggleDirectory(entry.path);
    } else {
      if (treeStateKey) {
        const parent = entry.path.split("/").slice(0, -1).join("/");
        setSelectedDirectory(treeStateKey, parent);
      }
      openFile(entry.path);
    }
  };
  const handleOpenTarget = (targetId: string) => {
    void execOpenTarget(targetId, entry.path);
  };
  const createParentPath = isDir ? entry.path : parentDirectoryPath(entry.path);
  const startCreate = (kind: "file" | "directory") => {
    if (!treeStateKey) {
      return;
    }
    if (createParentPath) {
      expandDirectory(treeStateKey, createParentPath);
    }
    startCreateDraft(treeStateKey, { kind, parentPath: createParentPath });
  };
  const handleRename = async () => {
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
      applyRenamedShellKeys(workspaceUiKey, renamePlan.keyMap);
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
  };
  const handleDelete = async () => {
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
      removeShellKeys(workspaceUiKey, closingTargetKeys);
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
  };
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

  const treeRow = (
    <div
      data-file-tree-entry
      role="treeitem"
      aria-level={level + 1}
      aria-selected={isActive}
      aria-expanded={isDir ? isExpanded : undefined}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
      onContextMenuCapture={onContextMenuCapture}
      className={`flex h-7 items-center gap-2 px-3 mx-2 rounded cursor-pointer text-[0.5rem] transition-colors group ${
        isActive
          ? "bg-sidebar-accent text-sidebar-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent"
      }`}
    >
      {isDir ? (
        <div className="relative size-3.5 shrink-0">
          <FileTreeEntryIcon
            name={entry.name}
            path={entry.path}
            kind={entry.kind}
            isExpanded={isExpanded}
            className="size-3.5 shrink-0 group-hover:invisible"
          />
          <ChevronRight
            className={`size-3.5 absolute inset-0 text-muted-foreground invisible group-hover:visible transition-transform duration-150 ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
        </div>
      ) : (
        <FileTreeEntryIcon
          name={entry.name}
          path={entry.path}
          kind={entry.kind}
        />
      )}

      <span className="truncate min-w-0 flex-1 text-[0.5rem]">{entry.name}</span>
      <div className="shrink-0 flex items-center gap-0.5 invisible group-hover:visible" />
    </div>
  );

  return (
    <div>
      <PopoverButton
        trigger={treeRow}
        triggerMode="contextMenu"
        stopPropagation
        className="w-52 rounded-lg border border-border bg-popover p-1 shadow-floating"
      >
        {(close) => (
          <div className="flex flex-col gap-px">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                handleClick();
                close();
              }}
              className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-foreground/80 hover:bg-accent/40 hover:text-foreground"
            >
              <FileTreeEntryIcon
                name={entry.name}
                path={entry.path}
                kind={entry.kind}
                className="size-3.5 shrink-0"
              />
              <span>Open in Proliferate</span>
            </Button>
            <div className="my-1 h-px bg-border" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                startCreate("file");
                close();
              }}
              className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-foreground/80 hover:bg-accent/40 hover:text-foreground"
            >
              <FilePlus className="size-3.5 shrink-0" />
              <span>New File</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                startCreate("directory");
                close();
              }}
              className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-foreground/80 hover:bg-accent/40 hover:text-foreground"
            >
              <FolderPlus className="size-3.5 shrink-0" />
              <span>New Folder</span>
            </Button>
            <div className="my-1 h-px bg-border" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleRename();
                close();
              }}
              className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-foreground/80 hover:bg-accent/40 hover:text-foreground"
            >
              <Pencil className="size-3.5 shrink-0" />
              <span>Rename</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleDelete();
                close();
              }}
              className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-destructive hover:bg-accent/40 hover:text-destructive"
            >
              <Trash className="size-3.5 shrink-0" />
              <span>Delete</span>
            </Button>
            {targets.length > 0 && <div className="my-1 h-px bg-border" />}
            {targets.map((target) => (
              <Button
                key={target.id}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  handleOpenTarget(target.id);
                  close();
                }}
                className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-foreground/80 hover:bg-accent/40 hover:text-foreground"
              >
                <TargetIcon target={target} size="size-3.5" />
                <span>{target.label}</span>
              </Button>
            ))}
          </div>
        )}
      </PopoverButton>

      {isDir && isExpanded && (
        <div className="pl-4">
          {childQuery.isLoading && (
            <div className="py-1 pl-[22px] text-[11px] text-muted-foreground">
              Loading...
            </div>
          )}
          {childQuery.isError && (
            <div className="py-1 pl-[22px] text-[11px] text-destructive">
              Failed to load
            </div>
          )}
          {children?.map((child) => (
            <FileTreeNode key={child.path} entry={child} level={level + 1} targets={targets} />
          ))}
        </div>
      )}
    </div>
  );
}

export const FileTreeNode = memo(FileTreeNodeInner);
FileTreeNode.displayName = "FileTreeNode";

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

function applyRenamedShellKeys(
  workspaceUiKey: string | null,
  keyMap: ReadonlyMap<ViewerTargetKey, ViewerTargetKey>,
): void {
  if (!workspaceUiKey || keyMap.size === 0) {
    return;
  }
  const ui = useWorkspaceUiStore.getState();
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

function removeShellKeys(
  workspaceUiKey: string | null,
  keys: ReadonlySet<ViewerTargetKey>,
): void {
  if (!workspaceUiKey || keys.size === 0) {
    return;
  }
  const ui = useWorkspaceUiStore.getState();
  const currentOrder = ui.shellTabOrderByWorkspace[workspaceUiKey];
  if (currentOrder) {
    ui.setShellTabOrderForWorkspace(
      workspaceUiKey,
      currentOrder.filter((key) => !keys.has(key as ViewerTargetKey)),
    );
  }
}
