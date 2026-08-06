import type { HighlightedToken } from "#product/lib/infra/editor/highlighting";
import { CodeTokenLine, type RenderTokenFn } from "./CodeTokenLine";

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
                <td className="select-none px-3 align-top text-right text-readable-code tabular-nums text-faint">
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
        // `block` is load-bearing: shiki's tokens carry no trailing newline and
        // `CodeTokenLine` emits a bare inline <span>, so without it every line
        // of a highlighted block runs onto one line. The gutter branch above
        // gets its line breaks from the table rows instead.
        <CodeTokenLine
          key={index}
          tokens={tokens}
          lineIndex={index}
          renderToken={renderToken}
          className="block"
        />
      ))}
    </code>
  );
}
