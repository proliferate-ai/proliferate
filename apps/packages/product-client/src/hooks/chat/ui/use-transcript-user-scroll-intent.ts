import { useEffect, type RefObject } from "react";
import {
  DIRECTION_EPSILON_PX,
  SCROLLABLE_OVERFLOW_EPSILON_PX,
} from "#product/hooks/chat/ui/transcript-row-list-model";

const USER_SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);
const USER_SCROLL_UP_KEYS = new Set(["ArrowUp", "Home", "PageUp"]);

/**
 * A gesture with no available scroll range produces no scroll event, so it
 * must not strand the transcript in an unpinned state.
 */
function viewportCanScroll(viewport: HTMLDivElement): boolean {
  return viewport.scrollHeight - viewport.clientHeight > SCROLLABLE_OVERFLOW_EPSILON_PX;
}

function viewportCanScrollInDirection(
  viewport: HTMLDivElement,
  direction: -1 | 1,
): boolean {
  if (!viewportCanScroll(viewport)) {
    return false;
  }
  if (direction < 0) {
    return viewport.scrollTop > DIRECTION_EPSILON_PX;
  }
  const maximumTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  return viewport.scrollTop < maximumTop - DIRECTION_EPSILON_PX;
}

function keyboardScrollDirection(event: KeyboardEvent): -1 | 1 | null {
  if (!USER_SCROLL_KEYS.has(event.key)) {
    return null;
  }
  if (event.key === " ") {
    return event.shiftKey ? -1 : 1;
  }
  return USER_SCROLL_UP_KEYS.has(event.key) ? -1 : 1;
}

/**
 * Claims wheel, keyboard, and touch scroll intent before the browser dispatches
 * the resulting scroll event, so a pinned transcript cannot snap first.
 */
export function useTranscriptUserScrollIntent({
  scrollRef,
  notifyUserScrollIntent,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  notifyUserScrollIntent: (direction: -1 | 1) => void;
}): void {
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return;
    }
    let touchStartY = 0;
    // An intent to leave is meaningless when there is nowhere to scroll. In
    // that case no scroll event follows to re-pin the transcript.
    const onWheel = (event: WheelEvent) => {
      const direction = event.deltaY < -DIRECTION_EPSILON_PX
        ? -1
        : event.deltaY > DIRECTION_EPSILON_PX
          ? 1
          : null;
      if (direction !== null && viewportCanScrollInDirection(viewport, direction)) {
        notifyUserScrollIntent(direction);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = keyboardScrollDirection(event);
      if (direction !== null && viewportCanScrollInDirection(viewport, direction)) {
        notifyUserScrollIntent(direction);
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? touchStartY;
      const direction = y - touchStartY > DIRECTION_EPSILON_PX
        ? -1
        : touchStartY - y > DIRECTION_EPSILON_PX
          ? 1
          : null;
      if (direction !== null && viewportCanScrollInDirection(viewport, direction)) {
        notifyUserScrollIntent(direction);
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
    };
  }, [notifyUserScrollIntent, scrollRef]);
}
