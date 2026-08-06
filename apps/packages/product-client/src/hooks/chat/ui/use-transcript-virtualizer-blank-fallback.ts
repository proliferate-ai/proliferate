import { useEffect, useRef, type RefObject } from "react";
import {
  hashMeasurementScope,
  isMainThreadMeasurementEnabled,
} from "#product/lib/infra/measurement/measurement-port";

const BLANK_VIEWPORT_MIN_SCROLLABLE_PX = 32;
const BLANK_VIEWPORT_LOGICAL_CONFIRMATION_FRAMES = 2;
const BLANK_VIEWPORT_DOM_CONFIRMATION_FRAMES = 2;
const VIRTUAL_RANGE_OVERLAP_EPSILON_PX = 1;

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
  const suspicionRef = useRef<{
    signature: string;
    logicalFrames: number;
    domBlankFrames: number;
  } | null>(null);

  useEffect(() => {
    if (rowCount === 0) {
      suspicionRef.current = null;
      return;
    }

    let frame: number | null = null;
    const inspect = () => {
      const viewport = scrollRef.current;
      if (!viewport) {
        suspicionRef.current = null;
        return;
      }

      // Hidden/suspended tabs can retain a scrollHeight while exposing a zero
      // viewport. That is not a virtualizer failure and must never permanently
      // swap a long transcript back to the full-DOM renderer.
      if (viewport.clientHeight <= VIRTUAL_RANGE_OVERLAP_EPSILON_PX
        || document.visibilityState === "hidden") {
        suspicionRef.current = null;
        return;
      }
      const scrollableDistance = viewport.scrollHeight - viewport.clientHeight;
      if (scrollableDistance < BLANK_VIEWPORT_MIN_SCROLLABLE_PX) {
        suspicionRef.current = null;
        return;
      }

      // TanStack already gives us the mounted range in scroll coordinates.
      // Use that cheap logical overlap check on the normal scroll path; DOM
      // rectangles are only read after a stable suspicious range survives two
      // animation frames.
      if (virtualRangeOverlapsViewport({
        firstVirtualItem,
        lastVirtualItem,
        scrollTop: viewport.scrollTop,
        clientHeight: viewport.clientHeight,
      })) {
        suspicionRef.current = null;
        return;
      }

      const suspectSignature = [
        activeSessionId,
        Math.round(viewport.scrollTop),
        Math.round(viewport.clientHeight),
        firstVirtualItem?.index ?? "none",
        lastVirtualItem?.index ?? "none",
      ].join(":");
      const previousSuspicion = suspicionRef.current;
      const logicalFrames = previousSuspicion?.signature === suspectSignature
        ? previousSuspicion.logicalFrames + 1
        : 1;
      const domBlankFrames = previousSuspicion?.signature === suspectSignature
        ? previousSuspicion.domBlankFrames
        : 0;
      suspicionRef.current = { signature: suspectSignature, logicalFrames, domBlankFrames };
      if (logicalFrames < BLANK_VIEWPORT_LOGICAL_CONFIRMATION_FRAMES) {
        frame = window.requestAnimationFrame(inspect);
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
        suspicionRef.current = null;
        return;
      }

      const confirmedDomBlankFrames = domBlankFrames + 1;
      suspicionRef.current = {
        signature: suspectSignature,
        logicalFrames,
        domBlankFrames: confirmedDomBlankFrames,
      };
      if (confirmedDomBlankFrames < BLANK_VIEWPORT_DOM_CONFIRMATION_FRAMES) {
        frame = window.requestAnimationFrame(inspect);
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

      suspicionRef.current = null;
      onFallback("blank_viewport");
    };

    frame = window.requestAnimationFrame(inspect);

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
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

export function virtualRangeOverlapsViewport({
  firstVirtualItem,
  lastVirtualItem,
  scrollTop,
  clientHeight,
}: {
  firstVirtualItem: TranscriptVirtualItemSnapshot | null;
  lastVirtualItem: TranscriptVirtualItemSnapshot | null;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  if (!firstVirtualItem || !lastVirtualItem || clientHeight <= 0) {
    return false;
  }
  const viewportEnd = scrollTop + clientHeight;
  return lastVirtualItem.end > scrollTop + VIRTUAL_RANGE_OVERLAP_EPSILON_PX
    && firstVirtualItem.start < viewportEnd - VIRTUAL_RANGE_OVERLAP_EPSILON_PX;
}
