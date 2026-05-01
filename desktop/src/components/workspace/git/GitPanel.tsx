import { useState } from "react";
import type { GitDiffScope } from "@anyharness/sdk";
import {
  useGitDiffQuery,
  useStageGitPathsMutation,
  useUnstageGitPathsMutation,
} from "@anyharness/sdk-react";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import { FileDiffCard } from "@/components/ui/content/FileDiffCard";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { Button } from "@/components/ui/Button";
import { ArrowUpRight, Check, ChevronDown, Plus, RefreshCw } from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { useWorkspaceFileActions } from "@/hooks/editor/use-workspace-file-actions";
import { useGitPanelState } from "@/hooks/workspaces/use-git-panel-state";
import {
  GIT_PANEL_MODE_OPTIONS,
  gitPanelDiffScope,
  gitPanelEmptyMessage,
  gitPanelOpenAction,
  type GitPanelFile,
  type GitPanelMode,
} from "@/lib/domain/workspaces/git-panel-diff";

const GIT_PANEL_DIFF_VIEWPORT_CLASS = "max-h-[calc(var(--diffs-line-height)*18)]";

function FileDiffContent({
  filePath,
  displayPath,
  workspaceId,
  scope,
  baseRef,
  oldPath,
  enabled,
}: {
  filePath: string;
  displayPath: string;
  workspaceId: string | null;
  scope: GitDiffScope;
  baseRef: string | null;
  oldPath: string | null;
  enabled: boolean;
}) {
  const { data: diff, isLoading } = useGitDiffQuery({
    workspaceId,
    path: filePath,
    scope,
    baseRef,
    oldPath,
    enabled,
  });

  if (isLoading) {
    return (
      <div className="px-3 py-2 space-y-1.5">
        <div className="h-2.5 w-full bg-sidebar-accent rounded animate-pulse" />
        <div className="h-2.5 w-3/4 bg-sidebar-accent rounded animate-pulse" />
        <div className="h-2.5 w-5/6 bg-sidebar-accent rounded animate-pulse" />
      </div>
    );
  }

  if (diff?.binary) {
    return (
      <p className="px-3 py-2 text-xs text-sidebar-muted-foreground">Binary file changed</p>
    );
  }

  if (diff?.truncated) {
    return (
      <div>
        {diff.patch && (
          <DiffViewer
            patch={diff.patch}
            filePath={displayPath}
            viewportClassName={GIT_PANEL_DIFF_VIEWPORT_CLASS}
            variant="chat"
          />
        )}
        <p className="px-3 pb-1 text-[10px] text-sidebar-muted-foreground">Diff truncated</p>
      </div>
    );
  }

  if (diff?.patch) {
    return (
      <DiffViewer
        patch={diff.patch}
        filePath={displayPath}
        viewportClassName={GIT_PANEL_DIFF_VIEWPORT_CLASS}
        variant="chat"
      />
    );
  }

  return null;
}

