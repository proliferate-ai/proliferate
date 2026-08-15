import { useLayoutEffect, type RefObject } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type {
  ContentHeightScrollAnchor,
  TranscriptRenderableRow,
} from "#product/hooks/chat/ui/transcript-row-list-model";
import type { TranscriptVirtualScrollAnchor } from "#product/hooks/chat/ui/use-transcript-virtual-anchor-capture";

export interface UseTranscriptCompletedTurnAnchorOptions {
  /** Anchor captured before the last commit, consumed here exactly once. */
  pendingAnchorRef: RefObject<TranscriptVirtualScrollAnchor | null>;
  /** Live pin state; a pinned viewport follows the bottom and needs no restore. */
  pinnedRef: RefObject<boolean>;
  renderableRows: TranscriptRenderableRow[];
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  notifyProgrammaticScroll: (write: () => void) => void;
  startAboveChangeCompensation: (anchor: ContentHeightScrollAnchor) => void;
}

/**
 * Hold the reader's position across a completing turn while unpinned. A finishing
 * turn can split one row into completed-history + content — a new, unmeasured
 * row inserted ABOVE the anchored row. The getOffsetForIndex + offsetWithinRowPx
 * restore lands against the virtualizer's estimate and bumps when measurement
 * corrects; when rows were inserted above the anchor, hold the position with the
 * measured scrollHeight delta instead. Pure shifts and below-the-viewport
 * appends keep the offset reposition / no-op.
 */
export function useTranscriptCompletedTurnAnchor({
  pendingAnchorRef,
  pinnedRef,
  renderableRows,
  virtualizer,
  notifyProgrammaticScroll,
  startAboveChangeCompensation,
}: UseTranscriptCompletedTurnAnchorOptions): void {
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

    if (nextIndex > anchor.rowIndex) {
      startAboveChangeCompensation(anchor);
      return;
    }

    const offsetInfo = virtualizer.getOffsetForIndex(nextIndex, "start");
    if (!offsetInfo) return;
    notifyProgrammaticScroll(() => {
      virtualizer.scrollToOffset(offsetInfo[0] + anchor.offsetWithinRowPx);
    });
  }, [
    notifyProgrammaticScroll,
    pendingAnchorRef,
    pinnedRef,
    renderableRows,
    startAboveChangeCompensation,
    virtualizer,
  ]);
}
