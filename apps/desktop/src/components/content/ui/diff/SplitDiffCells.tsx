import { Fragment } from "react";
import { DiffLineContent } from "@/components/content/ui/diff/DiffLineContent";
import {
  DiffCollapsedContentLabel,
  DiffCollapsedGutterIcon,
  DiffGapContentLabel,
  DiffGapGutterControls,
  type ExpandDirection,
  formatUnmodifiedLinesLabel,
} from "@/components/content/ui/diff/DiffContextExpander";
import { Button } from "@proliferate/ui/primitives/Button";
import type { CollapsedContext, DiffLine, InterHunkGap } from "@/lib/domain/files/diff-parser";
import {
  getDiffLineIndex,
  getSplitAltLineNumber,
  getSplitEmptyLineType,
  getSplitLineNumber,
  getSplitLineType,
  type SplitSide,
} from "@/lib/domain/files/diff-view-rows";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";

export function SplitEmptyCell({
  emptyLineType,
}: {
  emptyLineType: "change-addition" | "change-deletion" | undefined;
}) {
  return (
    <>
      <div
        data-gutter=""
        data-empty-side={emptyLineType}
        data-gutter-buffer="buffer"
        data-buffer-size="1"
        className="diff-gutter-cell sticky left-0 z-10 box-border min-h-[var(--diffs-line-height)] w-[var(--diffs-column-number-width)] min-w-[var(--diffs-column-number-width)] bg-[var(--diffs-bg)]"
      />
      <div
        data-content=""
        data-empty-side={emptyLineType}
        className="diff-content-cell min-h-[var(--diffs-line-height)] bg-[var(--diffs-bg)]"
      />
    </>
  );
}

export function SplitLineCells({
  line,
  peerLine,
  tokens,
  side,
  wrapLongLines,
}: {
  line: DiffLine | null;
  peerLine: DiffLine | null;
  tokens: HighlightedToken[][] | null;
  side: SplitSide;
  wrapLongLines: boolean;
}) {
  if (!line) {
    return <SplitEmptyCell emptyLineType={getSplitEmptyLineType(peerLine)} />;
  }

  const lineType = getSplitLineType(line);
  const lineNumber = getSplitLineNumber(line, side);
  const altLineNumber = getSplitAltLineNumber(line, side);

  return (
    <>
      <div
        data-gutter=""
        data-line-type={lineType}
        data-column-number={lineNumber ?? undefined}
        data-line-index={getDiffLineIndex(line)}
        className="diff-gutter-cell sticky left-0 z-10 box-border flex min-h-[var(--diffs-line-height)] w-[var(--diffs-column-number-width)] min-w-[var(--diffs-column-number-width)] items-start justify-end bg-[var(--diffs-bg)] pr-2 pl-3 pt-[calc((var(--diffs-line-height)-1em)/2)] text-right tabular-nums"
      >
        <span data-line-number-content="">{lineNumber ?? ""}</span>
      </div>
      <div
        data-content=""
        data-line={lineNumber ?? undefined}
        data-alt-line={altLineNumber}
        data-line-type={lineType}
        data-line-index={getDiffLineIndex(line)}
        className={`diff-content-cell relative min-h-[var(--diffs-line-height)] pr-3 pl-2 ${
          wrapLongLines
            ? "block min-w-0 whitespace-pre-wrap break-words py-[calc((var(--diffs-line-height)-1em)/2)]"
            : "flex min-w-max items-center whitespace-pre"
        }`}
      >
        <DiffLineContent line={line} tokens={tokens} />
      </div>
    </>
  );
}

export function SplitCollapsedCells({
  section,
  onExpand,
}: {
  section: CollapsedContext;
  onExpand: () => void;
}) {
  return (
    <>
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        data-gutter=""
        data-separator="line-info"
        onClick={onExpand}
        aria-label={`Expand ${section.lineCount} unmodified lines`}
        title={`${section.lineCount} unmodified lines`}
        className="diff-gutter-cell sticky left-0 z-10 box-border flex min-h-[var(--diffs-line-height)] w-[var(--diffs-column-number-width)] min-w-[var(--diffs-column-number-width)] cursor-pointer items-center justify-center bg-[var(--codex-diffs-separator-surface)] border-0 p-0 text-muted-foreground/60 transition-colors hover:text-foreground"
      >
        <DiffCollapsedGutterIcon />
      </Button>
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        data-content=""
        data-separator="line-info"
        onClick={onExpand}
        aria-label={`Expand ${section.lineCount} unmodified lines`}
        title={`${section.lineCount} unmodified lines`}
        className="diff-content-cell flex min-h-[var(--diffs-line-height)] cursor-pointer items-center justify-start border-0 bg-[var(--codex-diffs-separator-surface)] p-0 text-left font-[inherit] text-[inherit] leading-[inherit] text-muted-foreground/60 transition-colors hover:text-foreground"
      >
        <DiffCollapsedContentLabel
          lineCount={section.lineCount}
          stickyLeft="var(--diffs-column-number-width)"
        />
      </Button>
    </>
  );
}

export function SplitGapCells({
  gap,
  onExpand,
  canExpand,
}: {
  gap: InterHunkGap;
  onExpand: (direction: ExpandDirection) => void;
  canExpand: boolean;
}) {
  return (
    <>
      <div
        data-gutter=""
        data-separator="gap-expander"
        className="diff-gutter-cell sticky left-0 z-10 box-border flex min-h-[var(--diffs-line-height)] w-[var(--diffs-column-number-width)] min-w-[var(--diffs-column-number-width)] items-center justify-center bg-[var(--codex-diffs-separator-surface)]"
      >
        {canExpand && (
          <DiffGapGutterControls gap={gap} onExpand={onExpand} />
        )}
      </div>
      <div
        data-content=""
        data-separator="gap-expander"
        className="diff-content-cell flex min-h-[var(--diffs-line-height)] items-center bg-[var(--codex-diffs-separator-surface)]"
      >
        {canExpand ? (
          <DiffGapContentLabel
            gap={gap}
            onExpand={onExpand}
            stickyLeft="var(--diffs-column-number-width)"
          />
        ) : (
          <span
            style={{ position: "sticky", left: "var(--diffs-column-number-width)" }}
            className="w-max px-2 text-[10px] leading-none text-muted-foreground/50"
          >
            {formatUnmodifiedLinesLabel(gap.lineCount)}
          </span>
        )}
      </div>
    </>
  );
}
