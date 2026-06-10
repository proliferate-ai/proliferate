import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  shouldStickToVirtualBottom,
} from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import type { TranscriptVirtualizationMode } from "@proliferate/product-domain/chats/transcript/transcript-virtualization-config";
import {
  buildRenderableRows,
  estimateRenderableRowHeight,
  estimateRenderableRowsHeight,
  HISTORY_PREFETCH_TOP_THRESHOLD_PX,
  logHistoryPrefetchDecisionOnce,
  STICKY_BOTTOM_THRESHOLD_PX,
  TRANSCRIPT_TOP_PADDING_PX,
  TranscriptScrollToBottomButton,
  type HistoryPrefetchDecisionReason,
  type HistoryPrefetchTrigger,
  type HistoryPrependScrollAnchor,
  type TranscriptRenderableRow,
  type TranscriptRowListBaseProps,
} from "./TranscriptRowListShared";
import { VirtualTranscriptViewport } from "./VirtualTranscriptViewport";
import { useTranscriptVirtualizerBlankFallback } from "./useTranscriptVirtualizerBlankFallback";

const VIRTUALIZER_OVERSCAN = 8;

interface VirtualScrollAnchor {
  key: TranscriptRenderableRow["key"];
  offsetWithinRowPx: number;
  rowIndex: number;
  rowCount: number;
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
  selectedWorkspaceId,
  activeSessionId,
  isSessionBusy,
  pendingPromptText,
  onLoadOlderHistory,
  onScrollSample,
  renderRow,
  columnClassName,
  gutterClassName,
  onFallback,
  virtualizationMode,
}: VirtualizedTranscriptRowListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const pendingAnchorRef = useRef<VirtualScrollAnchor | null>(null);
  const pendingPrependAnchorRef = useRef<HistoryPrependScrollAnchor | null>(null);
  const lastOlderHistoryCursorRequestRef = useRef<number | null>(null);
  const lastPrefetchDecisionLogRef = useRef<string | null>(null);
  const lastBlankReportSignatureRef = useRef<string | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const renderableRows = useMemo(
    () => buildRenderableRows(rows, isLoadingOlderHistory),
    [isLoadingOlderHistory, rows],
  );
  const estimatedInitialBottomOffset =
    TRANSCRIPT_TOP_PADDING_PX
    + estimateRenderableRowsHeight(renderableRows)
    + bottomInsetPx;

  const virtualizer = useVirtualizer({
    count: renderableRows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => renderableRows[index]?.key ?? index,
    estimateSize: (index) => estimateRenderableRowHeight(renderableRows[index]),
    overscan: VIRTUALIZER_OVERSCAN,
    paddingStart: TRANSCRIPT_TOP_PADDING_PX,
    paddingEnd: bottomInsetPx,
    initialOffset: () => estimatedInitialBottomOffset,
    useAnimationFrameWithResizeObserver: true,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalContentHeight = virtualizer.getTotalSize();
  const firstVirtualItem = virtualItems[0] ?? null;
  const lastVirtualItem = virtualItems[virtualItems.length - 1] ?? null;
  const topSpacerHeight = firstVirtualItem?.start ?? totalContentHeight;
  const bottomSpacerHeight = lastVirtualItem
    ? Math.max(totalContentHeight - lastVirtualItem.end, 0)
    : 0;

  const scrollToBottom = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return;
    }
    // Pin against the real DOM scroll height instead of
    // virtualizer.scrollToIndex: index-based scrolling positions by the
    // virtualizer's *estimated* size for rows that haven't been measured
    // yet (e.g. the row appended by this very update), so each append lands
    // the viewport wrong by the estimate error and visibly bounces when the
    // measurement corrects it a frame later.
    viewport.scrollTop = viewport.scrollHeight;
  }, []);

  const updateStickiness = useCallback((viewport: HTMLDivElement) => {
    const stick = shouldStickToVirtualBottom({
      scrollOffset: viewport.scrollTop,
      viewportSize: viewport.clientHeight,
      totalVirtualSize: viewport.scrollHeight,
      thresholdPx: STICKY_BOTTOM_THRESHOLD_PX,
    });
    shouldStickToBottomRef.current = stick;
    setIsPinnedToBottom(stick);
  }, []);

  const handleScrollToBottomClick = useCallback(() => {
    shouldStickToBottomRef.current = true;
    setIsPinnedToBottom(true);
    scrollToBottom();
  }, [scrollToBottom]);

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
    updateStickiness(viewport);
    maybeLoadOlderHistory(viewport, "scroll");
    onScrollSample();
  }, [
    maybeLoadOlderHistory,
    onScrollSample,
    updateStickiness,
  ]);

  useLayoutEffect(() => {
    shouldStickToBottomRef.current = true;
    lastBlankReportSignatureRef.current = null;
    pendingPrependAnchorRef.current = null;
    lastOlderHistoryCursorRequestRef.current = null;
    lastPrefetchDecisionLogRef.current = null;
  }, [activeSessionId, selectedWorkspaceId]);

  useLayoutEffect(() => {
    shouldStickToBottomRef.current = true;
    setIsPinnedToBottom(true);
    scrollToBottom();
    // This is intentionally keyed to session identity and row availability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, selectedWorkspaceId]);

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

    shouldStickToBottomRef.current = false;
    const scrollDelta = viewport.scrollHeight - anchor.scrollHeight;
    viewport.scrollTop = anchor.scrollTop + scrollDelta;
  }, [olderHistoryCursor, rows.length]);

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

  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (!anchor || shouldStickToBottomRef.current) {
      return;
    }
    if (
      anchor.rowCount === renderableRows.length
      && renderableRows[anchor.rowIndex]?.key === anchor.key
    ) {
      return;
    }

    const nextIndex = renderableRows.findIndex((row) => row.key === anchor.key);
    if (nextIndex < 0) {
      return;
    }

    const offsetInfo = virtualizer.getOffsetForIndex(nextIndex, "start");
    if (!offsetInfo) return;
    virtualizer.scrollToOffset(offsetInfo[0] + anchor.offsetWithinRowPx);
  }, [renderableRows, rows.length, virtualizer]);

  useLayoutEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return;
    }
    scrollToBottom();
  }, [
    bottomInsetPx,
    isSessionBusy,
    pendingPromptText,
    renderableRows.length,
    scrollToBottom,
    totalContentHeight,
  ]);

  useLayoutEffect(() => () => {
    const viewport = scrollRef.current;
    if (!viewport || shouldStickToBottomRef.current) {
      pendingAnchorRef.current = null;
      return;
    }

    const firstVisibleVirtualRow = virtualizer
      .getVirtualItems()
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
    };
  });

  useTranscriptVirtualizerBlankFallback({
    activeSessionId,
    firstVirtualItem,
    lastVirtualItem,
    lastBlankReportSignatureRef,
    onFallback,
    rowCount: rows.length,
    scrollRef,
  });

  return (
    <div className="relative h-full">
      <VirtualTranscriptViewport
        bottomSpacerHeight={bottomSpacerHeight}
        columnClassName={columnClassName}
        gutterClassName={gutterClassName}
        measureElement={virtualizer.measureElement}
        onViewportScroll={handleViewportScroll}
        renderableRows={renderableRows}
        renderRow={renderRow}
        scrollRef={scrollRef}
        selectionRootRef={selectionRootRef}
        topSpacerHeight={topSpacerHeight}
        virtualItems={virtualItems}
        virtualizationMode={virtualizationMode}
      />
      <TranscriptScrollToBottomButton
        visible={!isPinnedToBottom}
        bottomInsetPx={bottomInsetPx}
        onClick={handleScrollToBottomClick}
      />
    </div>
  );
}
