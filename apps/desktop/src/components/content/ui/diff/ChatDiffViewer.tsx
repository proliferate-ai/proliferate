import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  DiffGapInfoRow,
  type ExpandDirection,
} from "@/components/content/ui/diff/DiffContextExpander";
import { ChatDiffLineWrapContextMenu } from "@/components/content/ui/diff/ChatDiffLineWrapContextMenu";
import { HunkActionPill } from "@/components/content/ui/diff/HunkActionPill";
import type { UnifiedDiffHunkActions } from "@/components/content/ui/diff/UnifiedDiffViewer";
import {
  ChatCollapsedRow,
  ChatContentLine,
  ChatGutterColumn,
} from "@/components/content/ui/diff/ChatDiffCells";
import {
  flattenWithGapExpansion,
  type ChatRenderRow,
} from "@/lib/domain/files/chat-diff-rows";
import { useResolvedMode } from "@/hooks/theme/derived/use-resolved-mode";
import {
  buildContentSearchLineMatchIds,
  normalizeContentSearchQuery,
} from "@/lib/domain/content-search/content-search";
import { chainVerticalWheelScroll } from "@proliferate/ui/utils/scroll-chain";
import type { InterHunkGap, ParsedPatch } from "@/lib/domain/files/diff-parser";
import {
  getChatDiffRows,
  getDiffLineNumberColumnWidth,
} from "@/lib/domain/files/diff-view-rows";
import {
  useGapExpansion,
} from "@/hooks/ui/diff/use-gap-expansion";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";
import { useContentSearchStore } from "@/stores/search/content-search-store";

const CHAT_DIFF_PRE_STYLE = {
  color: "var(--diffs-fg)",
  backgroundColor: "var(--diffs-bg)",
  "--diffs-bg": "var(--codex-diffs-surface)",
  "--diffs-addition-color": "var(--diffs-addition-color-override)",
  "--diffs-deletion-color": "var(--diffs-deletion-color-override)",
  "--diffs-min-number-column-width": "4ch",
  "--diffs-min-number-column-width-default": "3ch",
} as CSSProperties;

const CHAT_DIFF_CODE_BASE_STYLE = {
  "--diffs-column-content-width": "700px",
  "--diffs-column-width": "736px",
} as CSSProperties;

function ChatContentColumn({
  rows,
  rowCount,
  tokens,
  wrapLongLines,
  contentSearchQuery,
  activeMatchId,
  contentSearchUnitId,
  onExpandCollapsedRow,
  onExpandGap,
  canExpandGaps,
  hunkActions,
  hoveredHunkIndex,
  onHunkHover,
}: {
  rows: ChatRenderRow[];
  rowCount: number;
  tokens: HighlightedToken[][] | null;
  wrapLongLines: boolean;
  contentSearchQuery: string;
  activeMatchId: string | null;
  contentSearchUnitId: string;
  onExpandCollapsedRow: (key: string) => void;
  onExpandGap: (gapIndex: number, gap: InterHunkGap, direction: ExpandDirection) => void;
  canExpandGaps: boolean;
  hunkActions?: UnifiedDiffHunkActions | null;
  hoveredHunkIndex?: number | null;
  onHunkHover?: (hunkIndex: number) => void;
}) {
  return (
    <div
      data-content=""
      style={{ gridColumn: "2", gridRow: `1 / span ${rowCount}` }}
      className="grid [grid-template-rows:subgrid]"
    >
      {rows.map((row) => {
        if (row.kind === "line") {
          const showPill = Boolean(
            hunkActions
            && row.isHunkFirstRow
            && hoveredHunkIndex === row.hunkIndex,
          );
          return (
            <ChatContentLine
              key={row.key}
              line={row.line}
              tokens={tokens}
              wrapLongLines={wrapLongLines}
              contentSearchQuery={contentSearchQuery}
              activeMatchId={activeMatchId}
              contentSearchUnitId={contentSearchUnitId}
              hunkIndex={hunkActions ? row.hunkIndex : undefined}
              onHunkHover={hunkActions ? onHunkHover : undefined}
              pill={showPill && hunkActions ? (
                <HunkActionPill
                  mode={hunkActions.mode}
                  disabled={hunkActions.disabled}
                  onRevert={() => hunkActions.onRevert(row.hunkIndex)}
                  onStageOrUnstage={() => hunkActions.onStageOrUnstage(row.hunkIndex)}
                  reveal="visible"
                />
              ) : undefined}
            />
          );
        }
        if (row.kind === "expanded-gap-line") {
          return (
            <ChatContentLine
              key={row.key}
              line={row.line}
              tokens={null}
              wrapLongLines={wrapLongLines}
              contentSearchQuery={contentSearchQuery}
              activeMatchId={activeMatchId}
              contentSearchUnitId={contentSearchUnitId}
            />
          );
        }
        if (row.kind === "gap") {
          // Controls are in the gutter; content column shows just the label.
          if (!canExpandGaps) {
            return (
              <DiffGapInfoRow
                key={row.key}
                lineCount={row.gap.lineCount}
                stickyLeft="var(--diffs-column-number-width)"
              />
            );
          }
          return (
            <div
              key={row.key}
              data-separator="gap-expander"
              className="diff-content-cell flex min-h-[var(--diffs-line-height)] items-center bg-[var(--codex-diffs-separator-surface)]"
            >
              <DiffGapContentLabel
                gap={row.gap}
                onExpand={(direction) => onExpandGap(row.gapIndex, row.gap, direction)}
                stickyLeft="var(--diffs-column-number-width)"
              />
            </div>
          );
        }
        // collapsed
        return (
          <ChatCollapsedRow
            key={row.key}
            section={row.section}
            onExpand={() => onExpandCollapsedRow(row.key)}
          />
        );
      })}
    </div>
  );
}

