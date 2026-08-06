import { useLayoutEffect, useRef, type RefObject } from "react";
import type {
  ContentHeightScrollAnchor,
  TranscriptRenderableRow,
} from "#product/hooks/chat/ui/transcript-row-list-model";

interface TranscriptVirtualItemSnapshot {
  index: number;
  start: number;
  end: number;
}

export interface TranscriptVirtualScrollAnchor extends ContentHeightScrollAnchor {
  key: TranscriptRenderableRow["key"];
  offsetWithinRowPx: number;
  rowIndex: number;
  rowCount: number;
}

export function useTranscriptVirtualAnchorCapture({
  getVirtualItems,
  pinnedRef,
  renderableRows,
  rowCompositionKey,
  scrollRef,
}: {
  getVirtualItems: () => readonly TranscriptVirtualItemSnapshot[];
  pinnedRef: RefObject<boolean>;
  renderableRows: readonly TranscriptRenderableRow[];
  rowCompositionKey: string;
  scrollRef: RefObject<HTMLDivElement | null>;
}): RefObject<TranscriptVirtualScrollAnchor | null> {
  const captureAnchorRef = useRef<() => void>(() => {});
  const pendingAnchorRef = useRef<TranscriptVirtualScrollAnchor | null>(null);

  // Keep the capture closure current without reading layout. The keyed cleanup
  // below invokes the last committed closure only when row composition changes.
  useLayoutEffect(() => {
    captureAnchorRef.current = () => {
      const viewport = scrollRef.current;
      if (!viewport || pinnedRef.current) {
        pendingAnchorRef.current = null;
        return;
      }

      const firstVisibleVirtualRow = getVirtualItems()
        .find((item) => item.end >= viewport.scrollTop);
      if (!firstVisibleVirtualRow) {
        pendingAnchorRef.current = null;
        return;
      }

      const row = renderableRows[firstVisibleVirtualRow.index];
      if (!row) {
        pendingAnchorRef.current = null;
        return;
      }

      pendingAnchorRef.current = {
        key: row.key,
        offsetWithinRowPx: Math.max(viewport.scrollTop - firstVisibleVirtualRow.start, 0),
        rowIndex: firstVisibleVirtualRow.index,
        rowCount: renderableRows.length,
        // Preserve real DOM metrics for a completing turn that splits one row
        // above the visible anchor before the new row has been measured.
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      };
    };
  });

  // The cleanup runs before the ordered row-key composition changes. Native
  // scroll range commits leave it untouched and therefore perform no layout
  // reads on the scroll hot path.
  useLayoutEffect(
    () => () => captureAnchorRef.current(),
    [rowCompositionKey],
  );

  return pendingAnchorRef;
}
