import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { InterHunkGap } from "@/lib/domain/files/diff-parser";

/** Threshold: gaps with this many lines or fewer show a single expand-all control */
const SMALL_GAP_THRESHOLD = 7;

export type ExpandDirection = "up" | "down" | "all";

const ICON_BUTTON_CLASS =
  "flex shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground";

interface DiffContextExpanderProps {
  gap: InterHunkGap;
  onExpand: (direction: ExpandDirection) => void;
  /**
   * `left` offset for pinning the control cluster against horizontal
   * scroll (typically the gutter width so it clears sticky line numbers).
   */
  stickyLeft?: string;
}

export function formatUnmodifiedLinesLabel(lineCount: number): string {
  return lineCount >= 0
    ? `${lineCount} unmodified line${lineCount === 1 ? "" : "s"}`
    : "unmodified lines";
}

/**
 * Codex-style per-gap separator row: a compact, left-anchored inline
 * cluster of expand affordances followed by the "N unmodified lines"
 * label. The cluster is `position: sticky` against the nearest
 * horizontally scrolling ancestor so it never drifts out of the visible
 * viewport when long diff lines scroll sideways.
 *
 * Small gaps (<= 7 lines) get a single combined expand-both control;
 * larger gaps get expand-up + expand-down icon buttons and an
 * "Expand all" text button at the end.
 */
export function DiffContextExpander({
  gap,
  onExpand,
  stickyLeft = "0px",
}: DiffContextExpanderProps) {
  const lineCount = gap.lineCount;
  const isSmall = lineCount >= 0 && lineCount <= SMALL_GAP_THRESHOLD;
  const label = formatUnmodifiedLinesLabel(lineCount);

  return (
    <div
      data-separator="gap-expander"
      className="diff-gap-expander flex min-h-[var(--diffs-line-height)] items-center bg-[var(--codex-diffs-separator-surface)]"
    >
      <div
        style={{ position: "sticky", left: stickyLeft }}
        className="flex w-max items-center gap-0.5 px-2"
      >
        {isSmall ? (
          <button
            type="button"
            onClick={() => onExpand("all")}
            aria-label={`Expand ${label}`}
            title={`Expand ${label}`}
            className={ICON_BUTTON_CLASS}
          >
            <ChevronsUpDown className="h-3 w-3" />
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onExpand("up")}
              aria-label="Expand up (reveal lines adjacent to the hunk below)"
              title="Expand up"
              className={ICON_BUTTON_CLASS}
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => onExpand("down")}
              aria-label="Expand down (reveal lines adjacent to the hunk above)"
              title="Expand down"
              className={ICON_BUTTON_CLASS}
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </>
        )}
        <span className="shrink-0 pl-1 text-[10px] leading-none text-muted-foreground/70">
          {label}
        </span>
        {!isSmall && (
          <button
            type="button"
            onClick={() => onExpand("all")}
            aria-label={`Expand all ${label}`}
            title="Expand all"
            className="ml-1.5 shrink-0 cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[10px] leading-none text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            Expand all
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Non-interactive variant for surfaces where gap expansion is
 * unavailable (content fetch impossible for the diff's revision).
 * Same left-anchored, scroll-pinned layout.
 */
export function DiffGapInfoRow({
  lineCount,
  stickyLeft = "0px",
}: {
  lineCount: number;
  stickyLeft?: string;
}) {
  return (
    <div
      data-separator="gap-info"
      className="flex min-h-[var(--diffs-line-height)] items-center bg-[var(--codex-diffs-separator-surface)]"
    >
      <span
        style={{ position: "sticky", left: stickyLeft }}
        className="w-max px-2 text-[10px] leading-none text-muted-foreground/50"
      >
        {formatUnmodifiedLinesLabel(lineCount)}
      </span>
    </div>
  );
}
