import { SHORTCUTS } from "#product/config/shortcuts/registry";
import type { ShortcutDef } from "#product/config/shortcuts/types";
import { getFocusZone } from "#product/lib/domain/focus-zone";
import {
  isTextEntryTarget,
  matchShortcutDef,
} from "#product/lib/domain/shortcuts/matching";

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

function canBypassDefaultPrevented(
  shortcut: Pick<ShortcutDef, "id">,
  event: KeyboardShortcutEventLike,
): boolean {
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

  // Derived from the registry binding (⌘/ today) so the bypass cannot drift
  // when the shortcut is rebound again (it used to hardcode the old ⌘⇧/).
  const showShortcutsMatch = SHORTCUTS.showKeyboardShortcuts.match;
  if (
    shortcut.id === SHORTCUTS.showKeyboardShortcuts.id
    && (event.metaKey || event.ctrlKey)
    && event.altKey === showShortcutsMatch.alt
    && event.shiftKey === showShortcutsMatch.shift
    && event.code === showShortcutsMatch.code
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

  if (
    shortcut.id === SHORTCUTS.closeActiveTab.id
    && (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && event.key.toLowerCase() === "w"
  ) {
    return true;
  }

  if (
    (
      shortcut.id === SHORTCUTS.workspaceByIndex.id
      || shortcut.id === SHORTCUTS.settingsSectionByIndex.id
    )
    && (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && isDigitShortcutEvent(event)
  ) {
    return true;
  }

  if (
    shortcut.id === SHORTCUTS.tabByIndex.id
    && (event.metaKey || event.ctrlKey)
    && event.altKey
    && !event.shiftKey
    && isDigitShortcutEvent(event)
  ) {
    return true;
  }

  if (
    shortcut.id === SHORTCUTS.closeOtherTabs.id
    && (event.metaKey || event.ctrlKey)
    && event.key.toLowerCase() === "o"
    && (
      (event.altKey && !event.shiftKey)
      || (!event.altKey && event.shiftKey)
    )
  ) {
    return true;
  }

  if (
    shortcut.id === SHORTCUTS.newSessionTab.id
    && (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && event.key.toLowerCase() === "t"
  ) {
    return true;
  }

  if (
    (
      shortcut.id === SHORTCUTS.increaseWindowZoom.id
      || shortcut.id === SHORTCUTS.decreaseWindowZoom.id
    )
    && (event.metaKey || event.ctrlKey)
    && !event.altKey
    && (
      event.code === "Equal"
      || event.code === "Minus"
      || event.key === "+"
      || event.key === "="
      || event.key === "-"
    )
  ) {
    return true;
  }

  return false;
}

function isTabCyclingShortcut(
  shortcut: Pick<ShortcutDef, "id" | "match" | "nonMacMatch">,
  event: KeyboardShortcutEventLike,
): boolean {
  return (
    shortcut.id === SHORTCUTS.previousTab.id
    || shortcut.id === SHORTCUTS.nextTab.id
  ) && matchShortcutDef(shortcut, event) !== null;
}

function isDigitShortcutEvent(event: KeyboardShortcutEventLike): boolean {
  return /^[1-9]$/.test(event.key) || /^Digit[1-9]$/.test(event.code ?? "");
}

function isHighlightedComposerTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return typeof element?.closest === "function"
    && element.closest(
      "[data-chat-composer-editor][data-chat-composer-highlight]",
    ) !== null;
}

export function shouldDispatchKeyboardShortcut(
  shortcut: Pick<ShortcutDef, "allowInInputs" | "id" | "match" | "nonMacMatch">,
  event: KeyboardShortcutEventLike,
): boolean {
  // The composer's rich-text editor authors bold with the same primary-B
  // chord (Lexical's native FORMAT_TEXT_COMMAND handling). The editor owns
  // the key only while composer text is highlighted — the editor mirrors
  // that state onto its root as `data-chat-composer-highlight`. With a
  // collapsed caret, or focus anywhere else including the terminal, the
  // sidebar keeps it (PRO-265).
  if (
    shortcut.id === SHORTCUTS.toggleLeftSidebar.id
    && isHighlightedComposerTarget(event.target)
  ) {
    return false;
  }

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
