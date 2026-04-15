import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

interface AutoHideScrollAreaProps {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  contentClassName?: string;
  allowHorizontal?: boolean;
}

const HIDE_DELAY_MS = 700;
const MIN_THUMB_SIZE = 28;

export const AutoHideScrollArea = forwardRef<HTMLDivElement, AutoHideScrollAreaProps>(
  function AutoHideScrollArea(
    {
      children,
      className = "",
      viewportClassName = "",
      contentClassName = "",
      allowHorizontal = false,
    },
    ref,
  ) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const hideTimerRef = useRef<number | null>(null);
    const dragOffsetRef = useRef(0);
    const draggingRef = useRef(false);
    const [thumb, setThumb] = useState({
      size: 0,
      offset: 0,
      visible: false,
    });

    useImperativeHandle(ref, () => viewportRef.current as HTMLDivElement);

    const clearHideTimer = () => {
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    const updateThumb = (visible = false) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const { clientHeight, scrollHeight, scrollTop } = viewport;
      if (scrollHeight <= clientHeight + 1) {
        setThumb((current) =>
          current.size === 0 && !current.visible
            ? current
            : { size: 0, offset: 0, visible: false },
        );
        return;
      }

      const size = Math.max(
        (clientHeight / scrollHeight) * clientHeight,
        MIN_THUMB_SIZE,
      );
      const maxOffset = Math.max(clientHeight - size, 0);
      const maxScroll = Math.max(scrollHeight - clientHeight, 1);
      const offset = maxOffset * (scrollTop / maxScroll);

      setThumb((current) => ({
        size,
        offset,
        visible: visible || current.visible || draggingRef.current,
      }));
    };

    const scheduleHide = () => {
      clearHideTimer();
      if (draggingRef.current) return;
      hideTimerRef.current = window.setTimeout(() => {
        setThumb((current) => ({ ...current, visible: false }));
      }, HIDE_DELAY_MS);
    };

    useEffect(() => {
      updateThumb(false);
    }, [children]);

    useEffect(() => {
      const viewport = viewportRef.current;
      const content = contentRef.current;
      if (!viewport || !content) return;

      const handleScroll = () => {
        updateThumb(true);
        scheduleHide();
      };
      viewport.addEventListener("scroll", handleScroll, { passive: true });

      const observer = new ResizeObserver(() => updateThumb(false));
      observer.observe(viewport);
      observer.observe(content);

      return () => {
        clearHideTimer();
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
        viewport.scrollTop =
          (nextOffset / maxOffset) * Math.max(scrollHeight - clientHeight, 0);
        updateThumb(true);
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

      const thumbTop = thumb.offset;
      dragOffsetRef.current = event.clientY - viewport.getBoundingClientRect().top - thumbTop;
      setThumb((current) => ({ ...current, visible: true }));
      event.preventDefault();
      event.stopPropagation();
    };

    return (
      <div className={`relative min-h-0 overflow-hidden ${className}`}>
        <div
          ref={viewportRef}
          style={{ overscrollBehavior: "none" }}
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

        {!allowHorizontal && thumb.size > 0 && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute right-[3px] top-[3px] bottom-[3px] w-1.5 transition-opacity duration-200 ${
              thumb.visible ? "opacity-100" : "opacity-0"
            }`}
          >
            <div
              className="pointer-events-auto absolute right-0 w-1.5 rounded-full bg-[var(--color-scrollbar-thumb)] transition-colors duration-150 hover:bg-[var(--color-scrollbar-thumb-active)]"
              style={{
                height: `${thumb.size}px`,
                transform: `translateY(${thumb.offset}px)`,
              }}
              onPointerDown={handleThumbPointerDown}
            />
          </div>
        )}
      </div>
    );
  },
);
