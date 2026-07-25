import { useCallback } from "react";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Label } from "@proliferate/ui/primitives/Label";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import {
  ArrowUp,
  GitBranch,
  GitCommit,
  GitPullRequest,
} from "@proliferate/ui/icons";
import type { CommitAction } from "@/lib/domain/workspaces/creation/commit-dialog-state";
import type { CommitDialogState } from "@/hooks/workspaces/workflows/use-commit-dialog";

interface CommitDialogActionsProps {
  state: CommitDialogState;
  onTextareaKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onViewPr: () => void;
  onClose: () => void;
}

const ACTION_LABELS: Record<CommitAction, string> = {
  commit: "Commit",
  commit_and_push: "Commit and push",
  push: "Push",
  create_pr: "Create pull request…",
};

function ActionIcon({ action }: { action: CommitAction }) {
  switch (action) {
    case "commit":
      return <GitCommit className="size-3.5 shrink-0" />;
    case "commit_and_push":
      return <ArrowUp className="size-3.5 shrink-0" />;
    case "push":
      return <ArrowUp className="size-3.5 shrink-0" />;
    case "create_pr":
      return <GitPullRequest className="size-3.5 shrink-0" />;
  }
}

export function CommitDialogActions({
  state,
  onTextareaKeyDown,
  onViewPr,
  onClose,
}: CommitDialogActionsProps) {
  const { derived, commitMessage, includeUnstaged, focusedActionIndex, error, isSubmitting, generation } = state;

  const handleActionClick = useCallback((action: CommitAction, index: number) => {
    state.setFocusedActionIndex(index);
    void state.executeAction(action).then((done) => {
      if (done) onClose();
    });
  }, [onClose, state]);

  const showDiffStats = derived.totalAdditions > 0 || derived.totalDeletions > 0;

  return (
    <>
      {/* Header row: 36px, branch name + diff stats */}
      <div className="flex h-9 items-center justify-between gap-3 px-3">
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <GitBranch className="size-3 shrink-0" />
          <span className="min-w-0 truncate text-xs leading-5">
            {derived.branchName ?? "detached"}
          </span>
        </span>
        {showDiffStats && (
          <span className="flex shrink-0 items-center gap-1 tabular-nums text-xs">
            {derived.totalAdditions > 0 && (
              <span className="text-git-green">+{derived.totalAdditions}</span>
            )}
            {derived.totalDeletions > 0 && (
              <span className="text-git-red">&minus;{derived.totalDeletions}</span>
            )}
          </span>
        )}
      </div>

      {/* Commit message textarea: only when dirty tree */}
      {derived.dialogMode === "dirty" && (
        <div className="relative">
          <Textarea
            rows={3}
            className="h-20 w-full resize-none border-0 bg-transparent px-3 py-2 text-foreground outline-none focus:ring-0"
            aria-label="Commit message"
            placeholder={generation.generationAvailable
              ? "Commit message (leave blank to generate)"
              : "Commit message"}
            value={commitMessage}
            onChange={(event) => state.setCommitMessage(event.target.value)}
            onKeyDown={onTextareaKeyDown}
            disabled={isSubmitting}
          />
          {generation.commitStatus === "generating" && (
            <span className="absolute bottom-2 right-3 text-xs text-muted-foreground">
              Generating…
            </span>
          )}
        </div>
      )}

      {/* Quiet captions for non-dirty states */}
      {derived.dialogMode === "unpushed" && (
        <div className="px-3 py-2">
          <p className="text-xs text-muted-foreground">No local changes</p>
        </div>
      )}
      {derived.dialogMode === "synced_no_pr" && derived.availableActions.length === 0 && (
        <div className="px-3 py-2">
          <p className="text-xs text-muted-foreground">Everything up to date</p>
        </div>
      )}
      {derived.dialogMode === "synced_has_pr" && (
        <div className="px-3 py-2">
          <p className="text-xs text-muted-foreground">Everything up to date</p>
        </div>
      )}
      {derived.dialogMode === "blocked" && derived.blockingReason && (
        <div className="px-3 py-2">
          <p className="text-xs text-muted-foreground">{derived.blockingReason}</p>
        </div>
      )}

      {/* Include unstaged checkbox */}
      {derived.dialogMode === "dirty" && derived.hasUnstagedChanges && (
        <div className="flex items-center gap-2 px-3 pb-3 pt-2">
          <Checkbox
            id="commit-include-unstaged"
            checked={includeUnstaged}
            onCheckedChange={(checked) => state.setIncludeUnstaged(Boolean(checked))}
            disabled={isSubmitting}
          />
          <Label htmlFor="commit-include-unstaged" className="mb-0 text-sm text-foreground">
            Include unstaged changes
          </Label>
        </div>
      )}

      {/* Action list: unified, driven entirely by availableActions */}
      {derived.availableActions.length > 0 && (
        <div className="border-t border-border/60 py-1">
          <div role="listbox" aria-label="Actions" className="flex flex-col">
            {derived.availableActions.map((action, index) => {
              const isSelected = index === focusedActionIndex;
              return (
                <PopoverMenuItem
                  key={action}
                  role="option"
                  aria-selected={isSelected}
                  data-selected={isSelected}
                  density="compact"
                  disabled={isSubmitting}
                  icon={<ActionIcon action={action} />}
                  label={ACTION_LABELS[action]}
                  trailing={
                    <span className="invisible shrink-0 text-base text-muted-foreground group-aria-[selected=true]/menu-item:visible">
                      ⌘↵
                    </span>
                  }
                  className="rounded-none text-foreground aria-selected:bg-foreground/5"
                  onClick={() => handleActionClick(action, index)}
                  onMouseEnter={() => state.setFocusedActionIndex(index)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* View PR button: synced_has_pr mode only */}
      {derived.dialogMode === "synced_has_pr" && derived.existingPr && (
        <div className="border-t border-border/60 py-1">
          <PopoverMenuItem
            density="compact"
            icon={<GitPullRequest className="size-3.5 shrink-0" />}
            label={`View pull request #${derived.existingPr.number}`}
            className="rounded-none text-foreground"
            onClick={onViewPr}
            disabled={isSubmitting}
          />
        </div>
      )}

      {/* Inline error strip */}
      {error && (
        <div className="border-t border-border/60 px-3 py-2">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </>
  );
}
