import {
  forwardRef,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { HighlightedToken, RenderTokenFn } from "./types";
import { CodeTokenLine } from "./CodeTokenLine";

const ESTIMATED_LINE_HEIGHT = 20;
const VERTICAL_PADDING_PX = 8;
const VIRTUAL_OVERSCAN = 24;
const INITIAL_VIEWPORT_HEIGHT = 600;
const INITIAL_ROW_COUNT =
  Math.ceil(INITIAL_VIEWPORT_HEIGHT / ESTIMATED_LINE_HEIGHT) + VIRTUAL_OVERSCAN;

interface VirtualizedCodeContentProps {
  lines: HighlightedToken[][];
  wordWrap?: boolean;
  renderToken?: RenderTokenFn;
  /** CSS var for line number gutter width (e.g. "calc(3ch + 16px)") */
  lineNumberGutterWidth?: string;
  /** Show line numbers (default true) */
  showLineNumbers?: boolean;
  /** Additional className on the scroll container */
  className?: string;
  /** Additional className on the <pre> wrapper */
  preClassName?: string;
  /** Render slot for custom line content (bypasses default CodeTokenLine) */
  renderLine?: (
    tokens: HighlightedToken[],
    lineIndex: number,
    renderToken: RenderTokenFn | undefined,
  ) => ReactNode;
}

interface InitialVirtualRow {
  key: number;
  index: number;
  start: number;
}

/**
 * Windowed code content renderer using @tanstack/react-virtual.
 * Suitable for large files where rendering all lines would be expensive.
 */
export function VirtualizedCodeContent({
  lines,
  wordWrap = false,
  renderToken,
  lineNumberGutterWidth,
  showLineNumbers = true,
  className = "",
  preClassName = "",
  renderLine,
}: VirtualizedCodeContentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gutterWidth =
    lineNumberGutterWidth ??
    `calc(max(2ch, ${Math.max(2, String(lines.length).length)}ch) + 16px)`;

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => index,
    estimateSize: () => ESTIMATED_LINE_HEIGHT,
    overscan: VIRTUAL_OVERSCAN,
    paddingStart: VERTICAL_PADDING_PX,
    paddingEnd: VERTICAL_PADDING_PX,
    initialRect: { width: 0, height: INITIAL_VIEWPORT_HEIGHT },
    measureElement: (element) =>
      element.getBoundingClientRect().height || ESTIMATED_LINE_HEIGHT,
    useAnimationFrameWithResizeObserver: true,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const initialVirtualRows = useMemo(
    () => buildInitialVirtualRows(lines.length),
    [lines.length],
  );
  const renderedRows = virtualRows.length > 0 ? virtualRows : initialVirtualRows;

  return (
    <div
      ref={scrollRef}
      className={`h-full min-h-0 min-w-0 overflow-auto ${className}`}
    >
      <pre
        tabIndex={0}
        className={`m-0 min-h-full min-w-full p-0 font-[family:var(--diffs-font-family)] text-[length:var(--diffs-font-size)] leading-[var(--diffs-line-height)] outline-none ${preClassName}`}
      >
        <code
          className={`relative block min-h-full ${
            wordWrap ? "w-full min-w-0" : "w-max min-w-full"
          }`}
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {renderedRows.map((virtualRow) => (
            <VirtualizedLine
              ref={virtualizer.measureElement}
              key={virtualRow.key}
              virtualIndex={virtualRow.index}
              lineNumber={virtualRow.index + 1}
              tokens={lines[virtualRow.index] ?? []}
              wordWrap={wordWrap}
              renderToken={renderToken}
              renderLine={renderLine}
              showLineNumbers={showLineNumbers}
              gutterWidth={gutterWidth}
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
  );
}

/** Expose scrollToIndex for external use (e.g. search navigation). */
export function useVirtualizedCodeScroller(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  lineCount: number,
) {
  const virtualizer = useVirtualizer({
    count: lineCount,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => index,
    estimateSize: () => ESTIMATED_LINE_HEIGHT,
    overscan: VIRTUAL_OVERSCAN,
    paddingStart: VERTICAL_PADDING_PX,
    paddingEnd: VERTICAL_PADDING_PX,
    initialRect: { width: 0, height: INITIAL_VIEWPORT_HEIGHT },
    measureElement: (element) =>
      element.getBoundingClientRect().height || ESTIMATED_LINE_HEIGHT,
    useAnimationFrameWithResizeObserver: true,
  });
  return virtualizer;
}

interface VirtualizedLineProps {
  lineNumber: number;
  virtualIndex: number;
  tokens: HighlightedToken[];
  wordWrap: boolean;
  renderToken?: RenderTokenFn;
  renderLine?: (
    tokens: HighlightedToken[],
    lineIndex: number,
    renderToken: RenderTokenFn | undefined,
  ) => ReactNode;
  showLineNumbers: boolean;
  gutterWidth: string;
  style: CSSProperties;
}

const VirtualizedLine = forwardRef<HTMLSpanElement, VirtualizedLineProps>(
  function VirtualizedLine(
    {
      lineNumber,
      virtualIndex,
      tokens,
      wordWrap,
      renderToken,
      renderLine,
      showLineNumbers,
      gutterWidth,
      style,
    },
    ref,
  ) {
    const gridCols = showLineNumbers
      ? wordWrap
        ? `grid-cols-[${gutterWidth}_minmax(0,1fr)]`
        : `grid-cols-[${gutterWidth}_max-content]`
      : wordWrap
        ? "grid-cols-[minmax(0,1fr)]"
        : "grid-cols-[max-content]";

    return (
      <span
        ref={ref}
        className={`grid min-h-[var(--diffs-line-height)] ${gridCols}`}
        data-index={virtualIndex}
        data-line={lineNumber}
        style={style}
      >
        {showLineNumbers && (
          <span className="sticky left-0 z-10 select-none px-2 text-right tabular-nums">
            <span>{lineNumber}</span>
          </span>
        )}
        <span
          className={`min-w-0 ${
            wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
          }`}
        >
          {renderLine
            ? renderLine(tokens, virtualIndex, renderToken)
            : (
              <CodeTokenLine
                tokens={tokens}
                lineIndex={virtualIndex}
                renderToken={renderToken}
              />
            )}
        </span>
      </span>
    );
  },
);

function buildInitialVirtualRows(lineCount: number): InitialVirtualRow[] {
  const count = Math.min(lineCount, INITIAL_ROW_COUNT);
  return Array.from({ length: count }, (_, index) => ({
    key: index,
    index,
    start: VERTICAL_PADDING_PX + index * ESTIMATED_LINE_HEIGHT,
  }));
}
