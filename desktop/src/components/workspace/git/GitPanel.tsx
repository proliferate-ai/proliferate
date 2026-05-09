import { useState } from "react";
import {
  useStageGitPathsMutation,
  useUnstageGitPathsMutation,
} from "@anyharness/sdk-react";
import { ChangesFileRow } from "./ChangesFileRow";
import { GitPanelHeader } from "./GitPanelHeader";
import { Button } from "@/components/ui/Button";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useGitPanelState } from "@/hooks/workspaces/derived/use-git-panel-state";
import {
  gitPanelEmptyMessage,
  type GitPanelMode,
} from "@/lib/domain/workspaces/changes/git-panel-diff";
import { allChangesViewerTarget } from "@/lib/domain/workspaces/viewer/viewer-target";

export function GitPanel() {
  const [changesFilter, setChangesFilter] = useState<GitPanelMode>("working_tree_composite");
  const { openFile, openFileDiff, openViewerTarget } = useWorkspaceFileActions();
  const {
    activeWorkspaceId,
    baseRef,
    sections,
    totalChangedCount,
    visibleChangedCount,
    activeFilterLabel,
    isRuntimeReady,
    runtimeBlockedReason,
    isLoading,
    errorMessage,
    refetch,
  } = useGitPanelState(changesFilter);
  const stageMutation = useStageGitPathsMutation({ workspaceId: activeWorkspaceId });
  const unstageMutation = useUnstageGitPathsMutation({ workspaceId: activeWorkspaceId });
  const isBranchMode = changesFilter === "branch";

  return (
    <div className="flex h-full flex-col">
      <GitPanelHeader
        changesFilter={changesFilter}
        activeFilterLabel={activeFilterLabel}
        totalChangedCount={totalChangedCount}
        visibleChangedCount={visibleChangedCount}
        isBranchMode={isBranchMode}
        isRuntimeReady={isRuntimeReady}
        onFilterChange={setChangesFilter}
        onRefresh={() => void refetch()}
      />

      <AutoHideScrollArea className="min-h-0 flex-1" viewportClassName="px-2 py-2">
        {isLoading && (
          <div className="space-y-2 px-2 py-4">
            <div className="h-3 w-32 animate-pulse rounded bg-sidebar-accent" />
            <div className="h-3 w-48 animate-pulse rounded bg-sidebar-accent" />
            <div className="h-3 w-40 animate-pulse rounded bg-sidebar-accent" />
          </div>
        )}
        {errorMessage && (
          <p className="px-2 py-4 text-xs text-destructive">{errorMessage}</p>
        )}
        {!errorMessage && runtimeBlockedReason && (
          <p className="px-2 py-4 text-xs text-sidebar-muted-foreground">
            {runtimeBlockedReason}
          </p>
        )}
        {!isLoading && !errorMessage && sections.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-sidebar-muted-foreground">
            {gitPanelEmptyMessage(changesFilter)}
          </p>
        )}

        {!isLoading && !errorMessage && sections.length > 0 && (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => openViewerTarget(allChangesViewerTarget({
                scope: changesFilter,
                baseRef: isBranchMode ? baseRef : null,
              }))}
              disabled={!isRuntimeReady}
              className="h-8 justify-center text-xs"
            >
              Review all
            </Button>
            {sections.map((section) => (
              <div key={section.scope} className="flex flex-col gap-1.5">
                {changesFilter === "working_tree_composite" && (
                  <div className="px-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-sidebar-muted-foreground">
                    {section.label}
                  </div>
                )}
                {section.files.map((file) => (
                  <ChangesFileRow
                    key={`${section.scope}:${file.key}`}
                    file={file}
                    sectionScope={section.scope}
                    baseRef={baseRef}
                    isBranchMode={isBranchMode}
                    isRuntimeReady={isRuntimeReady}
                    stagePath={(path) => stageMutation.mutateAsync([path])}
                    unstagePath={(path) => unstageMutation.mutateAsync([path])}
                    openFile={openFile}
                    openFileDiff={openFileDiff}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </AutoHideScrollArea>
    </div>
  );
}
