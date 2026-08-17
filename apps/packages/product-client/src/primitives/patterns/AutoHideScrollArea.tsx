import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { motion } from "@proliferate/design/motion";
import {
  buildOverscrollStyle,
  useChainedVerticalWheel,
} from "#product/primitives/utils/use-chained-vertical-wheel";

interface AutoHideScrollAreaProps {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  contentClassName?: string;
  allowHorizontal?: boolean;
  overscrollBehavior?: CSSProperties["overscrollBehavior"];
  overscrollBehaviorX?: CSSProperties["overscrollBehaviorX"];
  overscrollBehaviorY?: CSSProperties["overscrollBehaviorY"];
  chainVerticalWheel?: boolean;
  /**
   * Opt in to `overflow-anchor: none` on the viewport. Off by default so the
   * shared primitive keeps the browser's native scroll-anchoring for ordinary
   * consumers. The chat transcript sets this so Chromium and WKWebView run the
   * identical single-writer stick-to-bottom regime: browser scroll anchoring
   * would otherwise adjust scrollTop underneath the transcript engine, a second
   * writer the ownership-marker classification cannot attribute.
   */
  stableScrollAnchor?: boolean;
  onViewportScroll?: (viewport: HTMLDivElement) => void;
  onUserScrollIntent?: (direction: -1 | 1) => void;
}

interface ScrollThumbState {
  size: number;
  offset: number;
  visible: boolean;
}

const MIN_THUMB_SIZE = 28;
const THUMB_MEASUREMENT_EPSILON = 0.5;
const HIDDEN_THUMB_STATE: ScrollThumbState = {
  size: 0,
  offset: 0,
  visible: false,
};

