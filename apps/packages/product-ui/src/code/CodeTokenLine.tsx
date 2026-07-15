import type { ReactNode } from "react";
import type { HighlightedToken, RenderTokenFn } from "./types";

interface CodeTokenLineProps {
  tokens: HighlightedToken[];
  lineIndex: number;
  /** Optional override for rendering individual token text (e.g. search marks). */
  renderToken?: RenderTokenFn;
  className?: string;
}

/**
 * Renders a single line of highlighted tokens as styled `<span>` elements.
 * When `renderToken` is provided, each token's text is passed through it
 * (enabling search-highlight overlays without changing the token array).
 */
export function CodeTokenLine({
  tokens,
  lineIndex,
  renderToken,
  className,
}: CodeTokenLineProps): ReactNode {
  if (tokens.length === 0) {
    return <span className={className}>{"\n"}</span>;
  }

  return (
    <span className={className}>
      {tokens.map((token, tokenIndex) => (
        <span
          key={tokenIndex}
          style={token.color ? { color: token.color } : undefined}
        >
          {renderToken
            ? renderToken(token.content, tokenIndex, lineIndex)
            : token.content}
        </span>
      ))}
    </span>
  );
}
