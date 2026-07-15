import { Button } from "@proliferate/ui/primitives/Button";
import { CheckCircleFilled, GitBranchIcon, RefreshCw, Undo } from "@proliferate/ui/icons";
import {
  GitReviewEmptyState,
  GitReviewEmptyStateAction,
} from "./GitReviewEmptyState";
import {
  gitPanelEmptyDescription,
  gitPanelEmptyMessage,
  type GitPanelMode,
} from "@/lib/domain/workspaces/changes/git-panel-diff";
import type { DiffDisplayPolicySummary } from "@/lib/domain/workspaces/changes/diff-display-policy";

export function GitLastTurnUndoAction({
  fileCount,
  disabledReason,
  busy,
  onUndo,
}: {
  fileCount: number;
  disabledReason: string | null;
  busy: boolean;
  onUndo: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-sidebar-border/70 bg-sidebar-accent/35 px-2.5 py-2 text-xs leading-5 text-sidebar-muted-foreground">
      <Undo className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {fileCount > 0
          ? `${fileCount} file${fileCount === 1 ? "" : "s"} from the last turn`
          : "Last turn undo unavailable"}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy || Boolean(disabledReason)}
        title={disabledReason ?? "Undo last turn changes"}
        onClick={onUndo}
        className="h-7 shrink-0 gap-1 rounded-md px-2 text-xs text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Undo className="size-3.5" />
        {busy ? "Undoing" : "Undo"}
      </Button>
    </div>
  );
}

export function GitReviewDiffPolicyNotice({ summary }: { summary: DiffDisplayPolicySummary }) {
  const hiddenLabel = `${summary.total} large/generated diff${summary.total === 1 ? "" : "s"}`;
  const tooLargeLabel = summary.tooLargeInline > 0
    ? `${summary.tooLargeInline} too large to render inline`
    : null;
  return (
    <div className="rounded-md border border-sidebar-border/70 bg-sidebar-accent/35 px-2.5 py-2 text-xs leading-5 text-sidebar-muted-foreground">
      <span>
        {hiddenLabel} collapsed to keep review responsive.
      </span>
      {tooLargeLabel && (
        <span> {tooLargeLabel}; open the file to inspect those changes.</span>
      )}
    </div>
  );
}

export function GitReviewNoChangesState({
  mode,
  baseRef,
  onRefresh,
}: {
  mode: GitPanelMode;
  baseRef: string | null;
  onRefresh: () => void;
}) {
  const Icon = mode === "branch" ? GitBranchIcon : CheckCircleFilled;
  return (
    <GitReviewEmptyState
      icon={<Icon className="size-4" />}
      title={gitPanelEmptyMessage(mode)}
      description={gitPanelEmptyDescription(mode, baseRef)}
      action={
        <GitReviewEmptyStateAction onClick={onRefresh}>
          <RefreshCw className="size-3" />
          Refresh
        </GitReviewEmptyStateAction>
      }
    />
  );
}

export function formatGitPanelUndoError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Could not undo last turn file changes.";
}
