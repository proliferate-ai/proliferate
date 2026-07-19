import {
  useEffect,
  useRef,
  useState,
} from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { Input } from "@proliferate/ui/primitives/Input";
import { Button } from "@proliferate/ui/primitives/Button";
import { Search, X } from "@proliferate/ui/icons";
import { FileSearchResultsTree } from "#product/components/workspace/files/tree/FileSearchResultsTree";
import { FileTreeDirectory } from "#product/components/workspace/files/tree/FileTreeDirectory";
import { useTreePanelResize } from "#product/hooks/ui/layout/use-tree-panel-resize";
import {
  FILE_TREE_MIN_WIDTH,
  useFileTreeStore,
} from "#product/stores/editor/file-tree-store";

interface FileTreeOverlayProps {
  open: boolean;
  workspaceId: string | null;
  selectedPath: string;
  onOpenFile: (path: string) => void;
  onClose: () => void;
  changedPaths?: Set<string>;
}

/**
 * Floating file browser anchored top-right within the files pane, layered over
 * the code viewer. Escape and outside click dismiss it; the left edge supports
 * pointer and keyboard resizing.
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
  const { resizing, handleResizeStart, handleResizeKeyDown } = useTreePanelResize({
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
        className="pointer-events-auto absolute bottom-2 right-2 top-2 flex min-w-0 flex-col overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-background shadow-floating-dark"
        style={{ width: `min(${width}px, calc(100% - 1rem))` }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file browser"
          aria-valuemin={FILE_TREE_MIN_WIDTH}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          data-file-tree-resize-handle
          className={`absolute bottom-0 left-0 top-0 z-10 w-2 cursor-col-resize focus-visible:outline focus-visible:outline-1 focus-visible:outline-sidebar-ring${resizing ? " bg-sidebar-accent" : ""}`}
          onPointerDown={handleResizeStart}
          onKeyDown={handleResizeKeyDown}
        >
          <span
            className={twMerge(
              "absolute bottom-0 left-0 top-0 w-px bg-sidebar-border transition-colors",
              resizing && "w-0.5 bg-sidebar-ring",
            )}
          />
        </div>
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
  const setExpanded = useFileTreeStore((s) => s.setExpanded);
  const query = filter.trim();
  const isSearching = query.length > 0;

  useEffect(() => {
    const segments = selectedPath.split("/").filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      setExpanded(segments.slice(0, index).join("/"), true);
    }
  }, [selectedPath, setExpanded]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pt-2 pb-1">
        <div className="flex h-7 items-center gap-2 rounded-md bg-sidebar-accent px-2 text-sidebar-muted-foreground focus-within:ring-1 focus-within:ring-sidebar-ring">
          <Search className="icon-paired shrink-0" />
          <Input
            value={filter}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFilter(event.target.value)}
            placeholder="Filter files…"
            autoFocus
            className="h-full border-0 bg-transparent px-0 text-[length:var(--text-message)] text-sidebar-foreground placeholder:text-sidebar-muted-foreground focus:ring-0"
          />
          {filter.length > 0 && (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              aria-label="Clear file filter"
              className="flex size-5 shrink-0 items-center justify-center rounded text-sidebar-muted-foreground hover:bg-sidebar-background hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-sidebar-ring"
              onClick={() => setFilter("")}
            >
              <X className="icon-paired" />
            </Button>
          )}
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
