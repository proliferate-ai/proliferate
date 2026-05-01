import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "@/config/chat-layout";
import {
  shouldStickToVirtualBottom,
} from "@/lib/domain/chat/transcript-virtual-rows";
import {
  parseTranscriptVirtualizationMode,
  resolveTranscriptVirtualizationEnabled,
  TRANSCRIPT_VIRTUALIZATION_STORAGE_KEY,
  type TranscriptVirtualizationMode,
} from "@/lib/domain/chat/transcript-virtualization-config";
import {
  hashMeasurementScope,
  isMainThreadMeasurementEnabled,
} from "@/lib/infra/debug-measurement";
import { FullTranscriptRowList } from "@/components/workspace/chat/transcript/FullTranscriptRowList";
import {
  buildRenderableRows,
  estimateRenderableRowHeight,
  estimateRenderableRowsHeight,
  HISTORY_PREFETCH_TOP_THRESHOLD_PX,
  logHistoryPrefetchDecisionOnce,
  STICKY_BOTTOM_THRESHOLD_PX,
  TRANSCRIPT_TOP_PADDING_PX,
  TranscriptHistoryLoadingRow,
  type HistoryPrefetchDecisionReason,
  type HistoryPrefetchTrigger,
  type HistoryPrependScrollAnchor,
  type TranscriptRenderableRow,
  type TranscriptRowListBaseProps,
} from "@/components/workspace/chat/transcript/TranscriptRowListShared";

const VIRTUALIZER_OVERSCAN = 8;
const BLANK_VIEWPORT_MIN_SCROLLABLE_PX = 32;
const LEGACY_ENABLE_VIRTUALIZATION_STORAGE_KEY =
  "proliferate:enableTranscriptVirtualization";
const LEGACY_DISABLE_VIRTUALIZATION_STORAGE_KEY =
  "proliferate:disableTranscriptVirtualization";

interface VirtualScrollAnchor {
  key: TranscriptRenderableRow["key"];
  offsetWithinRowPx: number;
  rowIndex: number;
  rowCount: number;
}

export function VirtualTranscriptRowList({
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
}: TranscriptRowListBaseProps) {
  const [virtualizationMode] = useState(readTranscriptVirtualizationMode);
  const virtualizationEnabled = resolveTranscriptVirtualizationEnabled({
    mode: virtualizationMode,
    rowCount: rows.length,
  });
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);

  useLayoutEffect(() => {
    setFallbackReason(null);
  }, [activeSessionId, selectedWorkspaceId]);

  if (!virtualizationEnabled || fallbackReason !== null) {
    return (
      <FullTranscriptRowList
        rows={rows}
        selectionRootRef={selectionRootRef}
        hasOlderHistory={hasOlderHistory}
        isLoadingOlderHistory={isLoadingOlderHistory}
        olderHistoryCursor={olderHistoryCursor}
        bottomInsetPx={bottomInsetPx}
        selectedWorkspaceId={selectedWorkspaceId}
        activeSessionId={activeSessionId}
        isSessionBusy={isSessionBusy}
        pendingPromptText={pendingPromptText}
        onLoadOlderHistory={onLoadOlderHistory}
        onScrollSample={onScrollSample}
        renderRow={renderRow}
        fallbackReason={fallbackReason}
        virtualizationMode={virtualizationMode}
      />
    );
  }

  return (
    <VirtualizedTranscriptRowList
      rows={rows}
      selectionRootRef={selectionRootRef}
      hasOlderHistory={hasOlderHistory}
      isLoadingOlderHistory={isLoadingOlderHistory}
      olderHistoryCursor={olderHistoryCursor}
      bottomInsetPx={bottomInsetPx}
      selectedWorkspaceId={selectedWorkspaceId}
      activeSessionId={activeSessionId}
      isSessionBusy={isSessionBusy}
      pendingPromptText={pendingPromptText}
      onLoadOlderHistory={onLoadOlderHistory}
      onScrollSample={onScrollSample}
      renderRow={renderRow}
      onFallback={setFallbackReason}
      virtualizationMode={virtualizationMode}
    />
  );
}

