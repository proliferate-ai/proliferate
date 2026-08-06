import type { ReactNode, RefObject } from "react";
import type { TranscriptVirtualRow } from "#product/domain/chats/transcript/transcript-virtual-rows";
import type { ChatTranscriptScrollHandle } from "#product/hooks/chat/ui/chat-transcript-view-types";

/** Classification of a viewport scroll event and whether input intent proved user ownership. */
export interface TranscriptScrollSample {
  programmatic: boolean;
  userInitiated?: true;
}

export const TRANSCRIPT_TOP_PADDING_PX = 16;
// Stick-to-bottom engine tuning (see useTranscriptStickToBottom).
// A user scroll re-pins only within this tight band of the true bottom. The
// legacy 96px "sticky window" was retired: it kept a small upward scroll
// "pinned" and let the next streaming snap fight the user back to the bottom.
export const REPIN_BOTTOM_THRESHOLD_PX = 24;
// A programmatic snap's resulting scroll event is recognized (and excluded from
// pin/direction tracking) when scrollTop lands within this tolerance of the
// value we wrote — absorbs subpixel scrollHeight and clamp slop.
export const PROGRAMMATIC_MATCH_TOL_PX = 2;
// Ignore subpixel scroll jitter when classifying user scroll direction.
export const DIRECTION_EPSILON_PX = 1;
// Minimum overflow (scrollHeight - clientHeight) for the viewport to count as
// scrollable. The pre-emptive intent-to-leave listeners must not unpin when the
// content fits in the viewport: such a gesture produces no scroll event, so
// nothing would re-pin and the scroll-to-bottom button would wrongly show while
// already at the bottom.
export const SCROLLABLE_OVERFLOW_EPSILON_PX = 1;
// User input and the rendering gate share one expiry so a late native or
// virtualizer correction cannot re-open a gate after the proven intent ended.
export const TRANSCRIPT_USER_SCROLL_SETTLE_MS = 150;
// Visibility-resume glue loop: hold the viewport at the bottom each frame until
// measured scrollHeight is stable for this many consecutive frames, capped at
// GLUE_MAX_FRAMES, so a suspended-then-resumed measurement backlog collapses
// into one jump instead of a visible crawl.
export const GLUE_STABLE_FRAMES = 3;
export const GLUE_MAX_FRAMES = 12;
export const HISTORY_PREFETCH_TOP_THRESHOLD_PX = 480;
export const HISTORY_LOADING_ROW_KEY = "history-loader";
const ESTIMATED_TURN_HEIGHT_PX = 360;
const ESTIMATED_HISTORY_LOADING_ROW_HEIGHT_PX = 32;
// Goal lifecycle rows are quiet single-line system rows, not turn content —
// a much smaller virtualization estimate than the generic turn fallback.
const ESTIMATED_GOAL_EVENT_ROW_HEIGHT_PX = 28;

export interface TranscriptRowListBaseProps {
  rows: readonly TranscriptVirtualRow[];
  selectionRootRef: RefObject<HTMLDivElement | null>;
  hasOlderHistory: boolean;
  isLoadingOlderHistory: boolean;
  olderHistoryCursor: number | null;
  bottomInsetPx: number;
  nonDisplacingBottomInsetPx?: number;
  selectedWorkspaceId: string | null;
  activeSessionId: string;
  isSessionBusy: boolean;
  pendingPromptText: string | null;
  onLoadOlderHistory: () => void;
  onScrollSample: (sample?: TranscriptScrollSample) => void;
  renderRow: (row: TranscriptVirtualRow, rowIndex: number) => ReactNode;
  getRowRenderRevision?: (row: TranscriptVirtualRow) => unknown;
  columnClassName?: string;
  gutterClassName?: string;
  scrollHandleRef?: RefObject<ChatTranscriptScrollHandle | null>;
}

