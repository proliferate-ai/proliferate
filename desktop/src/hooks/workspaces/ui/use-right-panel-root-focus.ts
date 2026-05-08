import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { resolvePrimaryDigitShortcutIndex } from "@/lib/domain/workspaces/shell/right-panel-view";
import type { RightPanelHeaderEntry } from "@/lib/domain/workspaces/shell/right-panel-header-entry";

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
      "[data-focus-zone='browser']",
    ].join(","),
  ));
}

export function useRightPanelRootFocus({
  rootRef,
  isOpen,
  focusRequestToken,
  headerEntries,
  onActivateHeaderEntry,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  focusRequestToken: number;
  headerEntries: readonly RightPanelHeaderEntry[];
  onActivateHeaderEntry: (entry: RightPanelHeaderEntry) => void;
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcutIndex = resolvePrimaryDigitShortcutIndex(event);
      if (shortcutIndex === null) {
        return;
      }

      const root = rootRef.current;
      const activeElement = document.activeElement;
      if (!root || !(activeElement instanceof Element) || !root.contains(activeElement)) {
        return;
      }

      const entry = headerEntries[shortcutIndex];
      if (!entry) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onActivateHeaderEntry(entry);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [headerEntries, onActivateHeaderEntry, rootRef]);

  return useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (shouldPreservePointerFocus(event.target)) {
      return;
    }

    rootRef.current?.focus({ preventScroll: true });
  }, [rootRef]);
}
