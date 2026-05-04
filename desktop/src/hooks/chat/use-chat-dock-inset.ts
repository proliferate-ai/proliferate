import { useLayoutEffect, useRef, useState } from "react";
import {
  computeChatDockLowerBackdropTopPx,
  computeChatStableBottomInsetPx,
  computeChatSurfaceBottomInsetPx,
} from "@/config/chat-layout";

export function useChatDockInset() {
  const dockRef = useRef<HTMLDivElement>(null);
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
        composerSurfaceHeightPx: surfaceRect ? Math.max(0, surfaceRect.height) : 0,
        composerSurfaceOffsetTopPx: surfaceRect
          ? Math.max(0, surfaceRect.top - dockRect.top)
          : 0,
        composerFooterHeightPx: footerRect ? Math.max(0, footerRect.height) : 0,
        dockHeightPx: Math.max(0, dockRect.height),
      };
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

    const observer = new ResizeObserver(() => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
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
    dockSafeAreaPx: computeChatStableBottomInsetPx(metrics),
  };
}
