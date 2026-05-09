import { useMemo, useState } from "react";
import { useSearchWorkspaceFilesQuery } from "@anyharness/sdk-react";
import { ChangedFilesList } from "./ChangedFilesList";
import { FileTreePane } from "./FileTreePane";
import { FileBrowserToolbar, type FileBrowserScopeFilter } from "./FileBrowserToolbar";
import { FileCreateDraftRow } from "./FileCreateDraftRow";
import { Button } from "@/components/ui/Button";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useWorkspaceFilesRefresh } from "@/hooks/workspaces/files/workflows/use-workspace-files-refresh";
import { useGitPanelState } from "@/hooks/workspaces/derived/use-git-panel-state";
import { gitPanelEmptyMessage } from "@/lib/domain/workspaces/changes/git-panel-diff";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";

interface WorkspaceFilesPanelProps {
  showHeader?: boolean;
}

export function WorkspaceFilesPanel({ showHeader = true }: WorkspaceFilesPanelProps) {
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<FileBrowserScopeFilter>("all");
  const materializedWorkspaceId = useWorkspaceViewerTabsStore((s) => s.materializedWorkspaceId);
  const changesMode = scopeFilter === "all" ? "working_tree_composite" : scopeFilter;
  const changesState = useGitPanelState(changesMode);
  const searchQuery = useSearchWorkspaceFilesQuery({
    workspaceId: materializedWorkspaceId,
    query: search,
    limit: 60,
    enabled: scopeFilter === "all" && search.trim().length > 0,
  });
  const { openFile, openFileDiff } = useWorkspaceFileActions();
  const { refreshFiles } = useWorkspaceFilesRefresh({
    refetchChanges: changesState.refetch,
  });
  const changedSections = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return changesState.sections
      .map((section) => ({
        ...section,
        files: normalizedSearch
          ? section.files.filter((file) =>
              file.displayPath.toLowerCase().includes(normalizedSearch)
              || file.path.toLowerCase().includes(normalizedSearch)
              || (file.oldPath?.toLowerCase().includes(normalizedSearch) ?? false))
          : section.files,
      }))
      .filter((section) => section.files.length > 0);
  }, [changesState.sections, search]);
  const changedFilterCount = changedSections.reduce(
    (count, section) => count + section.files.length,
    0,
  );
  const showChangedFiles = scopeFilter !== "all";

  return (
    <div className="h-full flex flex-col">
      {showHeader && (
        <div className="flex items-center justify-between px-3 h-10 min-h-10 bg-sidebar border-b border-border shrink-0">
          <span className="text-xs font-medium text-foreground">Files</span>
        </div>
      )}
      <FileBrowserToolbar
        search={search}
        scopeFilter={scopeFilter}
        changedFileCount={
          scopeFilter === "all" ? changesState.totalChangedCount : changesState.visibleChangedCount
        }
        onSearchChange={setSearch}
        onScopeFilterChange={setScopeFilter}
        onRefresh={refreshFiles}
      />
      <FileCreateDraftRow />

      <div className="flex-1 min-h-0 overflow-hidden">
        {showChangedFiles ? (
          <ChangedFilesList
            sections={changedSections}
            baseRef={changesState.baseRef}
            isBranchMode={changesMode === "branch"}
            isLoading={changesState.isLoading}
            errorMessage={changesState.errorMessage}
            runtimeBlockedReason={changesState.runtimeBlockedReason}
            emptyMessage={search.trim() ? "No changed files match" : gitPanelEmptyMessage(changesMode)}
            changedFileCount={changedFilterCount}
            openFile={openFile}
            openFileDiff={openFileDiff}
          />
        ) : search.trim().length > 0 ? (
          <div className="h-full overflow-auto px-2 py-2">
            {searchQuery.isLoading && (
              <p className="px-2 py-3 text-xs text-sidebar-muted-foreground">Searching...</p>
            )}
            {!searchQuery.isLoading && (searchQuery.data?.results.length ?? 0) === 0 && (
              <p className="px-2 py-3 text-center text-xs text-sidebar-muted-foreground">
                No matches
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {searchQuery.data?.results.map((result) => (
                <Button
                  key={result.path}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void openFile(result.path)}
                  className="h-7 w-full justify-start gap-2 rounded-md px-2 text-[0.65rem] text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  <FileTreeEntryIcon
                    name={result.name}
                    path={result.path}
                    kind="file"
                    className="size-3.5 shrink-0"
                  />
                  <span className="min-w-0 truncate">{result.path}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <FileTreePane />
        )}
      </div>
    </div>
  );
}
