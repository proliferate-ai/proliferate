import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { LoaderCircle } from "@/components/ui/icons";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "@/config/chat-layout";
import {
  shouldStickToVirtualBottom,
  type TranscriptVirtualRow,
} from "@/lib/domain/chat/transcript-virtual-rows";
import {
  hashMeasurementScope,
  isMainThreadMeasurementEnabled,
} from "@/lib/infra/debug-measurement";

const TRANSCRIPT_TOP_PADDING_PX = 16;
const STICKY_BOTTOM_THRESHOLD_PX = 96;
const ESTIMATED_TURN_HEIGHT_PX = 360;
const VIRTUALIZER_OVERSCAN = 8;
const BLANK_VIEWPORT_MIN_SCROLLABLE_PX = 32;
const HISTORY_PREFETCH_TOP_THRESHOLD_PX = 480;
const DEBUG_ENABLE_VIRTUALIZATION_STORAGE_KEY =
  "proliferate:enableTranscriptVirtualization";

// Dark launch only: production currently relies on bounded transcript history
// plus full rendering. Enable this in dev with the localStorage key above when
// profiling the virtualizer path without changing shipped behavior.

interface VirtualScrollAnchor {
  key: TranscriptVirtualRow["key"];
  offsetWithinRowPx: number;
  rowIndex: number;
  rowCount: number;
}

interface PrependScrollAnchor {
  rowCount: number;
  scrollHeight: number;
  scrollTop: number;
}

interface VirtualTurnListProps {
  rows: readonly TranscriptVirtualRow[];
  selectionRootRef: RefObject<HTMLDivElement | null>;
  hasOlderHistory: boolean;
  isLoadingOlderHistory: boolean;
  bottomInsetPx: number;
  selectedWorkspaceId: string | null;
  activeSessionId: string;
  isSessionBusy: boolean;
  pendingPromptText: string | null;
  onLoadOlderHistory: () => void;
  onScrollSample: () => void;
  renderRow: (row: TranscriptVirtualRow, rowIndex: number) => ReactNode;
}

