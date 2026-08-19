import { useEffect, useMemo, useState } from "react";
import { useSearchWorkspaceFilesQuery } from "@anyharness/sdk-react";
import { FileTreeRow } from "#product/components/workspace/files/tree/FileTreeRow";
import {
  isRetryableFileTreeError,
  RETRY_ROOT_LABEL,
  type FileTreeController,
} from "#product/lib/domain/files/file-tree-query-failures";
import {
  buildFileSearchTree,
  truncatePathLabel,
} from "#product/lib/domain/files/file-search-tree";

interface FileSearchResultsTreeProps {
  controller: FileTreeController;
  query: string;
}

export function FileSearchResultsTree({ controller, query }: FileSearchResultsTreeProps) {
  const { workspaceId, selectedPath, changedPaths } = controller;
  // This tree retains its own direct 60-result query ownership; it never
  // builds or retains a client-side index and is not routed through the
  // separate debounced palette-oriented workspace file search hook.
  const searchQuery = useSearchWorkspaceFilesQuery({
    workspaceId,
    query,
    limit: 60,
    enabled: Boolean(workspaceId) && query.length > 0,
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const results = searchQuery.data?.results ?? [];
  const groups = useMemo(() => buildFileSearchTree(results), [results]);
  // Contradiction, recorded rather than re-derived (same ruling as
  // FileTreeRow.tsx's chevron): spec section 2.6 lists this collapse-group
  // state machine as adopting `Disclosure`, but the group header below is a
  // `FileTreeRow` (`role="treeitem"`, `kind="directory"`) inside a
  // `role="tree"` — the same WAI-ARIA treeitem/tree pattern
  // `FileTreeDirectory` uses for real directories, driven by an
  // application-level collapsed-set exactly like `GitPanel.tsx`'s
  // `collapsedFiles` (which 2.6 itself rules "is application state, not a
  // shape, and stays"). Wrapping the group header in `Disclosure` would
  // fight the treeitem contract this file deliberately mirrors. Left as-is.

  const { onRootModel } = controller;
  useEffect(() => {
    onRootModel({
      rootKeys: groups.map((group) => group.path),
      scrollToRootIndex: () => {},
    });
  }, [groups, onRootModel]);

  const retryable = Boolean(searchQuery.error) && isRetryableFileTreeError(searchQuery.error);

  if (results.length === 0) {
    if (retryable) {
      return (
        <div role="tree" aria-label="File search results" className="file-tree-scroll min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <SearchRetryRow controller={controller} refetch={searchQuery.refetch} busy={searchQuery.isFetching} />
        </div>
      );
    }
    const message = !workspaceId
      ? "Search is unavailable for this workspace."
      : searchQuery.isLoading
        ? "Searching…"
        : searchQuery.error
          ? "Search could not be completed."
          : "No matching files";
    return (
      <p
        role="status"
        // A zero-result filter focuses its status; the filter input remains
        // the preceding tab stop.
        tabIndex={0}
        className={searchQuery.error
          ? "px-3 py-3 text-ui-sm text-destructive outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-sidebar-ring"
          : "px-3 py-3 text-ui-sm text-sidebar-muted-foreground outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-sidebar-ring"}
      >
        {message}
      </p>
    );
  }

  const toggleGroup = (path: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div role="tree" aria-label="File search results" className="file-tree-scroll min-h-0 flex-1 overflow-y-auto px-2 py-1">
      {groups.map((group, groupIndex) => {
        const collapsed = collapsedGroups.has(group.path);
        return (
          <div key={group.path || "__root__"}>
            <FileTreeRow
              name={truncatePathLabel(group.label)}
              path={group.path}
              rowKey={group.path}
              kind="directory"
              level={0}
              expanded={!collapsed}
              roving={controller.isRoving(group.path)}
              posinset={groupIndex + 1}
              setsize={groups.length}
              onClick={() => toggleGroup(group.path)}
            />
            {!collapsed && group.files.map((file, fileIndex) => (
              <FileTreeRow
                key={file.path}
                name={file.name}
                path={file.path}
                rowKey={file.path}
                kind="file"
                level={1}
                selected={file.path === selectedPath}
                changed={changedPaths?.has(file.path)}
                roving={controller.isRoving(file.path)}
                posinset={fileIndex + 1}
                setsize={group.files.length}
                onClick={() => controller.openFile(file.path)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** One roving retry treeitem for a transient search transport failure. */
function SearchRetryRow({
  controller,
  refetch,
  busy,
}: {
  controller: FileTreeController;
  refetch: () => Promise<unknown>;
  busy: boolean;
}) {
  const rowKey = "__file-search-retry__";
  const handleRetry = async () => {
    const token = controller.captureRequest();
    await refetch();
    if (!controller.isCurrent(token)) {
      return;
    }
  };

  return (
    <FileTreeRow
      name={RETRY_ROOT_LABEL}
      path=""
      rowKey={rowKey}
      kind="retry"
      level={0}
      busy={busy}
      roving={controller.isRoving(rowKey)}
      posinset={1}
      setsize={1}
      onClick={() => void handleRetry()}
    />
  );
}
