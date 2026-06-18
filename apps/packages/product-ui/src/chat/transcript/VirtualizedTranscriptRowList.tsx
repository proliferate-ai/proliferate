import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TranscriptVirtualizationMode } from "@proliferate/product-domain/chats/transcript/transcript-virtualization-config";
import {
  buildRenderableRows,
  estimateRenderableRowHeight,
  estimateRenderableRowsHeight,
  HISTORY_PREFETCH_TOP_THRESHOLD_PX,
  logHistoryPrefetchDecisionOnce,
  TRANSCRIPT_TOP_PADDING_PX,
  TranscriptScrollToBottomButton,
  type HistoryPrefetchDecisionReason,
  type HistoryPrefetchTrigger,
  type HistoryPrependScrollAnchor,
  type TranscriptRenderableRow,
  type TranscriptRowListBaseProps,
} from "./TranscriptRowListShared";
import { useAboveChangeCompensation } from "./useAboveChangeCompensation";
import { resolveUnpinnedAnchorRestore } from "./unpinned-anchor-restore";
import { useTranscriptStickToBottom } from "./useTranscriptStickToBottom";
import { VirtualTranscriptViewport } from "./VirtualTranscriptViewport";
import { useTranscriptVirtualizerBlankFallback } from "./useTranscriptVirtualizerBlankFallback";

const VIRTUALIZER_OVERSCAN = 8;

interface VirtualScrollAnchor {
  key: TranscriptRenderableRow["key"];
  offsetWithinRowPx: number;
  rowIndex: number;
  rowCount: number;
  // Real measured DOM metrics at capture, for the composition-change fallback
  // (turn-row split) where offset+estimate math lands wrong. See the restore
  // effect below.
  scrollHeight: number;
  scrollTop: number;
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
  // The stick-to-bottom engine is created before the virtualizer below, so the
  // resume-measure callback reads it through a ref (set once the virtualizer
  // exists) to force one synchronous measure pass on tab/window resume.
  const virtualizerRef = useRef<{ measure: () => void } | null>(null);
  // measure() clears the entire itemSizeCache (full re-measure from estimates),
  // so this momentarily resets scrollHeight to estimates before the resume glue
  // loop follows the re-measure. That cost is acceptable only because this is
  // resume-only (one tab/window re-show); do NOT widen its trigger to per-event
  // paths or it reintroduces the estimate->measure churn during streaming.
  const resumeMeasure = useCallback(() => {
    virtualizerRef.current?.measure();
  }, []);
  const pendingAnchorRef = useRef<VirtualScrollAnchor | null>(null);
  const pendingPrependAnchorRef = useRef<HistoryPrependScrollAnchor | null>(null);
  const lastOlderHistoryCursorRequestRef = useRef<number | null>(null);
  const lastPrefetchDecisionLogRef = useRef<string | null>(null);
  const lastBlankReportSignatureRef = useRef<string | null>(null);
  const {
    isPinnedToBottom,
    pinnedRef,
    onViewportScroll,
    scrollToBottom,
    glueToBottom,
    handleScrollToBottomClick,
    notifyProgrammaticScroll,
    setPinned,
    resetForSession,
  } = useTranscriptStickToBottom({ scrollRef, onScrollSample, onResumeMeasure: resumeMeasure });
  // Gates the blank-viewport fallback until the virtualizer has run >=1
  // measurement pass after mount/session change; the first frame is
  // estimate-only and would read as blank (the session-switch flicker).
  const [measurementReady, setMeasurementReady] = useState(false);
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
  virtualizerRef.current = virtualizer;
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

  // On mount and every session/workspace switch, reset stickiness (keeping the
  // virtualizer mounted so its measurement cache survives) and re-gate the
  // blank-fallback until the next measurement pass lands.
  useLayoutEffect(() => {
    lastBlankReportSignatureRef.current = null;
    pendingPrependAnchorRef.current = null;
    lastOlderHistoryCursorRequestRef.current = null;
    lastPrefetchDecisionLogRef.current = null;
    setMeasurementReady(false);
    resetForSession();
  }, [activeSessionId, resetForSession, selectedWorkspaceId]);

