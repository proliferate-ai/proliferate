import { memo } from "react";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import type { OpenTarget } from "@/hooks/access/tauri/use-shell-actions";
import { useFileTreeEntryActions } from "@/hooks/workspaces/files/workflows/use-file-tree-entry-actions";
import { FileTreeEntryContextMenu } from "./FileTreeEntryContextMenu";
import { FileTreeEntryRow } from "./FileTreeEntryRow";

interface FileTreeNodeProps {
  entry: WorkspaceFileEntry;
  level: number;
  targets: OpenTarget[];
}

function FileTreeNodeInner({ entry, level, targets }: FileTreeNodeProps) {
  const {
    isDir,
    isExpanded,
    isActive,
    childEntries,
    isChildLoading,
    isChildError,
    handleClick,
    handleOpenTarget,
    handleDelete,
    handleRename,
    onContextMenuCapture,
    startCreate,
  } = useFileTreeEntryActions({ entry, targets });

  const treeRow = (
    <FileTreeEntryRow
      entry={entry}
      level={level}
      isActive={isActive}
      isExpanded={isExpanded}
      onClick={handleClick}
      onContextMenuCapture={onContextMenuCapture}
    />
  );

  return (
    <div>
      <FileTreeEntryContextMenu
        entry={entry}
        targets={targets}
        trigger={treeRow}
        onOpenInProliferate={handleClick}
        onOpenTarget={handleOpenTarget}
        onNewFile={() => startCreate("file")}
        onNewFolder={() => startCreate("directory")}
        onRename={() => {
          void handleRename();
        }}
        onDelete={() => {
          void handleDelete();
        }}
      />

      {isDir && isExpanded && (
        <div className="pl-4">
          {isChildLoading && (
            <div className="py-1 pl-[22px] text-[11px] text-muted-foreground">
              Loading...
            </div>
          )}
          {isChildError && (
            <div className="py-1 pl-[22px] text-[11px] text-destructive">
              Failed to load
            </div>
          )}
          {childEntries?.map((child) => (
            <FileTreeNode key={child.path} entry={child} level={level + 1} targets={targets} />
          ))}
        </div>
      )}
    </div>
  );
}

export const FileTreeNode = memo(FileTreeNodeInner);
FileTreeNode.displayName = "FileTreeNode";