export function resolveTranscriptBottomInsets(
  bottomInsetPx: number,
  nonDisplacingBottomInsetPx: number,
): { structural: number; nonDisplacing: number } {
  const total = Math.max(0, bottomInsetPx);
  const nonDisplacing = Math.min(total, Math.max(0, nonDisplacingBottomInsetPx));
  return {
    structural: total - nonDisplacing,
    nonDisplacing,
  };
}

// Preserves the user's read position across a content-height change above the
// viewport using measured DOM deltas (immune to virtualizer estimate error):
// after the change, scrollTop = scrollTop + (newScrollHeight - scrollHeight).
export interface ContentHeightScrollAnchor {
  rowCount: number;
  scrollHeight: number;
  scrollTop: number;
}

export interface HistoryPrependScrollAnchor extends ContentHeightScrollAnchor {
  cursor: number | null;
}

export type TranscriptRenderableRow =
  | {
    kind: "history_loader";
    key: typeof HISTORY_LOADING_ROW_KEY;
  }
  | {
    kind: "transcript";
    key: TranscriptVirtualRow["key"];
    row: TranscriptVirtualRow;
    rowIndex: number;
  };

export type HistoryPrefetchTrigger = "scroll" | "settled";
export type HistoryPrefetchDecisionReason =
  | "below_threshold"
  | "blocked"
  | "requested";

interface HistoryPrefetchDecisionLogInput {
  component: "full" | "virtual";
  trigger: HistoryPrefetchTrigger;
  reason: HistoryPrefetchDecisionReason;
  sessionId: string;
  workspaceId: string | null;
  cursor: number | null;
  lastRequestedCursor: number | null;
  hasOlderHistory: boolean;
  isLoadingOlderHistory: boolean;
  pendingAnchor: HistoryPrependScrollAnchor | null;
  rowCount: number;
  viewport: HTMLDivElement;
  renderableRowCount?: number;
  virtualItemCount?: number;
  totalContentHeight?: number;
}

interface PrefetchDecisionSignatureRef {
  current: string | null;
}

export function logHistoryPrefetchDecisionOnce(
  input: HistoryPrefetchDecisionLogInput,
  lastSignatureRef: PrefetchDecisionSignatureRef,
) {
  const includeScrollMetrics = input.reason === "requested";
  const signature = [
    input.trigger,
    input.reason,
    input.cursor,
    input.lastRequestedCursor,
    input.isLoadingOlderHistory,
    input.hasOlderHistory,
    input.pendingAnchor?.cursor ?? "none",
    input.rowCount,
    input.renderableRowCount ?? "none",
    includeScrollMetrics ? Math.round(input.viewport.scrollTop) : "any-scroll",
    includeScrollMetrics ? Math.round(input.viewport.scrollHeight) : "any-height",
  ].join(":");
  if (lastSignatureRef.current === signature) {
    return;
  }
  lastSignatureRef.current = signature;
}

export function buildRenderableRows(
  rows: readonly TranscriptVirtualRow[],
  isLoadingOlderHistory: boolean,
): TranscriptRenderableRow[] {
  const renderableRows: TranscriptRenderableRow[] = [];
  if (isLoadingOlderHistory) {
    renderableRows.push({
      kind: "history_loader",
      key: HISTORY_LOADING_ROW_KEY,
    });
  }
  rows.forEach((row, rowIndex) => {
    renderableRows.push({
      kind: "transcript",
      key: row.key,
      row,
      rowIndex,
    });
  });
  return renderableRows;
}

export function estimateRenderableRowsHeight(
  rows: readonly TranscriptRenderableRow[],
): number {
  return rows.reduce(
    (sum, row) => sum + estimateRenderableRowHeight(row),
    0,
  );
}

export function estimateRenderableRowHeight(
  row: TranscriptRenderableRow | undefined,
): number {
  if (row?.kind === "history_loader") {
    return ESTIMATED_HISTORY_LOADING_ROW_HEIGHT_PX;
  }
  if (row?.kind === "transcript" && row.row.kind === "goal_event") {
    return ESTIMATED_GOAL_EVENT_ROW_HEIGHT_PX;
  }
  return ESTIMATED_TURN_HEIGHT_PX;
}
