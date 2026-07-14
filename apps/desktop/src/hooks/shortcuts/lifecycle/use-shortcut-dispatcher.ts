import { useEffect } from "react";
import { runShortcutHandler } from "@/lib/domain/shortcuts/registry";
import { resolveKeyboardShortcuts } from "@/lib/domain/shortcuts/keyboard-resolution";
import { shouldDispatchKeyboardShortcut } from "@/lib/domain/shortcuts/dispatch-policy";
import { SHORTCUT_REVEAL_RESET_EVENT } from "@/hooks/shortcuts/lifecycle/use-shortcut-reveal-state";

// Owns global shortcut event listeners and dispatching to registered handlers.
// Does not own individual shortcut handlers.
export function useShortcutDispatcher(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const resolvedShortcuts = resolveKeyboardShortcuts(event);
      if (resolvedShortcuts.length === 0) {
        return;
      }

      for (const resolved of resolvedShortcuts) {
        if (!shouldDispatchKeyboardShortcut(resolved.shortcut, event)) {
          continue;
        }

        const consumed = runShortcutHandler(resolved.id, resolved.trigger);
        if (consumed) {
          window.dispatchEvent(new Event(SHORTCUT_REVEAL_RESET_EVENT));
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);
}
