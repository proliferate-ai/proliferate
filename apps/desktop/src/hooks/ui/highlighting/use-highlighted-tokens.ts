import { useEffect, useState } from "react";
import { useResolvedMode } from "@/hooks/theme/derived/use-resolved-mode";
import { resolveHighlightTheme } from "@/hooks/ui/highlighting/use-highlighted-code";
import {
  highlightLines,
  type HighlightedToken,
} from "@/lib/infra/editor/highlighting";

/**
 * React hook that tokenizes a code string into HighlightedToken[][] (one
 * array per line). This is the token-based replacement for useHighlightedCode
 * which returned an HTML string.
 *
 * Whitespace handling: the code is split on "\n" before tokenizing. Shiki's
 * codeToTokens output preserves empty lines as arrays with a single empty-
 * content token, matching the split input 1:1. A trailing newline produces
 * an extra empty line — we strip it to match the visual behavior of the
 * prior HTML path (codeToHtml trims the trailing newline internally).
 */
export function useHighlightedTokens(
  code: string,
  languageOrFilename: string,
): HighlightedToken[][] | null {
  const resolvedMode = useResolvedMode();
  const theme = resolveHighlightTheme(resolvedMode);
  const [tokens, setTokens] = useState<HighlightedToken[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTokens(null);

    // Split into lines — same approach as highlightLines expects.
    const lines = code.split("\n");
    // Strip trailing empty line that results from a trailing newline in the
    // source. The HTML path (codeToHtml) does this internally; we match that
    // behavior here to avoid an extra blank line at the bottom of code blocks.
    if (lines.length > 1 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    void highlightLines(lines, languageOrFilename, theme).then((result) => {
      if (!cancelled) setTokens(result);
    });

    return () => {
      cancelled = true;
    };
  }, [code, languageOrFilename, theme]);

  return tokens;
}
