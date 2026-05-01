import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "@/config/chat-layout";
import {
  shouldStickToVirtualBottom,
} from "@/lib/domain/chat/transcript-virtual-rows";
import type { TranscriptVirtualizationMode } from "@/lib/domain/chat/transcript-virtualization-config";
import {
  HISTORY_PREFETCH_TOP_THRESHOLD_PX,
  logHistoryPrefetchDecisionOnce,
  STICKY_BOTTOM_THRESHOLD_PX,
  TRANSCRIPT_TOP_PADDING_PX,
  TranscriptHistoryLoadingRow,
  type HistoryPrefetchDecisionReason,
  type HistoryPrefetchTrigger,
  type HistoryPrependScrollAnchor,
  type TranscriptRowListBaseProps,
} from "@/components/workspace/chat/transcript/TranscriptRowListShared";

interface FullTranscriptRowListProps extends TranscriptRowListBaseProps {
  fallbackReason: string | null;
  virtualizationMode: TranscriptVirtualizationMode;
}

export function FullTranscriptRowList({
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
  fallbackReason,
  virtualizationMode,
}: FullTranscriptRowListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const pendingPrependAnchorRef = useRef<HistoryPrependScrollAnchor | null>(null);
  const lastOlderHistoryCursorRequestRef = useRef<number | null>(null);
  const lastPrefetchDecisionLogRef = useRef<string | null>(null);

  const scrollToBottom = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, []);

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
      component: "full",
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
      viewport,
    }, lastPrefetchDecisionLogRef);
  }, [
    activeSessionId,
    hasOlderHistory,
    isLoadingOlderHistory,
    olderHistoryCursor,
    rows.length,
    selectedWorkspaceId,
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
    if (!shouldStickToBottomRef.current) {
      return;
    }
    scrollToBottom();
  }, [
    bottomInsetPx,
    isSessionBusy,
    pendingPromptText,
    rows,
    scrollToBottom,
  ]);

  return (
    <AutoHideScrollArea
      className="h-full"
      ref={scrollRef}
      onViewportScroll={handleViewportScroll}
    >
      <div
        className={`${CHAT_SURFACE_GUTTER_CLASSNAME} min-h-full`}
        data-transcript-virtualization-mode="full"
        data-transcript-virtualization-setting={virtualizationMode}
        data-transcript-virtualization-fallback={fallbackReason ?? undefined}
      >
        <div
          ref={selectionRootRef}
          data-chat-transcript-root="true"
          tabIndex={-1}
          className={`${CHAT_COLUMN_CLASSNAME} select-none outline-none`}
        >
          {TRANSCRIPT_TOP_PADDING_PX > 0 && (
            <div aria-hidden="true" style={{ height: TRANSCRIPT_TOP_PADDING_PX }} />
          )}
          {isLoadingOlderHistory && <TranscriptHistoryLoadingRow />}
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
        </div>
      </div>
    </AutoHideScrollArea>
  );
}
