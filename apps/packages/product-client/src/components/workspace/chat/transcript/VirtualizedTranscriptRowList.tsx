import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TranscriptVirtualizationMode } from "#product/domain/chats/transcript/transcript-virtualization-config";
import {
  buildRenderableRows,
  HISTORY_PREFETCH_TOP_THRESHOLD_PX,
  logHistoryPrefetchDecisionOnce,
  TRANSCRIPT_TOP_PADDING_PX,
  resolveTranscriptBottomInsets,
  type HistoryPrefetchDecisionReason,
  type HistoryPrefetchTrigger,
  type HistoryPrependScrollAnchor,
  type TranscriptRowListBaseProps,
} from "#product/hooks/chat/ui/transcript-row-list-model";
import { TranscriptFloatingControls } from "./TranscriptRowListShared";
import { useTranscriptStickToBottom } from "#product/hooks/chat/ui/use-transcript-stick-to-bottom";
import { useTranscriptCompletedTurnAnchor } from "#product/hooks/chat/ui/use-transcript-completed-turn-anchor";
import { useTranscriptScrollPauseRegistration } from "./TranscriptScrollPriorityContext";
import { VirtualTranscriptViewport } from "./VirtualTranscriptViewport";
import { PREPEND_BLANK_FALLBACK_GRACE_MS, useTranscriptVirtualizerBlankFallback } from "#product/hooks/chat/ui/use-transcript-virtualizer-blank-fallback";
import { useTranscriptVirtualAnchorCapture } from "#product/hooks/chat/ui/use-transcript-virtual-anchor-capture";
import { useTranscriptVirtualMeasurementModel } from "#product/hooks/chat/ui/use-transcript-virtual-measurement-model";
import { useTranscriptReadingPosition } from "#product/hooks/chat/ui/use-transcript-reading-position";

const VIRTUALIZER_OVERSCAN = 8;

// Absolute ceiling on how long a pending prepend anchor may stay armed while
// its request is merely believed to be in flight. The loading-window proof
// below can never arrive when the request resolves without ever raising
// isLoadingOlderHistory in an observable commit (the hydration path has
// pre-await synchronous returns, so a true->false pair can coalesce into one
// React commit), and rows/cursor then stay put. Without this bound the anchor
// leaks for the rest of the mount and wedges older-history loading entirely,
// since maybeLoadOlderHistory only requests while the anchor is null. Same
// bounded-ceiling shape as PREPEND_BLANK_FALLBACK_GRACE_MS.
const PREPEND_ANCHOR_IN_FLIGHT_MAX_MS = 3000;

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

interface VirtualizedTranscriptRowListProps extends TranscriptRowListBaseProps {
  onFallback: (reason: string) => void;
  virtualizationMode: TranscriptVirtualizationMode;
}