export const AutoHideScrollArea = forwardRef<HTMLDivElement, AutoHideScrollAreaProps>(
  function AutoHideScrollArea(
    {
      children,
      className = "",
      viewportClassName = "",
      contentClassName = "",
      allowHorizontal = false,
      overscrollBehavior = "none",
      overscrollBehaviorX,
      overscrollBehaviorY,
      chainVerticalWheel = true,
      stableScrollAnchor = false,
      onViewportScroll,
      onUserScrollIntent,
    },
    ref,
  ) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const thumbTrackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);
    const onViewportScrollRef = useRef(onViewportScroll);
    const onUserScrollIntentRef = useRef(onUserScrollIntent);
    const hideTimerRef = useRef<number | null>(null);
    const thumbFrameRef = useRef<number | null>(null);
    const pendingThumbVisibleRef = useRef(false);
    const dragOffsetRef = useRef(0);
    const draggingRef = useRef(false);
    const thumbStateRef = useRef<ScrollThumbState>(HIDDEN_THUMB_STATE);

    useImperativeHandle(ref, () => viewportRef.current as HTMLDivElement);

    useEffect(() => {
      onViewportScrollRef.current = onViewportScroll;
    }, [onViewportScroll]);

    useEffect(() => {
      onUserScrollIntentRef.current = onUserScrollIntent;
    }, [onUserScrollIntent]);

    const applyThumbStateToDom = useCallback((state: ScrollThumbState) => {
      const track = thumbTrackRef.current;
      const thumb = thumbRef.current;
      if (!track || !thumb) {
        return;
      }
      track.style.opacity = state.visible && state.size > 0 ? "1" : "0";
      thumb.style.pointerEvents = state.visible && state.size > 0 ? "auto" : "none";
      thumb.style.height = `${state.size}px`;
      thumb.style.transform = `translateY(${state.offset}px)`;
    }, []);

    const setThumbTrackNode = useCallback((node: HTMLDivElement | null) => {
      thumbTrackRef.current = node;
      applyThumbStateToDom(thumbStateRef.current);
    }, [applyThumbStateToDom]);

    const setThumbNode = useCallback((node: HTMLDivElement | null) => {
      thumbRef.current = node;
      applyThumbStateToDom(thumbStateRef.current);
    }, [applyThumbStateToDom]);

    const clearHideTimer = () => {
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    const commitThumbState = (next: ScrollThumbState) => {
      if (areThumbStatesEqual(thumbStateRef.current, next)) {
        return;
      }
      thumbStateRef.current = next;
      applyThumbStateToDom(next);
    };

    const updateThumb = (visible = false) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const { clientHeight, scrollHeight, scrollTop } = viewport;
      if (scrollHeight <= clientHeight + 1) {
        commitThumbState(HIDDEN_THUMB_STATE);
        return;
      }

      const size = Math.max(
        (clientHeight / scrollHeight) * clientHeight,
        MIN_THUMB_SIZE,
      );
      const maxOffset = Math.max(clientHeight - size, 0);
      const maxScroll = Math.max(scrollHeight - clientHeight, 1);
      const offset = maxOffset * (scrollTop / maxScroll);

      const current = thumbStateRef.current;
      commitThumbState({
        size,
        offset,
        visible: visible || current.visible || draggingRef.current,
      });
    };

    const requestThumbUpdate = (visible = false) => {
      pendingThumbVisibleRef.current = pendingThumbVisibleRef.current || visible;
      if (thumbFrameRef.current !== null) {
        return;
      }
      thumbFrameRef.current = window.requestAnimationFrame(() => {
        thumbFrameRef.current = null;
        const nextVisible = pendingThumbVisibleRef.current;
        pendingThumbVisibleRef.current = false;
        updateThumb(nextVisible);
      });
    };

    const scheduleHide = () => {
      clearHideTimer();
      if (draggingRef.current) return;
      hideTimerRef.current = window.setTimeout(() => {
        const current = thumbStateRef.current;
        if (current.visible) {
          commitThumbState({ ...current, visible: false });
        }
      }, motion.delay.autoHideScrollbarMs);
    };

    useEffect(() => {
      const viewport = viewportRef.current;
      const content = contentRef.current;
      if (!viewport || !content) return;

      const handleScroll = () => {
        requestThumbUpdate(true);
        onViewportScrollRef.current?.(viewport);
        scheduleHide();
      };
      viewport.addEventListener("scroll", handleScroll, { passive: true });

      const observer = new ResizeObserver(() => requestThumbUpdate(false));
      observer.observe(viewport);
      observer.observe(content);
      requestThumbUpdate(false);

      return () => {
        clearHideTimer();
        if (thumbFrameRef.current !== null) {
          window.cancelAnimationFrame(thumbFrameRef.current);
          thumbFrameRef.current = null;
        }
        viewport.removeEventListener("scroll", handleScroll);
        observer.disconnect();
      };
    }, []);

    useEffect(() => {
      const handlePointerMove = (event: PointerEvent) => {
        if (!draggingRef.current) return;
        const viewport = viewportRef.current;
        if (!viewport) return;

        const { top } = viewport.getBoundingClientRect();
        const { clientHeight, scrollHeight } = viewport;
        const size = Math.max(
          (clientHeight / scrollHeight) * clientHeight,
          MIN_THUMB_SIZE,
        );
        const maxOffset = Math.max(clientHeight - size, 0);
        if (maxOffset <= 0) return;

        const nextOffset = Math.min(
          Math.max(event.clientY - top - dragOffsetRef.current, 0),
          maxOffset,
        );
        const nextScrollTop =
          (nextOffset / maxOffset) * Math.max(scrollHeight - clientHeight, 0);
        const scrollDelta = nextScrollTop - viewport.scrollTop;
        if (Math.abs(scrollDelta) > THUMB_MEASUREMENT_EPSILON) {
          onUserScrollIntentRef.current?.(scrollDelta < 0 ? -1 : 1);
          viewport.scrollTop = nextScrollTop;
        }
        requestThumbUpdate(true);
      };

      const handlePointerUp = () => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        scheduleHide();
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      return () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };
    }, []);

    const handleThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      draggingRef.current = true;
      clearHideTimer();

      const thumbTop = thumbStateRef.current.offset;
      dragOffsetRef.current = event.clientY - viewport.getBoundingClientRect().top - thumbTop;
      const current = thumbStateRef.current;
      if (!current.visible) {
        commitThumbState({ ...current, visible: true });
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const viewportStyle = buildOverscrollStyle(
      overscrollBehavior,
      overscrollBehaviorX,
      overscrollBehaviorY,
    );
    if (stableScrollAnchor) {
      viewportStyle.overflowAnchor = "none";
    }
    const handleViewportWheel = useChainedVerticalWheel(chainVerticalWheel);

    return (
      <div className={`relative min-h-0 overflow-hidden ${className}`}>
        <div
          ref={viewportRef}
          style={viewportStyle}
          onWheel={handleViewportWheel}
          className={`h-full w-full ${
            allowHorizontal
              ? "overflow-auto"
              : "scrollbar-none overflow-y-auto overflow-x-hidden"
          } ${viewportClassName}`}
        >
          <div ref={contentRef} className={contentClassName}>
            {children}
          </div>
        </div>

        {!allowHorizontal && (
          <div
            ref={setThumbTrackNode}
            aria-hidden="true"
            className="pointer-events-none absolute right-[3px] top-[3px] bottom-[3px] w-1.5 opacity-0 transition-opacity duration-hover"
          >
            <div
              ref={setThumbNode}
              className="pointer-events-auto absolute right-0 w-1.5 rounded-full bg-scrollbar-thumb transition-colors duration-hover hover:bg-scrollbar-thumb-active"
              style={{
                height: 0,
                pointerEvents: "none",
                transform: "translateY(0)",
              }}
              onPointerDown={handleThumbPointerDown}
            />
          </div>
        )}
      </div>
    );
  },
);

function areThumbStatesEqual(
  current: ScrollThumbState,
  next: ScrollThumbState,
): boolean {
  return current.visible === next.visible
    && Math.abs(current.size - next.size) < THUMB_MEASUREMENT_EPSILON
    && Math.abs(current.offset - next.offset) < THUMB_MEASUREMENT_EPSILON;
}
