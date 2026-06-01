import { useEffect, useRef } from "react";

const STICK_THRESHOLD_PX = 24;

/**
 * Returns a ref for a scroll container that pins itself to the bottom as new
 * content is appended, until the user scrolls away from the bottom. When they
 * scroll back to within `STICK_THRESHOLD_PX`, sticky behavior resumes.
 *
 * The container is expected to have a single inner content child whose growth
 * drives the auto-scroll (via ResizeObserver).
 */
export function useStickToBottom<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let stickToBottom = true;

    const updateStickiness = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottom = distanceFromBottom <= STICK_THRESHOLD_PX;
    };

    const scrollToBottomIfSticky = () => {
      if (!stickToBottom) return;
      el.scrollTop = el.scrollHeight;
    };

    el.addEventListener("scroll", updateStickiness, { passive: true });
    scrollToBottomIfSticky();

    if (typeof ResizeObserver === "undefined") {
      return () => {
        el.removeEventListener("scroll", updateStickiness);
      };
    }

    const observer = new ResizeObserver(() => {
      scrollToBottomIfSticky();
    });
    const content = el.firstElementChild;
    if (content) observer.observe(content);
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", updateStickiness);
      observer.disconnect();
    };
  }, []);

  return containerRef;
}
