import { memo, type ReactNode } from "react";
import type { TranscriptVirtualRow as TranscriptVirtualRowModel } from "@proliferate/product-model/chats/transcript/transcript-virtual-rows";

export type TranscriptVirtualRowRenderer = (
  row: TranscriptVirtualRowModel,
  rowIndex: number,
) => ReactNode;

export const MemoizedVirtualTranscriptRow = memo(function MemoizedVirtualTranscriptRow({
  row,
  rowIndex,
  virtualIndex,
  renderRow,
  measureElement,
}: {
  row: TranscriptVirtualRowModel;
  rowIndex: number;
  virtualIndex: number;
  renderRow: TranscriptVirtualRowRenderer;
  measureElement: (element: Element | null) => void;
}) {
  return (
    <div
      ref={measureElement}
      data-transcript-virtual-row="true"
      data-index={virtualIndex}
      className="w-full"
    >
      {renderRow(row, rowIndex)}
    </div>
  );
}, (prev, next) =>
  prev.row === next.row
  && prev.rowIndex === next.rowIndex
  && prev.virtualIndex === next.virtualIndex
  && prev.renderRow === next.renderRow
  && prev.measureElement === next.measureElement
);
