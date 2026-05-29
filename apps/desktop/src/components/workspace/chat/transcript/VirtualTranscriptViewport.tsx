import type { RefObject } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "@/config/chat-layout";
import {
  TranscriptHistoryLoadingRow,
  type TranscriptRenderableRow,
  type TranscriptRowListBaseProps,
} from "@/components/workspace/chat/transcript/TranscriptRowListShared";
import {
  MemoizedVirtualTranscriptRow,
} from "@/components/workspace/chat/transcript/VirtualTranscriptRow";
import type { TranscriptVirtualizationMode } from "@proliferate/product-domain/chats/transcript/transcript-virtualization-config";

export function VirtualTranscriptViewport({
  bottomSpacerHeight,
  measureElement,
  onViewportScroll,
  renderableRows,
  renderRow,
  scrollRef,
  selectionRootRef,
  topSpacerHeight,
  virtualItems,
  virtualizationMode,
}: {
  bottomSpacerHeight: number;
  measureElement: (element: Element | null) => void;
  onViewportScroll: (viewport: HTMLDivElement) => void;
  renderableRows: readonly TranscriptRenderableRow[];
  renderRow: TranscriptRowListBaseProps["renderRow"];
  scrollRef: RefObject<HTMLDivElement | null>;
  selectionRootRef: TranscriptRowListBaseProps["selectionRootRef"];
  topSpacerHeight: number;
  virtualItems: readonly VirtualItem[];
  virtualizationMode: TranscriptVirtualizationMode;
}) {
  return (
    <AutoHideScrollArea
      className="h-full"
      ref={scrollRef}
      onViewportScroll={onViewportScroll}
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
                  ref={measureElement}
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
              <MemoizedVirtualTranscriptRow
                key={row.key}
                row={row}
                rowIndex={renderableRow.rowIndex}
                virtualIndex={virtualRow.index}
                renderRow={renderRow}
                measureElement={measureElement}
              />
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
