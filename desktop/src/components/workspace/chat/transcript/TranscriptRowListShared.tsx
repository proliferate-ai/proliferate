import type { ReactNode, RefObject } from "react";
import { LoaderCircle } from "@/components/ui/icons";
import type { TranscriptVirtualRow } from "@/lib/domain/chat/transcript/transcript-virtual-rows";
import { logLatency } from "@/lib/infra/measurement/debug-latency";

export const TRANSCRIPT_TOP_PADDING_PX = 16;
export const STICKY_BOTTOM_THRESHOLD_PX = 96;
export const HISTORY_PREFETCH_TOP_THRESHOLD_PX = 480;
export const HISTORY_LOADING_ROW_KEY = "history-loader";

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

  logLatency("session.history.older_chunk.prefetch_decision", {
    component: input.component,
    trigger: input.trigger,
    reason: input.reason,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    cursor: input.cursor,
    lastRequestedCursor: input.lastRequestedCursor,
    hasOlderHistory: input.hasOlderHistory,
    isLoadingOlderHistory: input.isLoadingOlderHistory,
    pendingAnchorCursor: input.pendingAnchor?.cursor ?? null,
    pendingAnchorRowCount: input.pendingAnchor?.rowCount ?? null,
    rowCount: input.rowCount,
    renderableRowCount: input.renderableRowCount,
    virtualItemCount: input.virtualItemCount,
    scrollTop: Math.round(input.viewport.scrollTop),
    clientHeight: input.viewport.clientHeight,
    scrollHeight: input.viewport.scrollHeight,
    totalContentHeight: input.totalContentHeight,
    thresholdPx: HISTORY_PREFETCH_TOP_THRESHOLD_PX,
  });
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

export function TranscriptHistoryLoadingRow() {
  return (
    <div className="flex justify-center pb-3 text-muted-foreground" role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading earlier messages</span>
    </div>
  );
}
