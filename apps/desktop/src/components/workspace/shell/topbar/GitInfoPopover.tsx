import { useCallback, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@proliferate/ui/kit/Popover";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  Copy,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
} from "@proliferate/ui/icons";

export interface GitInfoPopoverData {
  branchName: string | null;
  additions: number;
  deletions: number;
  hasExistingPr: boolean;
  prNumber: number | null;
  prUrl: string | null;
  prChecksOk: boolean;
  prChecksFailing: boolean;
  prMerged: boolean;
  gitActionsDisabledReason: string | null;
}

export interface GitInfoPopoverActions {
  onOpenChangesPanel: () => void;
  onCopyBranch: () => void;
  onCommitOrPush: () => void;
  onCreatePr: () => void;
  onViewPr: () => void;
  onMergePr: () => void;
}

interface GitInfoPopoverProps {
  data: GitInfoPopoverData;
  actions: GitInfoPopoverActions;
}

const ROW_CLASS =
  "group/row relative isolate flex w-full min-w-0 items-center gap-2 rounded-sm border-0 bg-transparent px-0 text-left h-7 py-1 cursor-pointer text-popover-foreground before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-sm before:content-[''] hover:before:bg-accent/50";

export function GitInfoPopover({ data, actions }: GitInfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const hasDiff = data.additions > 0 || data.deletions > 0;
  const showMerge = data.hasExistingPr && !data.prMerged;

  const close = useCallback(() => setOpen(false), []);

  const handleChanges = useCallback(() => {
    close();
    actions.onOpenChangesPanel();
  }, [close, actions]);

  const handleCopyBranch = useCallback(() => {
    close();
    actions.onCopyBranch();
  }, [close, actions]);

  const handleCommitOrPush = useCallback(() => {
    close();
    actions.onCommitOrPush();
  }, [close, actions]);

  const handlePr = useCallback(() => {
    close();
    if (data.hasExistingPr) {
      actions.onViewPr();
    } else {
      actions.onCreatePr();
    }
  }, [close, data.hasExistingPr, actions]);

  const handleMerge = useCallback(() => {
    close();
    actions.onMergePr();
  }, [close, actions]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Git info"
          title="Git info"
          className="workspace-shell-icon-button app-region-no-drag shrink-0"
        >
          <GitBranch className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[300px] p-0"
      >
        <div className="flex flex-col gap-0.5 px-4 py-3">
          {/* Changes row */}
          <div
            className={ROW_CLASS}
            role="button"
            tabIndex={0}
            onClick={handleChanges}
            onKeyDown={(e) => e.key === "Enter" && handleChanges()}
          >
            <GitCommit className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-sm truncate">Changes</span>
              {hasDiff && (
                <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums text-xs tracking-tight">
                  <span className="text-git-green">+{data.additions.toLocaleString()}</span>
                  <span className="text-git-red">-{data.deletions.toLocaleString()}</span>
                </span>
              )}
            </span>
          </div>

          {/* Branch row */}
          {data.branchName && (
            <div
              className={ROW_CLASS}
              role="button"
              tabIndex={0}
              onClick={handleCopyBranch}
              onKeyDown={(e) => e.key === "Enter" && handleCopyBranch()}
              title="Copy branch name"
              data-telemetry-mask="true"
            >
              <GitBranch className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {data.branchName}
              </span>
              <Copy className="size-3 shrink-0 text-muted-foreground/70 opacity-0 group-hover/row:opacity-100" />
            </div>
          )}

          {/* Commit or push */}
          <div
            className={ROW_CLASS}
            role="button"
            tabIndex={0}
            onClick={handleCommitOrPush}
            onKeyDown={(e) => e.key === "Enter" && handleCommitOrPush()}
          >
            <GitCommit className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm truncate">Commit or push</span>
          </div>

          {/* PR row */}
          <div
            className={ROW_CLASS}
            role="button"
            tabIndex={0}
            onClick={handlePr}
            onKeyDown={(e) => e.key === "Enter" && handlePr()}
          >
            <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-sm truncate">
                {data.hasExistingPr && data.prNumber
                  ? `PR #${data.prNumber}`
                  : "Create pull request"}
              </span>
              {data.hasExistingPr && (
                <span
                  className={`ml-auto size-2 shrink-0 rounded-full ${
                    data.prChecksFailing
                      ? "bg-destructive"
                      : data.prChecksOk
                        ? "bg-green-500"
                        : "bg-muted-foreground/50"
                  }`}
                />
              )}
            </span>
          </div>

          {/* Merge PR row */}
          {showMerge && (
            <div
              className={ROW_CLASS}
              role="button"
              tabIndex={0}
              onClick={handleMerge}
              onKeyDown={(e) => e.key === "Enter" && handleMerge()}
            >
              <GitMerge className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm truncate">Merge pull request</span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
