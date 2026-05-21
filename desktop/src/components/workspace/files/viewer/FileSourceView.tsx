import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { renderContentSearchMarkedText } from "@/components/ui/content/search/ContentSearchMarks";
import { useHighlightedLines } from "@/hooks/ui/use-highlighted-lines";
import {
  buildContentSearchLineMatchIds,
  normalizeContentSearchQuery,
} from "@/lib/domain/content-search/content-search";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";
import { useContentSearchStore } from "@/stores/search/content-search-store";

const FILE_SOURCE_ESTIMATED_LINE_HEIGHT = 20;
const FILE_SOURCE_VERTICAL_PADDING_PX = 8;
const FILE_SOURCE_VIRTUAL_OVERSCAN = 24;
const FILE_SOURCE_INITIAL_VIEWPORT_HEIGHT = 600;
const FILE_SOURCE_INITIAL_ROW_COUNT =
  Math.ceil(FILE_SOURCE_INITIAL_VIEWPORT_HEIGHT / FILE_SOURCE_ESTIMATED_LINE_HEIGHT)
  + FILE_SOURCE_VIRTUAL_OVERSCAN;

interface SourceVirtualRow {
  key: string | number;
  index: number;
  start: number;
}

interface FileSourceViewProps {
  code: string;
  filePath: string;
  wordWrap: boolean;
}

