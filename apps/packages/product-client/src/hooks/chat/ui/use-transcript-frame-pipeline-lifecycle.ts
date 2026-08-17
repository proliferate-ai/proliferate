import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";
import type { ContentHeightScrollAnchor } from "#product/hooks/chat/ui/transcript-row-list-model";
import type { TranscriptFramePipeline } from "#product/hooks/chat/ui/transcript-frame-pipeline";

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
    notifyProgrammaticScroll(() => {
      viewport.scrollTop = anchor.scrollTop + (viewport.scrollHeight - anchor.scrollHeight);
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
