import { useEffect, useRef, type RefObject } from "react";
import {
  hashMeasurementScope,
  isMainThreadMeasurementEnabled,
} from "#product/lib/infra/measurement/measurement-port";
import { recordTranscriptVirtualizerBlank } from "#product/lib/infra/diagnostics/renderer-diagnostic-migrations";

// Bounded window (ms) after an older-history prepend during which the
// blank-viewport fallback is suppressed while the freshly mounted rows correct
// estimate -> measured height. A generous upper bound on that reconciliation
// even on a slow/loaded runner; the anchored scrollTop legitimately sits ahead
// of the still estimate-coordinate mounted range for that span and must not be
// misread as a broken virtualizer (a remount resets scrollTop to 0).
export const PREPEND_BLANK_FALLBACK_GRACE_MS = 3_000;
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
  prependSettleUntilRef,
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
  /**
   * Interaction-clock (performance.now) deadline until which a just-applied
   * older-history prepend is still reconciling its freshly-mounted rows from
   * estimate to measured height. Blank detection is suppressed until it lapses
   * (see inspect). 0 (or absent) means no prepend is settling.
   */
  prependSettleUntilRef?: RefObject<number>;
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

      // While a just-applied older-history prepend is still reconciling its
      // freshly-mounted rows from estimate to measured height, the engine
      // deliberately holds scrollTop at an anchored position that can briefly
      // sit ahead of the mounted virtual range (the range is in estimate
      // coordinates until the taller real heights measure in — more pronounced
      // on a slow/loaded runner and on WebKit, whose measurement delivery lags
      // the anchor write further). That transient non-overlap is normal prepend
      // settling, not a broken virtualizer, so it must never trip the blank
      // remount: the remount unmounts the virtualized list and mounts a fresh
      // full-DOM list whose new scroll container starts at scrollTop 0, with no
      // pending anchor to restore — a full loss of the reading position (the CI
      // webkit prepend "scrollTop 0"). Suppress detection until the bounded
      // settle window lapses; genuine blankness re-arms the instant it does.
      // (The reserved-slot / transient-block invariant that would make this a
      // structural guarantee is rung 10; this is the minimal correct guard for
      // the prepend anchor path.)
      const nowMs = typeof performance === "undefined" ? Date.now() : performance.now();
      if (nowMs < (prependSettleUntilRef?.current ?? 0)) {
        suspicionRef.current = null;
        frame = window.requestAnimationFrame(inspect);
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
        recordTranscriptVirtualizerBlank({
          sessionId: activeSessionId,
          workspaceId: selectedWorkspaceId,
          rowCount,
          renderableRowCount,
          virtualItemCount,
          firstVirtualItemIndex,
          lastVirtualItemIndex,
        });
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
    prependSettleUntilRef,
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
