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
import { useAboveChangeCompensation } from "#product/hooks/chat/ui/use-above-change-compensation";
import { useTranscriptStickToBottom } from "#product/hooks/chat/ui/use-transcript-stick-to-bottom";
import { useTranscriptCompletedTurnAnchor } from "#product/hooks/chat/ui/use-transcript-completed-turn-anchor";
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
  } = useTranscriptStickToBottom({
    scrollRef,
    onScrollSample,
    autoFollowBottomInsetPx: effectiveNonDisplacingBottomInsetPx,
    lastPromptSubmittedAtMs,
    sessionKey: `${selectedWorkspaceId ?? ""}:${activeSessionId}`,
  });
  const renderableRows = useMemo(
    () => buildRenderableRows(rows, isLoadingOlderHistory),
    [isLoadingOlderHistory, rows],
  );
  const {
    estimateSize,
    estimatedRowsHeight,
    getItemKey,
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
    overscan: VIRTUALIZER_OVERSCAN,
    paddingStart: TRANSCRIPT_TOP_PADDING_PX,
    paddingEnd: structuralBottomInsetPx,
    initialOffset: () => estimatedInitialBottomOffset,
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

  const startAboveChangeCompensation = useAboveChangeCompensation({
    scrollRef,
    pinnedRef,
    notifyProgrammaticScroll,
  });

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
    // height and the reading row stays fixed on every engine.
    startAboveChangeCompensation(anchor);
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

  // Row content can grow between virtualizer measurements (tool-call output
  // streaming, status flips, expanding panels). The snap effect above only
  // fires when totalContentHeight changes — but with
  // useAnimationFrameWithResizeObserver the virtualizer defers re-measurement
  // by one frame, leaving a window where the DOM has grown but no snap runs.
  // Bridge that gap with a ResizeObserver on the content wrapper (same pattern
  // as FullTranscriptRowList) that re-snaps immediately on any size increase
  // while pinned, regardless of whether the virtualizer has re-measured yet.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current) {
        return;
      }
      scrollToBottom();
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [pinnedRef, scrollToBottom]);

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
