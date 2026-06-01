import { SHORTCUTS, type ShortcutId } from "@/config/shortcuts/registry";
import { matchShortcutDef } from "@/lib/domain/shortcuts/matching";
import type { ShortcutTrigger } from "@/lib/domain/shortcuts/registry";

const DISPATCH_SHORTCUTS = Object.values(SHORTCUTS);
const SHORTCUT_IDS = new Set<ShortcutId>(DISPATCH_SHORTCUTS.map((shortcut) => shortcut.id));

export interface ResolvedKeyboardShortcut {
  id: ShortcutId;
  shortcut: (typeof DISPATCH_SHORTCUTS)[number];
  trigger: ShortcutTrigger;
}

export function isShortcutId(id: string): id is ShortcutId {
  return SHORTCUT_IDS.has(id as ShortcutId);
}

export function resolveKeyboardShortcuts(
  event: KeyboardEvent,
): ResolvedKeyboardShortcut[] {
  const resolved: ResolvedKeyboardShortcut[] = [];

  for (const shortcut of DISPATCH_SHORTCUTS) {
    const match = matchShortcutDef(shortcut, event);
    if (!match) {
      continue;
    }

    resolved.push({
      id: shortcut.id,
      shortcut,
      trigger: {
        source: "keyboard",
        digit: match.digit,
      },
    });
  }

  return resolved;
}

export function resolveKeyboardShortcut(
  event: KeyboardEvent,
): ResolvedKeyboardShortcut | null {
  // Declaration order in SHORTCUTS is authoritative here: the first match wins.
  return resolveKeyboardShortcuts(event)[0] ?? null;
}
