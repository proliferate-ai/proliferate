import { useMemo } from "react";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import {
  useSearchWorkspaceFilesQuery,
  useWorkspaceFilesQuery,
} from "@anyharness/sdk-react";
import {
  PaneFileTree,
  type PaneFileTreeNode,
  type PaneFileTreeSection,
} from "@/components/workspace/pane/PaneFileTree";

interface WorkspaceFileBrowserPaneProps {
  workspaceId: string | null;
  selectedPath: string;
  pathPrefix: string;
  autoFocusSearch?: boolean;
  onPathPrefixChange: (pathPrefix: string) => void;
  onOpenFile: (path: string) => void;
}

export function WorkspaceFileBrowserPane({
  workspaceId,
  selectedPath,
  pathPrefix,
  autoFocusSearch = false,
  onPathPrefixChange,
  onOpenFile,
}: WorkspaceFileBrowserPaneProps) {
  const directoryPath = normalizeDirectoryPath(pathPrefix);
  const directoryQuery = useWorkspaceFilesQuery({
    workspaceId,
    path: directoryPath,
    enabled: Boolean(workspaceId),
  });
  const searchQuery = useSearchWorkspaceFilesQuery({
    workspaceId,
    query: pathPrefix.trim(),
    limit: 80,
    enabled: Boolean(workspaceId) && pathPrefix.trim().length > 0 && directoryQuery.isError,
  });

  const sections = useMemo<PaneFileTreeSection[]>(() => {
    if (directoryQuery.data?.entries) {
      return [{
        id: "directory",
        label: directoryPath || "Workspace",
        nodes: directoryEntriesToNodes({
          directoryPath,
          entries: directoryQuery.data.entries,
          selectedPath,
        }),
      }];
    }

    if (searchQuery.data?.results) {
      return [{
        id: "search",
        label: "Matches",
        nodes: searchQuery.data.results.map((result) => ({
          id: result.path,
          name: result.name,
          path: result.path,
          kind: "file",
          selected: result.path === selectedPath,
        })),
      }];
    }

    return [];
  }, [directoryPath, directoryQuery.data?.entries, searchQuery.data?.results, selectedPath]);

  const emptyMessage = directoryQuery.isLoading || searchQuery.isLoading
    ? "Loading files"
    : directoryQuery.isError
      ? "No matching files"
      : "No files";

  return (
    <PaneFileTree
      sections={sections}
      searchValue={pathPrefix}
      searchPlaceholder="Filter files..."
      searchAutoFocus={autoFocusSearch}
      emptyMessage={emptyMessage}
      onSearchChange={onPathPrefixChange}
      onSelectNode={(node) => {
        if (node.kind === "directory") {
          onPathPrefixChange(node.path);
          return;
        }
        onOpenFile(node.path);
      }}
      onToggleDirectory={(node) => {
        onPathPrefixChange(node.path);
      }}
    />
  );
}

function directoryEntriesToNodes({
  directoryPath,
  entries,
  selectedPath,
}: {
  directoryPath: string;
  entries: readonly WorkspaceFileEntry[];
  selectedPath: string;
}): PaneFileTreeNode[] {
  const parentPath = parentDirectoryPath(directoryPath);
  const parentNode: PaneFileTreeNode[] = directoryPath
    ? [{
        id: "__parent__",
        name: "..",
        path: parentPath,
        kind: "directory",
        label: "..",
        title: parentPath || "Workspace",
      }]
    : [];

  return [
    ...parentNode,
    ...entries.map((entry) => ({
      id: entry.path,
      name: entry.name,
      path: entry.path,
      kind: entry.kind === "directory" ? "directory" : "file",
      title: entry.path,
      selected: entry.path === selectedPath,
    } satisfies PaneFileTreeNode)),
  ];
}

function normalizeDirectoryPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === ".") {
    return "";
  }
  return trimmed.replace(/^\.\/+/, "").replace(/\/+$/, "");
}

function parentDirectoryPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}
