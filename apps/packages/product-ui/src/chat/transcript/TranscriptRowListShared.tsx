import type { ReactNode, RefObject } from "react";
import { ChevronDown, Spinner } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";

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
// Visibility-resume glue loop: hold the viewport at the bottom each frame until
// measured scrollHeight is stable for this many consecutive frames, capped at
// GLUE_MAX_FRAMES, so a suspended-then-resumed measurement backlog collapses
// into one jump instead of a visible crawl.
export const GLUE_STABLE_FRAMES = 3;
export const GLUE_MAX_FRAMES = 12;
export const HISTORY_PREFETCH_TOP_THRESHOLD_PX = 480;
export const HISTORY_LOADING_ROW_KEY = "history-loader";
export const DEFAULT_CHAT_COLUMN_CLASSNAME = "mx-auto w-full max-w-3xl";
export const DEFAULT_CHAT_SURFACE_GUTTER_CLASSNAME = "px-4";

const ESTIMATED_TURN_HEIGHT_PX = 360;
const ESTIMATED_HISTORY_LOADING_ROW_HEIGHT_PX = 32;

export interface TranscriptRowListBaseProps {
  rows: readonly TranscriptVirtualRow[];
  selectionRootRef: RefObject<HTMLDivElement | null>;
  hasOlderHistory: boolean;
  isLoadingOlderHistory: boolean;
  olderHistoryCursor: number | null;
  bottomInsetPx: number;
  selectedWorkspaceId: string | null;
  activeSessionId: string;
  isSessionBusy: boolean;
  pendingPromptText: string | null;
  onLoadOlderHistory: () => void;
  onScrollSample: (sample?: import("./useTranscriptStickToBottom").TranscriptScrollSample) => void;
  renderRow: (row: TranscriptVirtualRow, rowIndex: number) => ReactNode;
  columnClassName?: string;
  gutterClassName?: string;
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
  return row?.kind === "history_loader"
    ? ESTIMATED_HISTORY_LOADING_ROW_HEIGHT_PX
    : ESTIMATED_TURN_HEIGHT_PX;
}

export function TranscriptScrollToBottomButton({
  visible,
  bottomInsetPx,
  onClick,
}: {
  visible: boolean;
  bottomInsetPx: number;
  onClick: () => void;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex justify-center"
      style={{ bottom: bottomInsetPx + 12 }}
    >
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        aria-label="Scroll to bottom"
        aria-hidden={!visible}
        tabIndex={visible ? 0 : -1}
        data-chat-transcript-ignore
        onClick={onClick}
        className={`text-muted-foreground shadow-md transition-[opacity,transform,color] duration-200 hover:text-foreground ${
          visible
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "translate-y-1 opacity-0"
        }`}
      >
        <ChevronDown className="size-4" />
      </Button>
    </div>
  );
}

export function TranscriptHistoryLoadingRow() {
  return (
    <div className="flex justify-center pb-3 text-muted-foreground" role="status">
      <Spinner className="size-4" />
      <span className="sr-only">Loading earlier messages</span>
    </div>
  );
}
