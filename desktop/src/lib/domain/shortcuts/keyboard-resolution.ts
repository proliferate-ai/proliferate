import { SHORTCUTS, type ShortcutId } from "@/config/shortcuts";
import {
  matchShortcutDef,
} from "@/lib/domain/shortcuts/matching";
import type { ShortcutTrigger } from "@/lib/domain/shortcuts/registry";

const DISPATCH_SHORTCUTS = Object.values(SHORTCUTS);
const SHORTCUT_IDS = new Set<ShortcutId>(DISPATCH_SHORTCUTS.map((shortcut) => shortcut.id));

export function isShortcutId(id: string): id is ShortcutId {
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
