export type ShortcutOwner = "js" | "native-menu";

interface ShortcutModifierMatch {
  meta: boolean;
  shift: boolean;
  alt: boolean;
  ctrl?: boolean;
}

export type ShortcutMatch =
  | ({
    kind: "fixed";
    key: string;
  } & ShortcutModifierMatch)
  | ({
    kind: "digit-key";
  } & ShortcutModifierMatch)
  | ({
    kind: "digit-code";
  } & ShortcutModifierMatch);

export interface ShortcutDef<Id extends string = string> {
  id: Id;
  label: string;
  description: string;
  owner: ShortcutOwner;
  match: ShortcutMatch;
  allowInInputs: boolean;
}

export interface ComposerShortcutDef {
  key: string;
  label: string;
  description: string;
}

export const SHORTCUTS = {
  openSettings: {
    id: "app.open-settings",
    label: "⌘,",
    description: "Open settings",
    owner: "native-menu",
    match: { kind: "fixed", key: ",", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  newWorktree: {
    id: "workspace.new-worktree",
    label: "⌘N",
    description: "New worktree workspace",
    owner: "js",
    match: { kind: "fixed", key: "n", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  newLocal: {
    id: "workspace.new-local",
    label: "⌘⇧N",
    description: "New local workspace",
    owner: "js",
    match: { kind: "fixed", key: "n", meta: true, shift: true, alt: false },
    allowInInputs: true,
  },
  newCloud: {
    id: "workspace.new-cloud",
    label: "⌘⌃N",
    description: "New cloud workspace",
    owner: "js",
    match: { kind: "fixed", key: "n", meta: true, ctrl: true, shift: false, alt: false },
    allowInInputs: true,
  },
  addRepository: {
    id: "workspace.add-repository",
    label: "⌘I",
    description: "Add repository",
    owner: "js",
    match: { kind: "fixed", key: "i", meta: true, shift: false, alt: false },
    allowInInputs: false,
  },
  workspaceByIndex: {
    id: "workspace.by-index",
    label: "⌘⌥1-9",
    description: "Switch to workspace by index",
    owner: "js",
    match: { kind: "digit-code", meta: true, shift: false, alt: true },
    allowInInputs: true,
  },
  previousTab: {
    id: "workspace.previous-tab",
    label: "⌘⇧←",
    description: "Previous tab",
    owner: "js",
    match: { kind: "fixed", key: "ArrowLeft", meta: true, shift: true, alt: false },
    allowInInputs: false,
  },
  nextTab: {
    id: "workspace.next-tab",
    label: "⌘⇧→",
    description: "Next tab",
    owner: "js",
    match: { kind: "fixed", key: "ArrowRight", meta: true, shift: true, alt: false },
    allowInInputs: false,
  },
  tabByIndex: {
    id: "workspace.tab-by-index",
    label: "⌘1-9",
    description: "Jump to tab by index",
    owner: "js",
    match: { kind: "digit-key", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  newSessionTab: {
    id: "workspace.new-session-tab",
    label: "⌘T",
    description: "New session tab",
    owner: "js",
    match: { kind: "fixed", key: "t", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  restoreTab: {
    id: "workspace.restore-tab",
    label: "⌘⇧T",
    description: "Restore last dismissed tab",
    owner: "js",
    match: { kind: "fixed", key: "t", meta: true, shift: true, alt: false },
    allowInInputs: true,
  },
  closeActiveTab: {
    id: "workspace.close-active-tab",
    label: "⌘W",
    description: "Close tab",
    owner: "native-menu",
    match: { kind: "fixed", key: "w", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  focusToggle: {
    id: "workspace.focus-toggle",
    label: "⌘L",
    description: "Toggle chat / terminal focus",
    owner: "js",
    match: { kind: "fixed", key: "l", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  openFilePalette: {
    id: "workspace.open-file-palette",
    label: "⌘P",
    description: "Open file palette",
    owner: "js",
    match: { kind: "fixed", key: "p", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  renameSession: {
    id: "session.rename",
    label: "⌘R",
    description: "Rename current chat",
    owner: "js",
    match: { kind: "fixed", key: "r", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
} as const satisfies Record<string, ShortcutDef>;

export type ShortcutId = (typeof SHORTCUTS)[keyof typeof SHORTCUTS]["id"];

export const COMPOSER_SHORTCUTS = {
  submitMessage: {
    key: "Enter",
    label: "↵",
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
} as const satisfies Record<string, ComposerShortcutDef>;
