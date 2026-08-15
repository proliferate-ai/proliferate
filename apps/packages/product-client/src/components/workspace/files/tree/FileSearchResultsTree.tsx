import { useMemo, useState } from "react";
import { useSearchWorkspaceFilesQuery } from "@anyharness/sdk-react";
import { FileTreeRow } from "#product/components/workspace/files/tree/FileTreeRow";
import {
  buildFileSearchTree,
  truncatePathLabel,
} from "#product/lib/domain/files/file-search-tree";

interface FileSearchResultsTreeProps {
  workspaceId: string | null;
  query: string;
  selectedPath: string;
  onOpenFile: (path: string) => void;
  changedPaths?: Set<string>;
}

export function FileSearchResultsTree({
  workspaceId,
  query,
  selectedPath,
  onOpenFile,
  changedPaths,
}: FileSearchResultsTreeProps) {
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

  if (results.length === 0) {
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
        className={searchQuery.error
          ? "px-3 py-3 text-ui-sm text-destructive"
          : "px-3 py-3 text-ui-sm text-sidebar-muted-foreground"}
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
    <div role="tree" className="file-tree-scroll min-h-0 flex-1 overflow-y-auto px-2 py-1">
      {groups.map((group) => {
        const collapsed = collapsedGroups.has(group.path);
        return (
          <div key={group.path || "__root__"}>
            <FileTreeRow
              name={truncatePathLabel(group.label)}
              path={group.path}
              kind="directory"
              level={0}
              expanded={!collapsed}
              onClick={() => toggleGroup(group.path)}
            />
            {!collapsed && group.files.map((file) => (
              <FileTreeRow
                key={file.path}
                name={file.name}
                path={file.path}
                kind="file"
                level={1}
                selected={file.path === selectedPath}
                changed={changedPaths?.has(file.path)}
                onClick={() => onOpenFile(file.path)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
