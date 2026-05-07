import { useEffect } from "react";
import { SHORTCUTS, type ShortcutId } from "@/config/shortcuts";
import {
  runShortcutHandler,
  type ShortcutTrigger,
} from "@/lib/domain/shortcuts/registry";
import {
  matchShortcutDef,
} from "@/lib/domain/shortcuts/matching";
import { shouldDispatchKeyboardShortcut } from "@/lib/domain/shortcuts/dispatch-policy";
import { useTauriMenuEvents } from "@/hooks/access/tauri/use-menu-events";

const DISPATCH_SHORTCUTS = Object.values(SHORTCUTS);
const SHORTCUT_IDS = new Set<ShortcutId>(DISPATCH_SHORTCUTS.map((shortcut) => shortcut.id));

function isShortcutId(id: string): id is ShortcutId {
  return SHORTCUT_IDS.has(id as ShortcutId);
}

export function resolveKeyboardShortcut(
  event: KeyboardEvent,
): {
  id: ShortcutId;
  shortcut: (typeof DISPATCH_SHORTCUTS)[number];
  trigger: ShortcutTrigger;
} | null {
  // Declaration order in SHORTCUTS is authoritative here: the first match wins.
  for (const shortcut of DISPATCH_SHORTCUTS) {
    const match = matchShortcutDef(shortcut, event);
    if (!match) {
      continue;
    }

    return {
      id: shortcut.id,
      shortcut,
      trigger: {
        source: "keyboard",
        digit: match.digit,
      },
    };
  }

  return null;
}

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
