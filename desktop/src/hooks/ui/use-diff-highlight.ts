import { useMemo, useState, useEffect } from "react";
import { parsePatch, type ParsedPatch } from "@/lib/domain/files/diff-parser";
import {
  highlightLines,
  type HighlightedToken,
  type HighlightTheme,
} from "@/lib/infra/highlighting";
import { useResolvedMode } from "@/hooks/theme/use-theme";

interface DiffHighlightResult {
  parsed: ParsedPatch;
  tokens: HighlightedToken[][] | null;
}

export function useDiffHighlight(
  patch: string,
  filePath?: string,
): DiffHighlightResult {
  const parsed = useMemo(() => parsePatch(patch), [patch]);
  const [tokens, setTokens] = useState<HighlightedToken[][] | null>(null);
  const resolvedMode = useResolvedMode();
  const theme: HighlightTheme = resolvedMode === "dark" ? "dark" : "light";

  useEffect(() => {
    if (parsed.allCodeLines.length === 0 || !filePath) {
      setTokens(null);
      return;
    }

    let cancelled = false;
    setTokens(null);

    void highlightLines(parsed.allCodeLines, filePath, theme).then((result) => {
      if (!cancelled) setTokens(result);
    });

    return () => {
      cancelled = true;
    };
  }, [parsed, filePath, theme]);

  return { parsed, tokens };
}
