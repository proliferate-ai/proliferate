import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
} from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";
import { PopoverSearchField } from "#product/primitives/PopoverSearchField";
import { FileSearchResultsTree } from "#product/components/workspace/files/tree/FileSearchResultsTree";
import { FileTreeDirectory } from "#product/components/workspace/files/tree/FileTreeDirectory";
import type { FileTreeController } from "#product/lib/domain/files/file-tree-query-failures";
import {
  FILE_TREE_FIRST_ROW,
  useFileTreeKeyboard,
  type FileTreeRootBoundary,
} from "#product/hooks/workspaces/ui/files/use-file-tree-keyboard";
import { useDockedFileTreeResize } from "#product/hooks/workspaces/ui/files/use-docked-file-tree-resize";
import type { ViewerActivationFocus } from "#product/hooks/workspaces/workflows/tabs/workspace-shell-activation-types";

export const FILE_TREE_FILTER_LABEL = "Filter files";
export const FILE_TREE_FILTER_PLACEHOLDER = "Filter files…";

export interface DockedFileTreeRevealRequest {
  /** Canonical runtime-relative directory path; `""` is the workspace root. */
  path: string;
  token: number;
}

interface DockedFileTreeProps {
  workspaceId: string | null;
  selectedPath: string;
  changedPaths?: Set<string>;
  expandedPaths: ReadonlySet<string>;
  setExpanded: (path: string, expanded: boolean) => void;
  toggleExpanded: (path: string) => void;
  /**
   * Row activation. The dock always states its own origin intent so the
   * activated row, not the incoming viewer, keeps keyboard focus.
   */
  onOpenFile: (path: string, options: { focus: ViewerActivationFocus }) => void;
  /** Effective (geometry-clamped) tree width in pixels. */
  width: number;
  /** Measured `[data-file-viewer-body]` width, which bounds the separator. */
  bodyWidth: number;
  onDesiredWidthChange: (width: number) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  onRequestClose: () => void;
  captureRequest: () => number;
  isCurrent: (token: number) => boolean;
  /** Set when the toolbar (not a breadcrumb) asked for the dock. */
  pendingFilterFocus: boolean;
  revealRequest: DockedFileTreeRevealRequest | null;
  /**
   * Consumes the one-shot open-focus request. A later responsive restore
   * remounts this dock with no pending request, so it never steals focus.
   */
  onPendingFocusHandled: () => void;
}

/**
 * The non-modal docked file tree: filter field, tree, and resize separator.
 *
 * There is deliberately no `role="dialog"`, scrim, click-catcher, outside-click
 * dismissal, focus trap, `aria-modal`, or window-global Escape listener — the
 * dock sits inside `[data-file-viewer-body]` beside the viewer content and
 * Escape is scoped to focus within it.
 */
