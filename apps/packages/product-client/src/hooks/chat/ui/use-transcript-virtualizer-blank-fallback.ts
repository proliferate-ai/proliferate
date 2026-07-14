import { useEffect, type RefObject } from "react";
import {
  hashMeasurementScope,
  isMainThreadMeasurementEnabled,
} from "@/lib/infra/measurement/debug-measurement-env";

const BLANK_VIEWPORT_MIN_SCROLLABLE_PX = 32;

interface TranscriptVirtualItemSnapshot {
  index: number;
  start: number;
  end: number;
}

export function useTranscriptVirtualizerBlankFallback({
  activeSessionId,
  bottomSpacerHeight,
  firstVirtualItem,
  lastVirtualItem,
  lastBlankReportSignatureRef,
  onFallback,
  renderableRowCount,
  rowCount,
  scrollRef,
  selectedWorkspaceId,
  topSpacerHeight,
  totalContentHeight,
  virtualItemCount,
}: {
  activeSessionId: string;
  bottomSpacerHeight: number;
  firstVirtualItem: TranscriptVirtualItemSnapshot | null;
  lastVirtualItem: TranscriptVirtualItemSnapshot | null;
  lastBlankReportSignatureRef: RefObject<string | null>;
  onFallback: (reason: string) => void;
  renderableRowCount: number;
  rowCount: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  selectedWorkspaceId: string | null;
  topSpacerHeight: number;
  totalContentHeight: number;
  virtualItemCount: number;
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

      const firstVirtualItemIndex = firstVirtualItem?.index ?? null;
      const lastVirtualItemIndex = lastVirtualItem?.index ?? null;
      const signature = [
        activeSessionId,
        rowCount,
        Math.round(viewport.scrollTop),
        firstVirtualItemIndex,
        lastVirtualItemIndex,
      ].join(":");
      if (lastBlankReportSignatureRef.current === signature) {
        return;
      }
      lastBlankReportSignatureRef.current = signature;

      if (import.meta.env.DEV && isMainThreadMeasurementEnabled()) {
        console.error("[transcript-virtualizer] blank viewport detected; falling back to full render", {
          activeSessionHash: hashMeasurementScope(activeSessionId),
          selectedWorkspaceHash: selectedWorkspaceId ? hashMeasurementScope(selectedWorkspaceId) : null,
          rowCount,
          renderableRowCount,
          virtualItemCount,
          firstVirtualItemIndex,
          lastVirtualItemIndex,
          firstVirtualStart: firstVirtualItem?.start ?? null,
          lastVirtualEnd: lastVirtualItem?.end ?? null,
          scrollTop: Math.round(viewport.scrollTop),
          clientHeight: viewport.clientHeight,
          scrollHeight: viewport.scrollHeight,
          totalContentHeight,
          topSpacerHeight,
          bottomSpacerHeight,
        });
      }

      onFallback("blank_viewport");
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    activeSessionId,
    bottomSpacerHeight,
    firstVirtualItem,
    lastVirtualItem,
    lastBlankReportSignatureRef,
    onFallback,
    renderableRowCount,
    rowCount,
    scrollRef,
    selectedWorkspaceId,
    topSpacerHeight,
    totalContentHeight,
    virtualItemCount,
  ]);
}
