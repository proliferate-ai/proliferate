import { FileChangeStats } from "@/components/content/ui/FileChangeStats";
import { ArrowRight, FilePen, Undo } from "@proliferate/ui/icons";
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
      className="group/turn-diff-header relative bg-[var(--color-diff-chat-turn-header-surface)] transition-colors hover:bg-[var(--color-diff-chat-turn-header-hover-surface)]"
    >
      <div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-3 px-[var(--turn-diff-row-padding-x)] py-2.5 text-left">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-diff-chat-turn-icon-surface)] text-secondary-foreground">
          <FilePen className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-chat font-medium leading-[var(--text-chat--line-height)] text-foreground">
            {title}
          </span>
          <span className="relative block min-h-4 min-w-0 text-xs leading-4 text-muted-foreground">
            <span
              className={`turn-diff-default-subtitle block truncate transition-opacity duration-200 ${
                onOpenReviewPane
                  ? "group-hover/turn-diff-header:opacity-0 group-focus-within/turn-diff-header:opacity-0"
                  : ""
              }`}
            >
              <FileChangeStats
                additions={totalAdditions}
                deletions={totalDeletions}
                className="text-xs"
              />
            </span>
            {onOpenReviewPane && (
              <span className="turn-diff-hover-subtitle pointer-events-none absolute inset-0 flex min-w-0 items-center gap-1 truncate opacity-0 transition-opacity duration-200 group-hover/turn-diff-header:opacity-100 group-focus-within/turn-diff-header:opacity-100">
                Review changes
                <ArrowRight className="size-3 shrink-0" />
              </span>
            )}
          </span>
        </span>
        <span className="pointer-events-auto flex shrink-0 items-center gap-1">
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
              className="h-8 gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Undo className="size-4" />
              Undo
            </Button>
          )}
          {onOpenReviewPane && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onOpenReviewPane();
              }}
              className="h-8 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Review
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}
