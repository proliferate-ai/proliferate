import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { ContentHeightScrollAnchor } from "#product/hooks/chat/ui/transcript-row-list-model";
import type { TranscriptFramePipeline } from "#product/hooks/chat/ui/transcript-frame-pipeline";
import type { TranscriptRestoreResolution } from "#product/hooks/chat/ui/transcript-reading-position-store";

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
  /**
   * FR-2 restore (rung 6): while unpinned on a finalized-session revisit, this
   * resolves the saved reading anchor to a scrollTop (or null when the saved
   * row is gone). The single frame writer re-applies it each glued frame so the
   * reading row stays put as freshly-mounted rows correct their heights, until
   * the deadline below lapses.
   */
  restoreResolverRef: RefObject<((viewport: HTMLElement) => TranscriptRestoreResolution | null) | null>;
  /** Deadline (interactionNow ms) past which the restore anchor is released. */
  restoreDeadlineRef: RefObject<number>;
  /** Snap to the active follow target (the pinned write). */
  scrollToBottom: () => void;
  /** Wrap a scrollTop write so its event is excluded from pin/direction. */
  notifyProgrammaticScroll: (write: () => void) => void;
  /** Clear all ownership markers (on unmount). */
  clearAllMarkers: () => void;
  /** Start a forced-glue window (used by the tab/window resume path here). */
  beginGlue: () => void;
  /**
   * Founder Ruling 3 (rung 10, PRO-187): fires when a restore's deadline lapses
   * having NEVER once resolved through the estimate-immune mounted-row path —
   * the saved row never mounted within the deadline, so the coarse index-sum
   * estimate (which can be arbitrarily wrong) would otherwise strand the
   * reader at a frozen, unproven scrollTop. The engine wires this to bottom-pin
   * (the conservative FR-2 default) instead of leaving the viewport there.
   */
  onRestoreStranded: () => void;
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
  restoreResolverRef,
  restoreDeadlineRef,
  scrollToBottom,
  notifyProgrammaticScroll,
  clearAllMarkers,
  beginGlue,
  onRestoreStranded,
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

  // Founder Ruling 3 (rung 10): whether the CURRENT restore resolver has ever
  // resolved through the estimate-immune mounted-row path. Keyed by resolver
  // identity so a fresh restore (a new session switch installs a new resolver
  // function) starts unproven again.
  const restoreMountedTrackingRef = useRef<{
    resolver: ((viewport: HTMLElement) => TranscriptRestoreResolution | null) | null;
    everMounted: boolean;
  }>({ resolver: null, everMounted: false });

  const runFramePass = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return;
    }
    if (pinnedRef.current) {
      scrollToBottom();
      return;
    }
    // FR-2 restore (rung 6): re-resolve the saved reading anchor to scrollTop
    // each frame until the deadline, so the reading row holds under the top edge
    // as freshly-mounted rows settle their heights. Writing the resolved target
    // directly (clamped reachable) keeps the placement estimate-immune and, with
    // rung-5's warmed heights, stable frame-to-frame (zero visible motion).
    const restore = restoreResolverRef.current;
    if (restore) {
      const tracking = restoreMountedTrackingRef.current;
      if (tracking.resolver !== restore) {
        tracking.resolver = restore;
        tracking.everMounted = false;
      }
      const restoreNow = typeof performance === "undefined" ? Date.now() : performance.now();
      if (restoreNow >= restoreDeadlineRef.current) {
        restoreResolverRef.current = null;
        // Founder Ruling 3 (rung 10): the deadline lapsed without the saved row
        // ever mounting, so every placement this window rested on the coarse
        // index-sum estimate — never proven against the row's real geometry.
        // Freezing scrollTop there would strand the reader at an unverified
        // position (the theoretical never-mounting-saved-row strand rung 6
        // left open); bottom-pin instead, the same conservative default a
        // vanished saved row already falls back to.
        if (!tracking.everMounted) {
          onRestoreStranded();
        }
      } else {
        const resolved = restore(viewport);
        if (resolved == null) {
          restoreResolverRef.current = null;
        } else {
          if (resolved.mounted) {
            tracking.everMounted = true;
          }
          const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
          // Only place when the saved anchor's scrollTop is actually reachable.
          // Once the anchor row is mounted the resolver returns an estimate-immune
          // target derived from its real rendered position, which is always within
          // the current content, so this holds. When the row is NOT yet mounted
          // the resolver falls back to the coarse index-sum estimate, which can
          // exceed the freshly-switched content's not-yet-measured max height;
          // writing it then would paint a clamped intermediate (a visible extra
          // frame). Waiting a frame instead lets the content measure taller (and
          // the carried-over scroll position keeps the anchor row in the render
          // window so the estimate-immune path takes over), so the restore lands
          // in a single instant cut with zero intermediate motion.
          if (resolved.top <= maxTop + 1) {
            notifyProgrammaticScroll(() => {
              viewport.scrollTop = resolved.top;
            });
          }
        }
        return;
      }
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
    // Where the reading row already belongs, computed against the max observed
    // SO FAR (before this pass folds in any new growth). The reader is DISPLACED
    // above it when scrollTop sits below that seat — which is NOT the settled
    // state: it means the browser clamped scrollTop DOWN during a transient
    // measured-swap content dip (on webkit the real, taller heights can land a
    // beat AFTER the estimate briefly shrinks the total), and the forward
    // re-raise below has not run against the recovered height yet.
    const seatedTarget = anchor.scrollTop + (floor.maxScrollHeight - anchor.scrollHeight);
    const displacedAboveTarget = seatedTarget - viewport.scrollTop > 1;
    // eslint-disable-next-line no-console -- TEMP r10-diag, removed before merge.
    console.error("[r10-diag] runFramePass-compensation", {
      now,
      deadline: compensationDeadlineRef.current,
      anchorScrollTop: anchor.scrollTop,
      anchorScrollHeight: anchor.scrollHeight,
      floorMaxScrollHeight: floor.maxScrollHeight,
      liveScrollHeight: viewport.scrollHeight,
      seatedTarget,
      currentScrollTop: viewport.scrollTop,
    });
    if (now >= compensationDeadlineRef.current) {
      // Release the anchor once the growth deadline lapses — UNLESS the reader
      // is still displaced above the already-established seat. On a slow
      // runner a late downward clamp can land in the same window the growth
      // deadline lapses; releasing silently then strands the reader near the
      // freshly-prepended top (CI webkit prepend "scrollTop Received 0"). Emit
      // one last forward-only corrective write against the established floor
      // BEFORE releasing, whether or not we are still within the absolute
      // ceiling, so a late dip can never leave the reader displaced merely
      // because the window closed on the same tick that observed it.
      if (displacedAboveTarget) {
        notifyProgrammaticScroll(() => {
          if (seatedTarget > viewport.scrollTop) {
            viewport.scrollTop = seatedTarget;
          }
        });
      }
      compensationAnchorRef.current = null;
      return;
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
    restoreResolverRef,
    restoreDeadlineRef,
    notifyProgrammaticScroll,
    onRestoreStranded,
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
        // above-change compensation anchor or an FR-2 restore anchor. Either way
        // the user reclaiming control (unpin with no anchor) ends the window.
        return (
          pinnedRef.current
          || compensationAnchorRef.current != null
          || restoreResolverRef.current != null
        );
      },
    });
  }, [
    compensationAnchorRef,
    restoreResolverRef,
    pinnedRef,
    pipelineRef,
    runFramePass,
    scrollRef,
  ]);

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