export function VirtualizedTranscriptRowList({
  rows,
  selectionRootRef,
  hasOlderHistory,
  isLoadingOlderHistory,
  olderHistoryCursor,
  bottomInsetPx,
  nonDisplacingBottomInsetPx = 0,
  selectedWorkspaceId,
  activeSessionId,
  isSessionBusy,
  lastPromptSubmittedAtMs,
  onLoadOlderHistory,
  onScrollSample,
  onIsPinnedToBottomChange,
  renderRow,
  getRowRenderRevision,
  columnClassName,
  gutterClassName,
  onFallback,
  virtualizationMode,
  scrollHandleRef,
}: VirtualizedTranscriptRowListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingPrependAnchorRef = useRef<HistoryPrependScrollAnchor | null>(null);
  // Whether the CURRENT pending anchor's request has been observed loading;
  // "not loading, rows unchanged" only proves "resolved with no rows" after that.
  const pendingPrependLoadingSeenRef = useRef(false);
  // When the CURRENT pending anchor was armed, for the absolute release ceiling.
  const pendingPrependArmedAtRef = useRef(0);
  const lastOlderHistoryCursorRequestRef = useRef<number | null>(null);
  const lastPrefetchDecisionLogRef = useRef<string | null>(null);
  const lastBlankReportSignatureRef = useRef<string | null>(null);
  const prependSettleUntilRef = useRef(0);
  const {
    structural: structuralBottomInsetPx,
    nonDisplacing: effectiveNonDisplacingBottomInsetPx,
  } = resolveTranscriptBottomInsets(bottomInsetPx, nonDisplacingBottomInsetPx);
  const {
    isPinnedToBottom,
    hasNewContentWhileUnpinned,
    pinnedRef,
    onViewportScroll,
    notifyUserScrollIntent,
    scrollToBottom,
    handleScrollToBottomClick,
    notifyProgrammaticScroll,
    setPinned,
    resetForSession,
    notifyContentResize,
    startAboveChangeCompensation,
    cancelFramePipeline,
    compensationDeadlineRef,
  } = useTranscriptStickToBottom({
    scrollRef,
    onScrollSample,
    structuralBottomInsetPx,
    nonDisplacingBottomInsetPx: effectiveNonDisplacingBottomInsetPx,
    lastPromptSubmittedAtMs,
    sessionKey: `${selectedWorkspaceId ?? ""}:${activeSessionId}`,
  });
  // A user scroll inside the input event's call stack pre-empts any queued
  // programmatic snap (render-freeze gate parity): cancel the frame pipeline.
  useTranscriptScrollPauseRegistration(cancelFramePipeline);
  // Reports the engine's OWN pin state upward — no parallel scroll listener,
  // just surfacing state this hook already computes for the in-list
  // scroll-to-bottom button.
  useEffect(() => {
    onIsPinnedToBottomChange?.(isPinnedToBottom);
  }, [isPinnedToBottom, onIsPinnedToBottomChange]);
  const renderableRows = useMemo(
    () => buildRenderableRows(rows, isLoadingOlderHistory),
    [isLoadingOlderHistory, rows],
  );
  const {
    estimateSize,
    estimatedRowsHeight,
    getItemKey,
    measureElement: recordingMeasureElement,
    rowCompositionKey,
  } = useTranscriptVirtualMeasurementModel({
    activeSessionId,
    renderableRows,
    selectedWorkspaceId,
  });
  // initialOffset is consumed only when the virtualizer mounts. Avoid reducing
  // the entire transcript again on every scroll-driven virtualizer render.
  const estimatedInitialBottomOffset = useMemo(
    () => TRANSCRIPT_TOP_PADDING_PX
      + estimatedRowsHeight
      + structuralBottomInsetPx,
    [estimatedRowsHeight, structuralBottomInsetPx],
  );
  const virtualizer = useVirtualizer({
    count: renderableRows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize,
    measureElement: recordingMeasureElement,
    overscan: VIRTUALIZER_OVERSCAN,
    paddingStart: TRANSCRIPT_TOP_PADDING_PX,
    paddingEnd: structuralBottomInsetPx,
    initialOffset: () => estimatedInitialBottomOffset,
    // Q12 (rung 4): kept true. EVALUATED false vs true; false desynchronizes
    // TanStack's re-measure from our snap and destabilized the pinned-follow /
    // repin / prepend physics scenarios. True keeps the proven cadence; the owned
    // content ResizeObserver still routes every growth at zero RO-loop cost.
    useAnimationFrameWithResizeObserver: true,
  });
  const { captureReadingPosition, buildSessionRestorePlan } = useTranscriptReadingPosition({
    sessionKey: `${selectedWorkspaceId ?? ""}:${activeSessionId}`,
    isSessionBusy,
    virtualizer,
    renderableRows,
  });
  const pendingAnchorRef = useTranscriptVirtualAnchorCapture({
    getVirtualItems: () => virtualizer.getVirtualItems(),
    pinnedRef,
    renderableRows,
    rowCompositionKey,
    scrollRef,
  });
  // Content-search jump-to-match: bring an off-screen row into view so its
  // painted marks mount before the overlay queries the DOM for the active one.
  useImperativeHandle(scrollHandleRef, () => ({
    scrollToRowKey: (rowKey: string) => {
      const index = renderableRows.findIndex(
        (row) => row.kind === "transcript" && row.key === rowKey,
      );
      if (index < 0) {
        return;
      }
      setPinned(false);
      notifyProgrammaticScroll(() => {
        virtualizer.scrollToIndex(index, { align: "center" });
      });
    },
  }), [notifyProgrammaticScroll, renderableRows, setPinned, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalContentHeight = virtualizer.getTotalSize();
  const firstVirtualItem = virtualItems[0] ?? null;
  const lastVirtualItem = virtualItems[virtualItems.length - 1] ?? null;
  const topSpacerHeight = firstVirtualItem?.start ?? totalContentHeight;
  const bottomSpacerHeight = lastVirtualItem
    ? Math.max(totalContentHeight - lastVirtualItem.end, 0)
    : 0;

  const logPrefetchDecision = useCallback((
    trigger: HistoryPrefetchTrigger,
    reason: HistoryPrefetchDecisionReason,
    viewport: HTMLDivElement,
  ) => {
    logHistoryPrefetchDecisionOnce({
      component: "virtual",
      trigger,
      reason,
      sessionId: activeSessionId,
      workspaceId: selectedWorkspaceId,
      cursor: olderHistoryCursor,
      lastRequestedCursor: lastOlderHistoryCursorRequestRef.current,
      hasOlderHistory,
      isLoadingOlderHistory,
      pendingAnchor: pendingPrependAnchorRef.current,
      rowCount: rows.length,
      renderableRowCount: renderableRows.length,
      virtualItemCount: virtualItems.length,
      totalContentHeight,
      viewport,
    }, lastPrefetchDecisionLogRef);
  }, [
    activeSessionId,
    hasOlderHistory,
    isLoadingOlderHistory,
    olderHistoryCursor,
    renderableRows.length,
    rows.length,
    selectedWorkspaceId,
    totalContentHeight,
    virtualItems.length,
  ]);

  const maybeLoadOlderHistory = useCallback((
    viewport: HTMLDivElement,
    trigger: "scroll" | "settled",
  ) => {
    if (viewport.scrollTop > HISTORY_PREFETCH_TOP_THRESHOLD_PX) {
      lastOlderHistoryCursorRequestRef.current = null;
      logPrefetchDecision(trigger, "below_threshold", viewport);
      return;
    }
    if (
      hasOlderHistory
      && !isLoadingOlderHistory
      && olderHistoryCursor !== null
      && lastOlderHistoryCursorRequestRef.current !== olderHistoryCursor
      && pendingPrependAnchorRef.current === null
    ) {
      lastOlderHistoryCursorRequestRef.current = olderHistoryCursor;
      pendingPrependLoadingSeenRef.current = false;
      pendingPrependArmedAtRef.current = nowMs();
      pendingPrependAnchorRef.current = {
        cursor: olderHistoryCursor,
        rowCount: rows.length,
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      };
      onLoadOlderHistory();
      logPrefetchDecision(trigger, "requested", viewport);
      return;
    }
    logPrefetchDecision(trigger, "blocked", viewport);
  }, [
    hasOlderHistory,
    isLoadingOlderHistory,
    logPrefetchDecision,
    olderHistoryCursor,
    onLoadOlderHistory,
    rows.length,
  ]);

  const handleViewportScroll = useCallback((viewport: HTMLDivElement) => {
    onViewportScroll(viewport);
    captureReadingPosition(viewport); // FR-2: persist for a later finalized revisit.
    maybeLoadOlderHistory(viewport, "scroll");
  }, [
    captureReadingPosition,
    maybeLoadOlderHistory,
    onViewportScroll,
  ]);

  useLayoutEffect(() => {
    lastBlankReportSignatureRef.current = null;
    pendingPrependAnchorRef.current = null;
    pendingPrependLoadingSeenRef.current = false;
    pendingPrependArmedAtRef.current = 0;
    lastOlderHistoryCursorRequestRef.current = null;
    lastPrefetchDecisionLogRef.current = null;
    resetForSession(buildSessionRestorePlan()); // FR-2: restore finalized / bottom-pin streaming.
  }, [activeSessionId, buildSessionRestorePlan, resetForSession, selectedWorkspaceId]);

  useLayoutEffect(() => {
    const anchor = pendingPrependAnchorRef.current;
    if (
      !anchor
      || (anchor.rowCount >= rows.length && anchor.cursor === olderHistoryCursor)
    ) {
      return;
    }

    const viewport = scrollRef.current;
    pendingPrependAnchorRef.current = null;
    if (!viewport) {
      return;
    }

    setPinned(false);
    // A prepend shifts every row's index up, indistinguishable to
    // useTranscriptCompletedTurnAnchor (runs after, below) from its OWN
    // completed-turn-split case; unguarded, it re-arms compensation from its
    // stale pre-prepend capture as cancelableByUpwardIntent=true, which
    // wheelToTop's still-in-flight gesture then cancels, stranding scrollTop
    // at 0 (the CI webkit bimodal prepend failure). Invalidate its capture.
    pendingAnchorRef.current = null;
    // Forward-clamped like every later frame-pass write (r5): never yield a
    // negative delta. NOT cancelable — the reader asked for this by scrolling up.
    notifyProgrammaticScroll(() => {
      const rawScrollHeightDelta = viewport.scrollHeight - anchor.scrollHeight;
      viewport.scrollTop = anchor.scrollTop + Math.max(rawScrollHeightDelta, 0);
    });
    startAboveChangeCompensation(anchor, false);
    prependSettleUntilRef.current = nowMs() + PREPEND_BLANK_FALLBACK_GRACE_MS; // Ruling 3(c): bounded ceiling only.
  }, [notifyProgrammaticScroll, olderHistoryCursor, pendingAnchorRef, rows.length, setPinned, startAboveChangeCompensation]);

  useEffect(() => {
    const anchor = pendingPrependAnchorRef.current;
    if (isLoadingOlderHistory) {
      if (anchor) {
        pendingPrependLoadingSeenRef.current = true;
      }
      return;
    }
    // Release a stale anchor ONLY once its request demonstrably resolved
    // without a prepend: its loading window closed with rows unchanged, or the
    // cursor moved past the one it captured. A merely in-flight request looks
    // identical on "not loading, rows unchanged" alone; discarding it on an
    // unrelated commit in that gap loses the prepend seat entirely.
    //
    // The two proofs above can both be unobtainable: runHydration returns
    // synchronously before its first await on several paths, so the loading
    // true->false pair can coalesce into a single React 18 commit that this
    // effect never observes as loading, while rows and cursor stay put. The
    // absolute ceiling is the third, always-terminating release condition —
    // without it the anchor never clears and older-history loading is wedged
    // for the rest of the mount.
    if (
      anchor
      && anchor.rowCount === rows.length
      && (
        pendingPrependLoadingSeenRef.current
        || anchor.cursor !== olderHistoryCursor
        || nowMs() - pendingPrependArmedAtRef.current > PREPEND_ANCHOR_IN_FLIGHT_MAX_MS
      )
    ) {
      pendingPrependAnchorRef.current = null;
      pendingPrependLoadingSeenRef.current = false;
      pendingPrependArmedAtRef.current = 0;
    }

    const frame = window.requestAnimationFrame(() => {
      const viewport = scrollRef.current;
      if (!viewport || pendingPrependAnchorRef.current !== null) {
        return;
      }
      maybeLoadOlderHistory(viewport, "settled");
    });
    return () => { window.cancelAnimationFrame(frame); };
  }, [isLoadingOlderHistory, maybeLoadOlderHistory, olderHistoryCursor, rows.length]);

  useTranscriptCompletedTurnAnchor({
    pendingAnchorRef,
    pinnedRef,
    renderableRows,
    virtualizer,
    notifyProgrammaticScroll,
    startAboveChangeCompensation,
  });

  // Rung 5 (PRO-187): re-run the pinned snap on every commit whose ROWS changed
  // (identity, not just count/estimate-total) so a streaming turn's DOM growth
  // snaps in that commit's layout phase against the already-grown `scrollHeight`
  // instead of trailing the content ResizeObserver by a frame. The `onChange`
  // bridge above covers the complementary measured-swap total-size change.
  useLayoutEffect(() => {
    if (!pinnedRef.current) {
      return;
    }
    scrollToBottom();
  }, [
    isSessionBusy,
    lastPromptSubmittedAtMs,
    pinnedRef,
    renderableRows,
    scrollToBottom,
    totalContentHeight,
  ]);

  // Q12 (rung 4): ONE content ResizeObserver drives the single per-frame snap
  // pass. Row content grows between virtualizer measurements (streaming, status
  // flips, expanding panels, the reveal's growth — Q7); on any size change we
  // request the one frame pass, which the pipeline coalesces into exactly one
  // snap (pinned) or compensation (unpinned) write per frame. With
  // useAnimationFrameWithResizeObserver:false the virtualizer re-measures
  // synchronously, so measurement and this snap land in the same frame WITHOUT a
  // second measure() here — a manual measure() would race the prepend anchor
  // restore's scrollTop write and provoke ResizeObserver-loop churn.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }
    const observer = new ResizeObserver(() => {
      notifyContentResize();
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [notifyContentResize]);

  useTranscriptVirtualizerBlankFallback({
    activeSessionId, bottomSpacerHeight,
    firstVirtualItem, lastVirtualItem,
    lastBlankReportSignatureRef, rowCount: rows.length,
    onFallback, prependSettleUntilRef, compensationDeadlineRef, renderableRowCount: renderableRows.length,
    scrollRef, selectedWorkspaceId,
    topSpacerHeight, totalContentHeight,
    virtualItemCount: virtualItems.length,
  });

  return (
    <div className="relative h-full">
      <VirtualTranscriptViewport
        bottomSpacerHeight={bottomSpacerHeight}
        nonDisplacingBottomInsetPx={effectiveNonDisplacingBottomInsetPx}
        columnClassName={columnClassName}
        contentRef={contentRef}
        gutterClassName={gutterClassName}
        measureElement={virtualizer.measureElement}
        onUserScrollIntent={notifyUserScrollIntent}
        onViewportScroll={handleViewportScroll}
        renderableRows={renderableRows}
        renderRow={renderRow}
        getRowRenderRevision={getRowRenderRevision}
        scrollRef={scrollRef}
        selectionRootRef={selectionRootRef}
        topSpacerHeight={topSpacerHeight}
        virtualItems={virtualItems}
        virtualizationMode={virtualizationMode}
      />
      <TranscriptFloatingControls
        bottomInsetPx={bottomInsetPx}
        isPinnedToBottom={isPinnedToBottom}
        hasNewContentWhileUnpinned={hasNewContentWhileUnpinned}
        onScrollToBottomClick={handleScrollToBottomClick}
      />
    </div>
  );
}
