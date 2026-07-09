import { useEffect, useState } from "react";
import { useResolvedMode } from "@/hooks/theme/derived/use-resolved-mode";
import {
  highlightLines,
  resolveHighlightTheme,
  type HighlightedToken,
} from "@/lib/infra/editor/highlighting";

export function useHighlightedLines(
  code: string,
  languageOrFilename: string,
): HighlightedToken[][] | null {
  const resolvedMode = useResolvedMode();
  const theme = resolveHighlightTheme(resolvedMode);
  const [lines, setLines] = useState<HighlightedToken[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLines(null);
    void highlightLines(code.split("\n"), languageOrFilename, theme).then((result) => {
      if (!cancelled) {
        setLines(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, languageOrFilename, theme]);

  return lines;
}
