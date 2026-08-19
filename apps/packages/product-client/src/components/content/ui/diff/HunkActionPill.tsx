import { Minus, Plus, Undo } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { Tooltip } from "#product/primitives/Tooltip";
import type { HunkActionMode } from "#product/lib/domain/files/hunk-patch";

interface HunkActionPillProps {
  mode: HunkActionMode;
  disabled: boolean;
  onRevert: () => void;
  onStageOrUnstage: () => void;
  placement?: "line-end" | "scrollport-end";
  /**
   * How the pill reveals itself:
   * - "group-hover" (default): invisible until an ancestor `.group/hunk` is hovered.
   * - "visible": always shown (parent controls mounting, e.g. hover-state tracking).
   */
  reveal?: "group-hover" | "visible";
}

/**
 * Floating pill shown on hover over a diff hunk, providing hunk-level
 * Revert and Stage/Unstage actions.
 */
export function HunkActionPill({
  mode,
  disabled,
  onRevert,
  onStageOrUnstage,
  placement = "line-end",
  reveal = "group-hover",
}: HunkActionPillProps) {
  const isUnstaged = mode === "unstaged";
  const revealClasses =
    reveal === "group-hover"
      ? "opacity-0 pointer-events-none group-hover/hunk:opacity-100 group-hover/hunk:pointer-events-auto group-focus-within/hunk:opacity-100 group-focus-within/hunk:pointer-events-auto"
      : "opacity-100";
  const placementClasses = placement === "scrollport-end"
    ? "sticky right-2 ms-auto shrink-0"
    : "absolute right-2 top-0";

  return (
    <div
      className={`${placementClasses} z-10 flex items-center gap-0.5 rounded-md border border-border/50 bg-[var(--diff-view-surface)] px-0.5 py-0.5 shadow-popover transition-opacity duration-hover ${revealClasses}`}
    >
      {isUnstaged && (
        <Tooltip content="Revert hunk">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-5 rounded p-0 text-muted-foreground hover:text-destructive"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onRevert();
            }}
            aria-label="Revert hunk"
          >
            <Undo className="icon-compact" />
          </Button>
        </Tooltip>
      )}
      <Tooltip content={isUnstaged ? "Stage hunk" : "Unstage hunk"}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={`size-5 rounded p-0 ${
            isUnstaged
              ? "text-muted-foreground hover:text-foreground"
              : "text-git-green hover:text-foreground"
          }`}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onStageOrUnstage();
          }}
          aria-label={isUnstaged ? "Stage hunk" : "Unstage hunk"}
        >
          {isUnstaged ? <Plus className="icon-compact" /> : <Minus className="icon-compact" />}
        </Button>
      </Tooltip>
    </div>
  );
}
