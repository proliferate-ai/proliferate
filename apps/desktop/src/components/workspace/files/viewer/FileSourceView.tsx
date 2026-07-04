import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CodeTokenLine } from "@proliferate/product-ui/code/CodeTokenLine";
import type { RenderTokenFn } from "@proliferate/product-ui/code/types";
import { renderContentSearchMarkedToken } from "@/components/content/ui/search/ContentSearchMarks";
import { useHighlightedLines } from "@/hooks/ui/highlighting/use-highlighted-lines";
import {
  buildContentSearchLineMatchIds,
  findContentSearchTokenMatchSegments,
  normalizeContentSearchQuery,
} from "@/lib/domain/content-search/content-search";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";
import { useContentSearchStore } from "@/stores/search/content-search-store";

const FILE_SOURCE_ESTIMATED_LINE_HEIGHT = 20;
const FILE_SOURCE_VERTICAL_PADDING_PX = 8;
// Overscan is the buffer of off-screen rows kept mounted above/below the
// viewport. A fast fling can jump well past a small buffer in a single frame,
// briefly exposing the (dark) code element background as "blank rows" until
// the next render catches up. A larger buffer absorbs typical fling deltas.
const FILE_SOURCE_VIRTUAL_OVERSCAN = 60;
// Below this line count we render every row in normal document flow (no
// windowing). Virtualization's absolute-positioned rows get repositioned via
// transform on scroll, and a fast fling can outrun that reposition for a frame
// — showing the dark background as "blank blocks". Small files don't need
// windowing at all, so rendering them statically removes that failure mode
// entirely and native scroll of static content can never blank.
const FILE_SOURCE_VIRTUALIZE_THRESHOLD = 2000;
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
  const contentSearchSurface = useContentSearchStore((state) => state.surface);
  const contentSearchOpen = useContentSearchStore((state) => state.open);
  const rawContentSearchQuery = useContentSearchStore((state) => state.query);
  const rawActiveMatchId = useContentSearchStore((state) => state.activeMatchId);
  const registerContentSearchUnit = useContentSearchStore((state) => state.registerUnit);
  const unregisterContentSearchUnit = useContentSearchStore((state) => state.unregisterUnit);
  const fileContentSearchActive = contentSearchOpen && contentSearchSurface === "file";
  const contentSearchQuery = fileContentSearchActive ? rawContentSearchQuery : "";
  const activeMatchId = fileContentSearchActive ? rawActiveMatchId : null;
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
  // Track the max visual line width lazily: instead of scanning every line
  // (O(n) main-thread cost on large files), measure scrollWidth on the
  // painted <code> element after layout. The running max is updated each time
  // the virtualizer paints new rows.
  const maxContentWidthRef = useRef(0);
  const codeElementRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = codeElementRef.current;
    if (!el) return;
    const sw = el.scrollWidth;
    if (sw > maxContentWidthRef.current) {
      maxContentWidthRef.current = sw;
    }
  });
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
  });
  const shouldVirtualize = lines.length > FILE_SOURCE_VIRTUALIZE_THRESHOLD;
  const virtualRows = virtualizer.getVirtualItems();
  const initialVirtualRows = useMemo(
    () => buildInitialVirtualRows(lines.length),
    [lines.length],
  );
  const renderedRows = virtualRows.length > 0 ? virtualRows : initialVirtualRows;
  // When word-wrap is off, the code element is w-max (intrinsic width from
  // content) so no explicit minWidth is needed — scrollWidth handles it.

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
      surface: "file",
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
            ref={codeElementRef}
            data-code
            className={`relative block min-h-full bg-background ${
              wordWrap ? "w-full min-w-0" : "w-max min-w-full"
            }`}
            style={
              shouldVirtualize
                ? { height: `${virtualizer.getTotalSize()}px` }
                : undefined
            }
          >
            {shouldVirtualize
              ? renderedRows.map((virtualRow) => (
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
                ))
              : lines.map((tokens, index) => (
                  <SourceLine
                    key={index}
                    virtualIndex={index}
                    lineNumber={index + 1}
                    tokens={tokens}
                    wordWrap={wordWrap}
                    contentSearchQuery={contentSearchQuery}
                    activeMatchId={activeMatchId}
                    contentSearchUnitId={contentSearchUnitId}
                    style={{
                      width: wordWrap ? "100%" : "max-content",
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
  const matchSegmentsByToken = findContentSearchTokenMatchSegments(
    tokens,
    contentSearchQuery,
  );

  const renderToken: RenderTokenFn = useCallback(
    (text: string, tokenIndex: number) => {
      return renderContentSearchMarkedToken({
        text,
        matchSegments: matchSegmentsByToken[tokenIndex] ?? [],
        activeMatchId,
        matchIdPrefix: `${contentSearchUnitId}:${lineNumber}`,
      });
    },
    [matchSegmentsByToken, activeMatchId, contentSearchUnitId, lineNumber],
  );

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
        className="file-source-line-number select-none bg-background px-2 text-right tabular-nums"
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
        <CodeTokenLine
          tokens={tokens}
          lineIndex={virtualIndex}
          renderToken={contentSearchQuery ? renderToken : undefined}
        />
      </span>
    </span>
  );
});


function buildInitialVirtualRows(lineCount: number): SourceVirtualRow[] {
  const count = Math.min(lineCount, FILE_SOURCE_INITIAL_ROW_COUNT);
  return Array.from({ length: count }, (_, index) => ({
    key: index,
    index,
    start: FILE_SOURCE_VERTICAL_PADDING_PX + index * FILE_SOURCE_ESTIMATED_LINE_HEIGHT,
  }));
}
