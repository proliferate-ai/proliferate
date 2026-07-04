import {
  useCallback,
  useRef,
  useState,
} from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { Input } from "@proliferate/ui/primitives/Input";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  ChevronRight,
  Search,
  SplitPanelLeft,
} from "@proliferate/ui/icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import {
  useSearchWorkspaceFilesQuery,
  useWorkspaceFilesQuery,
} from "@anyharness/sdk-react";
import { FileTreeEntryIcon } from "@/components/workspace/files/file-icons";
import {
  FILE_TREE_MAX_WIDTH_RATIO,
  FILE_TREE_MIN_WIDTH,
  useFileTreeSidebarStore,
} from "@/stores/editor/file-tree-sidebar-store";

interface FileTreeSidebarProps {
  workspaceId: string | null;
  selectedPath: string;
  onOpenFile: (path: string) => void;
  changedPaths?: Set<string>;
}

export function FileTreeSidebar({
  workspaceId,
  selectedPath,
  onOpenFile,
  changedPaths,
}: FileTreeSidebarProps) {
  const width = useFileTreeSidebarStore((s) => s.width);
  const collapsed = useFileTreeSidebarStore((s) => s.collapsed);
  const setWidth = useFileTreeSidebarStore((s) => s.setWidth);
  const toggleCollapsed = useFileTreeSidebarStore((s) => s.toggleCollapsed);

  const containerRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);

  const handleResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      setResizing(true);
      const startX = event.clientX;
      const startWidth = width;

      const handleMove = (moveEvent: PointerEvent) => {
        const parentWidth = containerRef.current?.parentElement?.clientWidth ?? 1000;
        const maxWidth = parentWidth * FILE_TREE_MAX_WIDTH_RATIO;
        const newWidth = Math.min(maxWidth, Math.max(FILE_TREE_MIN_WIDTH, startWidth + (moveEvent.clientX - startX)));
        setWidth(newWidth);
      };

      const handleUp = () => {
        setResizing(false);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [width, setWidth],
  );

  if (collapsed) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-sidebar-background"
      style={{ width }}
    >
      <FileTreeHeader onToggleCollapse={toggleCollapsed} />
      <FileTreeBody
        workspaceId={workspaceId}
        selectedPath={selectedPath}
        onOpenFile={onOpenFile}
        changedPaths={changedPaths}
      />
      <div
        role="separator"
        aria-orientation="vertical"
        className={twMerge(
          "absolute right-0 top-0 bottom-0 z-10 w-[4px] cursor-col-resize transition-colors duration-150",
          resizing
            ? "bg-accent"
            : "hover:bg-border",
        )}
        style={{ transform: "translateX(50%)" }}
        onPointerDown={handleResizeStart}
      />
    </div>
  );
}

function FileTreeHeader({ onToggleCollapse }: { onToggleCollapse: () => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Files
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Hide file tree"
        className="size-6 rounded text-muted-foreground hover:bg-list-hover hover:text-foreground"
        onClick={onToggleCollapse}
      >
        <SplitPanelLeft className="size-3.5" />
      </Button>
    </div>
  );
}

interface FileTreeBodyProps {
  workspaceId: string | null;
  selectedPath: string;
  onOpenFile: (path: string) => void;
  changedPaths?: Set<string>;
}

function FileTreeBody({
  workspaceId,
  selectedPath,
  onOpenFile,
  changedPaths,
}: FileTreeBodyProps) {
  const [filter, setFilter] = useState("");
  const query = filter.trim();
  const isSearching = query.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pt-2 pb-1">
        <div className="flex h-7 items-center gap-1.5 rounded-[10px] bg-sidebar-accent px-2 text-sidebar-muted-foreground">
          <Search className="size-3 shrink-0" />
          <Input
            value={filter}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFilter(event.target.value)}
            placeholder="Filter files…"
            className="h-full border-0 bg-transparent px-0 text-xs text-sidebar-foreground placeholder:text-sidebar-muted-foreground focus:ring-0"
          />
        </div>
      </div>
      {isSearching ? (
        <FileSearchResults
          workspaceId={workspaceId}
          query={query}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
          changedPaths={changedPaths}
        />
      ) : (
        <FileTreeDirectory
          workspaceId={workspaceId}
          path=""
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
          changedPaths={changedPaths}
          level={0}
        />
      )}
    </div>
  );
}

interface FileSearchResultsProps {
  workspaceId: string | null;
  query: string;
  selectedPath: string;
  onOpenFile: (path: string) => void;
  changedPaths?: Set<string>;
}

function FileSearchResults({
  workspaceId,
  query,
  selectedPath,
  onOpenFile,
  changedPaths,
}: FileSearchResultsProps) {
  const searchQuery = useSearchWorkspaceFilesQuery({
    workspaceId,
    query,
    limit: 60,
    enabled: Boolean(workspaceId) && query.length > 0,
  });

  const results = searchQuery.data?.results ?? [];

  if (results.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-sidebar-muted-foreground">
        {searchQuery.isLoading ? "Searching…" : "No matching files"}
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
      {results.map((result) => (
        <FileTreeRow
          key={result.path}
          name={result.name}
          path={result.path}
          kind="file"
          level={0}
          selected={result.path === selectedPath}
          changed={changedPaths?.has(result.path)}
          onClick={() => onOpenFile(result.path)}
        />
      ))}
    </div>
  );
}

