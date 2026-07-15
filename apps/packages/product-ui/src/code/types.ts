import type { ReactNode } from "react";

/**
 * A single highlighted token — the atomic unit of syntax-colored text.
 * Mirrors the output of shiki's `codeToTokens`.
 */
export interface HighlightedToken {
  content: string;
  color?: string;
}

/**
 * Render callback for individual tokens. Used to inject overlays like
 * search-highlight marks on top of the base token text.
 */
export type RenderTokenFn = (
  text: string,
  tokenIndex: number,
  lineIndex: number,
) => ReactNode;
