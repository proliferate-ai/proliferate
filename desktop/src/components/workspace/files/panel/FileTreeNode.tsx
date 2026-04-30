import type { WorkspaceFileEntry } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { useWorkspaceFileTreeUiStore } from "@/stores/editor/workspace-file-tree-ui-store";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useFileTreeNativeContextMenu } from "@/hooks/editor/use-file-tree-native-context-menu";
import { useWorkspaceFileActions } from "@/hooks/editor/use-workspace-file-actions";
import { ChevronRight } from "@/components/ui/icons";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { TargetIcon } from "@/components/workspace/open-target/OpenTargetMenu";
import {
  openTarget as execOpenTarget,
  type OpenTarget,
} from "@/platform/tauri/shell";

interface FileTreeNodeProps {
  entry: WorkspaceFileEntry;
  level: number;
  targets: OpenTarget[];
}

export function FileTreeNode({ entry, level, targets }: FileTreeNodeProps) {
  const treeStateKey = useWorkspaceFilesStore((s) => s.treeStateKey);
  const directoryEntriesByPath = useWorkspaceFilesStore((s) => s.directoryEntriesByPath);
  const directoryLoadStateByPath = useWorkspaceFilesStore((s) => s.directoryLoadStateByPath);
  const activeFilePath = useWorkspaceFilesStore((s) => s.activeFilePath);
  const isExpanded = useWorkspaceFileTreeUiStore((state) => (
    treeStateKey
      ? Boolean(state.expandedDirectoriesByTreeKey[treeStateKey]?.[entry.path])
      : false
  ));
  const { toggleDirectory, openFile } = useWorkspaceFileActions();

  const isDir = entry.kind === "directory";
  const isActive = activeFilePath === entry.path;
  const children = directoryEntriesByPath[entry.path];
  const loadState = directoryLoadStateByPath[entry.path];

  const handleClick = () => {
    if (isDir) {
      toggleDirectory(entry.path);
    } else {
      openFile(entry.path);
    }
  };
  const handleOpenTarget = (targetId: string) => {
    void execOpenTarget(targetId, entry.path);
  };
  const { onContextMenuCapture } = useFileTreeNativeContextMenu({
    targets,
    onOpenInProliferate: handleClick,
    onOpenTarget: handleOpenTarget,
  });

  const treeRow = (
    <div
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
          {loadState === "loading" && (
            <div className="py-1 pl-[22px] text-[11px] text-muted-foreground">
              Loading...
            </div>
          )}
          {loadState === "error" && (
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
