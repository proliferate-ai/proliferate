import { useState } from "react";
import {
  useGitDiffQuery,
  useGitStatusQuery,
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
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { useHarnessStore } from "@/stores/sessions/harness-store";

type ChangesFilter = "unstaged" | "staged";

const FILTER_OPTIONS: { id: ChangesFilter; label: string }[] = [
  { id: "unstaged", label: "Unstaged" },
  { id: "staged", label: "Staged" },
];

interface GitPanelFile {
  path: string;
  includedState: string;
  additions: number;
  deletions: number;
}

function FileDiffContent({
  filePath,
  workspaceId,
  enabled,
}: {
  filePath: string;
  workspaceId: string | null;
  enabled: boolean;
}) {
  const { data: diff, isLoading } = useGitDiffQuery({
    workspaceId,
    path: filePath,
    enabled,
  });

  if (isLoading) {
    return (
      <div className="px-3 py-2 space-y-1.5">
        <div className="h-2.5 w-full bg-muted/50 rounded animate-pulse" />
        <div className="h-2.5 w-3/4 bg-muted/50 rounded animate-pulse" />
        <div className="h-2.5 w-5/6 bg-muted/50 rounded animate-pulse" />
      </div>
    );
  }

  if (diff?.binary) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">Binary file changed</p>
    );
  }

  if (diff?.truncated) {
    return (
      <div>
        {diff.patch && <DiffViewer patch={diff.patch} filePath={filePath} />}
        <p className="px-3 pb-1 text-[10px] text-muted-foreground">Diff truncated</p>
      </div>
    );
  }

  if (diff?.patch) {
    return <DiffViewer patch={diff.patch} filePath={filePath} />;
  }

  return null;
}

export function GitPanel() {
  const [changesFilter, setChangesFilter] = useState<ChangesFilter>("unstaged");
  const [manualToggled, setManualToggled] = useState<Set<string>>(new Set());
  const { openFileDiff } = useWorkspaceFileActions();
  const selectedWorkspaceId = useHarnessStore((s) => s.selectedWorkspaceId);
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const runtimeBlockedReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);
  const isRuntimeReady = runtimeBlockedReason === null;
  const {
    data: gitStatus,
    isLoading: gitStatusLoading,
    error: gitStatusError,
    refetch: refetchGitStatus,
  } = useGitStatusQuery({ enabled: isRuntimeReady });
  const stageMutation = useStageGitPathsMutation();
  const unstageMutation = useUnstageGitPathsMutation();

  const files: GitPanelFile[] = (gitStatus?.files ?? []).filter(
    (file: GitPanelFile) => file.path.length > 0 && !file.path.startsWith(".claude/worktrees/"),
  );
  const unstagedFiles = files.filter((file) => file.includedState !== "included");
  const stagedFiles = files.filter((file) => file.includedState !== "excluded");
  const visibleFiles = changesFilter === "staged" ? stagedFiles : unstagedFiles;
  const totalChangedCount = files.length;
  const visibleChangedCount = visibleFiles.length;
  const activeFilterLabel = FILTER_OPTIONS.find((o) => o.id === changesFilter)!.label;
  const gitStatusMessage = gitStatusError instanceof Error ? gitStatusError.message : null;

  const toggleExpanded = (path: string) => {
    setManualToggled((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Files with actual code changes default open; binary/no-diff default closed.
  // Manual toggle overrides the default.
  const isFileExpanded = (file: { path: string; additions: number; deletions: number }) => {
    const hasChanges = file.additions > 0 || file.deletions > 0;
    const defaultOpen = hasChanges;
    return manualToggled.has(file.path) ? !defaultOpen : defaultOpen;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-2 py-2 border-b border-sidebar-border/70 shrink-0">
        <p className="px-1 text-xs text-muted-foreground">
          {totalChangedCount === 0
            ? "Working tree clean"
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
                {FILTER_OPTIONS.map((option) => (
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
            onClick={() => void refetchGitStatus()}
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
        {gitStatusLoading && (
          <div className="px-2 py-4 space-y-2">
            <div className="h-3 w-32 bg-muted/50 rounded animate-pulse" />
            <div className="h-3 w-48 bg-muted/50 rounded animate-pulse" />
            <div className="h-3 w-40 bg-muted/50 rounded animate-pulse" />
          </div>
        )}
        {gitStatusMessage && (
          <p className="px-2 py-4 text-xs text-destructive">{gitStatusMessage}</p>
        )}
        {!gitStatusMessage && runtimeBlockedReason && (
          <p className="px-2 py-4 text-xs text-muted-foreground">{runtimeBlockedReason}</p>
        )}
        {!gitStatusLoading && !gitStatusMessage && visibleFiles.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground text-center">
            {changesFilter === "staged"
              ? "No staged changes"
              : "No unstaged changes"}
          </p>
        )}

        {!gitStatusLoading && visibleFiles.length > 0 && (
          <div className="flex flex-col gap-2">
            {visibleFiles.map((file) => {
              const baseName = file.path.split("/").pop() ?? file.path;
              const isExpanded = isFileExpanded(file);
              const isStaged = file.includedState !== "excluded";

              return (
                <FileDiffCard
                  key={file.path}
                  filePath={file.path}
                  additions={file.additions}
                  deletions={file.deletions}
                  isExpanded={isExpanded}
                  onToggleExpand={() => toggleExpanded(file.path)}
                  actions={
                    <>
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
                            : "text-muted-foreground"
                        }`}
                        title={isStaged ? "Unstage" : "Stage"}
                      >
                        {isStaged ? (
                          <Check className="size-3" />
                        ) : (
                          <Plus className="size-3" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openFileDiff(file.path);
                        }}
                        disabled={!isRuntimeReady}
                        aria-label={`Open ${baseName}`}
                        className="size-6 text-muted-foreground hover:bg-sidebar-accent"
                        title="Open file"
                      >
                        <ArrowUpRight className="size-3" />
                      </Button>
                    </>
                  }
                >
                  <FileDiffContent
                    filePath={file.path}
                    workspaceId={selectedWorkspaceId}
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
