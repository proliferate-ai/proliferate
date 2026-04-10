import { SHORTCUTS, type ShortcutDef } from "@/config/shortcuts";
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

function isReloadBlockedRenameShortcut(
  shortcut: Pick<ShortcutDef, "id">,
  event: KeyboardShortcutEventLike,
): boolean {
  return shortcut.id === SHORTCUTS.renameSession.id
    && event.defaultPrevented
    && (event.metaKey || event.ctrlKey)
    && !event.shiftKey
    && !event.altKey
    && event.key.toLowerCase() === "r";
}

export function shouldDispatchKeyboardShortcut(
  shortcut: Pick<ShortcutDef, "allowInInputs" | "id">,
  event: KeyboardShortcutEventLike,
): boolean {
  if (event.defaultPrevented && !isReloadBlockedRenameShortcut(shortcut, event)) {
    return false;
  }

  if (!shortcut.allowInInputs && isTextEntryTarget(event.target)) {
    return false;
  }

  return true;
}
