import { SHORTCUTS, type ShortcutDef } from "@/config/shortcuts";
import { getFocusZone } from "@/lib/domain/focus-zone";
import { isTextEntryTarget } from "@/lib/domain/shortcuts/matching";

type KeyboardShortcutEventLike = Pick<
  KeyboardEvent,
  | "altKey"
  | "ctrlKey"
  | "defaultPrevented"
  | "key"
  | "metaKey"
  | "shiftKey"
  | "target"
>;

function isReloadBlockedRShortcut(
  shortcut: Pick<ShortcutDef, "id">,
  event: KeyboardShortcutEventLike,
): boolean {
  // Tauri/browser shells reserve reload shortcuts before our app shortcut
  // dispatcher sees them, so the two intentional R commands need this bypass.
  if (
    !event.defaultPrevented
    || !(event.metaKey || event.ctrlKey)
    || event.altKey
    || event.key.toLowerCase() !== "r"
  ) {
    return false;
  }

  if (shortcut.id === SHORTCUTS.renameSession.id) {
    return !event.shiftKey;
  }

  if (shortcut.id === SHORTCUTS.closeTabsToRight.id) {
    return event.shiftKey;
  }

  return false;
}

export function shouldDispatchKeyboardShortcut(
  shortcut: Pick<ShortcutDef, "allowInInputs" | "id">,
  event: KeyboardShortcutEventLike,
): boolean {
  if (event.defaultPrevented && !isReloadBlockedRShortcut(shortcut, event)) {
    return false;
  }

  const terminalFocused = typeof document !== "undefined"
    && getFocusZone() === "terminal";
  if (!shortcut.allowInInputs && (isTextEntryTarget(event.target) || terminalFocused)) {
    return false;
  }

  return true;
}
