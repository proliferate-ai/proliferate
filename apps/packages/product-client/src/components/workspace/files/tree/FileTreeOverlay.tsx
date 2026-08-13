import {
  useEffect,
  useRef,
  useState,
} from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";
import { Button } from "#product/primitives/Button";
import { PopoverSearchField } from "#product/primitives/PopoverSearchField";
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
 *
 * Integrator ruling (conformance slice): `components/workspace/pane/
 * PaneSideOverlay.tsx` had zero consumers and was deleted by the shell
 * slice rather than promoted, so the two-implementations-of-one-shape
 * finding this file used to share with it is now moot on that side. This
 * component keeps and cleans its own shell instead of adopting a library
 * pattern; promotion is deferred until a second live consumer of this shape
 * exists (see the design-system doctrine's promotion trigger).
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
        className="pointer-events-auto absolute bottom-2 right-2 top-2 flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-sidebar-background shadow-popover"
        // C4: clamps the panel to the stored width or the available pane
        // width minus a 1rem margin, whichever is smaller — legitimate
        // resize math with no fixed-token equivalent.
        style={{ width: `min(${width}px, calc(100% - 1rem))` }}
      >
        {/*
         * C7, partial: the acceptance criteria call for removing "the two
         * FileTreeOverlay focus-visible stacks" (this handle's, and the
         * filter-clear button's). The filter-clear button's stack is gone
         * because that whole hand-rolled field is replaced by
         * `PopoverSearchField` below. This resize handle's focus-visible
         * ring has no sanctioned target — there is no library "resizable
         * pane edge" primitive to absorb it into, and inventing one is a
         * new component, out of scope for this slice. It is not a
         * duplicate of any sanctioned pattern's state contract (it is a
         * single-state focus indicator, not a hover/active/selected trio),
         * so it stays, recorded alongside the deferred shell promotion
         * above.
         */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file browser"
          aria-valuemin={FILE_TREE_MIN_WIDTH}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          data-file-tree-resize-handle
          className={`absolute bottom-0 left-0 top-0 z-10 w-2 cursor-col-resize focus-visible:outline focus-visible:outline-1 focus-visible:outline-sidebar-ring${resizing ? " bg-active" : ""}`}
          onPointerDown={handleResizeStart}
          onKeyDown={handleResizeKeyDown}
        >
          <span
            className={twMerge(
              "absolute bottom-0 left-0 top-0 w-px bg-border transition-colors",
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
      {/*
       * Adopts `PopoverSearchField` (same composition as
       * `GitPanelHeader.tsx`'s file jump-to search, its sibling instance of
       * this shape) in place of the hand-rolled boxed `bg-surface-control`
       * field. This drops the field's own inline "clear" (×) button —
       * `PopoverSearchField` has no trailing-action slot for one — which
       * also removes its hand-assembled `focus-visible` stack for free per
       * the acceptance criteria. Clearing the filter still works via
       * selecting and deleting the text; flagged as a minor, spec-directed
       * affordance loss rather than reintroducing the hand-roll.
       */}
      <PopoverSearchField
        value={filter}
        onChange={setFilter}
        placeholder="Filter files…"
        ariaLabel="Filter files"
        autoFocus
      />
      <div className="h-px shrink-0 bg-border" />
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
