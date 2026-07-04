import {
  useEffect,
  useRef,
  useState,
} from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { Input } from "@proliferate/ui/primitives/Input";
import { Button } from "@proliferate/ui/primitives/Button";
import { Search } from "@proliferate/ui/icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import { useWorkspaceFilesQuery } from "@anyharness/sdk-react";
import { FileSearchResultsTree } from "@/components/workspace/files/tree/FileSearchResultsTree";
import { FileTreeRow } from "@/components/workspace/files/tree/FileTreeRow";
import { useTreePanelResize } from "@/hooks/ui/layout/use-tree-panel-resize";
import { useFileTreeStore } from "@/stores/editor/file-tree-store";

interface FileTreeOverlayProps {
  open: boolean;
  workspaceId: string | null;
  selectedPath: string;
  onOpenFile: (path: string) => void;
  onClose: () => void;
  changedPaths?: Set<string>;
}

/**
 * Codex-style floating file browser: an overlay panel anchored top-right
 * within the files pane, layered over the code viewer (no viewer reflow).
 * Opened via the FolderTree toolbar button; dismissed on Escape or
 * outside-click. Width is drag-resizable from the left edge and persisted.
 */
export function FileTreeOverlay({
  open,
  workspaceId,
  selectedPath,
  onOpenFile,
  onClose,
  changedPaths,
}: FileTreeOverlayProps) {
  const width = useFileTreeStore((s) => s.width);
  const setWidth = useFileTreeStore((s) => s.setWidth);

  const panelRef = useRef<HTMLElement>(null);
  const { resizing, handleResizeStart } = useTreePanelResize({
    panelRef,
    width,
    setWidth,
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-30" data-file-tree-overlay>
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        aria-label="Close file browser"
        className="pointer-events-auto absolute inset-0 cursor-default bg-transparent"
        onClick={onClose}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-label="Browse files"
        className="pointer-events-auto absolute bottom-2 right-2 top-2 flex min-w-0 flex-col overflow-hidden rounded-lg border border-sidebar-border/80 bg-sidebar-background/95 shadow-floating-dark backdrop-blur"
        style={{ width: `min(${width}px, calc(100% - 1rem))` }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          className={twMerge(
            "absolute left-0 top-0 bottom-0 z-10 w-[5px] cursor-col-resize transition-colors duration-150",
            resizing ? "bg-accent" : "hover:bg-border",
          )}
          onPointerDown={handleResizeStart}
        />
        <FileTreeBody
          workspaceId={workspaceId}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
          changedPaths={changedPaths}
        />
      </section>
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
          <Search className="size-4 shrink-0" />
          <Input
            value={filter}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFilter(event.target.value)}
            placeholder="Filter files…"
            autoFocus
            className="h-full border-0 bg-transparent px-0 text-[13px] text-sidebar-foreground placeholder:text-sidebar-muted-foreground focus:ring-0"
          />
        </div>
      </div>
      {isSearching ? (
        <FileSearchResultsTree
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
  const expandedPaths = useFileTreeStore((s) => s.expandedPaths);
  const toggleExpanded = useFileTreeStore((s) => s.toggleExpanded);

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
      <div
        ref={scrollRef}
        role="tree"
        className="file-tree-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-1"
      >
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
    // jsdom (tests) and pre-layout frames report a zero-height scroll
    // element; seed a viewport so initial rows render.
    initialRect: { width: 400, height: 800 },
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
