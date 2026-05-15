import { useMemo, type CSSProperties } from "react";
import { useHighlightedLines } from "@/hooks/ui/use-highlighted-lines";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";

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
  const lineNumberDigitWidth = `${Math.max(2, String(lines.length).length)}ch`;
  const lineNumberGutterWidth = `calc(${lineNumberDigitWidth} + 1rem)`;

  return (
    <div
      className="file-source-view relative h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
      data-file-source-view
      data-word-wrap={wordWrap ? "true" : "false"}
      style={{
        "--file-source-line-number-gutter-width": lineNumberGutterWidth,
      } as CSSProperties}
    >
      <div className="file-source-gutter-rail" aria-hidden="true" />
      <div className="file-source-scroll h-full min-h-0 min-w-0 overflow-auto">
        <pre
          data-file
          data-overflow="scroll"
          tabIndex={0}
          className="m-0 min-h-full min-w-full p-0 font-[family:var(--diffs-font-family)] text-[length:var(--diffs-font-size)] leading-[var(--diffs-line-height)] outline-none"
        >
          <code
            data-code
            className={`block min-h-full py-2 ${
              wordWrap ? "w-full min-w-0" : "w-max min-w-full"
            }`}
          >
            {lines.map((line, index) => (
              <SourceLine
                key={index}
                lineNumber={index + 1}
                tokens={line}
                wordWrap={wordWrap}
              />
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

function SourceLine({
  lineNumber,
  tokens,
  wordWrap,
}: {
  lineNumber: number;
  tokens: HighlightedToken[];
  wordWrap: boolean;
}) {
  return (
    <span
      className={`file-source-line grid min-h-[var(--diffs-line-height)] ${
        wordWrap
          ? "grid-cols-[var(--file-source-line-number-gutter-width)_minmax(0,1fr)]"
          : "grid-cols-[var(--file-source-line-number-gutter-width)_max-content]"
      }`}
      data-source-line
    >
      <span className="file-source-line-number sticky left-0 z-10 select-none px-2 text-right tabular-nums">
        {lineNumber}
      </span>
      <span
        className={`file-source-line-content min-w-0 px-3 ${
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
}
