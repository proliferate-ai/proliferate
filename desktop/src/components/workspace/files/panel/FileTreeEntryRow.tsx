import { forwardRef, type MouseEvent } from "react";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import { ChevronRight } from "@/components/ui/icons";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";

export const FileTreeEntryRow = forwardRef<HTMLDivElement, {
  entry: WorkspaceFileEntry;
  level: number;
  isActive: boolean;
  isExpanded: boolean;
  onClick: () => void;
  onContextMenuCapture: (event: MouseEvent) => void;
}>(function FileTreeEntryRow({
  entry,
  level,
  isActive,
  isExpanded,
  onClick,
  onContextMenuCapture,
}, ref) {
  const isDir = entry.kind === "directory";
  return (
    <div
      ref={ref}
      data-file-tree-entry
      role="treeitem"
      aria-level={level + 1}
      aria-selected={isActive}
      aria-expanded={isDir ? isExpanded : undefined}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => event.key === "Enter" && onClick()}
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
            className={`size-3.5 absolute inset-0 text-sidebar-muted-foreground invisible group-hover:visible transition-transform duration-150 ${
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
});
