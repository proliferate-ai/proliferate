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

const VIRTUALIZER_OVERSCAN = 8;

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
  } = useTranscriptStickToBottom({
    scrollRef,
    onScrollSample,
    autoFollowBottomInsetPx: effectiveNonDisplacingBottomInsetPx,
    lastPromptSubmittedAtMs,
    sessionKey: `${selectedWorkspaceId ?? ""}:${activeSessionId}`,
  });
  // A user scroll inside the input event's call stack pre-empts any queued
  // programmatic snap (render-freeze gate parity): cancel the frame pipeline.
  useTranscriptScrollPauseRegistration(cancelFramePipeline);
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
    // Q12 (rung 4): EVALUATED false vs true. The owned single content
    // ResizeObserver below routes every growth through the one frame pipeline,
    // and the pipeline writes scrollTop exactly once per frame, so no
    // ResizeObserver-loop error is provoked in either mode (the physics suite's
    // no-pageerror assertion is clean with both). Turning TanStack's own
    // observation OFF (false) does NOT move OUR snap — the pipeline still owns
    // when that runs — it only desynchronizes TanStack's internal re-measure
    // from our snap, which destabilized the pinned-follow / repin / prepend
    // scenarios in the physics suite. Kept true: it preserves the proven
    // measurement cadence at zero RO-loop cost. See the PR body for the matrix.
    useAnimationFrameWithResizeObserver: true,
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
    maybeLoadOlderHistory(viewport, "scroll");
  }, [
    maybeLoadOlderHistory,
    onViewportScroll,
  ]);

  useLayoutEffect(() => {
    lastBlankReportSignatureRef.current = null;
    pendingPrependAnchorRef.current = null;
    lastOlderHistoryCursorRequestRef.current = null;
    lastPrefetchDecisionLogRef.current = null;
    resetForSession();
  }, [activeSessionId, resetForSession, selectedWorkspaceId]);

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
    notifyProgrammaticScroll(() => {
      viewport.scrollTop = anchor.scrollTop + (viewport.scrollHeight - anchor.scrollHeight);
    });
    // The synchronous write above lands against the CURRENT scrollHeight, which
    // still reflects the virtualizer's 360px estimate for the freshly-mounted
    // older rows. On Chromium the transcript runs with `overflow-anchor: none`
    // (the single-writer ruling), so the browser no longer silently corrects
    // that shortfall as the real, taller row heights measure in a frame later —
    // the reading row would drift down by the estimate-to-measured difference.
    // Re-apply the same delta each frame while the prepended rows settle (a no-op
    // once pinned or height-stable), so scrollTop absorbs the full added-above
    // height and the reading row stays fixed on every engine. NOT cancelable by
    // upward intent: the reader requested this prepend by scrolling to the top,
    // so the reading row must hold even as that same upward gesture continues.
    startAboveChangeCompensation(anchor, false);
    // Open the blank-fallback grace window: the anchored scrollTop sits ahead of the still-estimated mounted range until those rows measure taller.
    prependSettleUntilRef.current = (typeof performance === "undefined" ? Date.now() : performance.now()) + PREPEND_BLANK_FALLBACK_GRACE_MS;
  }, [notifyProgrammaticScroll, olderHistoryCursor, rows.length, setPinned, startAboveChangeCompensation]);

  useEffect(() => {
    const anchor = pendingPrependAnchorRef.current;
    if (!isLoadingOlderHistory && anchor?.rowCount === rows.length) {
      pendingPrependAnchorRef.current = null;
    }
    if (isLoadingOlderHistory) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const viewport = scrollRef.current;
      if (!viewport || pendingPrependAnchorRef.current !== null) {
        return;
      }
      maybeLoadOlderHistory(viewport, "settled");
    });
    return () => { window.cancelAnimationFrame(frame); };
  }, [isLoadingOlderHistory, maybeLoadOlderHistory, rows.length]);

  useTranscriptCompletedTurnAnchor({
    pendingAnchorRef,
    pinnedRef,
    renderableRows,
    virtualizer,
    notifyProgrammaticScroll,
    startAboveChangeCompensation,
  });

  useLayoutEffect(() => {
    if (!pinnedRef.current) {
      return;
    }
    scrollToBottom();
  }, [
    isSessionBusy,
    lastPromptSubmittedAtMs,
    pinnedRef,
    renderableRows.length,
    scrollToBottom,
    totalContentHeight,
  ]);

  // Q12 (rung 4): ONE content ResizeObserver drives the single per-frame snap
  // pass. Row content grows between virtualizer measurements (tool-call output
  // streaming, status flips, expanding panels, the assistant reveal's height
  // growth — Q7); on any size change we request the one frame pass, which the
  // pipeline coalesces with every other mutation source into exactly one snap
  // (pinned) or compensation (unpinned) write per frame, so no independent loop
  // can interleave. With useAnimationFrameWithResizeObserver:false the
  // virtualizer already re-measures synchronously through its own element
  // observation (no one-frame deferral), so measurement and this snap land in
  // the same frame WITHOUT a second measure() call here — a manual measure()
  // inside this callback would race the prepend anchor restore's scrollTop write
  // and provoke ResizeObserver-loop churn. This replaces the previous bridge
  // observer that wrote scrollTop directly.
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
    onFallback, prependSettleUntilRef, renderableRowCount: renderableRows.length,
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
        onScrollToBottomClick={handleScrollToBottomClick}
      />
    </div>
  );
}
