import {
  Fragment,
  useMemo,
  useState,
  type CSSProperties,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { DiffLineContent } from "@/components/content/ui/diff/DiffLineContent";
import {
  DiffContextExpander,
  DiffGapInfoRow,
  type ExpandDirection,
} from "@/components/content/ui/diff/DiffContextExpander";
import { useResolvedMode } from "@/hooks/theme/derived/use-resolved-mode";
import { Button } from "@proliferate/ui/primitives/Button";
import { chainVerticalWheelScroll } from "@proliferate/ui/utils/scroll-chain";
import type { CollapsedContext, DiffLine, InterHunkGap, ParsedPatch } from "@/lib/domain/files/diff-parser";
import {
  getDiffLineIndex,
  getDiffLineNumberColumnWidth,
  getSplitAltLineNumber,
  getSplitDiffRows,
  getSplitEmptyLineType,
  getSplitLineNumber,
  getSplitLineType,
  type SplitDiffRow,
  type SplitSide,
} from "@/lib/domain/files/diff-view-rows";
import {
  clampGapReveal,
  resolveGapLineCount,
  useGapExpansion,
  type GapExpansionState,
} from "@/hooks/ui/diff/use-gap-expansion";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";

/** Flattened render row for split view */
type SplitRenderRow =
  | SplitDiffRow
  | { kind: "expanded-gap-line"; key: string; oldLine: DiffLine; newLine: DiffLine };

function makeSplitGapContextLine(
  fileLines: string[],
  gap: InterHunkGap,
  offset: number,
): DiffLine {
  const newLine = gap.newStartLine + offset;
  return {
    type: "context",
    marker: " ",
    content: fileLines[newLine - 1] ?? "",
    oldLineNum: gap.oldStartLine + offset,
    newLineNum: newLine,
    lineNum: newLine,
    tokenIndex: -1,
  };
}

function flattenSplitWithGapExpansion(
  rows: SplitDiffRow[],
  gapStates: Map<number, GapExpansionState>,
  fileLines: string[] | undefined,
): SplitRenderRow[] {
  const result: SplitRenderRow[] = [];
  for (const row of rows) {
    if (row.kind !== "gap") {
      result.push(row);
      continue;
    }

    // Resolve unknown trailing gap count against fetched file length
    const gap = resolveGapLineCount(row.gap, fileLines);
    if (!gap) continue;
    const resolvedRow: SplitDiffRow = gap === row.gap ? row : { ...row, gap };

    const state = gapStates.get(row.gapIndex);
    if (!fileLines || !state || gap.lineCount <= 0) {
      result.push(resolvedRow);
      continue;
    }

    const totalGapLines = gap.lineCount;
    const { top, bottom, fullyExpanded } = clampGapReveal(state, totalGapLines);
    if (top === 0 && bottom === 0) {
      result.push(resolvedRow);
      continue;
    }

    for (let i = 0; i < top; i++) {
      const line = makeSplitGapContextLine(fileLines, gap, i);
      result.push({ kind: "expanded-gap-line", key: `${row.key}-top-${i}`, oldLine: line, newLine: line });
    }

    if (!fullyExpanded) {
      const residualGap: InterHunkGap = {
        kind: "gap",
        oldStartLine: gap.oldStartLine + top,
        newStartLine: gap.newStartLine + top,
        lineCount: totalGapLines - top - bottom,
      };
      result.push({ kind: "gap", key: `${row.key}-residual`, gap: residualGap, gapIndex: row.gapIndex });
    }

    for (let i = totalGapLines - bottom; i < totalGapLines; i++) {
      const line = makeSplitGapContextLine(fileLines, gap, i);
      result.push({ kind: "expanded-gap-line", key: `${row.key}-bottom-${i}`, oldLine: line, newLine: line });
    }
  }
  return result;
}

const SPLIT_DIFF_PRE_STYLE = {
  color: "var(--diffs-fg)",
  backgroundColor: "var(--diffs-bg)",
  "--diffs-bg": "var(--codex-diffs-surface)",
  "--diffs-addition-color": "var(--diffs-addition-color-override)",
  "--diffs-deletion-color": "var(--diffs-deletion-color-override)",
  "--diffs-min-number-column-width": "4ch",
  "--diffs-min-number-column-width-default": "3ch",
} as CSSProperties;

const SPLIT_DIFF_CODE_BASE_STYLE = {
  "--diffs-column-content-width": "360px",
  "--diffs-column-width": "360px",
} as CSSProperties;

function SplitEmptyCell({
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

function SplitLineCells({
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

function SplitCollapsedCells({
  section,
  onExpand,
}: {
  section: CollapsedContext;
  onExpand: () => void;
}) {
  return (
    <>
      <div
        data-gutter=""
        data-separator="line-info"
        className="diff-gutter-cell sticky left-0 z-10 box-border min-h-[var(--diffs-line-height)] w-[var(--diffs-column-number-width)] min-w-[var(--diffs-column-number-width)] bg-[var(--diffs-bg)]"
      />
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        data-content=""
        data-separator="line-info"
        onClick={onExpand}
        aria-label={`Show ${section.lineCount} unmodified lines`}
        title={`${section.lineCount} unmodified lines`}
        className="diff-content-cell flex min-h-[var(--diffs-line-height)] cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-0 text-left font-[inherit] text-[inherit] leading-[inherit] text-muted-foreground/70 hover:text-muted-foreground"
      >
        <span className="h-px min-w-4 flex-1 bg-border/60" />
        <span data-unmodified-lines="" className="shrink-0 text-[10px] leading-none">
          Show {section.lineCount} unchanged line{section.lineCount === 1 ? "" : "s"}
        </span>
        <span className="h-px min-w-4 flex-1 bg-border/60" />
      </Button>
    </>
  );
}

function SplitGapCells({
  gap,
  onExpand,
  canExpand,
}: {
  gap: InterHunkGap;
  onExpand: (direction: ExpandDirection) => void;
  canExpand: boolean;
}) {
  // Each split code column owns its own horizontal scroll; the gutter cell
  // is sticky at left 0, so the cluster pins just past the gutter width.
  return (
    <>
      <div
        data-gutter=""
        data-separator="gap-expander"
        className="diff-gutter-cell sticky left-0 z-10 box-border min-h-[var(--diffs-line-height)] w-[var(--diffs-column-number-width)] min-w-[var(--diffs-column-number-width)] bg-[var(--codex-diffs-separator-surface)]"
      />
      <div
        data-content=""
        data-separator="gap-expander"
        className="diff-content-cell min-h-[var(--diffs-line-height)] bg-[var(--codex-diffs-separator-surface)]"
      >
        {canExpand ? (
          <DiffContextExpander
            gap={gap}
            onExpand={onExpand}
            stickyLeft="var(--diffs-column-number-width)"
          />
        ) : (
          <DiffGapInfoRow
            lineCount={gap.lineCount}
            stickyLeft="var(--diffs-column-number-width)"
          />
        )}
      </div>
    </>
  );
}

function SplitCodeColumn({
  side,
  rows,
  rowCount,
  tokens,
  wrapLongLines,
  lineNumberDigits,
  onExpandCollapsed,
  onExpandGap,
  canExpandGaps,
}: {
  side: SplitSide;
  rows: SplitRenderRow[];
  rowCount: number;
  tokens: HighlightedToken[][] | null;
  wrapLongLines: boolean;
  lineNumberDigits: number;
  onExpandCollapsed: (key: string) => void;
  onExpandGap: (gapIndex: number, gap: InterHunkGap, direction: ExpandDirection) => void;
  canExpandGaps: boolean;
}) {
  const codeStyle = useMemo(
    () => ({
      ...SPLIT_DIFF_CODE_BASE_STYLE,
      "--diffs-column-number-width": getDiffLineNumberColumnWidth(lineNumberDigits),
    }) as CSSProperties,
    [lineNumberDigits],
  );

  return (
    <code
      data-code=""
      data-deletions={side === "old" ? "" : undefined}
      data-additions={side === "new" ? "" : undefined}
      data-container-size=""
      style={{
        ...codeStyle,
        gridColumn: side === "old" ? "1" : "2",
        gridRow: `1 / span ${rowCount}`,
      }}
      className={`grid border-border/60 ${
        side === "old" ? "border-r" : ""
      } [grid-template-rows:subgrid] ${
        wrapLongLines
          ? "min-w-0 max-w-full overflow-hidden grid-cols-[var(--diffs-column-number-width)_minmax(0,1fr)]"
          : "min-w-0 max-w-full overflow-x-auto overflow-y-hidden [overscroll-behavior-x:contain] grid-cols-[var(--diffs-column-number-width)_minmax(max-content,1fr)]"
      }`}
    >
      {rows.map((row) => {
        if (row.kind === "line") {
          return (
            <Fragment key={row.key}>
              <SplitLineCells
                line={side === "old" ? row.oldLine : row.newLine}
                peerLine={side === "old" ? row.newLine : row.oldLine}
                tokens={tokens}
                side={side}
                wrapLongLines={wrapLongLines}
              />
            </Fragment>
          );
        }
        if (row.kind === "expanded-gap-line") {
          return (
            <Fragment key={row.key}>
              <SplitLineCells
                line={side === "old" ? row.oldLine : row.newLine}
                peerLine={side === "old" ? row.newLine : row.oldLine}
                tokens={null}
                side={side}
                wrapLongLines={wrapLongLines}
              />
            </Fragment>
          );
        }
        if (row.kind === "gap") {
          return (
            <Fragment key={row.key}>
              <SplitGapCells
                gap={row.gap}
                onExpand={(direction) => onExpandGap(row.gapIndex, row.gap, direction)}
                canExpand={canExpandGaps}
              />
            </Fragment>
          );
        }
        return (
          <Fragment key={row.key}>
            <SplitCollapsedCells
              section={row.section}
              onExpand={() => onExpandCollapsed(row.key)}
            />
          </Fragment>
        );
      })}
    </code>
  );
}

export function SplitDiffViewer({
  parsed,
  tokens,
  className,
  viewportClassName,
  wrapLongLines,
  overscrollBehavior = "none",
  overscrollBehaviorX,
  overscrollBehaviorY,
  chainVerticalWheel = false,
  fileLines,
  onRequestFileLines,
}: {
  parsed: ParsedPatch;
  tokens: HighlightedToken[][] | null;
  className?: string;
  viewportClassName?: string;
  wrapLongLines: boolean;
  overscrollBehavior?: CSSProperties["overscrollBehavior"];
  overscrollBehaviorX?: CSSProperties["overscrollBehaviorX"];
  overscrollBehaviorY?: CSSProperties["overscrollBehaviorY"];
  chainVerticalWheel?: boolean;
  fileLines?: string[];
  onRequestFileLines?: () => void;
}) {
  const resolvedMode = useResolvedMode();
  const [expandedCollapsedKeys, setExpandedCollapsedKeys] = useState<Set<string>>(
    new Set(),
  );
  const { gapStates, expandGap } = useGapExpansion();
  const canExpandGaps = Boolean(fileLines || onRequestFileLines);
  const expandGapWithFetch = (
    gapIndex: number,
    gap: InterHunkGap,
    direction: ExpandDirection,
  ) => {
    onRequestFileLines?.();
    expandGap(gapIndex, gap, direction);
  };
  const baseRows = useMemo(
    () => getSplitDiffRows(parsed, expandedCollapsedKeys),
    [parsed, expandedCollapsedKeys],
  );
  const rows = useMemo(
    () => flattenSplitWithGapExpansion(baseRows, gapStates, fileLines),
    [baseRows, gapStates, fileLines],
  );
  const rowCount = Math.max(rows.length, 1);
  const oldLineNumberDigits = useMemo(() => {
    let max = 0;
    for (const row of rows) {
      if (row.kind === "line" || row.kind === "expanded-gap-line") {
        const line = row.oldLine;
        if (line) max = Math.max(max, line.oldLineNum ?? 0);
      }
    }
    return Math.max(String(max).length, 1);
  }, [rows]);
  const newLineNumberDigits = useMemo(() => {
    let max = 0;
    for (const row of rows) {
      if (row.kind === "line" || row.kind === "expanded-gap-line") {
        const line = row.newLine;
        if (line) max = Math.max(max, line.newLineNum ?? 0);
      }
    }
    return Math.max(String(max).length, 1);
  }, [rows]);
  const viewportStyle = useMemo(
    () => ({
      overscrollBehavior,
      ...(overscrollBehaviorX ? { overscrollBehaviorX } : {}),
      ...(overscrollBehaviorY ? { overscrollBehaviorY } : {}),
    }) as CSSProperties,
    [overscrollBehavior, overscrollBehaviorX, overscrollBehaviorY],
  );
  const preStyle = useMemo(
    () => ({
      ...SPLIT_DIFF_PRE_STYLE,
      gridTemplateRows: `repeat(${rowCount}, auto)`,
    }) as CSSProperties,
    [rowCount],
  );

  const expandCollapsedRow = (key: string) => {
    setExpandedCollapsedKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };
  const handleViewportWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!chainVerticalWheel) {
      return;
    }
    if (chainVerticalWheelScroll(event.currentTarget, event.deltaY)) {
      event.preventDefault();
    }
  };

  return (
    <div className={className ?? ""}>
      <div
        style={viewportStyle}
        onWheel={handleViewportWheel}
        className={`relative [contain:content] composer-diff-simple-line overflow-y-auto overflow-x-hidden ${
          viewportClassName ?? ""
        }`}
      >
        <pre
          data-diff=""
          data-theme-type={resolvedMode === "dark" ? "dark" : "light"}
          data-indicators="bars"
          data-background=""
          data-diff-type="split"
          data-overflow="scroll"
          data-interactive-lines=""
          data-interactive-line-numbers=""
          tabIndex={0}
          style={preStyle}
          className={`m-0 grid bg-[var(--codex-diffs-surface)] p-0 font-[family:var(--diffs-font-family)] text-[length:var(--diffs-font-size)] leading-[var(--diffs-line-height)] text-[color:var(--diffs-fg)] ${
            wrapLongLines
              ? "w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
              : "w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          }`}
        >
          <SplitCodeColumn
            side="old"
            rows={rows}
            rowCount={rowCount}
            tokens={tokens}
            wrapLongLines={wrapLongLines}
            lineNumberDigits={oldLineNumberDigits}
            onExpandCollapsed={expandCollapsedRow}
            onExpandGap={expandGapWithFetch}
            canExpandGaps={canExpandGaps}
          />
          <SplitCodeColumn
            side="new"
            rows={rows}
            rowCount={rowCount}
            tokens={tokens}
            wrapLongLines={wrapLongLines}
            lineNumberDigits={newLineNumberDigits}
            onExpandCollapsed={expandCollapsedRow}
            onExpandGap={expandGapWithFetch}
            canExpandGaps={canExpandGaps}
          />
        </pre>
      </div>
    </div>
  );
}
