import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { ContentHeightScrollAnchor } from "#product/hooks/chat/ui/transcript-row-list-model";
import type {
  TranscriptFramePassOutcome,
  TranscriptFramePipeline,
} from "#product/hooks/chat/ui/transcript-frame-pipeline";
import type { TranscriptRestoreResolution } from "#product/hooks/chat/ui/transcript-reading-position-store";
import { resolveEasedFollowStep } from "#product/hooks/chat/ui/transcript-eased-follow";

// Each fresh measured-height growth extends prepend compensation by one quiet
// window so throttled corrections remain anchored after the initial deadline.
const ABOVE_CHANGE_COMPENSATION_QUIET_EXTENSION_MS = 1_000;
// A pathological never-quiet source must still release the reader.
const ABOVE_CHANGE_COMPENSATION_ABSOLUTE_MAX_MS = 3_000;

export interface UseTranscriptFramePipelineLifecycleOptions {
  /** The single owned per-frame pipeline instance (stable ref). */
  pipelineRef: RefObject<TranscriptFramePipeline>;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Live pin state. */
  pinnedRef: RefObject<boolean>;
  /** Active above-change compensation anchor, including any owed seat acknowledgment. */
  compensationAnchorRef: RefObject<ContentHeightScrollAnchor | null>;
  /**
   * Growth deadline (interactionNow ms). A displaced seat retains ownership
   * after this deadline until a later pass acknowledges it or the absolute cap.
   */
  compensationDeadlineRef: RefObject<number>;
  /** Lifecycle-owned absolute ceiling, keyed to the active anchor. */
  compensationAbsoluteDeadlineRef: RefObject<{
    anchor: ContentHeightScrollAnchor | null;
    deadline: number;
  }>;
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
  /**
   * PRO-168 (rung 12, Q16): flag-gated eased-follow motion writer. Default
   * OFF, resolved once at mount by the caller from the
   * `proliferate:transcriptEasedFollow` flag. False keeps the pinned branch
   * calling `scrollToBottom` exactly as before (byte-identical instant glue);
   * true routes it through `resolveFollowTargetTop` and the eased step below
   * instead, without touching classification (FR-1) — every write still
   * flows through `notifyProgrammaticScroll`.
   */
  easedFollowEnabled: boolean;
  /**
   * The same follow-target derivation `scrollToBottom` uses internally
   * (dock inset plus consumed-overlay state), exposed so the eased writer can
   * read a live target each pass without duplicating that state machine.
   * Returns the reachable (clamped) scrollTop for the given viewport.
   */
  resolveFollowTargetTop: (viewport: HTMLElement) => number;
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
 * one snap/compensation pass the pipeline drives each frame. Every write still
 * flows through rung-3 ownership markers (WHO); the pipeline owns only WHEN.
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
  compensationAbsoluteDeadlineRef,
  restoreResolverRef,
  restoreDeadlineRef,
  scrollToBottom,
  easedFollowEnabled,
  resolveFollowTargetTop,
  notifyProgrammaticScroll,
  clearAllMarkers,
  beginGlue,
  onRestoreStranded,
}: UseTranscriptFramePipelineLifecycleOptions): void {
  // PRO-168 (rung 12): true while the eased writer's last step has not yet
  // reached its target. Read by the pipeline's `hasPendingMotion` hook so it
  // keeps scheduling frames purely for this writer's own catch-up. Always
  // false (never read) when the flag is off.
  const easedMotionPendingRef = useRef(false);
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

  const runFramePass = useCallback((): TranscriptFramePassOutcome => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return "settled";
    }
    if (pinnedRef.current) {
      compensationAnchorRef.current = null;
      compensationAbsoluteDeadlineRef.current = { anchor: null, deadline: 0 };
      // PRO-168 (rung 12, Q16): flag off takes the original instant path
      // verbatim — byte-identical to pre-rung-12 v1. Flag on substitutes the
      // eased writer, which still writes exclusively through
      // `notifyProgrammaticScroll` (classification is untouched, FR-1).
      if (!easedFollowEnabled) {
        scrollToBottom();
        return "settled";
      }
      const targetTop = resolveFollowTargetTop(viewport);
      const step = resolveEasedFollowStep(viewport.scrollTop, targetTop);
      easedMotionPendingRef.current = !step.converged;
      if (step.nextTop !== viewport.scrollTop) {
        notifyProgrammaticScroll(() => {
          viewport.scrollTop = step.nextTop;
        });
      }
      return "settled";
    }
    // PRO-168 (rung 12): unpinned takes over from here; the eased writer's
    // pending flag only ever describes a PINNED catch-up, so clear it rather
    // than leave it stale until the reader re-pins (the `hasPendingMotion`
    // hook above also gates on `pinnedRef.current`, so this is defense in
    // depth, not the only thing preventing a stale-true leak).
    easedMotionPendingRef.current = false;
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
        return "settled";
      }
    }
    const anchor = compensationAnchorRef.current;
    if (!anchor) {
      compensationAbsoluteDeadlineRef.current = { anchor: null, deadline: 0 };
      return "settled";
    }
    // Glue ticks and isolated ResizeObserver passes share this same writer.
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
      compensationAbsoluteDeadlineRef.current = {
        anchor,
        deadline: floor.absoluteDeadline,
      };
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
    if (now >= compensationDeadlineRef.current) {
      // An ordinary-deadline correction retains the anchor until a later pass
      // observes the seat held. The absolute ceiling still releases immediately.
      const topBeforeCorrection = viewport.scrollTop;
      if (displacedAboveTarget) {
        notifyProgrammaticScroll(() => {
          if (seatedTarget > viewport.scrollTop) {
            viewport.scrollTop = seatedTarget;
          }
        });
      }
      const retained = displacedAboveTarget && now < floor.absoluteDeadline;
      if (!retained) {
        compensationAnchorRef.current = null;
        compensationAbsoluteDeadlineRef.current = { anchor: null, deadline: 0 };
      }
      // A retained displaced seat is NOT settled even with no read-back
      // advance: a still-running native scroll's latch (or a dip's clamp) can
      // swallow the write, with no later scroll/resize signal guaranteed.
      // Stay scheduled until a pass observes the seat held or the ceiling
      // releases; settling here strands the reader at the top.
      return viewport.scrollTop > topBeforeCorrection || retained
        ? "corrective_position_write"
        : "settled";
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
    const topBeforeCorrection = viewport.scrollTop;
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
    // Same owed-seat rule as the deadline branch: a write that left the
    // position short of the seat has not settled.
    return viewport.scrollTop > topBeforeCorrection || target - viewport.scrollTop > 1
      ? "corrective_position_write"
      : "settled";
  }, [
    compensationAnchorRef,
    compensationAbsoluteDeadlineRef,
    compensationDeadlineRef,
    restoreResolverRef,
    restoreDeadlineRef,
    notifyProgrammaticScroll,
    onRestoreStranded,
    pinnedRef,
    scrollRef,
    scrollToBottom,
    easedFollowEnabled,
    resolveFollowTargetTop,
  ]);

  useLayoutEffect(() => {
    const pipeline = pipelineRef.current;
    pipeline.setWriter({
      runFramePass,
      measureContentHeight: () => scrollRef.current?.scrollHeight ?? -1,
      // PRO-168 (rung 12): only the eased writer ever reports pending motion;
      // the instant path never sets the ref, so this stays a permanent no-op
      // with the flag off. Gated on `pinnedRef.current` too, not just the
      // ref: the ref is written ONLY from the pinned branch above, so it can
      // go stale (stay true) if the user unpins mid-catch-up — the unpinned
      // branch never revisits it. Without this gate a stale `true` would have
      // the motion continuation re-arm forever on any later resize, even
      // though nothing pinned is asking for another eased step.
      hasPendingMotion: () => easedFollowEnabled && pinnedRef.current && easedMotionPendingRef.current,
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
    easedFollowEnabled,
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