interface VirtualizedTranscriptRowListProps extends TranscriptRowListBaseProps {
  onFallback: (reason: string) => void;
  virtualizationMode: TranscriptVirtualizationMode;
}

function VirtualizedTranscriptRowList({
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
    if (renderableRows.length > 0) {
      virtualizer.scrollToIndex(renderableRows.length - 1, { align: "end" });
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [renderableRows.length, virtualizer]);

  const updateStickiness = useCallback((viewport: HTMLDivElement) => {
    shouldStickToBottomRef.current = shouldStickToVirtualBottom({
      scrollOffset: viewport.scrollTop,
      viewportSize: viewport.clientHeight,
      totalVirtualSize: viewport.scrollHeight,
      thresholdPx: STICKY_BOTTOM_THRESHOLD_PX,
    });
  }, []);

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
    return () => {
      window.cancelAnimationFrame(frame);
    };
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
    if (!offsetInfo) {
      return;
    }
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

  useEffect(() => {
    if (rows.length === 0) {
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
        rows.length,
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
          rowCount: rows.length,
          renderableRowCount: renderableRows.length,
          virtualItemCount: virtualItems.length,
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
    renderableRows.length,
    rows.length,
    selectedWorkspaceId,
    topSpacerHeight,
    totalContentHeight,
    virtualItems.length,
    onFallback,
  ]);

  return (
    <AutoHideScrollArea
      className="h-full"
      ref={scrollRef}
      onViewportScroll={handleViewportScroll}
    >
      <div
        className={`${CHAT_SURFACE_GUTTER_CLASSNAME} min-h-full`}
        data-transcript-virtualization-mode="virtual"
        data-transcript-virtualization-setting={virtualizationMode}
      >
        <div
          ref={selectionRootRef}
          data-chat-transcript-root="true"
          tabIndex={-1}
          className={`${CHAT_COLUMN_CLASSNAME} select-none outline-none`}
        >
          {topSpacerHeight > 0 && (
            <div aria-hidden="true" style={{ height: topSpacerHeight }} />
          )}
          {virtualItems.map((virtualRow) => {
            const renderableRow = renderableRows[virtualRow.index];
            if (renderableRow?.kind === "history_loader") {
              return (
                <div
                  key={renderableRow.key}
                  ref={virtualizer.measureElement}
                  data-transcript-virtual-row="true"
                  data-index={virtualRow.index}
                  className="w-full"
                >
                  <TranscriptHistoryLoadingRow />
                </div>
              );
            }

            const row = renderableRow?.row;
            if (!row) {
              return null;
            }

            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-transcript-virtual-row="true"
                data-index={virtualRow.index}
                className="w-full"
              >
                {renderRow(row, renderableRow.rowIndex)}
              </div>
            );
          })}
          {bottomSpacerHeight > 0 && (
            <div aria-hidden="true" style={{ height: bottomSpacerHeight }} />
          )}
        </div>
      </div>
    </AutoHideScrollArea>
  );
}

function readTranscriptVirtualizationMode(): TranscriptVirtualizationMode {
  if (typeof window === "undefined") {
    return "auto";
  }

  const explicitMode = window.localStorage.getItem(
    TRANSCRIPT_VIRTUALIZATION_STORAGE_KEY,
  );
  if (explicitMode !== null) {
    return parseTranscriptVirtualizationMode(explicitMode);
  }

  if (window.localStorage.getItem(LEGACY_DISABLE_VIRTUALIZATION_STORAGE_KEY) === "1") {
    return "off";
  }
  if (window.localStorage.getItem(LEGACY_ENABLE_VIRTUALIZATION_STORAGE_KEY) === "1") {
    return "on";
  }
  return "auto";
}
