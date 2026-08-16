// Per-session reading-position persistence for the FR-2 revisit contract
// (Chat Scroll rung 6, PRO-187). When a FINALIZED session is left and later
// reopened, it must reopen at the reading position the user left it at — NOT
// bottom-pinned (only actively STREAMING sessions bottom-pin on entry, FR-2).
//
// Following FR-2 exactly, the position is stored as {rowKey, offsetWithinRowPx}
// and NEVER as raw scrollTop, so the virtualizer's row-height estimates cannot
// skew the restore: the row is resolved back to a live measured offset at
// restore time (see resolveTranscriptRestoreTargetTop). The rung-5 per-row-key
// measured-height cache (transcript-row-height-cache.ts) is what makes that
// resolution land at near-true geometry pre-first-paint, collapsing the restore
// to a single silent placement with zero motion frames.
//
// Same house pattern as transcript-row-height-cache.ts / assistant-reveal-
// progress.ts: bounded module-level state only, no localStorage. Nothing here
// survives a reload; the restore is a within-runtime revisit contract, and its
// accuracy rests on the (also in-memory) rung-5 measured heights, so persisting
// it across reload would restore against estimates and defeat FR-2's own
// "estimates cannot skew the restore" guarantee.

import type { MutableRefObject, RefObject } from "react";

// The working set of concurrently open sessions in one runtime is small; this
// caps the retained set so a very long-lived tab that visits thousands of
// sessions can't grow the map unboundedly. One tiny record per session.
const MAX_TRACKED_SESSIONS = 200;

export interface TranscriptReadingPosition {
  /** Row key of the top-visible transcript row (estimate-immune anchor). */
  rowKey: string;
  /** Pixels the reader had scrolled into that row (>= 0). */
  offsetWithinRowPx: number;
}

/**
 * How a session switch should place the viewport, produced by the row list from
 * live streaming/finalized state and any saved reading position, consumed by the
 * stick-to-bottom engine's resetForSession.
 */
export type TranscriptSessionRestorePlan =
  | { kind: "bottom" }
  | {
    kind: "restore";
    /**
     * Resolve the saved {rowKey, offsetWithinRow} to a live scrollTop against
     * the current measured geometry, or null when the saved row no longer
     * exists (the engine then falls back to bottom-pin, the conservative
     * default). Re-invoked each glued frame so a late measurement correction
     * refines the placement without a visible crawl.
     */
    resolveTargetTop: () => number | null;
  };

const readingPositionsBySession = new Map<string, TranscriptReadingPosition>();

export function recordReadingPosition(
  sessionKey: string,
  position: TranscriptReadingPosition,
): void {
  // Refresh insertion order so the bounded map behaves as a tiny LRU.
  readingPositionsBySession.delete(sessionKey);
  readingPositionsBySession.set(sessionKey, position);
  while (readingPositionsBySession.size > MAX_TRACKED_SESSIONS) {
    const oldest = readingPositionsBySession.keys().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    readingPositionsBySession.delete(oldest);
  }
}

export function getReadingPosition(sessionKey: string): TranscriptReadingPosition | null {
  return readingPositionsBySession.get(sessionKey) ?? null;
}

export function clearReadingPositionsForTests(): void {
  readingPositionsBySession.clear();
}

interface ReadingAnchorVirtualItem {
  index: number;
  start: number;
  end: number;
}

interface ReadingAnchorRow {
  kind: "history_loader" | "transcript";
  key: string | number;
}

/**
 * The reader's current position: the top-visible transcript row and how far the
 * viewport has scrolled into it. Mirrors the unpinned anchor-capture geometry
 * (use-transcript-virtual-anchor-capture.ts): the first virtual row whose end
 * reaches scrollTop is the row under the top edge. Returns null when there is no
 * transcript row under the top edge (e.g. only the history loader is visible).
 */
export function resolveTranscriptReadingAnchor(
  virtualItems: readonly ReadingAnchorVirtualItem[],
  scrollTop: number,
  renderableRows: readonly ReadingAnchorRow[],
): TranscriptReadingPosition | null {
  const firstVisible = virtualItems.find((item) => item.end >= scrollTop);
  if (!firstVisible) {
    return null;
  }
  const row = renderableRows[firstVisible.index];
  if (!row || row.kind !== "transcript" || typeof row.key !== "string") {
    return null;
  }
  return {
    rowKey: row.key,
    offsetWithinRowPx: Math.max(scrollTop - firstVisible.start, 0),
  };
}

/**
 * Invert a saved reading position back to a scrollTop against the CURRENT
 * measured geometry. `getRowStartOffset` returns the virtualizer's measured
 * start offset for a row index (rung-5 warms this to near-true on revisit), so
 * target = rowStart + offsetWithinRow places the same reading row under the top
 * edge regardless of estimate error. Returns null when the saved row is gone.
 */
export function resolveTranscriptRestoreTargetTop(
  getRowStartOffset: (index: number) => number | null,
  renderableRows: readonly ReadingAnchorRow[],
  saved: TranscriptReadingPosition,
): number | null {
  const index = renderableRows.findIndex(
    (row) => row.kind === "transcript" && row.key === saved.rowKey,
  );
  if (index < 0) {
    return null;
  }
  const start = getRowStartOffset(index);
  if (start == null || !Number.isFinite(start)) {
    return null;
  }
  return Math.max(0, start + saved.offsetWithinRowPx);
}

/**
 * FR-2 (rung 6) restore placement, factored out of the stick-to-bottom engine.
 * When the plan is a resolvable restore, unpin, place the viewport at the saved
 * anchor before first paint, and arm the frame-writer's restore anchor (so the
 * placement re-resolves as heights settle). Returns true when a restore was
 * placed; false (bottom-pin) for a streaming session, a missing plan, or a saved
 * row now gone.
 */
export function beginSessionRestorePlacement(
  plan: TranscriptSessionRestorePlan,
  deadlineMs: number,
  refs: {
    scrollRef: RefObject<HTMLDivElement | null>;
    restoreResolverRef: MutableRefObject<(() => number | null) | null>;
    restoreDeadlineRef: MutableRefObject<number>;
  },
  setPinned: (pinned: boolean) => void,
  notifyProgrammaticScroll: (write: () => void) => void,
): boolean {
  if (plan.kind !== "restore") {
    return false;
  }
  const initialTop = plan.resolveTargetTop();
  if (initialTop == null) {
    return false;
  }
  setPinned(false);
  refs.restoreResolverRef.current = plan.resolveTargetTop;
  refs.restoreDeadlineRef.current = deadlineMs;
  const viewport = refs.scrollRef.current;
  if (viewport) {
    notifyProgrammaticScroll(() => {
      viewport.scrollTop = initialTop;
    });
  }
  return true;
}
