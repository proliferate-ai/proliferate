import { useCallback, useRef, type MouseEvent } from "react";
import type {
  MenuPosition,
  NativeMenuItem,
} from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

/**
 * Attach the host-provided native context menu to an element. Returns a
 * capture-phase handler that fires before any descendant bubble-phase
 * contextmenu listeners (e.g. `PopoverButton triggerMode="contextMenu"`).
 *
 * - With a Desktop native UI bridge: preventDefault + stopPropagation + show
 *   the native menu.
 * - Without a Desktop bridge: do nothing; descendant listeners still fire,
 *   so an existing DOM fallback (PopoverButton) continues to work.
 *
 * `buildItems` runs only when the menu is actually opened, so transient data
 * (e.g. which tab was right-clicked) can be captured via closure.
 */
export function useNativeContextMenu(buildItems: () => NativeMenuItem[]) {
  const { buildRef, disabledRef, nativeUi, showNativeMenu } = useNativeMenuController(buildItems);

  const onContextMenuCapture = useCallback((event: MouseEvent) => {
    if (disabledRef.current || nativeUi === null) {
      return;
    }
    const items = buildRef.current();
    if (items.length === 0) {
      return;
    }
    const fallbackTarget = event.target instanceof Element
      ? event.target
      : event.currentTarget;
    const fallbackEvent = event.nativeEvent;
    event.preventDefault();
    event.stopPropagation();
    void showNativeMenu(undefined, items).then((shown) => {
      if (!shown) {
        dispatchFallbackContextMenu(fallbackTarget, fallbackEvent);
      }
    });
  }, [buildRef, disabledRef, nativeUi, showNativeMenu]);

  return { onContextMenuCapture, showNativeMenu };
}

/**
 * Opens the same host-provided native menu from a normal click trigger. Callers keep
 * their DOM menu controlled and open it only when this returns false, which
 * preserves browser development and a graceful runtime fallback.
 */
export function useNativeMenu(buildItems: () => NativeMenuItem[]) {
  const { showNativeMenu } = useNativeMenuController(buildItems);
  return { showNativeMenu };
}

function useNativeMenuController(buildItems: () => NativeMenuItem[]) {
  const { desktop } = useProductHost();
  const nativeUi = desktop?.nativeUi ?? null;
  const buildRef = useRef(buildItems);
  const disabledRef = useRef(false);
  buildRef.current = buildItems;

  const showNativeMenu = useCallback(async (
    position?: MenuPosition,
    preparedItems?: NativeMenuItem[],
  ): Promise<boolean> => {
    if (disabledRef.current || nativeUi === null) return false;
    const items = preparedItems ?? buildRef.current();
    if (items.length === 0) return false;
    const shown = await nativeUi.showContextMenu(items, position);
    if (!shown) disabledRef.current = true;
    return shown;
  }, [nativeUi]);

  return { buildRef, disabledRef, nativeUi, showNativeMenu };
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
