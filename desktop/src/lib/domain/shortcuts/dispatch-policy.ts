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
> & {
  code?: string;
};

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

function canBypassDefaultPrevented(
  shortcut: Pick<ShortcutDef, "id">,
  event: KeyboardShortcutEventLike,
): boolean {
  if (isReloadBlockedRShortcut(shortcut, event)) {
    return true;
  }

  if (
    shortcut.id === SHORTCUTS.openSettings.id
    && (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && event.key === ","
  ) {
    return true;
  }

  if (
    shortcut.id === SHORTCUTS.toggleLeftSidebar.id
    && (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && (event.key.toLowerCase() === "b" || event.code === "KeyB")
  ) {
    return true;
  }

  if (
    shortcut.id === SHORTCUTS.toggleRightPanel.id
    && (event.metaKey || event.ctrlKey)
    && event.altKey
    && !event.shiftKey
    && (event.key.toLowerCase() === "b" || event.code === "KeyB")
  ) {
    return true;
  }

  return false;
}

function isTabCyclingShortcut(
  shortcut: Pick<ShortcutDef, "id">,
  event: KeyboardShortcutEventLike,
): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || !event.altKey) {
    return false;
  }

  return (
    shortcut.id === SHORTCUTS.previousTab.id
    && event.key === "ArrowLeft"
  ) || (
    shortcut.id === SHORTCUTS.nextTab.id
    && event.key === "ArrowRight"
  );
}

export function shouldDispatchKeyboardShortcut(
  shortcut: Pick<ShortcutDef, "allowInInputs" | "id">,
  event: KeyboardShortcutEventLike,
): boolean {
  if (
    event.defaultPrevented
    && !canBypassDefaultPrevented(shortcut, event)
    && !isTabCyclingShortcut(shortcut, event)
  ) {
    return false;
  }

  const terminalFocused = typeof document !== "undefined"
    && getFocusZone() === "terminal";
  if (!shortcut.allowInInputs && (isTextEntryTarget(event.target) || terminalFocused)) {
    return false;
  }

  return true;
}
