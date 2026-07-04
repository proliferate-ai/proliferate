import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { DiffLineContent } from "@/components/content/ui/diff/DiffLineContent";
import { DiffContextExpander, type ExpandDirection } from "@/components/content/ui/diff/DiffContextExpander";
import { ChatDiffLineWrapContextMenu } from "@/components/content/ui/diff/ChatDiffLineWrapContextMenu";
import { useResolvedMode } from "@/hooks/theme/derived/use-resolved-mode";
import {
  buildContentSearchLineMatchIds,
  normalizeContentSearchQuery,
} from "@/lib/domain/content-search/content-search";
import { Button } from "@proliferate/ui/primitives/Button";
import { chainVerticalWheelScroll } from "@proliferate/ui/utils/scroll-chain";
import type { CollapsedContext, DiffLine, InterHunkGap, ParsedPatch } from "@/lib/domain/files/diff-parser";
import {
  getChatDiffRows,
  getChatLineNumber,
  getChatLineType,
  getDiffLineIndex,
  getDiffLineNumberColumnWidth,
  type ChatDiffRow,
} from "@/lib/domain/files/diff-view-rows";
import {
  clampGapReveal,
  resolveGapLineCount,
  useGapExpansion,
  type GapExpansionState,
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

function ChatGutterLine({ line }: { line: DiffLine }) {
  const lineType = getChatLineType(line);
  const lineNumber = getChatLineNumber(line);

  return (
    <div
      data-line-type={lineType}
      data-column-number={lineNumber ?? undefined}
      data-line-index={getDiffLineIndex(line)}
      className="diff-gutter-cell box-border flex min-h-[var(--diffs-line-height)] w-[var(--diffs-column-number-width)] min-w-[var(--diffs-column-number-width)] items-start justify-end bg-[var(--diffs-bg)] pr-2 pl-3 pt-[calc((var(--diffs-line-height)-1em)/2)] text-right tabular-nums"
    >
      <span data-line-number-content="">{lineNumber ?? ""}</span>
    </div>
  );
}

function ChatGutterSeparatorLine() {
  return (
    <div
      data-separator="simple"
      className="diff-gutter-cell min-h-[var(--diffs-line-height)] bg-[var(--diffs-bg)]"
    />
  );
}

function ChatContentLine({
  line,
  tokens,
  wrapLongLines,
  contentSearchQuery,
  activeMatchId,
  contentSearchUnitId,
}: {
  line: DiffLine;
  tokens: HighlightedToken[][] | null;
  wrapLongLines: boolean;
  contentSearchQuery: string;
  activeMatchId: string | null;
  contentSearchUnitId: string;
}) {
  const lineType = getChatLineType(line);
  const lineNumber = getChatLineNumber(line);
  const altLineNumber = line.type === "context" ? line.oldLineNum : undefined;

  return (
    <div
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
      <DiffLineContent
        line={line}
        tokens={tokens}
        contentSearchQuery={contentSearchQuery}
        activeMatchId={activeMatchId}
        contentSearchLineId={`${contentSearchUnitId}:line:${line.tokenIndex}`}
      />
    </div>
  );
}

function ChatCollapsedRow({
  section,
  onExpand,
}: {
  section: CollapsedContext;
  onExpand: () => void;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      data-separator="simple"
      onClick={onExpand}
      aria-label={`Show ${section.lineCount} unmodified lines`}
      title={`${section.lineCount} unmodified lines`}
      className="diff-content-cell flex min-h-[var(--diffs-line-height)] cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-0 text-left font-[inherit] text-[inherit] leading-[inherit] text-muted-foreground/70 hover:text-muted-foreground"
    >
      <span className="h-px min-w-4 flex-1 bg-border/60" />
      <span className="shrink-0 text-[10px] leading-none">
        Show {section.lineCount} unchanged line{section.lineCount === 1 ? "" : "s"}
      </span>
      <span className="h-px min-w-4 flex-1 bg-border/60" />
    </Button>
  );
}

function ChatGutterColumn({
  rows,
  rowCount,
}: {
  rows: ChatRenderRow[];
  rowCount: number;
}) {
  return (
    <div
      data-gutter=""
      style={{ gridColumn: "1", gridRow: `1 / span ${rowCount}` }}
      className="sticky left-0 z-10 grid bg-[var(--diffs-bg)] [grid-template-rows:subgrid]"
    >
      {rows.map((row) =>
        row.kind === "line" || row.kind === "expanded-gap-line" ? (
          <ChatGutterLine key={row.key} line={row.line} />
        ) : (
          <ChatGutterSeparatorLine key={row.key} />
        )
      )}
    </div>
  );
}

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
}) {
  return (
    <div
      data-content=""
      style={{ gridColumn: "2", gridRow: `1 / span ${rowCount}` }}
      className="grid [grid-template-rows:subgrid]"
    >
      {rows.map((row) => {
        if (row.kind === "line") {
          return (
            <ChatContentLine
              key={row.key}
              line={row.line}
              tokens={tokens}
              wrapLongLines={wrapLongLines}
              contentSearchQuery={contentSearchQuery}
              activeMatchId={activeMatchId}
              contentSearchUnitId={contentSearchUnitId}
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
          if (!canExpandGaps) {
            // Informational-only separator when expansion is unavailable
            return (
              <div
                key={row.key}
                data-separator="gap-info"
                className="diff-content-cell flex min-h-[var(--diffs-line-height)] items-center gap-2 bg-[var(--codex-diffs-separator-surface)] px-2 text-muted-foreground/60"
              >
                <span className="h-px min-w-4 flex-1 bg-border/40" />
                <span className="shrink-0 text-[10px] leading-none">
                  {row.gap.lineCount > 0
                    ? `${row.gap.lineCount} unmodified line${row.gap.lineCount === 1 ? "" : "s"}`
                    : "unmodified lines"}
                </span>
                <span className="h-px min-w-4 flex-1 bg-border/40" />
              </div>
            );
          }
          return (
            <DiffContextExpander
              key={row.key}
              gap={row.gap}
              onExpand={(direction) => onExpandGap(row.gapIndex, row.gap, direction)}
            />
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

/** Flattened render row: either a data row from the diff or an expanded gap line */
type ChatRenderRow =
  | ChatDiffRow
  | { kind: "expanded-gap-line"; key: string; line: DiffLine };

function makeGapContextLine(
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

function flattenWithGapExpansion(
  rows: ChatDiffRow[],
  gapStates: Map<number, GapExpansionState>,
  fileLines: string[] | undefined,
): ChatRenderRow[] {
  const result: ChatRenderRow[] = [];
  for (const row of rows) {
    if (row.kind !== "gap") {
      result.push(row);
      continue;
    }

    // Resolve unknown trailing gap count against fetched file length
    const gap = resolveGapLineCount(row.gap, fileLines);
    if (!gap) continue;
    const resolvedRow: ChatDiffRow = gap === row.gap ? row : { ...row, gap };

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
      result.push({
        kind: "expanded-gap-line",
        key: `${row.key}-top-${i}`,
        line: makeGapContextLine(fileLines, gap, i),
      });
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
      result.push({
        kind: "expanded-gap-line",
        key: `${row.key}-bottom-${i}`,
        line: makeGapContextLine(fileLines, gap, i),
      });
    }
  }
  return result;
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
      if (row.kind === "line") {
        maxLineNumber = Math.max(maxLineNumber, getChatLineNumber(row.line) ?? 0);
      } else if (row.kind === "expanded-gap-line") {
        maxLineNumber = Math.max(maxLineNumber, getChatLineNumber(row.line) ?? 0);
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
          <ChatGutterColumn rows={rows} rowCount={rowCount} />
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
