import type { ComposerShortcutDef } from "./types";

export const COMPOSER_SHORTCUTS = {
  submitMessage: {
    key: "Enter",
    label: "↵ / ⌘↵",
    nonMacLabel: "↵ / Ctrl+Enter",
    description: "Submit message",
  },
  previousMode: {
    key: "Tab",
    label: "⇧⇥",
    description: "Previous session mode",
  },
  stopSession: {
    key: "Escape",
    label: "Esc",
    description: "Stop running session",
  },
  editLastQueued: {
    key: "ArrowUp",
    label: "↑",
    description: "Edit newest queued message",
  },
} as const satisfies Record<string, ComposerShortcutDef>;

export type ComposerShortcutKey = keyof typeof COMPOSER_SHORTCUTS;
