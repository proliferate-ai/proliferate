import {
  forwardRef,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useHighlightedLines } from "@/hooks/ui/use-highlighted-lines";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";

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
  const lineNumberGutterWidth = `calc(${lineNumberDigitWidth} + 1rem)`;
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
    : `calc(var(--file-source-line-number-gutter-width) + var(--file-source-content-gap) + ${maxLineCharacterWidth}ch + (var(--file-source-content-padding-inline) * 2))`;

  return (
    <div
      className="file-source-view relative h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
      data-file-source-view
      data-word-wrap={wordWrap ? "true" : "false"}
      style={{
        "--file-source-line-number-gutter-width": lineNumberGutterWidth,
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
  style: CSSProperties;
}

const SourceLine = forwardRef<HTMLSpanElement, SourceLineProps>(function SourceLine({
  lineNumber,
  virtualIndex,
  tokens,
  wordWrap,
  style,
}, ref) {
  return (
    <span
      ref={ref}
      className={`file-source-line grid min-h-[var(--diffs-line-height)] ${
        wordWrap
          ? "grid-cols-[var(--file-source-line-number-gutter-width)_minmax(0,1fr)]"
          : "grid-cols-[var(--file-source-line-number-gutter-width)_max-content]"
      }`}
      data-index={virtualIndex}
      data-source-line
      style={style}
    >
      <span className="file-source-line-number sticky left-0 z-10 select-none px-2 text-right tabular-nums">
        {lineNumber}
      </span>
      <span
        className={`file-source-line-content min-w-0 ${
          wordWrap
            ? "whitespace-pre-wrap break-words"
            : "whitespace-pre"
        }`}
      >
        {tokens.length > 0
          ? tokens.map((token, index) => (
              <span
                key={index}
                style={token.color ? { color: token.color } : undefined}
              >
                {token.content}
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
