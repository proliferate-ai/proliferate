import { FileChangeStats } from "#product/components/content/ui/FileChangeStats";
import { ArrowUpRight, FileDiff, Undo } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";

interface TurnDiffPanelHeaderProps {
  title: string;
  totalAdditions: number;
  totalDeletions: number;
  canUndo: boolean;
  showUndo: boolean;
  undoDisabledReason?: string | null;
  onUndoTurnChanges?: () => void;
  onOpenReviewPane?: () => void;
}

export function TurnDiffPanelHeader({
  title,
  totalAdditions,
  totalDeletions,
  canUndo,
  showUndo,
  undoDisabledReason,
  onUndoTurnChanges,
  onOpenReviewPane,
}: TurnDiffPanelHeaderProps) {
  return (
    <div
      data-chat-diff-wrap-context-trigger="turn-header"
      className={`relative ${onOpenReviewPane ? "cursor-pointer" : ""}`}
    >
      {onOpenReviewPane && (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          data-chat-transcript-ignore
          aria-label="Review changed files"
          onClick={onOpenReviewPane}
          className="turn-diff-review-target absolute inset-0 z-0 rounded-t-lg bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
        />
      )}
      <div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-2.5 px-[var(--turn-diff-row-padding-x)] py-3 text-left">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-diff-chat-turn-icon-surface)] text-secondary-foreground">
          <FileDiff className="icon-display" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-chat font-medium leading-[var(--text-chat--line-height)] text-foreground">
            {title}
          </span>
          <span className="relative block min-h-4 min-w-0 text-xs leading-4 text-muted-foreground">
            <span className="turn-diff-default-subtitle inline-flex truncate">
              <FileChangeStats
                additions={totalAdditions}
                deletions={totalDeletions}
                className="text-xs"
                rolling
              />
            </span>
            {onOpenReviewPane && (
              <span className="turn-diff-hover-subtitle pointer-events-none absolute inset-0 hidden min-w-0 items-center gap-1 truncate">
                Review changes
                <ArrowUpRight className="icon-compact shrink-0" />
              </span>
            )}
          </span>
        </span>
        <span className="pointer-events-auto flex shrink-0 items-center gap-2">
          {showUndo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canUndo}
              title={undoDisabledReason ?? "Undo last turn changes"}
              onClick={(event) => {
                event.stopPropagation();
                onUndoTurnChanges?.();
              }}
              className="h-7 gap-1 rounded-md px-2 text-chat text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
            >
              Undo
              <Undo className="icon-paired" />
            </Button>
          )}
          {onOpenReviewPane && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onOpenReviewPane();
              }}
              className="h-7 rounded-md border-border bg-transparent px-2 text-chat text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Review
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}