export function ChatDiffViewer({
  parsed,
  tokens,
  className,
  viewportClassName,
  wrapLongLines,
  filePath,
  contentSearchUnitId: contentSearchUnitIdProp,
  overscrollBehavior = "none",
  overscrollBehaviorX,
  overscrollBehaviorY,
  chainVerticalWheel = false,
  fileLines,
  onRequestFileLines,
  hunkActions,
}: {
  parsed: ParsedPatch;
  tokens: HighlightedToken[][] | null;
  className?: string;
  viewportClassName?: string;
  wrapLongLines: boolean;
  filePath?: string;
  contentSearchUnitId?: string;
  overscrollBehavior?: CSSProperties["overscrollBehavior"];
  overscrollBehaviorX?: CSSProperties["overscrollBehaviorX"];
  overscrollBehaviorY?: CSSProperties["overscrollBehaviorY"];
  chainVerticalWheel?: boolean;
  fileLines?: string[];
  onRequestFileLines?: () => void;
  hunkActions?: UnifiedDiffHunkActions | null;
}) {
  const resolvedMode = useResolvedMode();
  const [expandedCollapsedKeys, setExpandedCollapsedKeys] = useState<Set<string>>(
    new Set(),
  );
  const [hoveredHunkIndex, setHoveredHunkIndex] = useState<number | null>(null);
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
    () => getChatDiffRows(parsed, expandedCollapsedKeys),
    [parsed, expandedCollapsedKeys],
  );
  const rows = useMemo(
    () => flattenWithGapExpansion(baseRows, gapStates, fileLines),
    [baseRows, gapStates, fileLines],
  );
  const contentSearchSurface = useContentSearchStore((state) => state.surface);
  const contentSearchOpen = useContentSearchStore((state) => state.open);
  const rawContentSearchQuery = useContentSearchStore((state) => state.query);
  const rawActiveMatchId = useContentSearchStore((state) => state.activeMatchId);
  const registerContentSearchUnit = useContentSearchStore((state) => state.registerUnit);
  const unregisterContentSearchUnit = useContentSearchStore((state) => state.unregisterUnit);
  const chatContentSearchActive = contentSearchOpen && contentSearchSurface === "chat";
  const contentSearchQuery = chatContentSearchActive ? rawContentSearchQuery : "";
  const activeMatchId = chatContentSearchActive ? rawActiveMatchId : null;
  const fallbackContentSearchUnitId = useId();
  const contentSearchUnitId = useMemo(
    () => contentSearchUnitIdProp ?? `diff:${fallbackContentSearchUnitId}:${filePath ?? "inline"}`,
    [contentSearchUnitIdProp, fallbackContentSearchUnitId, filePath],
  );
  const contentSearchMatchIds = useMemo(
    () => {
      const normalizedQuery = normalizeContentSearchQuery(contentSearchQuery);
      if (!normalizedQuery) {
        return [];
      }

      return parsed.allCodeLines.flatMap((line, lineIndex) =>
        buildContentSearchLineMatchIds({
          idPrefix: `${contentSearchUnitId}:line:${lineIndex}`,
          tokens: tokens?.[lineIndex] ?? [{ content: line }],
          query: normalizedQuery,
        })
      );
    },
    [contentSearchQuery, contentSearchUnitId, parsed.allCodeLines, tokens],
  );
  const rowCount = Math.max(rows.length, 1);
  const lineNumberDigits = useMemo(() => {
    let maxLineNumber = 0;
    for (const row of rows) {
      if (row.kind === "line" || row.kind === "expanded-gap-line") {
        const lineNum = row.line.newLineNum ?? row.line.oldLineNum ?? 0;
        maxLineNumber = Math.max(maxLineNumber, lineNum);
      }
    }
    return Math.max(String(maxLineNumber).length, 1);
  }, [rows]);
  const codeStyle = useMemo(
    () => ({
      ...CHAT_DIFF_CODE_BASE_STYLE,
      "--diffs-column-number-width": getDiffLineNumberColumnWidth(lineNumberDigits),
      gridTemplateRows: `repeat(${rowCount}, auto)`,
    }) as CSSProperties,
    [lineNumberDigits, rowCount],
  );
  const viewportStyle = useMemo(
    () => ({
      overscrollBehavior,
      ...(overscrollBehaviorX ? { overscrollBehaviorX } : {}),
      ...(overscrollBehaviorY ? { overscrollBehaviorY } : {}),
    }) as CSSProperties,
    [overscrollBehavior, overscrollBehaviorX, overscrollBehaviorY],
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

  useEffect(() => {
    registerContentSearchUnit({
      unitId: contentSearchUnitId,
      surface: "chat",
      scope: "diffs",
      query: contentSearchQuery,
      matchIds: contentSearchMatchIds,
    });

    return () => unregisterContentSearchUnit(contentSearchUnitId);
  }, [
    contentSearchMatchIds,
    contentSearchQuery,
    contentSearchUnitId,
    registerContentSearchUnit,
    unregisterContentSearchUnit,
  ]);

  const viewport = (
    <div
      data-chat-diff-wrap-context-trigger="body"
      style={viewportStyle}
      onWheel={handleViewportWheel}
      onMouseLeave={hunkActions ? () => setHoveredHunkIndex(null) : undefined}
      className={`relative [contain:content] composer-diff-simple-line ${
        wrapLongLines ? "overflow-x-hidden" : "overflow-x-auto"
      } overflow-y-auto ${
        viewportClassName ?? ""
      }`}
    >
      <pre
        data-diff=""
        data-theme-type={resolvedMode === "dark" ? "dark" : "light"}
        data-indicators="bars"
        data-background=""
        data-diff-type="single"
        data-overflow="scroll"
        data-interactive-lines=""
        data-interactive-line-numbers=""
        tabIndex={0}
        style={CHAT_DIFF_PRE_STYLE}
        className={`m-0 w-full bg-[var(--codex-diffs-surface)] p-0 font-[family:var(--diffs-font-family)] text-[length:var(--diffs-font-size)] leading-[var(--diffs-line-height)] text-[color:var(--diffs-fg)] ${
          wrapLongLines ? "min-w-0" : "min-w-max"
        }`}
      >
        <code
          data-code=""
          data-unified=""
          style={codeStyle}
          className={`grid ${
            wrapLongLines
              ? "grid-cols-[var(--diffs-column-number-width)_minmax(0,1fr)]"
              : "grid-cols-[var(--diffs-column-number-width)_minmax(max-content,1fr)]"
          }`}
        >
          <ChatGutterColumn rows={rows} rowCount={rowCount} onExpandGap={expandGapWithFetch} canExpandGaps={canExpandGaps} />
          <ChatContentColumn
            rows={rows}
            rowCount={rowCount}
            tokens={tokens}
            wrapLongLines={wrapLongLines}
            contentSearchQuery={contentSearchQuery}
            activeMatchId={activeMatchId}
            contentSearchUnitId={contentSearchUnitId}
            onExpandCollapsedRow={expandCollapsedRow}
            onExpandGap={expandGapWithFetch}
            canExpandGaps={canExpandGaps}
            hunkActions={hunkActions}
            hoveredHunkIndex={hoveredHunkIndex}
            onHunkHover={hunkActions ? setHoveredHunkIndex : undefined}
          />
        </code>
      </pre>
    </div>
  );

  return (
    <div className={className ?? ""}>
      <ChatDiffLineWrapContextMenu trigger={viewport} />
    </div>
  );
}
