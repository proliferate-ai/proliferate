import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { ContentHeightScrollAnchor } from "#product/hooks/chat/ui/transcript-row-list-model";
import type { TranscriptFramePipeline } from "#product/hooks/chat/ui/transcript-frame-pipeline";

// While an above-change compensation anchor is live, each estimate-to-measured
// correction of a freshly-prepended older row grows the total above the reader
// and must be absorbed into scrollTop. On a slow/CPU-throttled runner those
// corrections do not all land inside the fixed initial deadline
// (ABOVE_CHANGE_COMPENSATION_MAX_MS in use-transcript-stick-to-bottom.ts) — they
// trickle in over a second or more, spaced out by hundreds of ms. So instead of
// letting the initial deadline end the window while corrections are still
// arriving, extend it by this quiet window every time a fresh growth is observed
// (see runFramePass). The window therefore stays open as long as the prepended
// rows keep correcting taller, and closes only once they go quiet — the fix for
// the r5 prepend under-compensation (chromium scrollTop 120 vs > 150 / delta 528
// vs > 576 on the throttled runner, and the severe near-top landing).
const ABOVE_CHANGE_COMPENSATION_QUIET_EXTENSION_MS = 1_000;
// Absolute ceiling on the extended window, measured from the anchor's first
// frame pass, so a pathological never-quiet growth source can never hold the
// reader anchored forever and later below-the-viewport growth is eventually free
// to move it again.
const ABOVE_CHANGE_COMPENSATION_ABSOLUTE_MAX_MS = 3_000;

export interface UseTranscriptFramePipelineLifecycleOptions {
  /** The single owned per-frame pipeline instance (stable ref). */
  pipelineRef: RefObject<TranscriptFramePipeline>;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Live pin state. */
  pinnedRef: RefObject<boolean>;
  /** Active above-change compensation anchor, applied while unpinned + within deadline. */
  compensationAnchorRef: RefObject<ContentHeightScrollAnchor | null>;
  /**
   * Deadline (interactionNow ms) past which the compensation anchor is stale.
   * The single frame pass compensates every measurement correction that arrives
   * before it — whether the eager glue window is still open or a later, isolated
   * ResizeObserver growth drives the pass — and clears the anchor once the
   * deadline passes so ordinary below-the-viewport growth can move the reader.
   */
  compensationDeadlineRef: RefObject<number>;
  /** Snap to the active follow target (the pinned write). */
  scrollToBottom: () => void;
  /** Wrap a scrollTop write so its event is excluded from pin/direction. */
  notifyProgrammaticScroll: (write: () => void) => void;
  /** Clear all ownership markers (on unmount). */
  clearAllMarkers: () => void;
  /** Start a forced-glue window (used by the tab/window resume path here). */
  beginGlue: () => void;
}

/**
 * Wire the frame pipeline's single writer and its lifecycle. The writer is the
 * one snap/compensation pass the pipeline drives each frame: snap to the follow
 * target while pinned; apply the above-change compensation delta while unpinned
 * with a live anchor (until its deadline lapses); otherwise do nothing. Every
 * write still flows through
 * the rung-3 ownership markers (WHO wrote) — the pipeline owns only WHEN.
 *
 * Also owns the tab/window resume glue (re-show while pinned collapses the
 * suspended-then-resumed measurement backlog into one jump) and disposal.
 */
