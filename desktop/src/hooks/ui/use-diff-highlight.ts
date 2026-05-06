import { useMemo, useState, useEffect } from "react";
import { parsePatch, type ParsedPatch } from "@/lib/domain/files/diff-parser";
import {
  isDebugMeasurementEnabled,
  measureDebugComputation,
  recordMeasurementDiagnostic,
  type MeasurementOperationId,
} from "@/lib/infra/debug-measurement";
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
  operationId?: MeasurementOperationId | null,
): DiffHighlightResult {
  const parsed = useMemo(() => {
    if (isDebugMeasurementEnabled()) {
      recordMeasurementDiagnostic({
        category: "diff_viewer",
        label: "patch_bytes",
        operationId,
        durationMs: 0,
        count: new TextEncoder().encode(patch).byteLength,
      });
      const lineCount = patch.length === 0 ? 0 : patch.split("\n").length;
      recordMeasurementDiagnostic({
        category: "diff_viewer",
        label: "diff_lines",
        operationId,
        durationMs: 0,
        count: lineCount,
      });
    }
    return measureDebugComputation({
      category: "diff_viewer",
      label: "parse_patch",
      operationId,
      count: (value) => value.allCodeLines.length,
    }, () => parsePatch(patch));
  }, [operationId, patch]);
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
    const startedAt = typeof performance === "undefined" ? Date.now() : performance.now();

    void highlightLines(parsed.allCodeLines, filePath, theme).then((result) => {
      recordMeasurementDiagnostic({
        category: "diff_viewer",
        label: "highlight_lines",
        operationId,
        startedAt,
        count: result.length,
      });
      if (!cancelled) setTokens(result);
    });

    return () => {
      cancelled = true;
    };
  }, [operationId, parsed, filePath, theme]);

  return { parsed, tokens };
}
