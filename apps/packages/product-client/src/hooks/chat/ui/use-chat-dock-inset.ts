import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  computeChatDockLowerBackdropTopPx,
  computeChatStableBottomInsetPx,
  computeChatSurfaceBottomInsetPx,
} from "#product/config/chat-layout";


interface ChatDockMetrics {
  composerSurfaceHeightPx: number;
  composerSurfaceOffsetTopPx: number;
  composerFooterHeightPx: number;
  dockHeightPx: number;
}

/**
 * The transcript's structural bottom inset: the stable dock reserve minus the
 * non-displacing offset-top share. The shrink gate below compares candidate
 * geometry against this.
 */
function structuralInsetOf(dockMetrics: ChatDockMetrics): number {
  return computeChatStableBottomInsetPx(dockMetrics) - dockMetrics.composerSurfaceOffsetTopPx;
}

export function useChatDockInset() {
  const dockRef = useRef<HTMLDivElement>(null);
  // Structural inset as of the last COMMITTED metrics.
  const lastCommittedStructuralInsetRef = useRef(0);
  // Structural inset as of the last measure READ, which may be ahead of the
  // committed one while its state update is still pending (a rAF-deferred
  // growth measure whose default-lane commit is delayed under load). The gate
  // takes the max of both: a shrink below either baseline must flush, and a
  // stale-high read can only cost an extra harmless sync flush, never a
  // missed one.
  const lastMeasuredStructuralInsetRef = useRef(0);
  const [metrics, setMetrics] = useState<ChatDockMetrics>({
    composerSurfaceHeightPx: 0,
    composerSurfaceOffsetTopPx: 0,
    composerFooterHeightPx: 0,
    dockHeightPx: 0,
  });

  // A measure-read alone must never LOWER the gate baseline: a rAF-deferred
  // measure that runs in the same frame as a collapse (growth queued the
  // frame before, collapse committed by a discrete event in between) reads
  // the already-collapsed geometry before its state ever commits, and using
  // that read as the sole baseline would disarm the sync gate for exactly
  // the frame it protects. Advancing this ref in a layout effect keyed on
  // the committed metrics keeps it truthful on both paths — inside a
  // flushSync it runs within the flush, still pre-paint. (A measure-read may
  // still RAISE the effective baseline via lastMeasuredStructuralInsetRef —
  // see the gate.)
  useLayoutEffect(() => {
    lastCommittedStructuralInsetRef.current = structuralInsetOf(metrics);
  }, [metrics]);

  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock) {
      return;
    }

    let frameId: number | null = null;

    // Shared by measure() and the observer's shrink gate so the gate compares
    // exactly what a measure would commit — no rounding or channel drift.
    const readDockMetrics = () => {
      const dockRect = dock.getBoundingClientRect();
      const composerSurface = dock.querySelector<HTMLElement>("[data-chat-composer-surface]");
      const composerFooter = dock.querySelector<HTMLElement>("[data-chat-composer-footer]");
      const surfaceRect = composerSurface?.getBoundingClientRect() ?? null;
      const footerRect = composerFooter?.getBoundingClientRect() ?? null;
      return {
        composerSurfaceHeightPx: surfaceRect ? Math.max(0, Math.ceil(surfaceRect.height)) : 0,
        composerSurfaceOffsetTopPx: surfaceRect
          ? Math.max(0, Math.ceil(surfaceRect.top - dockRect.top))
          : 0,
        composerFooterHeightPx: footerRect ? Math.max(0, Math.ceil(footerRect.height)) : 0,
        dockHeightPx: Math.max(0, Math.ceil(dockRect.height)),
      };
    };

    const measure = () => {
      const nextMetrics = readDockMetrics();
      lastMeasuredStructuralInsetRef.current = structuralInsetOf(nextMetrics);
      setMetrics((current) =>
        current.composerSurfaceHeightPx === nextMetrics.composerSurfaceHeightPx
        && current.composerSurfaceOffsetTopPx === nextMetrics.composerSurfaceOffsetTopPx
        && current.composerFooterHeightPx === nextMetrics.composerFooterHeightPx
        && current.dockHeightPx === nextMetrics.dockHeightPx
          ? current
          : nextMetrics
      );
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    // Composer growth (new line typed) must shift the transcript on the very
    // next frame — a settle delay here reads as input lag. rAF coalesces
    // multi-observer bursts within a frame without adding visible latency.
    const scheduleMeasure = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
    };

    const observer = new ResizeObserver(() => {
      // Any structural-inset shrink must commit before the shrink frame
      // paints: while pinned, the rAF-deferred measure would let that frame
      // paint against the stale (taller) inset, then drop the whole
      // transcript a notch when the correction lands. ResizeObserver fires
      // after layout and before paint, so flushing the measure synchronously
      // commits the corrected inset — and the pinned snap that depends on it —
      // before the frame paints. The submit collapse is the loudest case, but
      // Escape-clears, select-all deletes, and backspacing across a line wrap
      // are the same visual class and take the same path (a few sync flushes
      // across a held backspace is the accepted price of never notching).
      // Gating on the derived structural inset — not the dock rect — matters
      // in both directions: a queued send mounts its outbound card in the
      // very commit that collapses the surface, so the dock can net-grow
      // while the structural inset shrinks; and a dock-slot card dismissal
      // shrinks the dock while the structural inset stays put, which must
      // NOT force a sync flush (that shrink is the non-displacing overlay
      // share, whose clamp the scroll engine already classifies as
      // non-user). Growth keeps the rAF coalescing path: next-frame is
      // prompt enough for typing, and a sync flush per grow-keystroke would
      // tax input latency. Note the flush drains ALL pending work at this
      // root (a queued live-tail stream batch included), so its cost scales
      // with the pending tree, not with the dock subtree.
      //
      // The baseline is the max of committed and last-read: a growth measure
      // whose default-lane commit is still pending under load would leave the
      // committed baseline stale-low, letting a collapse back to the old
      // height slip to the deferred path — and the stale tall snapshot would
      // then commit and drop, the very notch this gate exists to prevent.
      // Either ref being stale-high only costs an extra sync flush.
      const shrinkGateBaseline = Math.max(
        lastCommittedStructuralInsetRef.current,
        lastMeasuredStructuralInsetRef.current,
      );
      if (structuralInsetOf(readDockMetrics()) < shrinkGateBaseline) {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
          frameId = null;
        }
        flushSync(measure);
        return;
      }
      scheduleMeasure();
    });

    observer.observe(dock);
    const composerSurface = dock.querySelector<HTMLElement>("[data-chat-composer-surface]");
    if (composerSurface) {
      observer.observe(composerSurface);
    }
    const composerFooter = dock.querySelector<HTMLElement>("[data-chat-composer-footer]");
    if (composerFooter) {
      observer.observe(composerFooter);
    }

    return () => {
      observer.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  return {
    dockRef,
    dockHeightPx: metrics.dockHeightPx,
    lowerBackdropTopPx: computeChatDockLowerBackdropTopPx(metrics),
    scrollBottomInsetPx: computeChatSurfaceBottomInsetPx(metrics),
    stickyBottomInsetPx: computeChatStableBottomInsetPx(metrics),
    stickyNonDisplacingBottomInsetPx: metrics.composerSurfaceOffsetTopPx,
    dockSafeAreaPx: computeChatStableBottomInsetPx(metrics),
  };
}
