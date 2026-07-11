import type { RefObject } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import {
  DEFAULT_CHAT_COLUMN_CLASSNAME,
  DEFAULT_CHAT_SURFACE_GUTTER_CLASSNAME,
  TranscriptHistoryLoadingRow,
  type TranscriptRenderableRow,
  type TranscriptRowListBaseProps,
} from "./TranscriptRowListShared";
import {
  MemoizedVirtualTranscriptRow,
} from "./VirtualTranscriptRow";
import type { TranscriptVirtualizationMode } from "@proliferate/product-domain/chats/transcript/transcript-virtualization-config";

export function VirtualTranscriptViewport({
  bottomSpacerHeight,
  nonDisplacingBottomInsetPx,
  contentRef,
  measureElement,
  onViewportScroll,
  renderableRows,
  renderRow,
  scrollRef,
  selectionRootRef,
  topSpacerHeight,
  virtualItems,
  virtualizationMode,
  columnClassName = DEFAULT_CHAT_COLUMN_CLASSNAME,
  gutterClassName = DEFAULT_CHAT_SURFACE_GUTTER_CLASSNAME,
}: {
  bottomSpacerHeight: number;
  nonDisplacingBottomInsetPx: number;
  columnClassName?: string;
  contentRef?: RefObject<HTMLDivElement | null>;
  gutterClassName?: string;
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
      contentClassName={`${gutterClassName} relative flex min-h-full flex-col`}
    >
      <div
        ref={contentRef}
        className="mt-auto"
        data-transcript-virtualization-mode="virtual"
        data-transcript-virtualization-setting={virtualizationMode}
      >
        <div
          ref={selectionRootRef}
          data-chat-transcript-root="true"
          tabIndex={-1}
          className={`${columnClassName} select-none outline-none [--text-chat:var(--text-message)] [--text-chat--line-height:var(--text-message--line-height)] [--text-chat-meta:calc(var(--text-chat)_-_2px)]`}
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
      {nonDisplacingBottomInsetPx > 0 && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-full"
          data-transcript-bottom-overlay-inset
          style={{ height: nonDisplacingBottomInsetPx }}
        />
      )}
    </AutoHideScrollArea>
  );
}
