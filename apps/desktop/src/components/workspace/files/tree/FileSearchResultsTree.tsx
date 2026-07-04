import { useMemo, useState } from "react";
import { useSearchWorkspaceFilesQuery } from "@anyharness/sdk-react";
import { FileTreeRow } from "@/components/workspace/files/tree/FileTreeRow";
import {
  buildFileSearchTree,
  truncatePathLabel,
} from "@/lib/domain/files/file-search-tree";

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

  if (results.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-sidebar-muted-foreground">
        {searchQuery.isLoading ? "Searching…" : "No matching files"}
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
    <div role="tree" className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
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