export function DockedFileTree({
  workspaceId,
  selectedPath,
  changedPaths,
  expandedPaths,
  setExpanded,
  toggleExpanded,
  onOpenFile,
  width,
  bodyWidth,
  onDesiredWidthChange,
  filter,
  onFilterChange,
  onRequestClose,
  captureRequest,
  isCurrent,
  pendingFilterFocus,
  revealRequest,
  onPendingFocusHandled,
}: DockedFileTreeProps) {
  const dockRef = useRef<HTMLElement | null>(null);
  const boundaryRef = useRef<FileTreeRootBoundary>({
    rootKeys: [],
    scrollToRootIndex: () => {},
  });
  const query = filter.trim();
  const isSearching = query.length > 0;

  const focusFilterInput = useCallback(() => {
    dockRef.current
      ?.querySelector<HTMLInputElement>(`input[aria-label="${FILE_TREE_FILTER_LABEL}"]`)
      ?.focus();
  }, []);

  const keyboard = useFileTreeKeyboard({
    boundary: {
      get rootKeys() {
        return boundaryRef.current.rootKeys;
      },
      scrollToRootIndex: (index) => boundaryRef.current.scrollToRootIndex(index),
    },
    onExpand: (path) => setExpanded(path, true),
    onCollapse: (path) => setExpanded(path, false),
  });
  const { reconcileRoving, requestRowFocus, rovingKey } = keyboard;

  const onRootModel = useCallback((model: FileTreeRootBoundary) => {
    boundaryRef.current = model;
  }, []);

  // Selection changes; focus does not leave the tree row the user activated.
  const openFileFromTreeRow = useCallback((path: string) => {
    onOpenFile(path, { focus: "preserve-origin" });
  }, [onOpenFile]);

  const controller = useMemo<FileTreeController>(() => ({
    workspaceId,
    selectedPath,
    changedPaths,
    expandedPaths,
    setExpanded,
    toggleExpanded,
    openFile: openFileFromTreeRow,
    isRoving: (key) => key === rovingKey,
    requestRowFocus,
    captureRequest,
    isCurrent,
    onRootModel,
  }), [
    captureRequest,
    changedPaths,
    expandedPaths,
    isCurrent,
    onRootModel,
    openFileFromTreeRow,
    requestRowFocus,
    rovingKey,
    selectedPath,
    setExpanded,
    toggleExpanded,
    workspaceId,
  ]);

  // First materialization: the selected file when it is visible, otherwise the
  // first visible row. Every later reconcile keeps the roving row when it
  // survived and otherwise falls back the same way.
  const materializedRef = useRef(false);
  useEffect(() => {
    if (materializedRef.current) {
      return;
    }
    const root = keyboard.treeRef.current;
    if (!root || root.querySelectorAll('[role="treeitem"]').length === 0) {
      return;
    }
    materializedRef.current = true;
    reconcileRoving(selectedPath);
  });

  // A filter update preserves the roving row if it is still visible and
  // otherwise chooses the first result. Only a genuine filter transition
  // re-picks: the initial commit is owned by the materialization effect above.
  const lastQueryRef = useRef(query);
  useEffect(() => {
    if (!materializedRef.current || lastQueryRef.current === query) {
      return;
    }
    lastQueryRef.current = query;
    reconcileRoving(rovingKey);
  }, [query, reconcileRoving, rovingKey]);

  // Selection-follow: expand every known ancestor of the active file in the
  // current composite expansion scope. This scrolls but never alters roving
  // focus, and it never moves DOM focus.
  useEffect(() => {
    const segments = selectedPath.split("/").filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      setExpanded(segments.slice(0, index).join("/"), true);
    }
  }, [selectedPath, setExpanded]);

  // Toolbar origin: open and focus the filter field. This runs only once the
  // dock is effectively visible, because the controller mounts it only then.
  useEffect(() => {
    if (!pendingFilterFocus) {
      return;
    }
    focusFilterInput();
    onPendingFocusHandled();
  }, [focusFilterInput, onPendingFocusHandled, pendingFilterFocus]);

  // Breadcrumb origin: clear a non-empty filter, expand/load the target path,
  // then focus the revealed row once lazy data and virtualization settle.
  const revealTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!revealRequest || revealTokenRef.current === revealRequest.token) {
      return;
    }
    revealTokenRef.current = revealRequest.token;
    const token = captureRequest();
    if (filter !== "") {
      onFilterChange("");
    }
    if (revealRequest.path === "") {
      requestRowFocus(FILE_TREE_FIRST_ROW, { moveDom: true });
      onPendingFocusHandled();
      return;
    }
    const segments = revealRequest.path.split("/").filter(Boolean);
    for (let index = 1; index <= segments.length; index += 1) {
      setExpanded(segments.slice(0, index).join("/"), true);
    }
    if (!isCurrent(token)) {
      return;
    }
    requestRowFocus(revealRequest.path, { moveDom: true });
    onPendingFocusHandled();
  }, [
    captureRequest,
    filter,
    isCurrent,
    onFilterChange,
    onPendingFocusHandled,
    requestRowFocus,
    revealRequest,
    setExpanded,
  ]);

  const resize = useDockedFileTreeResize({
    bodyWidth,
    effectiveWidth: width,
    setDesiredWidth: onDesiredWidthChange,
  });

  // Escape is scoped to focus inside the dock. The first Escape with a
  // non-empty filter clears it and returns focus to the input; with an empty
  // filter it closes the dock. Escape from viewer content does nothing here.
  const handleDockKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") {
      return;
    }
    event.stopPropagation();
    if (filter !== "") {
      event.preventDefault();
      onFilterChange("");
      focusFilterInput();
      return;
    }
    event.preventDefault();
    onRequestClose();
  };

  return (
    <section
      ref={dockRef}
      aria-label="Files"
      data-docked-file-tree
      className="relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-sidebar-background"
      style={{ width }}
      onKeyDown={handleDockKeyDown}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PopoverSearchField
          value={filter}
          onChange={onFilterChange}
          placeholder={FILE_TREE_FILTER_PLACEHOLDER}
          ariaLabel={FILE_TREE_FILTER_LABEL}
          autoFocus={false}
        />
        <div className="h-px shrink-0 bg-border" />
        <div
          ref={keyboard.treeRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          onKeyDown={keyboard.handleTreeKeyDown}
        >
          {isSearching ? (
            <FileSearchResultsTree controller={controller} query={query} />
          ) : (
            <FileTreeDirectory controller={controller} path="" level={0} />
          )}
        </div>
      </div>
      <FileTreeDockSeparator resize={resize} />
    </section>
  );
}

function FileTreeDockSeparator({
  resize,
}: {
  resize: ReturnType<typeof useDockedFileTreeResize>;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize file tree"
      aria-valuemin={resize.minWidth}
      aria-valuemax={resize.maxWidth}
      aria-valuenow={resize.valueNow}
      tabIndex={0}
      data-docked-file-tree-separator
      // C4: the separator is a hit target on the dock's inline-end edge; its
      // focus ring uses the sanctioned sidebar focus token and it is a single
      // focus indicator, not a hover/active/selected state stack.
      className="absolute inset-y-0 right-0 w-2 cursor-col-resize focus-visible:outline focus-visible:outline-1 focus-visible:outline-sidebar-ring"
      onPointerDown={resize.handleResizeStart}
      onKeyDown={resize.handleResizeKeyDown}
    >
      <span
        className={twMerge(
          "absolute inset-y-0 right-0 w-px bg-border transition-colors",
          resize.resizing && "w-0.5 bg-sidebar-ring",
        )}
      />
    </div>
  );
}
