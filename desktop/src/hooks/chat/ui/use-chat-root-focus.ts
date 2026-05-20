import {
  useCallback,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

function shouldPreservePointerFocus(target: EventTarget): boolean {
  if (!(target instanceof Element)) {
    return true;
  }

  return Boolean(target.closest(
    [
      "a",
      "button",
      "input",
      "select",
      "textarea",
      "iframe",
      "[contenteditable='true']",
      "[role='button']",
      "[tabindex]:not([tabindex='-1'])",
      "[data-chat-transcript-root='true']",
      "[data-focus-zone='terminal']",
      "[data-focus-zone='browser']",
    ].join(","),
  ));
}

export function useChatRootFocus(
  rootRef: RefObject<HTMLDivElement | null>,
) {
  return useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (shouldPreservePointerFocus(event.target)) {
      return;
    }

    rootRef.current?.focus({ preventScroll: true });
  }, [rootRef]);
}