export function GitPanel() {
  const [changesFilter, setChangesFilter] = useState<GitPanelMode>("unstaged");
  const [manualToggled, setManualToggled] = useState<Set<string>>(new Set());
  const { openFile, openFileDiff } = useWorkspaceFileActions();
  const stageMutation = useStageGitPathsMutation();
  const unstageMutation = useUnstageGitPathsMutation();
  const {
    activeWorkspaceId,
    baseRef,
    files: visibleFiles,
    totalChangedCount,
    visibleChangedCount,
    activeFilterLabel,
    isRuntimeReady,
    runtimeBlockedReason,
    isLoading,
    errorMessage,
    refetch,
  } = useGitPanelState(changesFilter);
  const diffScope = gitPanelDiffScope(changesFilter);
  const isBranchMode = changesFilter === "branch";

  const toggleExpanded = (key: string) => {
    setManualToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Git diffs default collapsed. Manual toggle opens or recloses each file.
  const isFileExpanded = (file: GitPanelFile) => {
    const defaultOpen = false;
    return manualToggled.has(file.key) ? !defaultOpen : defaultOpen;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-2 py-2 border-b border-sidebar-border/70 shrink-0">
        <p className="px-1 text-xs text-sidebar-muted-foreground">
          {totalChangedCount === 0
            ? isBranchMode
              ? "No branch changes"
              : "Working tree clean"
            : `${visibleChangedCount} ${activeFilterLabel.toLowerCase()} file${visibleChangedCount !== 1 ? "s" : ""}`}
        </p>
        <div className="flex items-center gap-1">
          <PopoverButton
            trigger={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-6 gap-1 rounded-md border-sidebar-border/70 bg-sidebar-accent/50 px-2 text-[10px] text-sidebar-foreground hover:bg-sidebar-accent"
              >
                <span>{activeFilterLabel}</span>
                <ChevronDown className="size-2.5" />
              </Button>
            }
            align="end"
            className="w-36 rounded-lg border border-border bg-popover p-1 shadow-floating"
          >
            {(close) => (
              <div className="flex flex-col gap-px">
                {GIT_PANEL_MODE_OPTIONS.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setChangesFilter(option.id);
                      close();
                    }}
                    className={`h-auto w-full justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent/40 ${
                      changesFilter === option.id
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span>{option.label}</span>
                    {changesFilter === option.id && (
                      <Check className="size-3 text-foreground" />
                    )}
                  </Button>
                ))}
              </div>
            )}
          </PopoverButton>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void refetch()}
            disabled={!isRuntimeReady}
            className="h-6 w-6 rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title="Refresh changes"
            aria-label="Refresh changes"
          >
            <RefreshCw className="size-3" />
          </Button>
        </div>
      </div>

      <AutoHideScrollArea className="flex-1 min-h-0" viewportClassName="px-2 py-2">
        {isLoading && (
          <div className="px-2 py-4 space-y-2">
            <div className="h-3 w-32 bg-sidebar-accent rounded animate-pulse" />
            <div className="h-3 w-48 bg-sidebar-accent rounded animate-pulse" />
            <div className="h-3 w-40 bg-sidebar-accent rounded animate-pulse" />
          </div>
        )}
        {errorMessage && (
          <p className="px-2 py-4 text-xs text-destructive">{errorMessage}</p>
        )}
        {!errorMessage && runtimeBlockedReason && (
          <p className="px-2 py-4 text-xs text-sidebar-muted-foreground">{runtimeBlockedReason}</p>
        )}
        {!isLoading && !errorMessage && visibleFiles.length === 0 && (
          <p className="px-2 py-4 text-xs text-sidebar-muted-foreground text-center">
            {gitPanelEmptyMessage(changesFilter)}
          </p>
        )}

        {!isLoading && visibleFiles.length > 0 && (
          <div className="flex flex-col gap-2">
            {visibleFiles.map((file) => {
              const baseName = file.displayPath.split("/").pop() ?? file.displayPath;
              const isExpanded = isFileExpanded(file);
              const isStaged = file.includedState !== "excluded";
              const openAction = gitPanelOpenAction(changesFilter, file);

              return (
                <FileDiffCard
                  key={file.key}
                  filePath={file.displayPath}
                  additions={file.additions}
                  deletions={file.deletions}
                  isExpanded={isExpanded}
                  onToggleExpand={() => toggleExpanded(file.key)}
                  actions={
                    <>
                      {!isBranchMode && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isStaged) {
                              void unstageMutation.mutateAsync([file.path]);
                            } else {
                              void stageMutation.mutateAsync([file.path]);
                            }
                          }}
                          disabled={!isRuntimeReady}
                          aria-label={isStaged ? `Unstage ${baseName}` : `Stage ${baseName}`}
                          className={`size-6 hover:bg-sidebar-accent ${
                            isStaged
                              ? "text-git-green"
                              : "text-sidebar-muted-foreground"
                          }`}
                          title={isStaged ? "Unstage" : "Stage"}
                        >
                          {isStaged ? (
                            <Check className="size-3" />
                          ) : (
                            <Plus className="size-3" />
                          )}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (openAction === "file") {
                            void openFile(file.path);
                          } else if (openAction === "diff") {
                            void openFileDiff(file.path, { scope: diffScope });
                          }
                        }}
                        disabled={!isRuntimeReady || openAction === "disabled"}
                        aria-label={`Open ${baseName}`}
                        className="size-6 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        title="Open file"
                      >
                        <ArrowUpRight className="size-3" />
                      </Button>
                    </>
                  }
                  surface="sidebar"
                >
                  <FileDiffContent
                    filePath={file.path}
                    displayPath={file.displayPath}
                    workspaceId={activeWorkspaceId}
                    scope={diffScope}
                    baseRef={isBranchMode ? baseRef : null}
                    oldPath={isBranchMode ? file.oldPath : null}
                    enabled={isRuntimeReady}
                  />
                </FileDiffCard>
              );
            })}
          </div>
        )}
      </AutoHideScrollArea>
    </div>
  );
}
