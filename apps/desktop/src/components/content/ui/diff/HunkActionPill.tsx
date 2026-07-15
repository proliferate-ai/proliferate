import { Minus, Plus, Undo } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";

export type HunkActionMode = "unstaged" | "staged";

interface HunkActionPillProps {
  mode: HunkActionMode;
  disabled: boolean;
  onRevert: () => void;
  onStageOrUnstage: () => void;
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
  reveal = "group-hover",
}: HunkActionPillProps) {
  const isUnstaged = mode === "unstaged";
  const revealClasses =
    reveal === "group-hover"
      ? "opacity-0 pointer-events-none group-hover/hunk:opacity-100 group-hover/hunk:pointer-events-auto group-focus-within/hunk:opacity-100 group-focus-within/hunk:pointer-events-auto"
      : "opacity-100";

  return (
    <div
      className={`absolute right-2 top-0 z-10 flex items-center gap-0.5 rounded-md border border-border/50 bg-[var(--codex-diffs-surface)] px-0.5 py-0.5 shadow-sm transition-opacity duration-150 ${revealClasses}`}
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
            <Undo className="size-3" />
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
          {isUnstaged ? <Plus className="size-3" /> : <Minus className="size-3" />}
        </Button>
      </Tooltip>
    </div>
  );
}
