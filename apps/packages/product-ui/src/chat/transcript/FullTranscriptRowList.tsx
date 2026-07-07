import {
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useRef,
  type ReactNode,
} from "react";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import type { TranscriptVirtualizationMode } from "@proliferate/product-domain/chats/transcript/transcript-virtualization-config";
import {
  HISTORY_PREFETCH_TOP_THRESHOLD_PX,
  logHistoryPrefetchDecisionOnce,
  TRANSCRIPT_TOP_PADDING_PX,
  DEFAULT_CHAT_COLUMN_CLASSNAME,
  DEFAULT_CHAT_SURFACE_GUTTER_CLASSNAME,
  TranscriptHistoryLoadingRow,
  TranscriptScrollToBottomButton,
  type HistoryPrefetchDecisionReason,
  type HistoryPrefetchTrigger,
  type HistoryPrependScrollAnchor,
  type TranscriptRowListBaseProps,
} from "./TranscriptRowListShared";
import { useTranscriptStickToBottom } from "./useTranscriptStickToBottom";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";

type TranscriptRowRenderer = (
  row: TranscriptVirtualRow,
  rowIndex: number,
) => ReactNode;

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
  columnClassName = DEFAULT_CHAT_COLUMN_CLASSNAME,
  gutterClassName = DEFAULT_CHAT_SURFACE_GUTTER_CLASSNAME,
  fallbackReason,
  virtualizationMode,
}: FullTranscriptRowListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingPrependAnchorRef = useRef<HistoryPrependScrollAnchor | null>(null);
  const lastOlderHistoryCursorRequestRef = useRef<number | null>(null);
  const lastPrefetchDecisionLogRef = useRef<string | null>(null);
  const {
    isPinnedToBottom,
    pinnedRef,
    onViewportScroll,
    scrollToBottom,
    handleScrollToBottomClick,
    notifyProgrammaticScroll,
    setPinned,
    resetForSession,
  } = useTranscriptStickToBottom({ scrollRef, onScrollSample, bottomInsetPx });

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
    onViewportScroll(viewport);
    maybeLoadOlderHistory(viewport, "scroll");
  }, [
    maybeLoadOlderHistory,
    onViewportScroll,
  ]);

  useLayoutEffect(() => {
    pendingPrependAnchorRef.current = null;
    lastOlderHistoryCursorRequestRef.current = null;
    lastPrefetchDecisionLogRef.current = null;
    resetForSession();
  }, [activeSessionId, selectedWorkspaceId, resetForSession]);

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
  }, [notifyProgrammaticScroll, olderHistoryCursor, rows.length, setPinned]);

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
    if (!pinnedRef.current) {
      return;
    }
    scrollToBottom();
  }, [
    bottomInsetPx,
    isSessionBusy,
    pendingPromptText,
    pinnedRef,
    rows,
    scrollToBottom,
  ]);

  // Content can grow after the React commit (images decoding, async diff
  // panels, code-highlight reflow). Re-stick on any content resize so a
  // pinned viewport stays at the true bottom; the stickiness ref is the
  // guard, so we always observe.
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

  return (
    <div className="relative h-full">
      <AutoHideScrollArea
        className="h-full"
        ref={scrollRef}
        onViewportScroll={handleViewportScroll}
      >
        <div
          ref={contentRef}
          className={`${gutterClassName} min-h-full`}
          data-transcript-virtualization-mode="full"
          data-transcript-virtualization-setting={virtualizationMode}
          data-transcript-virtualization-fallback={fallbackReason ?? undefined}
        >
          <div
            ref={selectionRootRef}
            data-chat-transcript-root="true"
            tabIndex={-1}
            className={`${columnClassName} select-none outline-none`}
          >
            {TRANSCRIPT_TOP_PADDING_PX > 0 && (
              <div aria-hidden="true" style={{ height: TRANSCRIPT_TOP_PADDING_PX }} />
            )}
            {isLoadingOlderHistory && <TranscriptHistoryLoadingRow />}
            {rows.map((row, rowIndex) => (
              <MemoizedFullTranscriptRow
                key={row.key}
                row={row}
                rowIndex={rowIndex}
                renderRow={renderRow}
              />
            ))}
            {bottomInsetPx > 0 && (
              <div aria-hidden="true" style={{ height: bottomInsetPx }} />
            )}
          </div>
        </div>
      </AutoHideScrollArea>
      <TranscriptScrollToBottomButton
        visible={!isPinnedToBottom}
        bottomInsetPx={bottomInsetPx}
        onClick={handleScrollToBottomClick}
      />
    </div>
  );
}

const MemoizedFullTranscriptRow = memo(function MemoizedFullTranscriptRow({
  row,
  rowIndex,
  renderRow,
}: {
  row: TranscriptVirtualRow;
  rowIndex: number;
  renderRow: TranscriptRowRenderer;
}) {
  return (
    <div
      data-transcript-virtual-row="true"
      data-index={rowIndex}
      className="w-full"
    >
      {renderRow(row, rowIndex)}
    </div>
  );
}, (prev, next) =>
  prev.row === next.row
  && prev.rowIndex === next.rowIndex
  && prev.renderRow === next.renderRow
);
