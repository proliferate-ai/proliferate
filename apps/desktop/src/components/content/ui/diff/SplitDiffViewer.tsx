import {
  Fragment,
  useMemo,
  useState,
  type CSSProperties,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  type ExpandDirection,
} from "@/components/content/ui/diff/DiffContextExpander";
import {
  SplitCollapsedCells,
  SplitGapCells,
  SplitLineCells,
} from "@/components/content/ui/diff/SplitDiffCells";
import {
  flattenSplitWithGapExpansion,
  type SplitRenderRow,
} from "@/lib/domain/files/split-diff-rows";
import { useResolvedMode } from "@/hooks/theme/derived/use-resolved-mode";
import { chainVerticalWheelScroll } from "@proliferate/ui/utils/scroll-chain";
import type { InterHunkGap, ParsedPatch } from "@/lib/domain/files/diff-parser";
import {
  getDiffLineNumberColumnWidth,
  getSplitDiffRows,
  type SplitSide,
} from "@/lib/domain/files/diff-view-rows";
import {
  useGapExpansion,
} from "@/hooks/ui/diff/use-gap-expansion";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";

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
