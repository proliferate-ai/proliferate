import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  computeChatDockLowerBackdropTopPx,
  computeChatStableBottomInsetPx,
  computeChatSurfaceBottomInsetPx,
} from "#product/config/chat-layout";


export function useChatDockInset() {
  const dockRef = useRef<HTMLDivElement>(null);
  const lastMeasuredDockHeightRef = useRef(0);
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

    const measure = () => {
      const dockRect = dock.getBoundingClientRect();
      const composerSurface = dock.querySelector<HTMLElement>("[data-chat-composer-surface]");
      const composerFooter = dock.querySelector<HTMLElement>("[data-chat-composer-footer]");
      const surfaceRect = composerSurface?.getBoundingClientRect() ?? null;
      const footerRect = composerFooter?.getBoundingClientRect() ?? null;
      const nextMetrics = {
        composerSurfaceHeightPx: surfaceRect ? Math.max(0, Math.ceil(surfaceRect.height)) : 0,
        composerSurfaceOffsetTopPx: surfaceRect
          ? Math.max(0, Math.ceil(surfaceRect.top - dockRect.top))
          : 0,
        composerFooterHeightPx: footerRect ? Math.max(0, Math.ceil(footerRect.height)) : 0,
        dockHeightPx: Math.max(0, Math.ceil(dockRect.height)),
      };
      lastMeasuredDockHeightRef.current = nextMetrics.dockHeightPx;
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
      // A dock shrink is the submit-collapse path: clearing the draft drops
      // the dock's height in the same frame the optimistic prompt row mounts.
      // The rAF-deferred measure would let that frame paint against the stale
      // (taller) inset, then drop the whole transcript a notch when the
      // correction lands. ResizeObserver fires after layout and before paint,
      // so flushing the measure synchronously commits the corrected inset —
      // and the pinned snap that depends on it — before the collapse frame
      // paints. Growth keeps the rAF coalescing path: next-frame is prompt
      // enough for typing, and a sync flush per keystroke would tax input
      // latency.
      const dockHeightPx = Math.ceil(dock.getBoundingClientRect().height);
      if (dockHeightPx < lastMeasuredDockHeightRef.current) {
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
