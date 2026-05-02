import { useState } from "react";
import {
  useStageGitPathsMutation,
  useUnstageGitPathsMutation,
} from "@anyharness/sdk-react";
import { Button } from "@/components/ui/Button";
import { FileChangeStats } from "@/components/ui/content/FileDiffCard";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { ArrowUpRight, Check, ChevronDown, FileText, Plus, RefreshCw } from "@/components/ui/icons";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useGitPanelState } from "@/hooks/workspaces/use-git-panel-state";
import {
  GIT_PANEL_MODE_OPTIONS,
  gitPanelEmptyMessage,
  type GitPanelFile,
  type GitPanelMode,
  type GitPanelSectionScope,
} from "@/lib/domain/workspaces/git-panel-diff";
import { allChangesViewerTarget } from "@/lib/domain/workspaces/viewer-target";

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
      <div className="flex shrink-0 items-center justify-between border-b border-sidebar-border/70 px-2 py-2">
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
                className="h-6 gap-1 rounded-md border-sidebar-border/70 bg-sidebar-accent px-2 text-[10px] text-sidebar-foreground hover:bg-sidebar-accent"
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
                    className={`h-auto w-full justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent ${
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

function ChangesFileRow({
  file,
  sectionScope,
  baseRef,
  isBranchMode,
  isRuntimeReady,
  stagePath,
  unstagePath,
  openFile,
  openFileDiff,
}: {
  file: GitPanelFile;
  sectionScope: GitPanelSectionScope;
  baseRef: string | null;
  isBranchMode: boolean;
  isRuntimeReady: boolean;
  stagePath: (path: string) => Promise<unknown>;
  unstagePath: (path: string) => Promise<unknown>;
  openFile: (path: string) => Promise<void>;
  openFileDiff: (
    path: string,
    options?: {
      scope?: GitPanelSectionScope | null;
      baseRef?: string | null;
      oldPath?: string | null;
    },
  ) => Promise<void>;
}) {
  const baseName = file.displayPath.split("/").pop() ?? file.displayPath;
  const shouldUnstage = sectionScope === "staged";
  const stateLabel = isBranchMode
    ? file.status
    : shouldUnstage
      ? "staged"
      : "unstaged";
  const openDiff = () => openFileDiff(file.path, {
    scope: sectionScope,
    baseRef: isBranchMode ? baseRef : null,
    oldPath: isBranchMode ? file.oldPath : null,
  });

  return (
    <div className="group rounded-md border border-sidebar-border/60 bg-sidebar-accent/20 transition-colors hover:border-sidebar-border hover:bg-sidebar-accent/70">
      <div className="flex min-w-0 items-center gap-1 pr-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void openDiff()}
          disabled={!isRuntimeReady}
          title={`Open ${file.displayPath} diff`}
          className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-md bg-transparent px-2 py-2 text-left hover:bg-transparent"
        >
          <FileTreeEntryIcon
            name={baseName}
            path={file.path}
            kind="file"
            className="size-3.5 shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.68rem] font-medium text-sidebar-foreground [direction:ltr] [unicode-bidi:plaintext]">
              {file.displayPath}
            </span>
            <span className="mt-0.5 flex items-center gap-2 text-[10px] text-sidebar-muted-foreground">
              <span className="capitalize">{stateLabel}</span>
              <FileChangeStats
                additions={file.additions}
                deletions={file.deletions}
              />
            </span>
          </span>
        </Button>
        <Tooltip content="Open file">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void openFile(file.path)}
            disabled={!isRuntimeReady}
            aria-label={`Open ${baseName} file`}
            className="size-6 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <FileText className="size-3" />
          </Button>
        </Tooltip>
        {!isBranchMode && (
          <Tooltip content={shouldUnstage ? "Unstage" : "Stage"}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                if (shouldUnstage) {
                  void unstagePath(file.path);
                } else {
                  void stagePath(file.path);
                }
              }}
              disabled={!isRuntimeReady}
              aria-label={shouldUnstage ? `Unstage ${baseName}` : `Stage ${baseName}`}
              className={`size-6 hover:bg-sidebar-accent ${
                shouldUnstage
                  ? "text-git-green"
                  : "text-sidebar-muted-foreground hover:text-sidebar-foreground"
              }`}
            >
              {shouldUnstage ? (
                <Check className="size-3" />
              ) : (
                <Plus className="size-3" />
              )}
            </Button>
          </Tooltip>
        )}
        <Tooltip singleLine content="Open diff">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void openDiff()}
            disabled={!isRuntimeReady}
            aria-label={`Open ${baseName} diff`}
            className="size-6 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ArrowUpRight className="size-3" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