export function VirtualTurnList({
  rows,
  selectionRootRef,
  hasOlderHistory,
  isLoadingOlderHistory,
  bottomInsetPx,
  selectedWorkspaceId,
  activeSessionId,
  isSessionBusy,
  pendingPromptText,
  onLoadOlderHistory,
  onScrollSample,
  renderRow,
}: VirtualTurnListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const pendingAnchorRef = useRef<VirtualScrollAnchor | null>(null);
  const pendingPrependAnchorRef = useRef<PrependScrollAnchor | null>(null);
  const lastBlankReportSignatureRef = useRef<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const virtualizationEnabled = isTranscriptVirtualizationDarkLaunchEnabled();
  const virtualizationDisabled = fallbackReason !== null || !virtualizationEnabled;
  const estimatedInitialBottomOffset =
    TRANSCRIPT_TOP_PADDING_PX
    + rows.length * ESTIMATED_TURN_HEIGHT_PX
    + bottomInsetPx;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: () => ESTIMATED_TURN_HEIGHT_PX,
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
    if (!virtualizationDisabled && rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [rows.length, virtualizationDisabled, virtualizer]);

  const updateStickiness = useCallback((viewport: HTMLDivElement) => {
    shouldStickToBottomRef.current = shouldStickToVirtualBottom({
      scrollOffset: viewport.scrollTop,
      viewportSize: viewport.clientHeight,
      totalVirtualSize: viewport.scrollHeight,
      thresholdPx: STICKY_BOTTOM_THRESHOLD_PX,
    });
  }, []);

  const handleViewportScroll = useCallback((viewport: HTMLDivElement) => {
    updateStickiness(viewport);
    if (
      hasOlderHistory
      && !isLoadingOlderHistory
      && viewport.scrollTop <= HISTORY_PREFETCH_TOP_THRESHOLD_PX
      && pendingPrependAnchorRef.current === null
    ) {
      pendingPrependAnchorRef.current = {
        rowCount: rows.length,
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      };
      onLoadOlderHistory();
    }
    onScrollSample();
  }, [
    hasOlderHistory,
    isLoadingOlderHistory,
    onLoadOlderHistory,
    onScrollSample,
    rows.length,
    updateStickiness,
  ]);

  useLayoutEffect(() => {
    shouldStickToBottomRef.current = true;
    setFallbackReason(null);
    lastBlankReportSignatureRef.current = null;
    pendingPrependAnchorRef.current = null;
  }, [activeSessionId, selectedWorkspaceId]);

  useLayoutEffect(() => {
    shouldStickToBottomRef.current = true;
    scrollToBottom();
    // This is intentionally keyed to session identity and row availability.
    // Fallback changes must not reset the fallback flag immediately after the
    // blank-viewport watchdog enables it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, selectedWorkspaceId]);

  useLayoutEffect(() => {
    const anchor = pendingPrependAnchorRef.current;
    if (!anchor || anchor.rowCount >= rows.length) {
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
  }, [rows.length]);

  useEffect(() => {
    const anchor = pendingPrependAnchorRef.current;
    if (!isLoadingOlderHistory && anchor?.rowCount === rows.length) {
      pendingPrependAnchorRef.current = null;
    }
  }, [isLoadingOlderHistory, rows.length]);

  useLayoutEffect(() => {
    if (virtualizationDisabled) {
      return;
    }

    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (!anchor || shouldStickToBottomRef.current) {
      return;
    }
    if (anchor.rowCount === rows.length && rows[anchor.rowIndex]?.key === anchor.key) {
      return;
    }

    const nextIndex = rows.findIndex((row) => row.key === anchor.key);
    if (nextIndex < 0) {
      return;
    }

    const offsetInfo = virtualizer.getOffsetForIndex(nextIndex, "start");
    if (!offsetInfo) {
      return;
    }
    virtualizer.scrollToOffset(offsetInfo[0] + anchor.offsetWithinRowPx);
  }, [rows, virtualizationDisabled, virtualizer]);

  useLayoutEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return;
    }
    scrollToBottom();
  }, [
    bottomInsetPx,
    isSessionBusy,
    pendingPromptText,
    rows.length,
    scrollToBottom,
    totalContentHeight,
  ]);

  useLayoutEffect(() => () => {
    if (virtualizationDisabled) {
      pendingAnchorRef.current = null;
      return;
    }

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

    const row = rows[firstVisibleVirtualRow.index];
    if (!row) {
      pendingAnchorRef.current = null;
      return;
    }

    pendingAnchorRef.current = {
      key: row.key,
      offsetWithinRowPx: Math.max(viewport.scrollTop - firstVisibleVirtualRow.start, 0),
      rowIndex: firstVisibleVirtualRow.index,
      rowCount: rows.length,
    };
  });

  useEffect(() => {
    if (virtualizationDisabled || rows.length === 0) {
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

      setFallbackReason("blank_viewport");
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    activeSessionId,
    bottomSpacerHeight,
    firstVirtualItem,
    lastVirtualItem,
    rows.length,
    selectedWorkspaceId,
    topSpacerHeight,
    totalContentHeight,
    virtualItems.length,
    virtualizationDisabled,
  ]);

  return (
    <AutoHideScrollArea
      className="h-full"
      ref={scrollRef}
      onViewportScroll={handleViewportScroll}
    >
      <div
        className={`${CHAT_SURFACE_GUTTER_CLASSNAME} min-h-full`}
        data-transcript-virtualization-mode={virtualizationDisabled ? "disabled" : "virtual"}
        data-transcript-virtualization-fallback={fallbackReason ?? undefined}
      >
        <div
          ref={selectionRootRef}
          data-chat-transcript-root="true"
          tabIndex={-1}
          className={`${CHAT_COLUMN_CLASSNAME} select-none outline-none`}
        >
          {virtualizationDisabled ? (
            <>
              {TRANSCRIPT_TOP_PADDING_PX > 0 && (
                <div aria-hidden="true" style={{ height: TRANSCRIPT_TOP_PADDING_PX }} />
              )}
              {isLoadingOlderHistory && <HistoryLoadingRow />}
              {rows.map((row, rowIndex) => (
                <div
                  key={row.key}
                  data-transcript-virtual-row="true"
                  data-index={rowIndex}
                  className="w-full"
                >
                  {renderRow(row, rowIndex)}
                </div>
              ))}
              {bottomInsetPx > 0 && (
                <div aria-hidden="true" style={{ height: bottomInsetPx }} />
              )}
            </>
          ) : (
            <>
              {topSpacerHeight > 0 && (
                <div aria-hidden="true" style={{ height: topSpacerHeight }} />
              )}
              {isLoadingOlderHistory && <HistoryLoadingRow />}
              {virtualItems.map((virtualRow) => {
                const row = rows[virtualRow.index];
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
                    {renderRow(row, virtualRow.index)}
                  </div>
                );
              })}
              {bottomSpacerHeight > 0 && (
                <div aria-hidden="true" style={{ height: bottomSpacerHeight }} />
              )}
            </>
          )}
        </div>
      </div>
    </AutoHideScrollArea>
  );
}

function HistoryLoadingRow() {
  return (
    <div className="flex justify-center pb-3 text-muted-foreground" role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading earlier messages</span>
    </div>
  );
}

function isTranscriptVirtualizationDarkLaunchEnabled(): boolean {
  return import.meta.env.DEV
    && typeof window !== "undefined"
    && window.localStorage.getItem(DEBUG_ENABLE_VIRTUALIZATION_STORAGE_KEY) === "1";
}
