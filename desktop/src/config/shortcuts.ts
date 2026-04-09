/**
 * Central shortcut definitions. Every keybinding in the app reads from here.
 *
 * `meta` means Cmd on macOS, Ctrl on Windows/Linux.
 * Hooks match via `(e.metaKey || e.ctrlKey)`.
 */

export interface ShortcutDef {
  /** `event.key` value (lowercase for letters, exact for special keys like "ArrowLeft") */
  key: string;
  meta: boolean;
  shift: boolean;
  label: string;
  description: string;
}

/**
 * Range shortcuts match a range of keys (e.g. digits 1-9) rather than a single key.
 * The `key` field is a human-readable range descriptor, NOT a valid `event.key` value.
 * These entries exist for documentation and label display only — the actual range
 * matching is done inline in the shortcut hooks.
 */
export interface RangeShortcutDef extends Omit<ShortcutDef, "key"> {
  /** Human-readable range descriptor. NOT usable in `event.key` comparisons. */
  key: `${string}-${string}`;
}

// ---------------------------------------------------------------------------
// Global (app-wide, no workspace required for some)
// ---------------------------------------------------------------------------

export const SHORTCUTS = {
  // Global — workspace context
  newWorktree: { key: "n", meta: true, shift: false, label: "⌘N", description: "New worktree workspace" },
  newLocal: { key: "n", meta: true, shift: true, label: "⌘⇧N", description: "New local workspace" },
  addRepository: { key: "i", meta: true, shift: false, label: "⌘I", description: "Add repository" },

  // Workspace tabs
  previousTab: { key: "ArrowLeft", meta: true, shift: true, label: "⌘⇧←", description: "Previous tab" },
  nextTab: { key: "ArrowRight", meta: true, shift: true, label: "⌘⇧→", description: "Next tab" },
  newSessionTab: { key: "t", meta: true, shift: false, label: "⌘T", description: "New session tab" },
  restoreTab: { key: "t", meta: true, shift: true, label: "⌘⇧T", description: "Restore last dismissed tab" },
  closeTab: { key: "w", meta: true, shift: false, label: "⌘W", description: "Close tab" },

  // Focus
  focusToggle: { key: "l", meta: true, shift: false, label: "⌘L", description: "Toggle chat / terminal focus" },
  openFilePalette: { key: "p", meta: true, shift: false, label: "⌘P", description: "Open file palette" },
  renameChat: { key: "r", meta: true, shift: false, label: "⌘R", description: "Rename current chat" },

  // Chat composer (textarea-scoped, not window-level)
  submitMessage: { key: "Enter", meta: false, shift: false, label: "↵", description: "Submit message" },
  previousMode: { key: "Tab", meta: false, shift: true, label: "⇧⇥", description: "Previous session mode" },
  stopSession: { key: "Escape", meta: false, shift: false, label: "Esc", description: "Stop running session" },
} as const satisfies Record<string, ShortcutDef>;

/**
 * Range-based shortcuts. Matching logic lives in their respective hooks;
 * these entries are for documentation and label display only.
 */
export const RANGE_SHORTCUTS = {
  /** Cmd+Option+1-9: switch workspace by sidebar index. Matched via e.code in use-global-shortcuts. */
  workspaceByIndex: { key: "1-9", meta: true, shift: false, label: "⌘⌥1-9", description: "Switch to workspace by index" },
  /** Cmd+1-9: jump to tab by index within workspace. Matched inline in use-workspace-tab-shortcuts. */
  tabByIndex: { key: "1-9", meta: true, shift: false, label: "⌘1-9", description: "Jump to tab by index" },
} as const satisfies Record<string, RangeShortcutDef>;
