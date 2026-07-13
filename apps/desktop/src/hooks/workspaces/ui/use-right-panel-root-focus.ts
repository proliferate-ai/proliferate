import {
  useCallback,
  useEffect,
  useRef,
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
      "[data-focus-zone='terminal']",
    ].join(","),
  ));
}

export function useRightPanelRootFocus({
  rootRef,
  isOpen,
  focusRequestToken,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  focusRequestToken: number;
}) {
  const handledFocusRequestRef = useRef(0);

  useEffect(() => {
    if (
      !isOpen
      || focusRequestToken <= 0
      || handledFocusRequestRef.current === focusRequestToken
    ) {
      return;
    }

    handledFocusRequestRef.current = focusRequestToken;
    rootRef.current?.focus({ preventScroll: true });
  }, [focusRequestToken, isOpen, rootRef]);

  return useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (shouldPreservePointerFocus(event.target)) {
      return;
    }

    rootRef.current?.focus({ preventScroll: true });
  }, [rootRef]);
}