export function FileSourceView({
  code,
  filePath,
  wordWrap,
}: FileSourceViewProps) {
  const highlightedLines = useHighlightedLines(code, filePath);
  const fallbackLines = useMemo(
    () => code.split("\n").map((line) => [{ content: line }] satisfies HighlightedToken[]),
    [code],
  );
  const lines = highlightedLines ?? fallbackLines;
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineNumberDigitWidth = `${Math.max(2, String(lines.length).length)}ch`;
  const lineNumberGutterWidth = `calc(max(2ch, ${lineNumberDigitWidth}) + 16px)`;
  const contentSearchQuery = useContentSearchStore((state) => state.query);
  const activeMatchId = useContentSearchStore((state) => state.activeMatchId);
  const registerContentSearchUnit = useContentSearchStore((state) => state.registerUnit);
  const unregisterContentSearchUnit = useContentSearchStore((state) => state.unregisterUnit);
  const contentSearchUnitId = useMemo(
    () => `diff:${filePath}:source`,
    [filePath],
  );
  const contentSearchMatchIds = useMemo(
    () => {
      const normalizedQuery = normalizeContentSearchQuery(contentSearchQuery);
      if (!normalizedQuery) {
        return [];
      }

      return lines.flatMap((tokens, lineIndex) =>
        buildContentSearchLineMatchIds({
          idPrefix: `${contentSearchUnitId}:${lineIndex + 1}`,
          tokens,
          query: normalizedQuery,
        })
      );
    },
    [contentSearchQuery, contentSearchUnitId, lines],
  );
  const maxLineCharacterWidth = useMemo(
    () => maxVisualLineLength(lines),
    [lines],
  );
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => index,
    estimateSize: () => FILE_SOURCE_ESTIMATED_LINE_HEIGHT,
    overscan: FILE_SOURCE_VIRTUAL_OVERSCAN,
    paddingStart: FILE_SOURCE_VERTICAL_PADDING_PX,
    paddingEnd: FILE_SOURCE_VERTICAL_PADDING_PX,
    initialRect: {
      width: 0,
      height: FILE_SOURCE_INITIAL_VIEWPORT_HEIGHT,
    },
    measureElement: (element) =>
      element.getBoundingClientRect().height || FILE_SOURCE_ESTIMATED_LINE_HEIGHT,
    useAnimationFrameWithResizeObserver: true,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const initialVirtualRows = useMemo(
    () => buildInitialVirtualRows(lines.length),
    [lines.length],
  );
  const renderedRows = virtualRows.length > 0 ? virtualRows : initialVirtualRows;
  const codeMinWidth = wordWrap
    ? undefined
    : `calc(var(--diffs-column-number-width) + var(--file-source-content-gap) + ${maxLineCharacterWidth}ch + (var(--file-source-content-padding-inline) * 2))`;

  useEffect(() => {
    if (!activeMatchId?.startsWith(`${contentSearchUnitId}:`)) {
      return;
    }

    const matchSuffix = activeMatchId.slice(contentSearchUnitId.length + 1);
    const lineNumber = Number(matchSuffix.split(":")[0]);
    if (!Number.isFinite(lineNumber) || lineNumber <= 0) {
      return;
    }

    virtualizer.scrollToIndex(lineNumber - 1, { align: "center" });
  }, [activeMatchId, contentSearchUnitId, virtualizer]);

  useEffect(() => {
    registerContentSearchUnit({
      unitId: contentSearchUnitId,
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

  return (
    <div
      className="file-source-view relative h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
      data-file-source-view
      data-word-wrap={wordWrap ? "true" : "false"}
      style={{
        "--diffs-column-number-width": lineNumberGutterWidth,
      } as CSSProperties}
    >
      <div
        ref={scrollRef}
        className="file-source-scroll h-full min-h-0 min-w-0 overflow-auto"
      >
        <pre
          data-file
          data-file-source-virtualized
          data-overflow="scroll"
          tabIndex={0}
          className="m-0 min-h-full min-w-full p-0 font-[family:var(--diffs-font-family)] text-[length:var(--diffs-font-size)] leading-[var(--diffs-line-height)] outline-none"
        >
          <code
            data-code
            className={`relative block min-h-full ${
              wordWrap ? "w-full min-w-0" : "w-max min-w-full"
            }`}
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              minWidth: codeMinWidth,
            }}
          >
            {renderedRows.map((virtualRow) => (
              <SourceLine
                ref={virtualizer.measureElement}
                key={virtualRow.key}
                virtualIndex={virtualRow.index}
                lineNumber={virtualRow.index + 1}
                tokens={lines[virtualRow.index] ?? []}
                wordWrap={wordWrap}
                contentSearchQuery={contentSearchQuery}
                activeMatchId={activeMatchId}
                contentSearchUnitId={contentSearchUnitId}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: wordWrap ? "100%" : "max-content",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              />
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

interface SourceLineProps {
  lineNumber: number;
  virtualIndex: number;
  tokens: HighlightedToken[];
  wordWrap: boolean;
  contentSearchQuery: string;
  activeMatchId: string | null;
  contentSearchUnitId: string;
  style: CSSProperties;
}

const SourceLine = forwardRef<HTMLSpanElement, SourceLineProps>(function SourceLine({
  lineNumber,
  virtualIndex,
  tokens,
  wordWrap,
  contentSearchQuery,
  activeMatchId,
  contentSearchUnitId,
  style,
}, ref) {
  let contentSearchMatchIndex = 0;

  return (
    <span
      ref={ref}
      className={`file-source-line grid min-h-[var(--diffs-line-height)] ${
        wordWrap
          ? "grid-cols-[var(--diffs-column-number-width)_minmax(0,1fr)]"
          : "grid-cols-[var(--diffs-column-number-width)_max-content]"
      }`}
      data-index={virtualIndex}
      data-line={lineNumber}
      data-line-index={virtualIndex}
      data-line-type="context"
      data-source-line
      style={style}
    >
      <span
        className="file-source-line-number sticky left-0 z-10 select-none px-2 text-right tabular-nums"
        data-column-number={lineNumber}
        data-gutter=""
        data-line-index={virtualIndex}
        data-line-type="context"
      >
        <span data-line-number-content="">{lineNumber}</span>
      </span>
      <span
        className={`file-source-line-content min-w-0 ${
          wordWrap
            ? "whitespace-pre-wrap break-words"
            : "whitespace-pre"
        }`}
        data-content=""
        data-line={lineNumber}
        data-line-index={virtualIndex}
        data-line-type="context"
      >
        {tokens.length > 0
          ? tokens.map((token, index) => (
              <span
                key={index}
                style={token.color ? { color: token.color } : undefined}
              >
                {renderContentSearchMarkedText({
                  text: token.content,
                  query: contentSearchQuery,
                  activeMatchId,
                  nextMatchId: () => {
                    const matchId = `${contentSearchUnitId}:${lineNumber}:${contentSearchMatchIndex}`;
                    contentSearchMatchIndex += 1;
                    return matchId;
                  },
                })}
              </span>
            ))
          : "\n"}
      </span>
    </span>
  );
});

function visualLineLength(tokens: HighlightedToken[]): number {
  return tokens.reduce(
    (length, token) => length + token.content.replaceAll("\t", "  ").length,
    0,
  );
}

function maxVisualLineLength(lines: readonly HighlightedToken[][]): number {
  let maxLength = 1;
  for (const line of lines) {
    maxLength = Math.max(maxLength, visualLineLength(line));
  }
  return maxLength;
}

function buildInitialVirtualRows(lineCount: number): SourceVirtualRow[] {
  const count = Math.min(lineCount, FILE_SOURCE_INITIAL_ROW_COUNT);
  return Array.from({ length: count }, (_, index) => ({
    key: index,
    index,
    start: FILE_SOURCE_VERTICAL_PADDING_PX + index * FILE_SOURCE_ESTIMATED_LINE_HEIGHT,
  }));
}
