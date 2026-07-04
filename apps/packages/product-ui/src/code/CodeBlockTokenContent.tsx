import type { HighlightedToken, RenderTokenFn } from "./types";
import { CodeTokenLine } from "./CodeTokenLine";

interface CodeBlockTokenContentProps {
  lines: HighlightedToken[][];
  renderToken?: RenderTokenFn;
  showLineNumbers?: boolean;
  lineNumberStart?: number;
  className?: string;
}

/**
 * Non-virtualized renderer for an array of token lines. Suitable for
 * chat code blocks and other bounded-size content.
 */
export function CodeBlockTokenContent({
  lines,
  renderToken,
  showLineNumbers = false,
  lineNumberStart = 1,
  className = "",
}: CodeBlockTokenContentProps) {
  if (showLineNumbers) {
    return (
      <div className={`min-w-full w-max ${className}`}>
        <table className="border-collapse">
          <tbody>
            {lines.map((tokens, index) => (
              <tr key={index}>
                <td className="select-none px-3 align-top text-right text-[11px] tabular-nums text-faint">
                  {lineNumberStart + index}
                </td>
                <td className="py-px pr-3 align-top">
                  <CodeTokenLine
                    tokens={tokens}
                    lineIndex={index}
                    renderToken={renderToken}
                    className="whitespace-pre font-mono"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <code className={`block whitespace-pre font-mono ${className}`}>
      {lines.map((tokens, index) => (
        <CodeTokenLine
          key={index}
          tokens={tokens}
          lineIndex={index}
          renderToken={renderToken}
        />
      ))}
    </code>
  );
}
