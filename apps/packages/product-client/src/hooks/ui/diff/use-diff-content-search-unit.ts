import { useEffect, useId, useMemo } from "react";
import { useChatTranscriptRow } from "#product/components/workspace/chat/transcript/ChatContentSearchContext";
import {
  buildContentSearchLineMatchIds,
  normalizeContentSearchQuery,
} from "#product/lib/domain/content-search/content-search";
import type { HighlightedToken } from "#product/lib/infra/editor/highlighting";
import {
  useContentSearchStore,
  type ContentSearchSurface,
} from "#product/stores/search/content-search-store";

/**
 * Owns a diff viewer's participation in content search: derives the unit id,
 * indexes the diff's code lines against the active query, and keeps the unit
 * registered in the content-search store for the viewer's lifetime.
 *
 * Interleaves inline diff matches with the surrounding transcript-row prose
 * matches: a diff sits just after its row's prose (rowIndex * 2 + 1). Outside
 * a transcript row (no context) the unit stays unkeyed and sorts last, unless
 * the caller supplies its own order key (e.g. a review-pane row index).
 */
export function useDiffContentSearchUnit(input: {
  surface: ContentSearchSurface;
  unitId?: string;
  orderKey?: number;
  filePath?: string;
  allCodeLines: string[];
  tokens: HighlightedToken[][] | null;
}): {
  contentSearchUnitId: string;
  contentSearchQuery: string;
  activeMatchId: string | null;
} {
  const { surface, unitId: unitIdProp, orderKey: orderKeyProp, filePath, allCodeLines, tokens } = input;
  const activeSurface = useContentSearchStore((state) => state.surface);
  const open = useContentSearchStore((state) => state.open);
  const rawQuery = useContentSearchStore((state) => state.query);
  const rawActiveMatchId = useContentSearchStore((state) => state.activeMatchId);
  const registerUnit = useContentSearchStore((state) => state.registerUnit);
  const unregisterUnit = useContentSearchStore((state) => state.unregisterUnit);
  const active = open && activeSurface === surface;
  const contentSearchQuery = active ? rawQuery : "";
  const activeMatchId = active ? rawActiveMatchId : null;
  const fallbackUnitId = useId();
  const contentSearchUnitId = useMemo(
    () => unitIdProp ?? `diff:${fallbackUnitId}:${filePath ?? "inline"}`,
    [unitIdProp, fallbackUnitId, filePath],
  );
  const transcriptRow = useChatTranscriptRow();
  const orderKey = orderKeyProp ?? (transcriptRow ? transcriptRow.rowIndex * 2 + 1 : undefined);
  const matchIds = useMemo(
    () => {
      const normalizedQuery = normalizeContentSearchQuery(contentSearchQuery);
      if (!normalizedQuery) {
        return [];
      }

      return allCodeLines.flatMap((line, lineIndex) =>
        buildContentSearchLineMatchIds({
          idPrefix: `${contentSearchUnitId}:line:${lineIndex}`,
          tokens: tokens?.[lineIndex] ?? [{ content: line }],
          query: normalizedQuery,
        })
      );
    },
    [contentSearchQuery, contentSearchUnitId, allCodeLines, tokens],
  );

  useEffect(() => {
    registerUnit({
      unitId: contentSearchUnitId,
      surface,
      query: contentSearchQuery,
      matchIds,
      orderKey,
    });

    return () => unregisterUnit(contentSearchUnitId);
  }, [
    contentSearchQuery,
    contentSearchUnitId,
    matchIds,
    orderKey,
    registerUnit,
    surface,
    unregisterUnit,
  ]);

  return { contentSearchUnitId, contentSearchQuery, activeMatchId };
}
