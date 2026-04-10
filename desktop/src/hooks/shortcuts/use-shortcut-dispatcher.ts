import { useEffect } from "react";
import { SHORTCUTS, type ShortcutId } from "@/config/shortcuts";
import {
  getShortcutHandler,
  type ShortcutTrigger,
} from "@/lib/domain/shortcuts/registry";
import {
  matchShortcut,
} from "@/lib/domain/shortcuts/matching";
import { shouldDispatchKeyboardShortcut } from "@/lib/domain/shortcuts/dispatch-policy";
import { listenForShortcutMenuEvents } from "@/platform/tauri/menu";

const DISPATCH_SHORTCUTS = Object.values(SHORTCUTS);
const SHORTCUT_IDS = new Set<ShortcutId>(DISPATCH_SHORTCUTS.map((shortcut) => shortcut.id));

function isShortcutId(id: string): id is ShortcutId {
  return SHORTCUT_IDS.has(id as ShortcutId);
}

function dispatchShortcut(id: ShortcutId, trigger: ShortcutTrigger): boolean {
  const handler = getShortcutHandler(id);
  if (!handler) {
    return false;
  }

  try {
    return handler(trigger) !== false;
  } catch (error) {
    console.error(`Failed to handle shortcut ${id}`, error);
    return false;
  }
}

export function useShortcutDispatcher(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Declaration order in SHORTCUTS is authoritative here: the first match wins.
      for (const shortcut of DISPATCH_SHORTCUTS) {
        const match = matchShortcut(shortcut.match, event);
        if (!match) {
          continue;
        }

        if (!shouldDispatchKeyboardShortcut(shortcut, event)) {
          return;
        }

        const consumed = dispatchShortcut(shortcut.id, {
          source: "keyboard",
          digit: match.digit,
        });
        if (consumed) {
          event.preventDefault();
        }
        return;
      }
    };

    let disposed = false;
    let unlistenMenu = () => {};

    void listenForShortcutMenuEvents((id) => {
      if (!isShortcutId(id)) {
        return;
      }

      dispatchShortcut(id, { source: "menu" });
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }

      unlistenMenu = dispose;
    });

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      disposed = true;
      unlistenMenu();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
