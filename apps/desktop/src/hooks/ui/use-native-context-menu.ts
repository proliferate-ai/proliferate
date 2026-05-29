import { useCallback, useRef, type MouseEvent } from "react";
import {
  canShowNativeContextMenu,
  showNativeContextMenu,
  type NativeContextMenuItem,
} from "@/lib/access/tauri/context-menu";

/**
 * Attach a native (Tauri/muda) context menu to an element. Returns a
 * capture-phase handler that fires before any descendant bubble-phase
 * contextmenu listeners (e.g. `PopoverButton triggerMode="contextMenu"`).
 *
 * - In Tauri: preventDefault + stopPropagation + show native menu.
 * - Outside Tauri (dev browser): do nothing; descendant listeners still fire,
 *   so an existing DOM fallback (PopoverButton) continues to work.
 *
 * `buildItems` runs only when the menu is actually opened, so transient data
 * (e.g. which tab was right-clicked) can be captured via closure.
 */
export function useNativeContextMenu(buildItems: () => NativeContextMenuItem[]) {
  const buildRef = useRef(buildItems);
  const disabledRef = useRef(false);
  buildRef.current = buildItems;

  const onContextMenuCapture = useCallback((event: MouseEvent) => {
    if (disabledRef.current || !canShowNativeContextMenu()) {
      return;
    }
    const items = buildRef.current();
    if (items.length === 0) {
      return;
    }
    const fallbackTarget = event.currentTarget;
    const fallbackEvent = event.nativeEvent;
    event.preventDefault();
    event.stopPropagation();
    void showNativeContextMenu(items).then((shown) => {
      if (!shown) {
        disabledRef.current = true;
        dispatchFallbackContextMenu(fallbackTarget, fallbackEvent);
      }
    });
  }, []);

  return { onContextMenuCapture };
}

function dispatchFallbackContextMenu(
  target: EventTarget,
  event: globalThis.MouseEvent,
) {
  if (!(target instanceof Element) || typeof window === "undefined") {
    return;
  }
  window.queueMicrotask(() => {
    target.dispatchEvent(new window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      altKey: event.altKey,
      button: event.button,
      buttons: event.buttons,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      screenX: event.screenX,
      screenY: event.screenY,
      shiftKey: event.shiftKey,
    }));
  });
}
