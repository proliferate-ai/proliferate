import { useEffect, type RefObject } from "react";

const BLANK_VIEWPORT_MIN_SCROLLABLE_PX = 32;

export function useTranscriptVirtualizerBlankFallback({
  activeSessionId,
  firstVirtualItem,
  lastVirtualItem,
  lastBlankReportSignatureRef,
  onFallback,
  rowCount,
  scrollRef,
}: {
  activeSessionId: string;
  firstVirtualItem: { index: number } | null;
  lastVirtualItem: { index: number } | null;
  lastBlankReportSignatureRef: RefObject<string | null>;
  onFallback: (reason: string) => void;
  rowCount: number;
  scrollRef: RefObject<HTMLDivElement | null>;
}): void {
  useEffect(() => {
    if (rowCount === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const viewport = scrollRef.current;
      if (!viewport) {
        return;
      }

      const scrollableDistance = viewport.scrollHeight - viewport.clientHeight;
      if (scrollableDistance < BLANK_VIEWPORT_MIN_SCROLLABLE_PX) {
        return;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const rowElements = Array.from(
        viewport.querySelectorAll<HTMLElement>("[data-transcript-virtual-row='true']"),
      );
      const visibleRowCount = rowElements.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > viewportRect.top + 1 && rect.top < viewportRect.bottom - 1;
      }).length;

      if (visibleRowCount > 0) {
        return;
      }

      const signature = [
        activeSessionId,
        rowCount,
        Math.round(viewport.scrollTop),
        firstVirtualItem?.index ?? null,
        lastVirtualItem?.index ?? null,
      ].join(":");
      if (lastBlankReportSignatureRef.current === signature) {
        return;
      }
      lastBlankReportSignatureRef.current = signature;
      onFallback("blank_viewport");
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    activeSessionId,
    firstVirtualItem,
    lastBlankReportSignatureRef,
    lastVirtualItem,
    onFallback,
    rowCount,
    scrollRef,
  ]);
}
