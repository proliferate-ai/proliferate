import type { ReactNode, RefObject } from "react";
import { LoaderCircle } from "@/components/ui/icons";
import type { TranscriptVirtualRow } from "@/lib/domain/chat/transcript-virtual-rows";

export const TRANSCRIPT_TOP_PADDING_PX = 16;
export const STICKY_BOTTOM_THRESHOLD_PX = 96;
export const HISTORY_PREFETCH_TOP_THRESHOLD_PX = 480;

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

export function TranscriptHistoryLoadingRow() {
  return (
    <div className="flex justify-center pb-3 text-muted-foreground" role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading earlier messages</span>
    </div>
  );
}
