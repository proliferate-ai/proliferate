import { useEffect, useId, useMemo } from "react";
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
 * registered in the content-search store for the viewer's lifetime. Ordering
 * against sibling units is the caller's concern: pass `orderKey` (e.g. a
 * transcript-row interleave key or a review-pane row index) or leave it
 * undefined to sort last.
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
  const { surface, unitId: unitIdProp, orderKey, filePath, allCodeLines, tokens } = input;
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
