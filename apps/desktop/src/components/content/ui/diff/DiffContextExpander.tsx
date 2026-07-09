import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@proliferate/ui/primitives/Button";
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
 * Gutter-column expand controls for inter-hunk gap rows.
 *
 * Small gaps (<=7 lines): single expand-both (ChevronsUpDown) icon.
 * Large gaps: expand-down chevron on top (extends hunk above), expand-up
 * below (extends hunk below) — matching Codex ordering where each control
 * is adjacent to the hunk it extends.
 */
export function DiffGapGutterControls({
  gap,
  onExpand,
}: {
  gap: InterHunkGap;
  onExpand: (direction: ExpandDirection) => void;
}) {
  const lineCount = gap.lineCount;
  const isSmall = lineCount >= 0 && lineCount <= SMALL_GAP_THRESHOLD;
  const label = formatUnmodifiedLinesLabel(lineCount);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-0">
      {isSmall ? (
        <Button
          variant="unstyled"
          size="unstyled"
          type="button"
          onClick={() => onExpand("all")}
          aria-label={`Expand ${label}`}
          title={`Expand ${label}`}
          className={ICON_BUTTON_CLASS}
        >
          <ChevronsUpDown className="h-3 w-3" />
        </Button>
      ) : (
        <>
          <Button
            variant="unstyled"
            size="unstyled"
            type="button"
            onClick={() => onExpand("down")}
            aria-label="Expand down (reveal lines adjacent to the hunk above)"
            title="Expand down"
            className={ICON_BUTTON_CLASS}
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button
            variant="unstyled"
            size="unstyled"
            type="button"
            onClick={() => onExpand("up")}
            aria-label="Expand up (reveal lines adjacent to the hunk below)"
            title="Expand up"
            className={ICON_BUTTON_CLASS}
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * Content-column label for inter-hunk gap rows.
 * Shows "N unmodified lines" and, for large gaps, an "Expand all" text button.
 * Sticky-pinned against horizontal scroll via stickyLeft.
 */
export function DiffGapContentLabel({
  gap,
  onExpand,
  stickyLeft = "0px",
}: {
  gap: InterHunkGap;
  onExpand?: (direction: ExpandDirection) => void;
  stickyLeft?: string;
}) {
  const lineCount = gap.lineCount;
  const isSmall = lineCount >= 0 && lineCount <= SMALL_GAP_THRESHOLD;
  const label = formatUnmodifiedLinesLabel(lineCount);

  return (
    <div
      style={{ position: "sticky", left: stickyLeft }}
      className="flex w-max items-center gap-0.5 px-2"
    >
      <span className="shrink-0 text-[10px] leading-none text-muted-foreground/70">
        {label}
      </span>
      {!isSmall && onExpand && (
        <Button
          variant="unstyled"
          size="unstyled"
          type="button"
          onClick={() => onExpand("all")}
          aria-label={`Expand all ${label}`}
          title="Expand all"
          className="ml-1.5 shrink-0 cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[10px] leading-none text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          Expand all
        </Button>
      )}
    </div>
  );
}

/**
 * Gutter-column expand icon for collapsed-context rows.
 * Single expand-both icon (decorative in the sense that the parent button
 * owns the click, but visually conveys expandability).
 */
export function DiffCollapsedGutterIcon() {
  return (
    <div className="flex h-full items-center justify-center">
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground/60"
      >
        <ChevronsUpDown className="h-3 w-3" />
      </span>
    </div>
  );
}

/**
 * Content-column label for collapsed-context rows.
 * Shows "N unmodified lines" text, sticky-pinned.
 */
export function DiffCollapsedContentLabel({
  lineCount,
  stickyLeft = "0px",
}: {
  lineCount: number;
  stickyLeft?: string;
}) {
  return (
    <span
      style={{ position: "sticky", left: stickyLeft }}
      className="flex w-max items-center gap-0.5 px-2"
    >
      <span className="shrink-0 text-[10px] leading-none">
        {formatUnmodifiedLinesLabel(lineCount)}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Legacy combined components (kept for UnifiedDiffViewer simple layout)
// ---------------------------------------------------------------------------

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
      {/* Gutter-width area for expand controls */}
      <div className="flex w-[var(--diffs-column-number-width,1.5rem)] shrink-0 items-center justify-center">
        {isSmall ? (
          <Button
            variant="unstyled"
            size="unstyled"
            type="button"
            onClick={() => onExpand("all")}
            aria-label={`Expand ${label}`}
            title={`Expand ${label}`}
            className={ICON_BUTTON_CLASS}
          >
            <ChevronsUpDown className="h-3 w-3" />
          </Button>
        ) : (
          <div className="flex flex-col items-center gap-0">
            <Button
              variant="unstyled"
              size="unstyled"
              type="button"
              onClick={() => onExpand("down")}
              aria-label="Expand down (reveal lines adjacent to the hunk above)"
              title="Expand down"
              className={ICON_BUTTON_CLASS}
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
            <Button
              variant="unstyled"
              size="unstyled"
              type="button"
              onClick={() => onExpand("up")}
              aria-label="Expand up (reveal lines adjacent to the hunk below)"
              title="Expand up"
              className={ICON_BUTTON_CLASS}
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      {/* Content area: label + expand all */}
      <div
        style={{ position: "sticky", left: stickyLeft }}
        className="flex w-max items-center gap-0.5 px-2"
      >
        <span className="shrink-0 text-[10px] leading-none text-muted-foreground/70">
          {label}
        </span>
        {!isSmall && (
          <Button
            variant="unstyled"
            size="unstyled"
            type="button"
            onClick={() => onExpand("all")}
            aria-label={`Expand all ${label}`}
            title="Expand all"
            className="ml-1.5 shrink-0 cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[10px] leading-none text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            Expand all
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Inner cluster for legacy intra-hunk CollapsedContext sections (lines
 * present in the patch but folded away). One click on the wrapping
 * button reveals the whole section, so this is a single expand-all
 * affordance — same treatment as the small-gap expander: left-anchored,
 * scroll-pinned. The chevron is decorative; the caller's button owns
 * the interaction and accessible name.
 */
export function DiffCollapsedContextCluster({
  lineCount,
  stickyLeft = "0px",
}: {
  lineCount: number;
  stickyLeft?: string;
}) {
  return (
    <span
      style={{ position: "sticky", left: stickyLeft }}
      className="flex w-max items-center gap-0.5 px-2"
    >
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded p-0.5"
      >
        <ChevronsUpDown className="h-3 w-3" />
      </span>
      <span className="shrink-0 pl-1 text-[10px] leading-none">
        {formatUnmodifiedLinesLabel(lineCount)}
      </span>
    </span>
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
