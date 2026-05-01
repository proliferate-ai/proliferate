import { useEffect, useState } from "react";
import { useResolvedMode } from "@/hooks/theme/use-theme";
import { highlightCode, type HighlightTheme } from "@/lib/infra/highlighting";

export function resolveHighlightTheme(resolvedMode: string): HighlightTheme {
  return resolvedMode === "light" ? "light" : "dark";
}

export function useHighlightedCode(
  code: string,
  languageOrFilename: string,
): string | null {
  const resolvedMode = useResolvedMode();
  const theme = resolveHighlightTheme(resolvedMode);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    void highlightCode(code, languageOrFilename, theme).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, languageOrFilename, theme]);

  return html;
}