export function useTranscriptFramePipelineLifecycle({
  pipelineRef,
  scrollRef,
  pinnedRef,
  compensationAnchorRef,
  compensationDeadlineRef,
  scrollToBottom,
  notifyProgrammaticScroll,
  clearAllMarkers,
  beginGlue,
}: UseTranscriptFramePipelineLifecycleOptions): void {
  // Running maximum of the viewport's reported total content height within the
  // CURRENT compensation anchor's window, so the compensation delta can be
  // clamped monotonic (see runFramePass). Keyed by anchor identity: a fresh
  // anchor (each prepend installs a new object) resets the floor to that
  // anchor's captured pre-prepend total.
  const compensationTotalFloorRef = useRef<{
    anchor: ContentHeightScrollAnchor | null;
    maxScrollHeight: number;
    // Hard ceiling (interactionNow ms) for the extended window of THIS anchor.
    absoluteDeadline: number;
  }>({ anchor: null, maxScrollHeight: 0, absoluteDeadline: 0 });

  const runFramePass = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return;
    }
    if (pinnedRef.current) {
      scrollToBottom();
      return;
    }
    const anchor = compensationAnchorRef.current;
    if (!anchor) {
      return;
    }
    // Compensate every measurement correction until the deadline, whichever pass
    // (eager glue tick or a later isolated ResizeObserver growth) drives it. The
    // freshly-mounted older rows keep correcting their estimated heights taller
    // for several frames after a prepend — more, and more spread out, on a slow
    // runner — often past the forced-glue window's quiet-frame end. Gating on the
    // deadline instead of `isGluing` keeps this single writer absorbing the full
    // added-above height so the reading row stays fixed on every engine.
    const now = typeof performance === "undefined" ? Date.now() : performance.now();
    if (now >= compensationDeadlineRef.current) {
      compensationAnchorRef.current = null;
      return;
    }
    // Rung 5: composition-derived estimates plus the write-through
    // measured-height cache make the virtualizer's reported total scrollHeight
    // move NON-MONOTONICALLY while the freshly-prepended older rows correct from
    // estimate to measured over the throttled settle. A transient dip in that
    // total — below the anchor's pre-prepend height, or below a height already
    // observed this window — would shrink the compensation delta and jump the
    // reader UP toward the newly prepended top (the r5 chromium regression:
    // scrollTop 120 vs > 150). Clamp the effective total to its running maximum
    // within this anchor's window, so the delta is monotonic non-decreasing and
    // never negative and the reading row never travels backward as the estimate
    // churns. The real added-above height only ever grows toward its measured
    // truth here (the older rows correct taller), so the running max converges
    // on the correct compensation without over-shooting.
    const floor = compensationTotalFloorRef.current;
    if (floor.anchor !== anchor) {
      floor.anchor = anchor;
      floor.maxScrollHeight = anchor.scrollHeight;
      floor.absoluteDeadline = now + ABOVE_CHANGE_COMPENSATION_ABSOLUTE_MAX_MS;
    }
    // A fresh above-anchor growth this pass is a late estimate-to-measured
    // correction still arriving; keep the compensation window open past the
    // initial deadline (bounded by the absolute ceiling) so every such
    // correction is absorbed even when a throttled runner spreads them out well
    // beyond the fixed initial window. Without this the deadline lapses after a
    // couple of frame passes and the remaining, still-arriving corrections jump
    // the reader up toward the newly prepended top (r5 prepend under-compensation).
    if (viewport.scrollHeight > floor.maxScrollHeight) {
      floor.maxScrollHeight = viewport.scrollHeight;
      compensationDeadlineRef.current = Math.min(
        now + ABOVE_CHANGE_COMPENSATION_QUIET_EXTENSION_MS,
        floor.absoluteDeadline,
      );
    }
    const effectiveScrollHeight = floor.maxScrollHeight;
    const target = anchor.scrollTop + (effectiveScrollHeight - anchor.scrollHeight);
    notifyProgrammaticScroll(() => {
      // Above-change compensation only ever absorbs growth ABOVE the reader, so
      // the anchored scrollTop moves DOWN (increases) or holds as those rows
      // measure taller; it must never travel back UP toward the freshly inserted
      // top. On webkit the rung-5 measured-height swap can momentarily report the
      // total at (or below) its pre-insert value between the anchor install and
      // the real-height delivery; a frame pass sampled during that dip computes a
      // ~0 delta and, without this forward clamp, jumps the reader to scrollTop 0
      // (the r5 CI webkit prepend regression: scrollTop Received 0 while the
      // content had already grown). Clamp forward so the correct initial anchor
      // placement is only ever raised further, never undone.
      if (target > viewport.scrollTop) {
        viewport.scrollTop = target;
      }
    });
  }, [
    compensationAnchorRef,
    compensationDeadlineRef,
    notifyProgrammaticScroll,
    pinnedRef,
    scrollRef,
    scrollToBottom,
  ]);

  useLayoutEffect(() => {
    const pipeline = pipelineRef.current;
    pipeline.setWriter({
      runFramePass,
      measureContentHeight: () => scrollRef.current?.scrollHeight ?? -1,
      shouldContinueGlue: () => {
        const viewport = scrollRef.current;
        if (!viewport) {
          return false;
        }
        // A pinned burst glues to the bottom; an unpinned burst glues an active
        // above-change compensation anchor. Either way the user reclaiming
        // control (unpin with no anchor) ends the window.
        return pinnedRef.current || compensationAnchorRef.current != null;
      },
    });
  }, [compensationAnchorRef, pinnedRef, pipelineRef, runFramePass, scrollRef]);

  // On tab/window re-show while pinned, glue to the bottom for a few frames so
  // the suspended-then-resumed measurement backlog lands as one jump. Listen to
  // both visibilitychange and focus (WKWebView may fire only the latter).
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !pinnedRef.current) {
        return;
      }
      beginGlue();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      pipelineRef.current.cancel();
    };
  }, [beginGlue, pinnedRef, pipelineRef]);

  useEffect(() => {
    const pipeline = pipelineRef.current;
    return () => {
      clearAllMarkers();
      pipeline.dispose();
    };
  }, [clearAllMarkers, pipelineRef]);
}
