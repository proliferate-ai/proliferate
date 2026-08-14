import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  computeChatDockLowerBackdropTopPx,
  computeChatStableBottomInsetPx,
  computeChatSurfaceBottomInsetPx,
} from "#product/config/chat-layout";


export function useChatDockInset() {
  const dockRef = useRef<HTMLDivElement>(null);
  // The transcript's structural bottom inset (stable dock reserve minus the
  // non-displacing offset-top share) as of the last committed measure. The
  // ResizeObserver's shrink gate compares candidate geometry against this.
  const lastMeasuredStructuralInsetRef = useRef(0);
  const [metrics, setMetrics] = useState({
    composerSurfaceHeightPx: 0,
    composerSurfaceOffsetTopPx: 0,
    composerFooterHeightPx: 0,
    dockHeightPx: 0,
  });

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

    const structuralInsetOf = (dockMetrics: ReturnType<typeof readDockMetrics>) =>
      computeChatStableBottomInsetPx(dockMetrics) - dockMetrics.composerSurfaceOffsetTopPx;

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
      // tax input latency.
      if (structuralInsetOf(readDockMetrics()) < lastMeasuredStructuralInsetRef.current) {
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
