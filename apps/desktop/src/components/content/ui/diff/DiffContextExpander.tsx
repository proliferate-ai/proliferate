import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { InterHunkGap } from "@/lib/domain/files/diff-parser";

/** Threshold: gaps with this many lines or fewer show a single expand-all control */
const SMALL_GAP_THRESHOLD = 7;

export type ExpandDirection = "up" | "down" | "all";

interface DiffContextExpanderProps {
  gap: InterHunkGap;
  onExpand: (direction: ExpandDirection) => void;
}

/**
 * Codex-style per-gap separator row with expand affordances.
 * For small gaps (<=7 lines), renders a single combined expand-all control.
 * For larger gaps, renders expand-up, expand-down, and expand-all buttons.
 */
export function DiffContextExpander({ gap, onExpand }: DiffContextExpanderProps) {
  const lineCount = gap.lineCount;
  const isUnknown = lineCount < 0;
  const isSmall = !isUnknown && lineCount <= SMALL_GAP_THRESHOLD;
  const label = isUnknown
    ? "unmodified lines"
    : `${lineCount} unmodified line${lineCount === 1 ? "" : "s"}`;

  if (isSmall) {
    return (
      <div
        data-separator="gap-expander"
        className="diff-gap-expander flex min-h-[var(--diffs-line-height)] items-center gap-2 bg-[var(--codex-diffs-separator-surface)] px-2"
      >
        <span className="h-px min-w-3 flex-1 bg-border/40" />
        <button
          type="button"
          onClick={() => onExpand("all")}
          aria-label={`Expand ${label}`}
          title={`Expand ${label}`}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground/70 transition-colors hover:text-muted-foreground"
        >
          <ChevronsUpDown className="h-3 w-3" />
          <span>{label}</span>
        </button>
        <span className="h-px min-w-3 flex-1 bg-border/40" />
      </div>
    );
  }

  return (
    <div
      data-separator="gap-expander"
      className="diff-gap-expander flex min-h-[var(--diffs-line-height)] items-center gap-1.5 bg-[var(--codex-diffs-separator-surface)] px-2"
    >
      <span className="h-px min-w-3 flex-1 bg-border/40" />
      <button
        type="button"
        onClick={() => onExpand("down")}
        aria-label="Expand lines down (adjacent to hunk above)"
        title="Expand down"
        className="flex shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0.5 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        <ChevronDown className="h-3 w-3" />
      </button>
      <span className="shrink-0 text-[10px] leading-none text-muted-foreground/70">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onExpand("up")}
        aria-label="Expand lines up (adjacent to hunk below)"
        title="Expand up"
        className="flex shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0.5 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        <ChevronUp className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => onExpand("all")}
        aria-label={`Expand all ${label}`}
        title="Expand all"
        className="flex shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0.5 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        <ChevronsUpDown className="h-3 w-3" />
      </button>
      <span className="h-px min-w-3 flex-1 bg-border/40" />
    </div>
  );
}