interface FileTreeDirectoryProps {
  workspaceId: string | null;
  path: string;
  selectedPath: string;
  onOpenFile: (path: string) => void;
  changedPaths?: Set<string>;
  level: number;
}

function FileTreeDirectory({
  workspaceId,
  path,
  selectedPath,
  onOpenFile,
  changedPaths,
  level,
}: FileTreeDirectoryProps) {
  const expandedPaths = useFileTreeSidebarStore((s) => s.expandedPaths);
  const toggleExpanded = useFileTreeSidebarStore((s) => s.toggleExpanded);

  const filesQuery = useWorkspaceFilesQuery({
    workspaceId,
    path,
    enabled: Boolean(workspaceId),
  });

  const entries = filesQuery.data?.entries ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  // Only virtualize the root level
  if (level === 0) {
    return (
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        <VirtualizedTree
          scrollRef={scrollRef}
          entries={entries}
          workspaceId={workspaceId}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
          changedPaths={changedPaths}
          expandedPaths={expandedPaths}
          toggleExpanded={toggleExpanded}
          level={level}
        />
      </div>
    );
  }

  return (
    <>
      {entries.map((entry) => (
        <FileTreeEntryRow
          key={entry.path}
          entry={entry}
          workspaceId={workspaceId}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
          changedPaths={changedPaths}
          expandedPaths={expandedPaths}
          toggleExpanded={toggleExpanded}
          level={level}
        />
      ))}
    </>
  );
}

function VirtualizedTree({
  scrollRef,
  entries,
  workspaceId,
  selectedPath,
  onOpenFile,
  changedPaths,
  expandedPaths,
  toggleExpanded,
  level,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  entries: readonly WorkspaceFileEntry[];
  workspaceId: string | null;
  selectedPath: string;
  onOpenFile: (path: string) => void;
  changedPaths?: Set<string>;
  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  level: number;
}) {
  // For the root tree, we render entries + their expanded children inline
  // We only virtualize at the top-level list for now
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  return (
    <div
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const entry = entries[virtualItem.index]!;
        return (
          <div
            key={entry.path}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <FileTreeEntryRow
              entry={entry}
              workspaceId={workspaceId}
              selectedPath={selectedPath}
              onOpenFile={onOpenFile}
              changedPaths={changedPaths}
              expandedPaths={expandedPaths}
              toggleExpanded={toggleExpanded}
              level={level}
            />
          </div>
        );
      })}
    </div>
  );
}

function FileTreeEntryRow({
  entry,
  workspaceId,
  selectedPath,
  onOpenFile,
  changedPaths,
  expandedPaths,
  toggleExpanded,
  level,
}: {
  entry: WorkspaceFileEntry;
  workspaceId: string | null;
  selectedPath: string;
  onOpenFile: (path: string) => void;
  changedPaths?: Set<string>;
  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  level: number;
}) {
  const isDirectory = entry.kind === "directory";
  const expanded = isDirectory && expandedPaths.has(entry.path);

  return (
    <div>
      <FileTreeRow
        name={entry.name}
        path={entry.path}
        kind={isDirectory ? "directory" : "file"}
        level={level}
        selected={!isDirectory && entry.path === selectedPath}
        expanded={isDirectory ? expanded : undefined}
        changed={changedPaths?.has(entry.path)}
        onClick={() => {
          if (isDirectory) {
            toggleExpanded(entry.path);
          } else {
            onOpenFile(entry.path);
          }
        }}
      />
      {isDirectory && expanded && (
        <FileTreeDirectory
          workspaceId={workspaceId}
          path={entry.path}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
          changedPaths={changedPaths}
          level={level + 1}
        />
      )}
    </div>
  );
}

function FileTreeRow({
  name,
  path,
  kind,
  level,
  selected = false,
  expanded,
  changed = false,
  onClick,
}: {
  name: string;
  path: string;
  kind: "file" | "directory";
  level: number;
  selected?: boolean;
  expanded?: boolean;
  changed?: boolean;
  onClick: () => void;
}) {
  const isDirectory = kind === "directory";
  const paddingLeft = isDirectory ? 6 + level * 12 : 18 + level * 12;

  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={isDirectory ? expanded : undefined}
      aria-selected={selected}
      aria-level={level + 1}
      title={path}
      className={twMerge(
        "flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] leading-none transition-colors duration-150",
        "hover:bg-sidebar-accent",
        isDirectory ? "text-sidebar-muted-foreground" : "text-sidebar-foreground",
        selected && "bg-sidebar-accent text-sidebar-foreground",
      )}
      style={{ paddingLeft }}
      onClick={onClick}
    >
      {isDirectory && (
        <ChevronRight
          className={twMerge(
            "size-3 shrink-0 transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
      )}
      <FileTreeEntryIcon
        name={name}
        path={path}
        kind={kind}
        isExpanded={isDirectory ? expanded : undefined}
        className="size-4 shrink-0"
      />
      <span className="min-w-0 flex-1 truncate">
        {name}
      </span>
      {changed && (
        <span
          className="inline-flex size-2 shrink-0 rounded-full bg-accent"
          aria-label="Modified"
        />
      )}
    </button>
  );
}
