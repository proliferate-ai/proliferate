import type { ReactNode, RefObject } from "react";
import { ChevronDown, Spinner } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";

export const TRANSCRIPT_TOP_PADDING_PX = 16;
export const STICKY_BOTTOM_THRESHOLD_PX = 96;
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
  onScrollSample: () => void;
  renderRow: (row: TranscriptVirtualRow, rowIndex: number) => ReactNode;
  columnClassName?: string;
  gutterClassName?: string;
}

export interface HistoryPrependScrollAnchor {
  cursor: number | null;
  rowCount: number;
  scrollHeight: number;
  scrollTop: number;
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