  // Flip measurement-ready one frame after a session change: by the next frame
  // the virtualizer has already measured the visible rows (via
  // useAnimationFrameWithResizeObserver) so the blank-viewport check can run
  // without false-positiving on the estimate-only first frame. Gate strictly to
  // session/workspace change: keying off rows.length would re-arm on every
  // streamed-row append, and an explicit virtualizer.measure() here would clear
  // the whole itemSizeCache and reintroduce per-event estimate->measure churn.
  const hasRows = rows.length > 0;
  useEffect(() => {
    if (!hasRows) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setMeasurementReady(true);
    });
    return () => { window.cancelAnimationFrame(frame); };
  }, [activeSessionId, hasRows, selectedWorkspaceId]);

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
    return () => { window.cancelAnimationFrame(frame); };
  }, [isLoadingOlderHistory, maybeLoadOlderHistory, rows.length]);

  const startAboveChangeCompensation = useAboveChangeCompensation({
    scrollRef,
    pinnedRef,
    notifyProgrammaticScroll,
  });

  // While unpinned, a completing turn can split/grow rows around the anchored
  // (first-visible) row. getOffsetForIndex builds on the 360px estimate for
  // unmeasured neighbours, so the naive offset restore lands wrong and nudges
  // the read position. Distinguish the three change shapes relative to the
  // anchor and pick the restore that holds it at the same viewport y:
  //   - anchor moved DOWN  (nextIndex > rowIndex): rows inserted ABOVE the
  //     viewport — hold with the measured scrollHeight delta (estimate-immune).
  //   - anchor moved UP    (nextIndex < rowIndex): rows removed ABOVE the
  //     viewport — same measured-delta compensation applies.
  //   - anchor index UNCHANGED (nextIndex === rowIndex): nothing changed above
  //     the anchor, so getOffsetForIndex(nextIndex) is the anchor's real top.
  //     A change strictly BELOW the viewport leaves scrollTop correct (hold it,
  //     no move); a same-index height change of the anchor row itself needs the
  //     measured offset — force-measure the anchor row first so the offset is
  //     real, not the estimate, then restore offset + intra-row position.
  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (!anchor || pinnedRef.current) {
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

    const restore = resolveUnpinnedAnchorRestore({
      capturedRowIndex: anchor.rowIndex,
      nextRowIndex: nextIndex,
    });

    if (restore.kind === "measured-delta") {
      // The anchor shifted, so rows were inserted/removed above the viewport.
      // Measured-delta keeps the anchored row at the same y regardless of
      // estimate error on the changed (unmeasured) rows.
      startAboveChangeCompensation(anchor);
      return;
    }

    // measured-offset — index unchanged: the composition change is at the anchor
    // row or strictly below it. Force-measure the anchor row so its offset is
    // measured rather than estimated, then re-anchor to (measured top + captured
    // intra-row offset). When the change is purely below the viewport this
    // reproduces the captured scrollTop exactly (a no-op hold); when the anchor
    // row itself grew/shrank it holds the same visible content.
    const viewport = scrollRef.current;
    const anchorNode = viewport?.querySelector<HTMLElement>(
      `[data-index="${nextIndex}"]`,
    );
    if (anchorNode) {
      virtualizer.measureElement(anchorNode);
    }

    const offsetInfo = virtualizer.getOffsetForIndex(nextIndex, "start");
    if (!offsetInfo) return;
    notifyProgrammaticScroll(() => {
      virtualizer.scrollToOffset(offsetInfo[0] + anchor.offsetWithinRowPx);
    });
  }, [
    notifyProgrammaticScroll,
    pinnedRef,
    renderableRows,
    rows.length,
    startAboveChangeCompensation,
    virtualizer,
  ]);

  useLayoutEffect(() => {
    if (!pinnedRef.current) {
      return;
    }
    // Synchronous snap (pre-paint, no flash) + a glue loop that re-snaps until
    // the measured height settles. A freshly appended/streamed row enters at its
    // estimated height and corrects a frame later; the one-shot snap alone lands
    // against the estimate and leaves a visible jump as the measurement lands.
    scrollToBottom();
    glueToBottom();
  }, [
    bottomInsetPx,
    glueToBottom,
    isSessionBusy,
    pendingPromptText,
    pinnedRef,
    renderableRows.length,
    scrollToBottom,
    totalContentHeight,
  ]);

  useLayoutEffect(() => () => {
    const viewport = scrollRef.current;
    if (!viewport || pinnedRef.current) {
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
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
    };
  });

  useTranscriptVirtualizerBlankFallback({
    activeSessionId,
    firstVirtualItem,
    lastVirtualItem,
    lastBlankReportSignatureRef,
    measurementReady,
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
