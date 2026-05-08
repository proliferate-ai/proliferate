import { useEffect } from "react";
import {
  runShortcutHandler,
} from "@/lib/domain/shortcuts/registry";
import {
  isShortcutId,
  resolveKeyboardShortcut,
} from "@/lib/domain/shortcuts/keyboard-resolution";
import { shouldDispatchKeyboardShortcut } from "@/lib/domain/shortcuts/dispatch-policy";
import { useTauriMenuEvents } from "@/hooks/access/tauri/use-menu-events";

// Owns global shortcut event listeners and dispatching to registered handlers.
// Does not own individual shortcut handlers.
export function useShortcutDispatcher(): void {
  const { listenForShortcutMenuEvents } = useTauriMenuEvents();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const resolved = resolveKeyboardShortcut(event);
      if (!resolved) {
        return;
      }

      if (!shouldDispatchKeyboardShortcut(resolved.shortcut, event)) {
        return;
      }

      const consumed = runShortcutHandler(resolved.id, resolved.trigger);
      if (consumed) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    let disposed = false;
    let unlistenMenu = () => {};

    void listenForShortcutMenuEvents((id) => {
      if (!isShortcutId(id)) {
        return;
      }

      runShortcutHandler(id, { source: "menu" });
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }

      unlistenMenu = dispose;
    });

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      disposed = true;
      unlistenMenu();
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [listenForShortcutMenuEvents]);
}
