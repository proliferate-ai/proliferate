import { Button } from "#product/primitives/Button";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { RefreshCw } from "#product/primitives/icons/platform";
import { Undo } from "#product/primitives/icons/core";
import {
  GitReviewEmptyState,
  GitReviewEmptyStateAction,
} from "./GitReviewEmptyState";
import {
  gitPanelEmptyDescription,
  gitPanelEmptyMessage,
  type GitPanelMode,
} from "#product/lib/domain/workspaces/changes/git-panel-diff";
import type { DiffDisplayPolicySummary } from "#product/lib/domain/workspaces/changes/diff-display-policy";

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
    <NoticeBanner
      tone="neutral"
      icon={<Undo />}
      // The Undo button keeps its own hand-assembled hover/active/disabled
      // stack (C7, permitted to survive with justification): it is a
      // secondary-weight text+icon action with a `title` tooltip and a
      // "Undoing" busy label, a shape `Button`'s own variants don't cover,
      // and `NoticeBanner`'s action slot takes any interactive primitive as
      // long as that primitive owns its own states, which this one does.
      action={(
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || Boolean(disabledReason)}
          title={disabledReason ?? "Undo last turn changes"}
          onClick={onUndo}
          className="h-7 shrink-0 gap-1 rounded-md px-2 text-ui-sm text-sidebar-muted-foreground hover:bg-hover hover:text-sidebar-foreground active:bg-active disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Undo className="icon-paired" />
          {busy ? "Undoing" : "Undo"}
        </Button>
      )}
    >
      {fileCount > 0
        ? `${fileCount} file${fileCount === 1 ? "" : "s"} from the last turn`
        : "Last turn undo unavailable"}
    </NoticeBanner>
  );
}

export function GitReviewDiffPolicyNotice({ summary }: { summary: DiffDisplayPolicySummary }) {
  const hiddenLabel = `${summary.total} large/generated diff${summary.total === 1 ? "" : "s"}`;
  const tooLargeLabel = summary.tooLargeInline > 0
    ? `${summary.tooLargeInline} too large to render inline`
    : null;
  return (
    <NoticeBanner tone="neutral">
      {hiddenLabel} collapsed to keep review responsive.
      {tooLargeLabel && ` ${tooLargeLabel}; open the file to inspect those changes.`}
    </NoticeBanner>
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
  return (
    <GitReviewEmptyState
      title={gitPanelEmptyMessage(mode)}
      description={gitPanelEmptyDescription(mode, baseRef)}
      action={
        <GitReviewEmptyStateAction onClick={onRefresh}>
          <RefreshCw className="icon-compact" />
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
